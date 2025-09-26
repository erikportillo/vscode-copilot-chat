/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../util/vs/base/common/event';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { IToolCall } from '../../prompt/common/intents';

export interface IToolCallDetection {
	modelId: string;
	toolCalls: IToolCall[];
}

/**
 * Service for detecting tool calls in model responses during streaming.
 *
 * This service monitors streaming responses from language models and identifies
 * when they want to execute tools. It parses tool call data from response chunks
 * and provides events when tool calls are detected.
 *
 * Key responsibilities:
 * - Parse streaming response chunks for tool call indicators
 * - Accumulate tool call data as it streams in
 * - Emit events when complete tool calls are detected
 * - Handle malformed or incomplete tool call data gracefully
 */
export class ToolCallDetectionService extends Disposable {
	private readonly _onToolCallDetected = this._register(new Emitter<IToolCallDetection>());
	public readonly onToolCallDetected: Event<IToolCallDetection> = this._onToolCallDetected.event;

	// Track partial tool calls as they're being streamed
	private readonly modelToolCallBuffers = new Map<string, Map<string, Partial<IToolCall>>>();

	constructor() {
		super();
	}

	/**
	 * Process a streaming response chunk to detect tool calls
	 * @param modelId The model ID this response is from
	 * @param responseText The text content of the response chunk
	 * @param delta Optional response delta containing structured tool call data
	 */
	public processResponseChunk(modelId: string, responseText: string, delta?: any): void {
		// First, check if the delta contains structured tool call data
		if (delta?.copilotToolCalls && Array.isArray(delta.copilotToolCalls)) {
			console.log(`🔧 [${modelId}] Found ${delta.copilotToolCalls.length} structured tool calls`);
			this.processStructuredToolCalls(modelId, delta.copilotToolCalls);
			return;
		}

		// If no structured data, try to parse from text (only log if significant content)
		if (responseText.length > 50 && responseText.includes('tool')) {
			this.parseToolCallsFromText(modelId, responseText);
		}
	}

	/**
	 * Process structured tool call data from response delta
	 */
	private processStructuredToolCalls(modelId: string, toolCalls: any[]): void {
		const completedToolCalls: IToolCall[] = [];

		for (const toolCall of toolCalls) {
			if (this.isCompleteToolCall(toolCall)) {
				completedToolCalls.push({
					id: toolCall.id,
					name: toolCall.name,
					arguments: typeof toolCall.arguments === 'string'
						? toolCall.arguments
						: JSON.stringify(toolCall.arguments)
				});
			} else {
				// Handle partial tool calls (streaming)
				this.accumulatePartialToolCall(modelId, toolCall);
			}
		}

		if (completedToolCalls.length > 0) {
			this._onToolCallDetected.fire({
				modelId,
				toolCalls: completedToolCalls
			});
		}
	}

