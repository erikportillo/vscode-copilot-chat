/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Raw } from '@vscode/prompt-tsx';
import { Location, type ChatPromptReference, type ChatRequest, type ExtendedChatResponsePart } from 'vscode';
import { getChatParticipantIdFromName } from '../../../platform/chat/common/chatAgents';
import { IRequestLogger } from '../../../platform/requestLogger/node/requestLogger';
import { ITabsAndEditorsService } from '../../../platform/tabs/common/tabsAndEditorsService';
import { ChatResponseStreamImpl } from '../../../util/common/chatResponseStreamImpl';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { Event } from '../../../util/vs/base/common/event';
import { IDisposable } from '../../../util/vs/base/common/lifecycle';
import { generateUuid } from '../../../util/vs/base/common/uuid';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { ChatLocation, ChatRequestTurn, ChatResponseMarkdownPart, ChatResponseTurn } from '../../../vscodeTypes';
import { Intent } from '../../common/constants';
import { IIntentService } from '../../intents/node/intentService';
import { PauseController } from '../../intents/node/pauseController';
import { ChatVariablesCollection } from '../../prompt/common/chatVariablesCollection';
import { ChatParticipantRequestHandler, IChatAgentArgs } from '../../prompt/node/chatParticipantRequestHandler';
import { IIntentInvocationContext } from '../../prompt/node/intents';
import { getContributedToolName } from '../../tools/common/toolNames';
import { IToolsService } from '../../tools/common/toolsService';
import { PromptModificationStore } from './promptModificationStore';
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

	// Store request-specific prompt modifier to avoid shared state issues
	public promptModifier?: (messages: Raw.ChatMessage[]) => Raw.ChatMessage[];
	public onPromptRendered?: (messages: Raw.ChatMessage[]) => void;

	constructor(
		public prompt: string,
		references: readonly ChatPromptReference[] = []
	) {
		this.references = references;
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
	private static _originalAgentInvoke: any = null; // Store the original invoke method once

	constructor(
		private readonly instantiationService: IInstantiationService,
		private readonly promptModificationStore?: PromptModificationStore
	) { }

	/**
	 * Gather context from the active editor (open file and selection)
	 * This mimics what the chat panel does with implicit context
	 */
	private gatherEditorContext(): ChatPromptReference[] {
		return this.instantiationService.invokeFunction(accessor => {
			const tabsAndEditorsService = accessor.get<ITabsAndEditorsService>(ITabsAndEditorsService);
			const activeTextEditor = tabsAndEditorsService.activeTextEditor;
			const references: ChatPromptReference[] = [];

			if (activeTextEditor) {
				const selection = activeTextEditor.selection;
				if (selection && !selection.isEmpty) {
					// Add the selection as a reference (similar to #selection variable)
					references.push({
						id: 'vscode.implicit',
						name: `file:${activeTextEditor.document.uri.path}`,
						value: new Location(activeTextEditor.document.uri, selection),
						modelDescription: `User's active selection`
					} as ChatPromptReference);
				} else {
					// Add the whole file if no selection
					references.push({
						id: 'vscode.implicit',
						name: `file:${activeTextEditor.document.uri.path}`,
						value: activeTextEditor.document.uri,
						modelDescription: `User's active file`
					} as ChatPromptReference);
				}
			}

			return references;
		});
	}

	/**
	 * Send a chat message to a single model and get the response
	 * @param modelId The model to use for the chat request
	 * @param message The user's message
	 * @param history Previous chat history (optional)
	 * @param cancellationToken Cancellation token for the request
	 * @param onProgress Optional streaming progress callback for text chunks
	 * @param modelMetadata Optional model metadata to create the LanguageModelChat object
	 * @param onDelta Optional callback for streaming delta with tool calls
	 * @param onCompletion Optional callback when the request completes
	 * @param onToolCall Optional callback when a tool call is detected
	 * @param onPromptRendered Optional callback when the prompt is rendered (before sending to model)
	 * @param promptModifier Optional function to modify the prompt messages before sending
	 * @param includeEditorContext Whether to include open file/selection as context (default: false)
	 * @param additionalReferences Additional ChatPromptReferences to include as context
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
		onToolCall?: (modelId: string, toolCall: IFormattedToolCall) => void,
		onPromptRendered?: (modelId: string, messages: Raw.ChatMessage[]) => void,
		promptModifier?: (modelId: string, messages: Raw.ChatMessage[]) => Raw.ChatMessage[],
		includeEditorContext: boolean = false,
		additionalReferences: ChatPromptReference[] = []
	): Promise<{ response: string; error?: string; toolCalls?: IFormattedToolCall[] }> {

		if (this._isDisposed) {
			throw new Error('SingleModelChatHandler has been disposed');
		}

		// Variables for intent restoration (declared outside try to be accessible in finally)
		let originalInvoke: any = null;
		let agentIntent: any = null;
		let chatRequest: ModelComparisonChatRequest | undefined;

		try {
			// Gather context from editor if requested
			const editorContext = includeEditorContext ? this.gatherEditorContext() : [];

			// Merge all references: editor context + additional references
			const allReferences = [...editorContext, ...additionalReferences];

			// Create a proper ChatRequest for the model comparison
			chatRequest = new ModelComparisonChatRequest(message, allReferences);

			// Create a non-nullable reference for TypeScript's benefit
			// (chatRequest is definitely assigned at this point)
			const request = chatRequest;

			// Initialize tool call tracking for this request
			this._toolCallTracking.set(request, []);

			// Subscribe to tool call events from the RequestLogger
			const requestLogger = this.instantiationService.invokeFunction(accessor => accessor.get(IRequestLogger));
			console.log(`[SingleModelChatHandler] ${modelId} - Subscribing to tool calls for request:`, request.id);

			const toolCallDisposable = requestLogger.onDidLogToolCall(toolCall => {
				console.log(`[SingleModelChatHandler] ${modelId} - Tool call event received:`, {
					toolName: toolCall.name,
					toolRequestId: toolCall.chatRequest?.id,
					ourRequestId: request.id,
					match: toolCall.chatRequest?.id === request.id
				});

				// Only track tool calls for this specific chat request
				// Compare by ID since the chatRequest objects may be different instances
				if (toolCall.chatRequest?.id === request.id) {
					const formattedCall = ToolCallFormatter.formatToolCall(toolCall);
					const currentCalls = this._toolCallTracking.get(request) || [];
					currentCalls.push(formattedCall);
					this._toolCallTracking.set(request, currentCalls);

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

				request.model = languageModelChat;
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
						request.tools.set(contributedName, true);
					}
				}
			});

			// Now use the same tool selection logic as the AgentIntent to get all available tools
			// This ensures we get the same tools as the regular chat panel
			const enabledTools = await this.instantiationService.invokeFunction(async accessor => {
				// Import the getAgentTools function from agentIntent.ts
				const { getAgentTools } = await import('../../intents/node/agentIntent');
				return await getAgentTools(this.instantiationService, request);
			});

			// Ensure all enabled tools are marked in the tools map
			for (const tool of enabledTools) {
				const contributedName = getContributedToolName(tool.name);
				if (contributedName) {
					request.tools.set(contributedName, true);
				}
			}

			console.log(`[SingleModelChatHandler] Enabled ${enabledTools.length} tools for ${modelId}:`, enabledTools.map((tool: any) => tool.name));
			console.log(`[SingleModelChatHandler] Total tools in request.tools map for ${modelId}:`, request.tools.size);
			console.log(`[SingleModelChatHandler] Tools map contents for ${modelId}:`, Array.from(request.tools.entries()));

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

			// PROMPT INTERCEPTION: Wrap the agent intent to intercept and modify prompts
			// This allows us to capture and modify the prompt before it's sent to the model
			// while still using ChatParticipantRequestHandler for all its benefits
			//
			// First, check if we have stored prompt modifications for this model
			const storedModification = this.promptModificationStore?.getModification(modelId);

			// Create a combined prompt modifier that applies both stored modifications and custom modifiers
			const combinedPromptModifier = (modelId: string, messages: Raw.ChatMessage[]): Raw.ChatMessage[] => {
				let modifiedMessages = [...messages];

				// Apply stored modifications first (if any)
				if (storedModification?.customSystemMessage) {
					// Find the system message
					const systemMessageIndex = modifiedMessages.findIndex(msg => msg.role === Raw.ChatRole.System);

					if (systemMessageIndex !== -1) {
						const originalContent = modifiedMessages[systemMessageIndex].content;

						if (storedModification.replaceSystemMessage) {
							// Replace the entire system message
							// Need to match the format of the original content
							let newContent: any;
							if (Array.isArray(originalContent)) {
								// Original was an array format, maintain the same structure
								newContent = [{
									type: Raw.ChatCompletionContentPartKind.Text,
									text: storedModification.customSystemMessage
								}];
							} else {
								// Original was a string
								newContent = storedModification.customSystemMessage;
							}

							modifiedMessages[systemMessageIndex] = {
								...modifiedMessages[systemMessageIndex],
								content: newContent
							};
							console.log(`[SingleModelChatHandler] ${modelId} - Replaced system message with custom prompt`);
						} else {
							// Prepend to the system message
							const contentStr = typeof originalContent === 'string' ? originalContent :
								(Array.isArray(originalContent) ? originalContent.map((part: any) => part.text || '').join('\n') : JSON.stringify(originalContent));

							let newContent: any;
							if (Array.isArray(originalContent)) {
								// Maintain array format
								newContent = [{
									type: Raw.ChatCompletionContentPartKind.Text,
									text: `${storedModification.customSystemMessage}\n\n${contentStr}`
								}];
							} else {
								// Maintain string format
								newContent = `${storedModification.customSystemMessage}\n\n${contentStr}`;
							}

							modifiedMessages[systemMessageIndex] = {
								...modifiedMessages[systemMessageIndex],
								content: newContent
							};
							console.log(`[SingleModelChatHandler] ${modelId} - Prepended custom prompt to system message`);
						}
					}
				}

				// Apply custom modifier if provided
				if (promptModifier) {
					modifiedMessages = promptModifier(modelId, modifiedMessages);
				}

				return modifiedMessages;
			};

			// PROMPT INTERCEPTION: Set up intent wrapping if needed
			if (onPromptRendered || promptModifier || storedModification) {
				// Store the prompt modifier and callback directly on the request object
				// This avoids shared state issues - each request has its own modifiers
				request.promptModifier = (messages: Raw.ChatMessage[]) => combinedPromptModifier(modelId, messages);
				request.onPromptRendered = (messages: Raw.ChatMessage[]) => {
					if (onPromptRendered) {
						onPromptRendered(modelId, messages);
					}
				};

				await this.instantiationService.invokeFunction(async accessor => {
					const intentService = accessor.get(IIntentService);
					agentIntent = intentService.getIntent(Intent.Agent, ChatLocation.Panel);

					if (agentIntent) {
						// Save the original invoke method (could be from a previous request or the true original)
						// Store it at class level the first time we see it
						if (SingleModelChatHandler._originalAgentInvoke === null) {
							SingleModelChatHandler._originalAgentInvoke = agentIntent.invoke.bind(agentIntent);
						}

						// Always use the originally saved invoke method
						originalInvoke = SingleModelChatHandler._originalAgentInvoke;

						// Create a wrapper that looks up modifiers from the request object (passed via context)
						const requestSpecificInvoke = async (context: IIntentInvocationContext) => {
							// Call the ORIGINAL invoke to get the invocation object
							const invocation = await originalInvoke(context);

							// Wrap the buildPrompt method to intercept prompt rendering
							const originalBuildPrompt = invocation.buildPrompt.bind(invocation);
							invocation.buildPrompt = async (promptContext: any, progress: any, token: any) => {
								// Call the original buildPrompt to get the rendered prompt
								const result = await originalBuildPrompt(promptContext, progress, token);

								// Look up the modifiers from the request object (from context)
								const chatRequest = context.request as ModelComparisonChatRequest;

								// Notify callback if present
								if (chatRequest.onPromptRendered) {
									chatRequest.onPromptRendered(result.messages);
								}

								// Apply modifier if present
								if (chatRequest.promptModifier) {
									const modifiedMessages = chatRequest.promptModifier(result.messages);
									return {
										...result,
										messages: modifiedMessages
									};
								}

								return result;
							};

							return invocation;
						};

						// Temporarily replace the invoke method with our wrapper
						agentIntent.invoke = requestSpecificInvoke;
					}
				});
			}

			// Create the request handler
			const requestHandler = this.instantiationService.createInstance(
				ChatParticipantRequestHandler,
				history,
				request,
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
			const toolCalls = this._toolCallTracking.get(request) || [];
			console.log(`[SingleModelChatHandler] ${modelId} used ${toolCalls.length} tools:`, toolCalls.map(tc => tc.displayMessage));

			// Clean up tracking map
			this._toolCallTracking.delete(request);

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

			// Clean up tracking map even on error (if chatRequest was created)
			if (chatRequest) {
				this._toolCallTracking.delete(chatRequest);
			}

			return {
				response: '',
				error: errorMsg,
				toolCalls: []
			};
		} finally {
			// CRITICAL: Restore the original intent invoke method if we modified it
			if (agentIntent && originalInvoke) {
				agentIntent.invoke = originalInvoke;
				console.log(`[SingleModelChatHandler] ${modelId} - Restored original intent invoke method`);
			}
		}
	}

	/**
	 * Get tool calls tracked for a specific chat request
	 */
	public getToolCallsForRequest(chatRequest: ChatRequest): IFormattedToolCall[] {
		return this._toolCallTracking.get(chatRequest) || [];
	}

	/**
	 * Capture the original system message that would be used for a model
	 * This renders the prompt without actually sending it to the model
	 */
	async captureOriginalSystemMessage(
		modelId: string,
		message: string = 'test',
		modelMetadata?: { id: string; name: string; family?: string; version?: string; vendor?: string }
	): Promise<string | undefined> {
		try {
			// Create a temporary chat request
			const chatRequest = new ModelComparisonChatRequest(message);

			// Set up the model if we have metadata
			if (modelMetadata) {
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

			// Capture the rendered prompt using the intent system
			let capturedSystemMessage: string | undefined;

			await this.instantiationService.invokeFunction(async accessor => {
				const intentService = accessor.get(IIntentService);
				const agentIntent = intentService.getIntent(Intent.Agent, ChatLocation.Panel);

				if (agentIntent) {
					// Store the original invoke method
					const originalInvoke = agentIntent.invoke.bind(agentIntent);

					// Temporarily replace invoke to capture the prompt
					agentIntent.invoke = async (context) => {
						const invocation = await originalInvoke(context);

						// Wrap buildPrompt to capture the rendered messages
						const originalBuildPrompt = invocation.buildPrompt.bind(invocation);
						invocation.buildPrompt = async (promptContext, progress, token) => {
							const result = await originalBuildPrompt(promptContext, progress, token);

							// Extract system message
							const systemMsg = result.messages.find((msg: Raw.ChatMessage) => msg.role === Raw.ChatRole.System);
							if (systemMsg) {
								if (typeof systemMsg.content === 'string') {
									capturedSystemMessage = systemMsg.content;
								} else if (Array.isArray(systemMsg.content)) {
									// Extract text from array of message parts (e.g., [{type: 1, text: "..."}, ...])
									capturedSystemMessage = systemMsg.content
										.map((part: any) => part.text || '')
										.filter((text: string) => text.length > 0)
										.join('\n');
								} else {
									capturedSystemMessage = JSON.stringify(systemMsg.content);
								}
							}

							return result;
						};

						return invocation;
					};

					// Create a minimal intent service context to trigger prompt building
					try {
						const intentContext: IIntentInvocationContext = {
							request: chatRequest,
							location: ChatLocation.Panel,
							// documentContext is optional for Panel location
							documentContext: undefined
						};

						const invocation = await agentIntent.invoke(intentContext);

						// Trigger prompt building with minimal context
						if (invocation && invocation.buildPrompt) {
							// Create a minimal but valid IBuildPromptContext
							const buildContext = {
								query: message,
								history: [], // Empty history for capturing just the system message
								chatVariables: new ChatVariablesCollection([]) // Empty chat variables
							};

							await invocation.buildPrompt(buildContext as any, undefined as any, undefined as any);
						}
					} catch (error) {
						console.error('[SingleModelChatHandler] Failed to capture system message:', error);
					}

					// Restore the original invoke method
					agentIntent.invoke = originalInvoke;
				}
			});

			return capturedSystemMessage;
		} catch (error) {
			console.error('[SingleModelChatHandler] Error capturing original system message:', error);
			return undefined;
		}
	}

	/**
	 * Format prompt messages into a readable string for display
	 */
	public static formatPromptForDisplay(messages: Raw.ChatMessage[]): string {
		return messages.map((msg, index) => {
			const role = String(msg.role).toUpperCase();
			const content = typeof msg.content === 'string'
				? msg.content
				: JSON.stringify(msg.content, null, 2);

			const toolCalls = (msg as any).toolCalls?.map((tc: any) =>
				`  Tool: ${tc.function.name}\n  Args: ${tc.function.arguments}`
			).join('\n') || '';

			return `[Message ${index + 1}: ${role}]\n${content}${toolCalls ? '\n' + toolCalls : ''}`;
		}).join('\n\n---\n\n');
	}

	/**
	 * Extract key information from prompt messages
	 */
	public static analyzePrompt(messages: Raw.ChatMessage[]): {
		systemMessageCount: number;
		userMessageCount: number;
		assistantMessageCount: number;
		totalTokensEstimate: number;
		hasTools: boolean;
	} {
		let systemMessageCount = 0;
		let userMessageCount = 0;
		let assistantMessageCount = 0;
		let totalChars = 0;
		let hasTools = false;

		for (const msg of messages) {
			switch (msg.role) {
				case Raw.ChatRole.System:
					systemMessageCount++;
					break;
				case Raw.ChatRole.User:
					userMessageCount++;
					break;
				case Raw.ChatRole.Assistant:
					assistantMessageCount++;
					break;
			}

			const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
			totalChars += content.length;

			if ((msg as any).toolCalls && (msg as any).toolCalls.length > 0) {
				hasTools = true;
			}
		}

		return {
			systemMessageCount,
			userMessageCount,
			assistantMessageCount,
			totalTokensEstimate: Math.ceil(totalChars / 4), // Rough estimate: 4 chars per token
			hasTools
		};
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