/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * REFERENCE IMPLEMENTATION ONLY - DO NOT USE
 *
 * This file demonstrates how to use the Language Model API directly to get full access
 * to tool call parameters. However, this approach is NOT SUITABLE for the model comparison
 * panel because:
 *
 * 1. **Breaks Fidelity**: The comparison panel must use the exact same code path as the
 *    real chat panel (ChatParticipantRequestHandler) to ensure accurate comparison.
 *
 * 2. **Missing Features**: Direct API bypasses intent detection, context gathering, and
 *    prompt crafting that are part of the production chat experience.
 *
 * 3. **Different Behavior**: Models would receive different prompts and context compared
 *    to what users experience, making comparison results misleading.
 *
 * This file is kept as a reference for other use cases where direct Language Model API
 * access is appropriate (e.g., experiments, custom workflows, non-participant contexts).
 *
 * For the model comparison panel, use SingleModelChatHandler which uses
 * ChatParticipantRequestHandler for production fidelity.
 */

import * as vscode from 'vscode';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { IDisposable } from '../../../util/vs/base/common/lifecycle';

/**
 * Simplified chat handler that uses the Language Model API directly
 * instead of going through ChatParticipantRequestHandler.
 *
 * This approach gives us full access to tool call parameters but requires
 * implementing our own tool calling loop.
 */
export class DirectModelChatHandler implements IDisposable {

	private _isDisposed = false;

	/**
	 * Send a chat message to a single model using the direct Language Model API
	 *
	 * @param modelSelector Criteria for selecting the model (family, vendor, etc.)
	 * @param message The user's message
	 * @param tools Available tools for the model to use
	 * @param history Previous conversation history (optional)
	 * @param cancellationToken Cancellation token for the request
	 * @param onProgress Callback for streaming text chunks
	 * @param onToolCall Callback when a tool is called with full parameters
	 * @returns Promise with the final response
	 */
	async sendChatMessage(
		modelSelector: vscode.LanguageModelChatSelector,
		message: string,
		tools: readonly vscode.LanguageModelChatTool[],
		history: ReadonlyArray<vscode.LanguageModelChatMessage> = [],
		cancellationToken: CancellationToken,
		onProgress?: (chunk: string) => void,
		onToolCall?: (toolName: string, toolCallId: string, parameters: any, formattedMessage: string) => void,
		onCompletion?: () => void
	): Promise<{ response: string; error?: string }> {

		if (this._isDisposed) {
			throw new Error('DirectModelChatHandler has been disposed');
		}

		try {
			// 1. Select the model
			const models = await vscode.lm.selectChatModels(modelSelector);
			if (models.length === 0) {
				return {
					response: '',
					error: `No model found matching criteria: ${JSON.stringify(modelSelector)}`
				};
			}
			const model = models[0];
			console.log(`[DirectModelChatHandler] Using model: ${model.name} (${model.id})`);

			// 2. Build message history
			const messages: vscode.LanguageModelChatMessage[] = [
				...history,
				vscode.LanguageModelChatMessage.User(message)
			];

			let responseContent = '';
			const maxToolRounds = 5; // Prevent infinite loops
			let toolRound = 0;

			// 3. Tool calling loop
			while (toolRound < maxToolRounds) {
				console.log(`[DirectModelChatHandler] Round ${toolRound + 1}`);

				// Make the request with tools
				const response = await model.sendRequest(
					messages,
					{
						justification: 'Model comparison panel',
						tools: tools.length > 0 ? Array.from(tools) : undefined,
					},
					cancellationToken
				);

				// Process the streaming response
				const assistantContent: Array<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart> = [];
				let hasToolCalls = false;

				for await (const chunk of response.stream) {
					// Handle text chunks
					if (chunk instanceof vscode.LanguageModelTextPart) {
						responseContent += chunk.value;
						assistantContent.push(chunk);
						if (onProgress) {
							onProgress(chunk.value);
						}
					}
					// Handle tool calls - THIS IS WHERE WE GET THE PARAMETERS!
					else if (chunk instanceof vscode.LanguageModelToolCallPart) {
						hasToolCalls = true;
						assistantContent.push(chunk);

						// Format a human-readable message (similar to what the UI would show)
						const formattedMessage = this.formatToolCallMessage(chunk.name, chunk.input);

						console.log(`🔧 Tool call: ${chunk.name}`, {
							callId: chunk.callId,
							parameters: chunk.input,
							formatted: formattedMessage
						});

						// Notify the caller
						if (onToolCall) {
							onToolCall(chunk.name, chunk.callId, chunk.input, formattedMessage);
						}
					}
				}

				// If no tool calls, we're done
				if (!hasToolCalls) {
					break;
				}

				// 4. Execute tools and add results to history
				messages.push(vscode.LanguageModelChatMessage.Assistant(assistantContent));

				for (const content of assistantContent) {
					if (content instanceof vscode.LanguageModelToolCallPart) {
						try {
							// Invoke the tool
							console.log(`[DirectModelChatHandler] Invoking tool: ${content.name}`);
							const result = await vscode.lm.invokeTool(
								content.name,
								{
									input: content.input,
									toolInvocationToken: undefined, // No token available in comparison context
									tokenizationOptions: {
										tokenBudget: 2000,
										countTokens: async () => 0 // Simplified
									}
								},
								cancellationToken
							);

							// Add tool result to message history
							messages.push(vscode.LanguageModelChatMessage.User([
								new vscode.LanguageModelToolResultPart(content.callId, result.content)
							]));

							console.log(`[DirectModelChatHandler] Tool ${content.name} completed`);
						} catch (error) {
							console.error(`[DirectModelChatHandler] Tool ${content.name} failed:`, error);
							// Add error result
							messages.push(vscode.LanguageModelChatMessage.User([
								new vscode.LanguageModelToolResultPart(
									content.callId,
									[new vscode.LanguageModelTextPart(`Error: ${error}`)]
								)
							]));
						}
					}
				}

				toolRound++;
			}

			if (toolRound >= maxToolRounds) {
				console.warn(`[DirectModelChatHandler] Hit maximum tool calling rounds (${maxToolRounds})`);
			}

			if (onCompletion) {
				onCompletion();
			}

			return {
				response: responseContent,
				error: undefined
			};

		} catch (error) {
			console.error('[DirectModelChatHandler] Error:', error);
			return {
				response: '',
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}

	/**
	 * Format a tool call into a human-readable message
	 * Similar to what the formatters in toolInvocationFormatter.ts do
	 */
	private formatToolCallMessage(toolName: string, parameters: any): string {
		// Simple formatting - you can enhance this based on tool type
		try {
			switch (toolName) {
				case 'copilot_readFile':
					return `Read ${parameters.filePath || 'file'}`;
				case 'copilot_listFiles':
					return `Listed files matching \`${parameters.pattern || '*'}\``;
				case 'copilot_searchFiles':
					return `Searched for \`${parameters.query || ''}\``;
				case 'copilot_grepSearch':
					return `Searched text for \`${parameters.query || ''}\``;
				default: {
					// Generic fallback
					const keys = Object.keys(parameters);
					if (keys.length === 0) {
						return `Called ${toolName}`;
					}
					const primaryParam = parameters[keys[0]];
					return `${toolName}(${primaryParam})`;
				}
			}
		} catch {
			return `Called ${toolName}`;
		}
	}

	dispose(): void {
		this._isDisposed = true;
	}
}
