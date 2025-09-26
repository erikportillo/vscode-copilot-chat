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
import { ChatParticipantRequestHandler, IChatAgentArgs } from '../../prompt/node/chatParticipantRequestHandler';

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

	constructor(
		private readonly instantiationService: IInstantiationService
	) { }

	/**
	 * Send a chat message to a single model and get the response
	 * @param modelId The model to use for the chat request
	 * @param message The user's message
	 * @param history Previous chat history (optional)
	 * @param cancellationToken Cancellation token for the request
	 * @param modelMetadata Optional model metadata to create the LanguageModelChat object
	 * @returns Promise that resolves when the response is complete
	 */
	async sendChatMessage(
		modelId: string,
		message: string,
		history: ReadonlyArray<ChatRequestTurn | ChatResponseTurn> = [],
		cancellationToken: CancellationToken,
		onProgress?: (chunk: string) => void,
		modelMetadata?: { id: string; name: string; family?: string; version?: string; vendor?: string }
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
				// The endpoint provider uses vendor: 'copilot' to route through ModelMetadataFetcher.getChatModelFromApiModel()
				// which matches models by id, version, and family properties to resolve to the correct endpoint
				const languageModelChat: any = {
					id: modelMetadata.id,
					name: modelMetadata.name,
					vendor: 'copilot',
					family: modelMetadata.family || modelMetadata.id,
					version: modelMetadata.version || '1.0.0'
				};
				chatRequest.model = languageModelChat;
			}

			// Create a response stream that captures the output
			let responseContent = '';

			const responseStream = new ChatResponseStreamImpl(
				(part: ExtendedChatResponsePart) => {
					// Handle different types of response parts
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
						console.log(`[SingleModelChatHandler] Extracted content for ${modelId}:`, content);
						responseContent += content;
						if (onProgress) {
							onProgress(content);
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
				intentId: Intent.Unknown // Let the system auto-detect intent
			};

			// Create the ChatParticipantRequestHandler
			const requestHandler = this.instantiationService.createInstance(
				ChatParticipantRequestHandler,
				history,
				chatRequest,
				responseStream,
				cancellationToken,
				chatAgentArgs,
				Event.None // No pause events for single model handler
			);

			// Execute the request and wait for completion
			console.log(`[SingleModelChatHandler] Starting request for model ${modelId} with message: "${message}"`);
			await requestHandler.getResult();
			console.log(`[SingleModelChatHandler] Completed request for model ${modelId}, response length: ${responseContent.length}`);

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
	}
}