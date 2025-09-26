/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { ChatRequestTurn, ChatResponseTurn } from '../../../vscodeTypes';
import { PauseController } from '../../intents/node/pauseController';
import { ComparisonToolCoordinator, IComparisonToolState } from './comparisonToolCoordinator';
import { SingleModelChatHandler } from './singleModelChatHandler';
import { IToolCallDetection, ToolCallDetectionService } from './toolCallDetectionService';

/**
 * Response from a single model chat request
 */
export interface ModelChatResponse {
	modelId: string;
	response: string;
	error?: string;
	isComplete: boolean;
	timestamp: number;
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
	private readonly modelPauseControllers = new Map<string, PauseController>();

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
		modelMetadataMap?: Map<string, { id: string; name: string; family?: string; version?: string; vendor?: string }>
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

			// Create or get pause controller for this model
			let pauseController = this.modelPauseControllers.get(modelId);
			if (!pauseController) {
				// Use model-specific pause event instead of shared event
				pauseController = this._register(new PauseController(
					this.toolCoordinator.getModelPauseEvent(modelId),
					cancellationToken
				));
				this.modelPauseControllers.set(modelId, pauseController);
				this.toolCoordinator.registerModel(modelId, pauseController);
			}

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
				modelCompletionCallback
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
					timestamp
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
		onCompletion?: (modelId: string) => void
	): Promise<ModelChatResponse> {

		const timestamp = Date.now();

		try {
			const result = await handler.sendChatMessage(
				modelId,
				message,
				history,
				pauseController, // Pass the pause controller
				onProgress,
				modelMetadata,
				onDelta,
				onCompletion
			);

			return {
				modelId,
				response: result.response,
				error: result.error,
				isComplete: true,
				timestamp
			};

		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			return {
				modelId,
				response: '',
				error: errorMsg,
				isComplete: true,
				timestamp
			};
		}
	}

	/**
	 * Cancel all ongoing requests
	 */
	cancelAllRequests(): void {
		// Individual requests are cancelled via the cancellation token passed to them
		// This method could be extended to track and cancel individual requests if needed
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
		for (const handler of this.chatHandlers.values()) {
			handler.dispose();
		}
		this.chatHandlers.clear();

		// Also clear pause controllers and unregister from tool coordinator
		for (const [modelId, pauseController] of this.modelPauseControllers) {
			this.toolCoordinator.unregisterModel(modelId);
			pauseController.dispose();
		}
		this.modelPauseControllers.clear();

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