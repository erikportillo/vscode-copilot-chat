/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, CancellationTokenSource } from '../../../util/vs/base/common/cancellation';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { ChatRequestTurn, ChatResponseTurn } from '../../../vscodeTypes';
import { PauseController } from '../../intents/node/pauseController';
import { ComparisonToolCoordinator, IComparisonToolState } from './comparisonToolCoordinator';
import { SingleModelChatHandler } from './singleModelChatHandler';
import { IToolCallDetection, ToolCallDetectionService } from './toolCallDetectionService';
import { IFormattedToolCall } from './toolCallFormatter';

/**
 * Response from a single model chat request
 */
export interface ModelChatResponse {
	modelId: string;
	response: string;
	error?: string;
	isComplete: boolean;
	timestamp: number;
	toolCalls?: IFormattedToolCall[];
}

/**
 * Progress callback for streaming responses
 */
export type StreamingProgressCallback = (modelId: string, chunk: string) => void;

/**
 * Orchestrates chat requests across multiple models simultaneously for fair comparison
 *
 * This class manages the complex process of:
 * 1. Sending identical chat requests to multiple AI models concurrently
 * 2. Handling streaming responses from each model independently
 * 3. Aggregating responses while preserving individual model context
 * 4. Coordinating tool execution control across all models
 *
 * Key implementation details:
 * - Uses SingleModelChatHandler instances that route through ChatParticipantRequestHandler
 * - Model selection works by creating LanguageModelChat objects with vendor: 'copilot'
 * - The endpoint provider matches models by id, version, and family to route to correct endpoints
 * - Supports both streaming and non-streaming response aggregation
 * - Includes tool call detection and pause coordination for user approval
 *
 * @see SingleModelChatHandler for individual model request handling
 * @see ResponseAggregator for response synchronization logic
 * @see ComparisonToolCoordinator for tool execution control
 */
export class ComparisonChatOrchestrator extends Disposable {

	private readonly chatHandlers = new Map<string, SingleModelChatHandler>();
	private readonly toolCoordinator: ComparisonToolCoordinator;
	private readonly toolDetectionService: ToolCallDetectionService;
	private readonly modelCancellationTokenSources = new Map<string, CancellationTokenSource>();

	constructor(
		private readonly instantiationService: IInstantiationService
	) {
		super();

		// Initialize tool coordination services
		this.toolCoordinator = this._register(new ComparisonToolCoordinator());
		this.toolDetectionService = this._register(new ToolCallDetectionService());

		// Set up tool call detection
		this._register(this.toolDetectionService.onToolCallDetected(detection => {
			this.handleToolCallDetection(detection);
		}));
	}

	/**
	 * Get the tool coordinator for external access
	 */
	public getToolCoordinator(): ComparisonToolCoordinator {
		return this.toolCoordinator;
	}

	/**
	 * Get current tool state for UI updates
	 */
	public getCurrentToolState(): IComparisonToolState {
		return this.toolCoordinator.getCurrentToolState();
	}

	/**
	 * Handle tool call detection from any model
	 */
	private handleToolCallDetection(detection: IToolCallDetection): void {
		console.log(`🔧 [${detection.modelId}] Requesting ${detection.toolCalls.length} tool calls`);

		// Update the tool coordinator with the detected tool calls
		this.toolCoordinator.updateModelToolCalls(detection.modelId, detection.toolCalls);

		// Pause the specific model that wants to call tools
		if (this.toolCoordinator.hasToolCallsPending()) {
			console.log(`⏸️ [${detection.modelId}] Paused for tool approval`);
			this.toolCoordinator.pauseModel(detection.modelId);
		}
	}

