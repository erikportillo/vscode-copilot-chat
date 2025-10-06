/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ChatPromptReference, ChatRequest, ExtendedChatResponsePart } from 'vscode';
import { getChatParticipantIdFromName } from '../../../platform/chat/common/chatAgents';
import { IRequestLogger } from '../../../platform/requestLogger/node/requestLogger';
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
import { IFormattedToolCall, ToolCallFormatter } from './toolCallFormatter';

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
	public sessionId = generateUuid();

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
	private _toolCallTracking = new Map<ChatRequest, IFormattedToolCall[]>();

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
		onCompletion?: (modelId: string) => void,
		onToolCall?: (modelId: string, toolCall: IFormattedToolCall) => void
	): Promise<{ response: string; error?: string; toolCalls?: IFormattedToolCall[] }> {

		if (this._isDisposed) {
			throw new Error('SingleModelChatHandler has been disposed');
		}

		try {
			// Create a proper ChatRequest for the model comparison
			const chatRequest = new ModelComparisonChatRequest(message);

			// Initialize tool call tracking for this request
			this._toolCallTracking.set(chatRequest, []);

			// Subscribe to tool call events from the RequestLogger
			const requestLogger = this.instantiationService.invokeFunction(accessor => accessor.get(IRequestLogger));
			console.log(`[SingleModelChatHandler] ${modelId} - Subscribing to tool calls for request:`, chatRequest.id);

			const toolCallDisposable = requestLogger.onDidLogToolCall(toolCall => {
				console.log(`[SingleModelChatHandler] ${modelId} - Tool call event received:`, {
					toolName: toolCall.name,
					toolRequestId: toolCall.chatRequest?.id,
					ourRequestId: chatRequest.id,
					match: toolCall.chatRequest?.id === chatRequest.id
				});

				// Only track tool calls for this specific chat request
				// Compare by ID since the chatRequest objects may be different instances
				if (toolCall.chatRequest?.id === chatRequest.id) {
					const formattedCall = ToolCallFormatter.formatToolCall(toolCall);
					const currentCalls = this._toolCallTracking.get(chatRequest) || [];
					currentCalls.push(formattedCall);
					this._toolCallTracking.set(chatRequest, currentCalls);

					console.log(`[SingleModelChatHandler] Tracked tool call for ${modelId}:`, formattedCall.displayMessage);

					// Notify listener of new tool call in real-time
					if (onToolCall) {
						onToolCall(modelId, formattedCall);
					}
				}
			});

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

			// Create a response stream that captures the output and tool calls
			// Note: ChatToolInvocationPart (with detailed invocationMessage) is only created
			// when there's a valid toolInvocationToken from a real chat request.
			// Since we create synthetic requests, we only get ChatPrepareToolInvocationPart.
			let responseContent = '';

			const baseResponseStream = new ChatResponseStreamImpl(
				(part: ExtendedChatResponsePart) => {
					// Detect tool invocations - we only get ChatPrepareToolInvocationPart
					// which contains just the tool name, not the full parameters
					if ((part as any).toolName) {
						const toolName = (part as any).toolName;
						const hasCallId = !!(part as any).toolCallId;

						if (hasCallId) {
							// This is ChatToolInvocationPart (unlikely without real toolInvocationToken)
							const invocationMsg = (part as any).invocationMessage;
							const displayText = typeof invocationMsg === 'string'
								? invocationMsg
								: invocationMsg?.value || toolName;
							console.log(`🔧 [${modelId}] Tool invocation: ${displayText}`);
						} else {
							// This is ChatPrepareToolInvocationPart (what we actually get)
							console.log(`🔄 [${modelId}] Tool call: ${toolName}`);
						}

						// Report the tool call to the comparison UI
						if (onDelta) {
							const toolCallDelta = {
								copilotToolCalls: [{
									id: (part as any).toolCallId || `prepare_${toolName}_${Date.now()}`,
									name: toolName,
									// Note: We don't have access to the actual parameters here
									arguments: JSON.stringify({ toolName })
								}]
							};
							onDelta(modelId, '', toolCallDelta);
						}
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

			// Wrap the response stream to use it with ChatParticipantRequestHandler
			const responseStream = baseResponseStream;

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

			// Dispose the tool call listener
			toolCallDisposable.dispose();

			// Get the tracked tool calls for this request
			const toolCalls = this._toolCallTracking.get(chatRequest) || [];
			console.log(`[SingleModelChatHandler] ${modelId} used ${toolCalls.length} tools:`, toolCalls.map(tc => tc.displayMessage));

			// Clean up tracking map
			this._toolCallTracking.delete(chatRequest);

			// Call completion callback if provided
			if (onCompletion) {
				onCompletion(modelId);
			}

			// Return the accumulated response with tool calls
			return {
				response: responseContent,
				error: undefined,
				toolCalls
			};

		} catch (error) {
			// Handle any errors that occurred during processing
			const errorMsg = error instanceof Error ? error.message : String(error);
			console.log(`❌ [${modelId}] Error occurred:`, errorMsg);
			return {
				response: '',
				error: errorMsg,
				toolCalls: []
			};
		}
	}

	/**
	 * Get tool calls tracked for a specific chat request
	 */
	public getToolCallsForRequest(chatRequest: ChatRequest): IFormattedToolCall[] {
		return this._toolCallTracking.get(chatRequest) || [];
	}

	/**
	 * Dispose of the handler and clean up resources
	 */
	dispose(): void {
		this._isDisposed = true;
		this._endpointCache.clear();
		this._toolCallTracking.clear();
	}
}