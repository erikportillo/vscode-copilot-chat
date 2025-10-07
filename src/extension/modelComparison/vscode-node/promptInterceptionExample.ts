/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Raw } from '@vscode/prompt-tsx';
import { SingleModelChatHandler } from './singleModelChatHandler';

/**
 * Example: Using prompt interception in SingleModelChatHandler
 *
 * This file demonstrates how to use the new prompt interception capabilities
 * to capture, display, and modify prompts sent to models in the comparison panel.
 */

// Example 1: Basic usage - Capture and display prompts
export async function capturePromptExample(
	handler: SingleModelChatHandler,
	modelId: string,
	message: string
) {
	// Store the captured prompt
	let capturedPrompt: Raw.ChatMessage[] | null = null;

	await handler.sendChatMessage(
		modelId,
		message,
		[], // history
		cancellationToken,
		undefined, // onProgress
		undefined, // modelMetadata
		undefined, // onDelta
		undefined, // onCompletion
		undefined, // onToolCall
		// Capture the rendered prompt
		(modelId, messages) => {
			console.log(`[${modelId}] Prompt captured with ${messages.length} messages`);
			capturedPrompt = messages;

			// Display the prompt
			const formatted = SingleModelChatHandler.formatPromptForDisplay(messages);
			console.log(`Prompt for ${modelId}:\n${formatted}`);

			// Analyze the prompt
			const analysis = SingleModelChatHandler.analyzePrompt(messages);
			console.log(`Prompt analysis for ${modelId}:`, analysis);
		}
	);

	return capturedPrompt;
}

// Example 2: Modify prompts - Add custom system message
export async function addCustomSystemMessageExample(
	handler: SingleModelChatHandler,
	modelId: string,
	message: string
) {
	await handler.sendChatMessage(
		modelId,
		message,
		[],
		cancellationToken,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		// Modify the prompt before sending
		(modelId, messages) => {
			// Add a custom instruction to the first system message
			const modified = [...messages];
			if (modified[0]?.role === Raw.ChatRole.System) {
				const originalContent = modified[0].content;
				const contentStr = typeof originalContent === 'string' ? originalContent : JSON.stringify(originalContent);
				modified[0] = {
					...modified[0],
					content: `[MODEL COMPARISON MODE - ${modelId}]\n\n${contentStr}` as any
				};
			}
			return modified;
		}
	);
}

// Example 3: Interactive prompt editing UI
export class PromptEditor {
	private currentPrompts = new Map<string, Raw.ChatMessage[]>();
	private modifiedPrompts = new Map<string, Raw.ChatMessage[]>();

	/**
	 * Send a message with prompt capture
	 */
	async sendWithCapture(
		handler: SingleModelChatHandler,
		modelId: string,
		message: string
	) {
		await handler.sendChatMessage(
			modelId,
			message,
			[],
			cancellationToken,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			// Capture prompts
			(modelId, messages) => {
				this.currentPrompts.set(modelId, messages);
				this.displayPrompt(modelId, messages);
			},
			// Apply modifications
			(modelId, messages) => {
				const modified = this.modifiedPrompts.get(modelId);
				return modified || messages;
			}
		);
	}

	/**
	 * Display prompt in the UI
	 */
	private displayPrompt(modelId: string, messages: Raw.ChatMessage[]) {
		const formatted = SingleModelChatHandler.formatPromptForDisplay(messages);
		const analysis = SingleModelChatHandler.analyzePrompt(messages);

		console.log(`\n=== Prompt for ${modelId} ===`);
		console.log(`Messages: ${analysis.systemMessageCount} system, ${analysis.userMessageCount} user, ${analysis.assistantMessageCount} assistant`);
		console.log(`Estimated tokens: ${analysis.totalTokensEstimate}`);
		console.log(`Has tools: ${analysis.hasTools}`);
		console.log(`\n${formatted}\n`);
	}

	/**
	 * Edit a specific message in the prompt
	 */
	editMessage(modelId: string, messageIndex: number, newContent: string) {
		const current = this.currentPrompts.get(modelId);
		if (!current) {
			throw new Error(`No prompt found for model ${modelId}`);
		}

		if (messageIndex < 0 || messageIndex >= current.length) {
			throw new Error(`Invalid message index ${messageIndex}`);
		}

		const modified = [...current];
		modified[messageIndex] = {
			...modified[messageIndex],
			content: newContent as any
		};

		this.modifiedPrompts.set(modelId, modified);
		console.log(`Modified message ${messageIndex} for ${modelId}`);
	}

	/**
	 * Remove a specific message from the prompt
	 */
	removeMessage(modelId: string, messageIndex: number) {
		const current = this.currentPrompts.get(modelId);
		if (!current) {
			throw new Error(`No prompt found for model ${modelId}`);
		}

		const modified = current.filter((_, index) => index !== messageIndex);
		this.modifiedPrompts.set(modelId, modified);
		console.log(`Removed message ${messageIndex} from ${modelId} prompt`);
	}