	/**
	 * Send a chat message to multiple models simultaneously for comparison
	 *
	 * This method orchestrates parallel chat requests to ensure fair model comparison:
	 * - Each model receives identical input (message + history)
	 * - Model routing uses proper LanguageModelChat objects with vendor: 'copilot'
	 * - Responses are collected independently to preserve individual model characteristics
	 * - Supports both streaming (via onProgress) and batch response collection
	 *
	 * @param modelIds Array of model IDs to query
	 * @param message The chat message to send
	 * @param history Previous chat history (optional)
	 * @param cancellationToken Cancellation token
	 * @param onProgress Optional streaming progress callback (modelId, chunk) => void
	 * @param modelMetadataMap Optional map of model metadata for enhanced routing
	 * @returns Promise resolving to array of model responses with timing and error info
	 */
	async sendChatMessageToMultipleModels(
		modelIds: string[],
		message: string,
		history: ReadonlyArray<ChatRequestTurn | ChatResponseTurn> = [],
		cancellationToken: CancellationToken,
		onProgress?: StreamingProgressCallback,
		modelMetadataMap?: Map<string, { id: string; name: string; family?: string; version?: string; vendor?: string }>,
		onToolCall?: (modelId: string, toolCall: IFormattedToolCall) => void
	): Promise<ModelChatResponse[]> {
		if (modelIds.length === 0) {
			return [];
		}

		// Create or reuse chat handlers for each model
		const chatPromises: Promise<ModelChatResponse>[] = [];

		for (const modelId of modelIds) {
			// Get or create handler for this model
			let handler = this.chatHandlers.get(modelId);
			if (!handler) {
				handler = this._register(new SingleModelChatHandler(this.instantiationService));
				this.chatHandlers.set(modelId, handler);
			}

			// Clean up any existing cancellation token source for this model (from previous cancelled request)
			const existingTokenSource = this.modelCancellationTokenSources.get(modelId);
			if (existingTokenSource) {
				existingTokenSource.dispose();
			}

			// Create a per-model cancellation token source
			const modelCancellationTokenSource = new CancellationTokenSource();
			this.modelCancellationTokenSources.set(modelId, modelCancellationTokenSource);

			// Link the parent cancellation token to this model's token
			if (cancellationToken.isCancellationRequested) {
				modelCancellationTokenSource.cancel();
			} else {
				cancellationToken.onCancellationRequested(() => {
					modelCancellationTokenSource.cancel();
				});
			}

			// Clean up any existing pause controller for this model (from previous cancelled request)
			const existingPauseController = this.toolCoordinator.getPauseController(modelId);
			if (existingPauseController) {
				this.toolCoordinator.unregisterModel(modelId);
			}

			// Create a new pause controller for this model using its own cancellation token
			const pauseController = this._register(new PauseController(
				this.toolCoordinator.getModelPauseEvent(modelId),
				modelCancellationTokenSource.token
			));
			this.toolCoordinator.registerModel(modelId, pauseController);

			// Create enhanced progress callback that also detects tool calls
			const modelProgressCallback = onProgress
				? (chunk: string) => {
					// First, call the original progress callback
					onProgress(modelId, chunk);
					// Then, process the chunk for tool call detection
					this.toolDetectionService.processResponseChunk(modelId, chunk, undefined);
				}
				: (chunk: string) => {
					// Even without external progress callback, still detect tool calls
					this.toolDetectionService.processResponseChunk(modelId, chunk, undefined);
				};

			// Get model metadata for this model
			const modelMetadata = modelMetadataMap?.get(modelId);

			// Create delta callback for tool call detection
			const modelDeltaCallback = (modelId: string, text: string, delta: any) => {
				// Process the delta for tool call detection
				this.toolDetectionService.processResponseChunk(modelId, text, delta);
			};

			// Create completion callback that marks tool execution as completed
			const modelCompletionCallback = (completedModelId: string) => {
				this.toolCoordinator.markToolExecutionCompleted(completedModelId);
			};

			// Start the chat request for this model
			const chatPromise = this.handleSingleModelRequest(
				handler,
				modelId,
				message,
				history,
				pauseController, // Use pause controller instead of cancellation token directly
				modelProgressCallback,
				modelMetadata,
				modelDeltaCallback,
				modelCompletionCallback,
				onToolCall
			);

			chatPromises.push(chatPromise);
		}

		// Wait for all models to complete (or fail)
		const results = await Promise.allSettled(chatPromises);

		// Convert PromiseSettledResult to ModelChatResponse
		return results.map((result, index) => {
			const modelId = modelIds[index];
			const timestamp = Date.now();

			if (result.status === 'fulfilled') {
				return result.value;
			} else {
				// Handle promise rejection
				const error = result.reason instanceof Error
					? result.reason.message
					: String(result.reason);

				return {
					modelId,
					response: '',
					error,
					isComplete: true,
					timestamp,
					toolCalls: []
				};
			}
		});
	}

