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
	public model = null!;
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
	 * @returns Promise that resolves when the response is complete
	 */
	async sendChatMessage(
		modelId: string,
		message: string,
		history: ReadonlyArray<ChatRequestTurn | ChatResponseTurn> = [],
		cancellationToken: CancellationToken,
		onProgress?: (chunk: string) => void
	): Promise<{ response: string; error?: string }> {

		if (this._isDisposed) {
			throw new Error('SingleModelChatHandler has been disposed');
		}

		try {
			// Create a proper ChatRequest for the model comparison
			const chatRequest = new ModelComparisonChatRequest(message);

			// Create a response stream that captures the output
			let responseContent = '';

			const responseStream = new ChatResponseStreamImpl(
				(part: ExtendedChatResponsePart) => {
					// Handle different types of response parts
					if (part instanceof ChatResponseMarkdownPart) {
						const content = typeof part.value === 'string' ? part.value : part.value.value;
						responseContent += content;
						if (onProgress) {
							onProgress(content);
						}
					}
					// For other part types, we can add handling as needed
					// For now, we'll just extract any text content
					else if ('value' in part && typeof part.value === 'string') {
						responseContent += part.value;
						if (onProgress) {
							onProgress(part.value);
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
			await requestHandler.getResult();

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