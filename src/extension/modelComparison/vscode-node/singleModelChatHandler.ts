/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ChatPromptReference, ChatRequest, ExtendedChatResponsePart } from 'vscode';
import { getChatParticipantIdFromName } from '../../../platform/chat/common/chatAgents';
import { ChatResponseStreamImpl } from '../../../util/common/chatResponseStreamImpl';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { Event } from '../../../util/vs/base/common/event';
import { IDisposable } from '../../../util/vs/base/common/lifecycle';
import { generateUuid } from '../../../util/vs/base/common/uuid';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { ChatLocation, ChatRequestTurn, ChatResponseMarkdownPart, ChatResponseTurn } from '../../../vscodeTypes';
import { Intent } from '../../common/constants';
import { PauseController } from '../../intents/node/pauseController';
import { ChatParticipantRequestHandler, IChatAgentArgs } from '../../prompt/node/chatParticipantRequestHandler';
import { getContributedToolName } from '../../tools/common/toolNames';
import { IToolsService } from '../../tools/common/toolsService';

/**
 * Simple ChatRequest implementation for model comparison
 */
class ModelComparisonChatRequest implements ChatRequest {
	public command: string | undefined;
	public references: readonly ChatPromptReference[];
	public location: ChatLocation;
	public location2 = undefined;
	public attempt: number;
	public enableCommandDetection: boolean;
	public isParticipantDetected: boolean;
	public toolReferences = [];
	public toolInvocationToken: never = undefined as never;
	public model: any = null;
	public tools = new Map();
	public id = generateUuid();

	constructor(
		public prompt: string
	) {
		this.references = [];
		this.location = ChatLocation.Panel;
		this.attempt = 0;
		this.enableCommandDetection = false;
		this.isParticipantDetected = false;
	}
}

/**
 * Handles chat requests for a single model in the model comparison panel
 */
export class SingleModelChatHandler implements IDisposable {

	private _isDisposed = false;
	private _endpointCache = new Map<string, any>();

	constructor(
		private readonly instantiationService: IInstantiationService
	) { }