	/**
	 * Handle a single model request and convert to ModelChatResponse
	 */
	private async handleSingleModelRequest(
		handler: SingleModelChatHandler,
		modelId: string,
		message: string,
		history: ReadonlyArray<ChatRequestTurn | ChatResponseTurn>,
		pauseController: PauseController,
		onProgress?: (chunk: string) => void,
		modelMetadata?: { id: string; name: string; family?: string; version?: string; vendor?: string },
		onDelta?: (modelId: string, text: string, delta: any) => void,
		onCompletion?: (modelId: string) => void,
		onToolCall?: (modelId: string, toolCall: IFormattedToolCall) => void
	): Promise<ModelChatResponse> {

		const timestamp = Date.now();

		try {
			const result: { response: string; error?: string; toolCalls?: IFormattedToolCall[] } = await handler.sendChatMessage(
				modelId,
				message,
				history,
				pauseController, // Pass the pause controller
				onProgress,
				modelMetadata,
				onDelta,
				onCompletion,
				onToolCall
			);

			return {
				modelId,
				response: result.response,
				error: result.error,
				isComplete: true,
				timestamp,
				toolCalls: result.toolCalls || []
			};

		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			return {
				modelId,
				response: '',
				error: errorMsg,
				isComplete: true,
				timestamp,
				toolCalls: []
			};
		}
	}

	/**
	 * Cancel all ongoing requests
	 */
	cancelAllRequests(): void {
		// Cancel all per-model cancellation token sources
		for (const [modelId, tokenSource] of this.modelCancellationTokenSources) {
			console.log(`[ComparisonChatOrchestrator] Cancelling request for model: ${modelId}`);
			tokenSource.cancel();
			tokenSource.dispose();
		}
		this.modelCancellationTokenSources.clear();

		// Clean up pause controllers so new requests get fresh ones
		// The tool coordinator owns these, so just unregister all models
		for (const modelId of this.toolCoordinator.getRegisteredModelIds()) {
			this.toolCoordinator.unregisterModel(modelId);
		}
	}

	/**
	 * Cancel a specific model's request
	 */
	cancelModelRequest(modelId: string): void {
		const tokenSource = this.modelCancellationTokenSources.get(modelId);
		if (tokenSource) {
			console.log(`[ComparisonChatOrchestrator] Cancelling request for model: ${modelId}`);
			tokenSource.cancel();
			tokenSource.dispose();
			this.modelCancellationTokenSources.delete(modelId);
		}

		// Clean up the pause controller so new requests get a fresh one
		// The tool coordinator owns it, so just unregister the model
		this.toolCoordinator.unregisterModel(modelId);
	}

	/**
	 * Get the number of models currently being handled
	 */
	getHandlerCount(): number {
		return this.chatHandlers.size;
	}

	/**
	 * Clear all handlers (useful for cleanup or reset)
	 */
	clearHandlers(): void {
		// Cancel any ongoing requests first
		this.cancelAllRequests();

		// Dispose and clear cancellation token sources
		for (const tokenSource of this.modelCancellationTokenSources.values()) {
			tokenSource.dispose();
		}
		this.modelCancellationTokenSources.clear();

		for (const handler of this.chatHandlers.values()) {
			handler.dispose();
		}
		this.chatHandlers.clear();

		// Clear pause controllers by unregistering all models from the tool coordinator
		for (const modelId of this.toolCoordinator.getRegisteredModelIds()) {
			this.toolCoordinator.unregisterModel(modelId);
		}

		// Clear tool detection buffers
		this.toolDetectionService.clearAllBuffers();
	}

	/**
	 * Dispose of the orchestrator and clean up all handlers
	 */
	override dispose(): void {
		this.clearHandlers();
		super.dispose();
	}
}