	/**
	 * Add a new message to the prompt
	 */
	addMessage(modelId: string, role: Raw.ChatRole, content: string, position?: number) {
		const current = this.currentPrompts.get(modelId);
		if (!current) {
			throw new Error(`No prompt found for model ${modelId}`);
		}

		const newMessage = {
			role,
			content
		} as unknown as Raw.ChatMessage;

		const modified = [...current];
		if (position !== undefined) {
			modified.splice(position, 0, newMessage);
		} else {
			modified.push(newMessage);
		}

		this.modifiedPrompts.set(modelId, modified);
		console.log(`Added ${role} message to ${modelId} prompt at position ${position ?? modified.length - 1}`);
	}

	/**
	 * Reset modifications for a model
	 */
	resetModifications(modelId: string) {
		this.modifiedPrompts.delete(modelId);
		console.log(`Reset modifications for ${modelId}`);
	}

	/**
	 * Get the current prompt for a model
	 */
	getPrompt(modelId: string): Raw.ChatMessage[] | undefined {
		return this.modifiedPrompts.get(modelId) || this.currentPrompts.get(modelId);
	}
}

// Example 4: Compare prompts across models
export async function comparePromptsAcrossModels(
	handler: SingleModelChatHandler,
	modelIds: string[],
	message: string
) {
	const prompts = new Map<string, Raw.ChatMessage[]>();

	// Send the same message to all models and capture prompts
	await Promise.all(
		modelIds.map(async modelId => {
			await handler.sendChatMessage(
				modelId,
				message,
				[],
				cancellationToken,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				(modelId, messages) => {
					prompts.set(modelId, messages);
				}
			);
		})
	);

	// Compare the prompts
	console.log('\n=== Prompt Comparison ===\n');

	for (const [modelId, messages] of prompts.entries()) {
		const analysis = SingleModelChatHandler.analyzePrompt(messages);
		console.log(`${modelId}:`);
		console.log(`  - ${messages.length} total messages`);
		console.log(`  - ${analysis.systemMessageCount} system, ${analysis.userMessageCount} user, ${analysis.assistantMessageCount} assistant`);
		console.log(`  - ~${analysis.totalTokensEstimate} tokens`);
		console.log(`  - Tools: ${analysis.hasTools ? 'Yes' : 'No'}`);
		console.log('');
	}

	// Find differences in system messages
	const systemMessages = new Map<string, string>();
	for (const [modelId, messages] of prompts.entries()) {
		const systemMsg = messages.find(m => m.role === Raw.ChatRole.System);
		if (systemMsg && typeof systemMsg.content === 'string') {
			systemMessages.set(modelId, systemMsg.content);
		}
	}

	if (systemMessages.size > 1) {
		const uniqueSystemMessages = new Set(systemMessages.values());
		if (uniqueSystemMessages.size > 1) {
			console.log('⚠️ Different system messages detected across models!');
			for (const [modelId, content] of systemMessages.entries()) {
				console.log(`\n${modelId} system message (${content.length} chars):`);
				console.log(content.substring(0, 200) + '...');
			}
		} else {
			console.log('✅ All models received the same system message');
		}
	}
}

// Example 5: A/B test different prompts
export async function abTestPrompts(
	handler: SingleModelChatHandler,
	modelId: string,
	message: string,
	promptVariations: Array<(messages: Raw.ChatMessage[]) => Raw.ChatMessage[]>
) {
	const results: Array<{ variation: number; response: string }> = [];

	for (let i = 0; i < promptVariations.length; i++) {
		const variation = promptVariations[i];

		console.log(`\n=== Testing Variation ${i + 1} ===\n`);

		const result = await handler.sendChatMessage(
			modelId,
			message,
			[],
			cancellationToken,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			(modelId, messages) => {
				console.log(`Original prompt for variation ${i + 1}:`);
				const analysis = SingleModelChatHandler.analyzePrompt(messages);
				console.log(analysis);
			},
			(modelId, messages) => {
				const modified = variation(messages);
				console.log(`Modified prompt for variation ${i + 1}:`);
				const analysis = SingleModelChatHandler.analyzePrompt(modified);
				console.log(analysis);
				return modified;
			}
		);

		results.push({
			variation: i + 1,
			response: result.response
		});
	}

	// Compare results
	console.log('\n=== A/B Test Results ===\n');
	results.forEach(({ variation, response }) => {
		console.log(`Variation ${variation}: ${response.length} chars`);
		console.log(response.substring(0, 100) + '...\n');
	});

	return results;
}

// Placeholder for cancellationToken (would come from actual usage context)
declare const cancellationToken: any;