	/**
	 * Parse tool calls from response text using pattern matching
	 * This is a fallback for models that don't provide structured tool call data
	 */
	private parseToolCallsFromText(modelId: string, responseText: string): void {

		// Look for common tool call patterns in the text
		// This is a simplified implementation - real parsing would be more sophisticated

		// Pattern: Looking for function calls or tool invocations
		const toolCallPatterns = [
			// Pattern for explicit tool calls: `toolName(args)`
			/(\w+)\s*\(\s*({[^}]*}|\w+[^)]*)\s*\)/g,
			// Pattern for function-style calls: `function_name({...})`
			/function[_\s]+(\w+)\s*\(\s*({[^}]*})\s*\)/gi,
			// Pattern for tool invocation: `<tool name="..." args="...">`
			/<tool\s+name\s*=\s*["']([^"']+)["']\s+args\s*=\s*["']([^"']+)["']\s*>/gi
		];

		const detectedToolCalls: IToolCall[] = [];

		for (const pattern of toolCallPatterns) {
			let match;
			while ((match = pattern.exec(responseText)) !== null) {
				try {
					const toolName = match[1];
					const args = match[2];

					// Validate that it looks like a real tool call
					if (this.isLikelyToolCall(toolName, args)) {
						detectedToolCalls.push({
							id: `parsed_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
							name: toolName,
							arguments: args.startsWith('{') ? args : `"${args}"`
						});
					}
				} catch (error) {
					// Ignore parsing errors for malformed tool calls
					continue;
				}
			}
		}

		if (detectedToolCalls.length > 0) {
			console.log(`🔧 [${modelId}] Detected ${detectedToolCalls.length} tool calls from text`);
			this._onToolCallDetected.fire({
				modelId,
				toolCalls: detectedToolCalls
			});
		}
	}

	/**
	 * Accumulate partial tool call data for streaming responses
	 */
	private accumulatePartialToolCall(modelId: string, partialToolCall: any): void {
		if (!this.modelToolCallBuffers.has(modelId)) {
			this.modelToolCallBuffers.set(modelId, new Map());
		}

		const modelBuffer = this.modelToolCallBuffers.get(modelId)!;
		const toolCallId = partialToolCall.id || 'unknown';

		if (!modelBuffer.has(toolCallId)) {
			modelBuffer.set(toolCallId, {
				id: toolCallId,
				name: partialToolCall.name || '',
				arguments: ''
			});
		}

		const bufferedCall = modelBuffer.get(toolCallId)!;

		// Accumulate data
		if (partialToolCall.name) {
			bufferedCall.name = partialToolCall.name;
		}
		if (partialToolCall.arguments) {
			bufferedCall.arguments += partialToolCall.arguments;
		}

		// Check if the tool call is now complete
		if (this.isCompleteToolCall(bufferedCall)) {
			const completeToolCall: IToolCall = {
				id: bufferedCall.id!,
				name: bufferedCall.name!,
				arguments: bufferedCall.arguments!
			};

			// Remove from buffer and emit
			modelBuffer.delete(toolCallId);
			this._onToolCallDetected.fire({
				modelId,
				toolCalls: [completeToolCall]
			});
		}
	}

	/**
	 * Check if a tool call object is complete
	 */
	private isCompleteToolCall(toolCall: any): toolCall is IToolCall {
		return toolCall &&
			typeof toolCall.id === 'string' &&
			typeof toolCall.name === 'string' &&
			toolCall.name.length > 0 &&
			typeof toolCall.arguments === 'string';
	}

	/**
	 * Heuristic to determine if a parsed pattern is likely a real tool call
	 */
	private isLikelyToolCall(name: string, args: string): boolean {
		// Check if the name looks like a tool name (no spaces, reasonable length)
		if (!name || name.includes(' ') || name.length > 50) {
			return false;
		}

		// Check if args look reasonable
		if (!args || args.length > 1000) {
			return false;
		}

		// Known tool name patterns
		const commonToolPatterns = [
			/^(read|write|list|search|find|get|set|create|delete|update)_?\w*/i,
			/^\w+_(file|directory|workspace|project|tool)/i,
			/^(file|workspace|project|code|text)_\w+/i
		];

		return commonToolPatterns.some(pattern => pattern.test(name));
	}

	/**
	 * Clear all buffers for a specific model (useful when a conversation ends)
	 */
	public clearModelBuffers(modelId: string): void {
		this.modelToolCallBuffers.delete(modelId);
	}

	/**
	 * Clear all buffers (useful for cleanup)
	 */
	public clearAllBuffers(): void {
		this.modelToolCallBuffers.clear();
	}

	/**
	 * Get current buffered (incomplete) tool calls for debugging
	 */
	public getBufferedToolCalls(modelId: string): Partial<IToolCall>[] {
		const buffer = this.modelToolCallBuffers.get(modelId);
		return buffer ? Array.from(buffer.values()) : [];
	}

	public override dispose(): void {
		this.clearAllBuffers();
		super.dispose();
	}
}