	/**
	 * Send a chat message to a single model and get the response
	 * @param modelId The model to use for the chat request
	 * @param message The user's message
	 * @param history Previous chat history (optional)
	 * @param cancellationToken Cancellation token for the request
	 * @param onProgress Optional streaming progress callback for text chunks
	 * @param modelMetadata Optional model metadata to create the LanguageModelChat object
	 * @param onDelta Optional callback for streaming delta with tool calls
	 * @returns Promise that resolves when the response is complete
	 */
	async sendChatMessage(
		modelId: string,
		message: string,
		history: ReadonlyArray<ChatRequestTurn | ChatResponseTurn> = [],
		cancellationToken: CancellationToken | PauseController,
		onProgress?: (chunk: string) => void,
		modelMetadata?: { id: string; name: string; family?: string; version?: string; vendor?: string },
		onDelta?: (modelId: string, text: string, delta: any) => void,
		onCompletion?: (modelId: string) => void
	): Promise<{ response: string; error?: string }> {

		if (this._isDisposed) {
			throw new Error('SingleModelChatHandler has been disposed');
		}

		try {
			// Create a proper ChatRequest for the model comparison
			const chatRequest = new ModelComparisonChatRequest(message);

			// If we have model metadata, create a proper LanguageModelChat object
			if (modelMetadata) {
				// Create LanguageModelChat with vendor: 'copilot' - this is crucial for proper model routing
				// Cache the model object to avoid repeated creation overhead
				const modelCacheKey = JSON.stringify(modelMetadata);
				let languageModelChat = this._endpointCache.get(modelCacheKey);

				if (!languageModelChat) {
					languageModelChat = {
						id: modelMetadata.id,
						name: modelMetadata.name,
						vendor: 'copilot',
						family: modelMetadata.family || modelMetadata.id,
						version: modelMetadata.version || '1.0.0'
					};
					this._endpointCache.set(modelCacheKey, languageModelChat);
				}

				chatRequest.model = languageModelChat;
			}

			// First populate the tools map with VS Code's default tool selections
			// This is what VS Code does automatically for regular chat requests
			await this.instantiationService.invokeFunction(async accessor => {
				const toolsService = accessor.get<IToolsService>(IToolsService);

				// Get all available tools from VS Code
				const allTools = toolsService.tools;

				// Enable tools that would be enabled by default in VS Code
				// This includes tools in toolsets or marked as canBeReferencedInPrompt
				for (const tool of allTools) {
					// Enable contributed tools (these come from VS Code's contribution system)
					const contributedName = getContributedToolName(tool.name);
					if (contributedName && contributedName.startsWith('copilot_')) {
						chatRequest.tools.set(contributedName, true);
					}
				}
			});

			// Now use the same tool selection logic as the AgentIntent to get all available tools
			// This ensures we get the same tools as the regular chat panel
			const enabledTools = await this.instantiationService.invokeFunction(async accessor => {
				// Import the getAgentTools function from agentIntent.ts
				const { getAgentTools } = await import('../../intents/node/agentIntent');
				return await getAgentTools(this.instantiationService, chatRequest);
			});

			// Ensure all enabled tools are marked in the tools map
			for (const tool of enabledTools) {
				const contributedName = getContributedToolName(tool.name);
				if (contributedName) {
					chatRequest.tools.set(contributedName, true);
				}
			}

			console.log(`[SingleModelChatHandler] Enabled ${enabledTools.length} tools for ${modelId}:`, enabledTools.map((tool: any) => tool.name));
			console.log(`[SingleModelChatHandler] Total tools in chatRequest.tools map for ${modelId}:`, chatRequest.tools.size);
			console.log(`[SingleModelChatHandler] Tools map contents for ${modelId}:`, Array.from(chatRequest.tools.entries()));

			// Create a response stream that captures the output
			let responseContent = '';

			const responseStream = new ChatResponseStreamImpl(
				(part: ExtendedChatResponsePart) => {
					// Enhanced logging to understand what we're receiving
					const partDetails = {
						constructor: part.constructor.name,
						keys: Object.keys(part),
						toolName: (part as any).toolName,
						kind: (part as any).kind,
						type: (part as any).type,
						name: (part as any).name,
						id: (part as any).id,
						callId: (part as any).callId,
						hasValue: 'value' in part,
						hasText: 'text' in part,
						hasContent: 'content' in part
					};
					// Only log significant parts like tool calls, not every streaming chunk
					if ((part as any).toolName || partDetails.keys.length > 3) {
						console.log(`📡 [${modelId}] Response part:`, partDetails.keys.join(', '));
					}

					// Check for tool call parts - based on the log, look for toolName property
					if ((part as any).toolName) {
						console.log(`🔧 [${modelId}] Tool call: ${(part as any).toolName}`);
						if (onDelta) {
							// Create a structured delta with tool calls
							const toolCallDelta = {
								copilotToolCalls: [{
									id: (part as any).id || (part as any).callId || `tool_call_${Date.now()}`,
									name: (part as any).toolName,
									arguments: (part as any).arguments || JSON.stringify((part as any).input || {})
								}]
							};
							onDelta(modelId, '', toolCallDelta);
						} else {
							console.log(`[SingleModelChatHandler] *** NO onDelta CALLBACK *** for ${modelId}`);
						}
						// Still continue processing - don't return early to avoid breaking streaming
					}

					// Check for other tool call indicators
					if ((part as any).kind === 'toolCall' || (part as any).type === 'toolCall') {
						console.log(`[SingleModelChatHandler] Found tool call part (kind/type) for ${modelId}:`, part);
						if (onDelta) {
							// Create a structured delta with tool calls
							const toolCallDelta = {
								copilotToolCalls: [{
									id: (part as any).id || (part as any).callId || `tool_call_${Date.now()}`,
									name: (part as any).name || (part as any).toolName,
									arguments: (part as any).arguments || JSON.stringify((part as any).input || {})
								}]
							};
							console.log(`[SingleModelChatHandler] Created tool call delta (kind/type) for ${modelId}:`, toolCallDelta);
							onDelta(modelId, '', toolCallDelta);
						}
						// Still continue processing - don't return early to avoid breaking streaming
					}

					// Handle different types of response parts for text content
					let content: string | undefined;
					if (part instanceof ChatResponseMarkdownPart) {
						content = typeof part.value === 'string' ? part.value : part.value.value;
					}
					// Handle parts with a value property that might be a string or object with value/text
					else if ('value' in part) {
						const value = (part as any).value;
						if (typeof value === 'string') {
							content = value;
						} else if (value && typeof value === 'object') {
							// Check for nested value or text properties
							if (typeof value.value === 'string') {
								content = value.value;
							} else if (typeof value.text === 'string') {
								content = value.text;
							} else if (typeof value.content === 'string') {
								content = value.content;
							}
						}
					}
					// Handle parts that might have text property directly
					else if ('text' in part && typeof (part as any).text === 'string') {
						content = (part as any).text;
					}
					// Handle parts that might have content property directly
					else if ('content' in part && typeof (part as any).content === 'string') {
						content = (part as any).content;
					}

					if (content) {
						responseContent += content;
						if (onProgress) {
							onProgress(content);
						}
						// Call the delta callback with just the text for now (no structured delta available here)
						if (onDelta) {
							onDelta(modelId, content, undefined);
						}
					}
				},
				() => {
					// Handle clearToPreviousToolInvocation - no-op for now
				}
			);

			// Configure chat agent arguments for the default copilot agent
			const chatAgentArgs: IChatAgentArgs = {
				agentName: 'copilot',
				agentId: getChatParticipantIdFromName('copilot'),
				intentId: Intent.Agent // Use agent mode to get tool usage instructions
			};

			// Create pause events from the cancellation token if it's a PauseController
			const pauseEvents = (cancellationToken as any).onDidChangePause
				? (cancellationToken as any).onDidChangePause
				: Event.None;

			// Set up pause event listener for tool approval workflow
			if ((cancellationToken as any).onDidChangePause) {
				(cancellationToken as any).onDidChangePause((isPaused: boolean) => {
					if (isPaused) {
						console.log(`⏸️ [${modelId}] Paused for tool approval`);
					} else {
						console.log(`▶️ [${modelId}] Resumed execution`);
					}
				});
			}

			// Extract the underlying CancellationToken if we have a PauseController
			const actualCancellationToken = (cancellationToken as any).token ?? cancellationToken;

			// Create the request handler
			const requestHandler = this.instantiationService.createInstance(
				ChatParticipantRequestHandler,
				history,
				chatRequest,
				responseStream,
				actualCancellationToken,
				chatAgentArgs,
				pauseEvents
			);

			// Execute the request and wait for completion
			console.log(`🤖 [${modelId}] Starting chat request`);
			await requestHandler.getResult();
			console.log(`✅ [${modelId}] Completed (${responseContent.length} chars)`);

			// Call completion callback if provided
			if (onCompletion) {
				onCompletion(modelId);
			}

			// Return the accumulated response
			return {
				response: responseContent,
				error: undefined
			};

		} catch (error) {
			// Handle any errors that occurred during processing
			const errorMsg = error instanceof Error ? error.message : String(error);
			return {
				response: '',
				error: errorMsg
			};
		}
	}

	/**
	 * Dispose of the handler and clean up resources
	 */
	dispose(): void {
		this._isDisposed = true;
		this._endpointCache.clear();
	}
}