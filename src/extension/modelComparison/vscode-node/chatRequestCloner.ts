/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChatRequestTurn, ChatResponseTurn } from '../../../vscodeTypes';

/**
 * Represents a cloned chat request that ensures identical input across all models
 */
export interface ClonedChatRequest {
	/** The user's message */
	message: string;
	/** Chat history for context */
	history: ReadonlyArray<ChatRequestTurn | ChatResponseTurn>;
	/** Timestamp when the request was created */
	timestamp: number;
	/** Unique identifier for this request batch */
	requestId: string;
}

/**
 * Service responsible for cloning chat requests to ensure identical inputs across models
 * This is crucial for fair model comparison - all models must receive exactly the same input
 */
export class ChatRequestCloner {

	/**
	 * Clone a chat request for use across multiple models
	 * @param message The user's message
	 * @param history The chat history for context
	 * @returns A cloned request object that can be safely used across multiple models
	 */
	static cloneRequest(
		message: string,
		history: ReadonlyArray<ChatRequestTurn | ChatResponseTurn> = []
	): ClonedChatRequest {

		// Generate a unique ID for this request batch
		const requestId = this.generateRequestId();

		// Create a deep clone of the history to ensure no shared references
		const clonedHistory = this.cloneHistory(history);

		// Normalize the message (trim whitespace, ensure consistency)
		const normalizedMessage = message.trim();

		return {
			message: normalizedMessage,
			history: clonedHistory,
			timestamp: Date.now(),
			requestId
		};
	}

	/**
	 * Validate that a request is suitable for comparison
	 * @param request The request to validate
	 * @returns True if the request is valid for comparison
	 */
	static validateRequest(request: ClonedChatRequest): boolean {
		// Check that message is not empty
		if (!request.message || request.message.trim().length === 0) {
			return false;
		}

		// Check that history is properly structured
		if (!Array.isArray(request.history)) {
			return false;
		}

		// Check that timestamp is reasonable
		const now = Date.now();
		const maxAge = 24 * 60 * 60 * 1000; // 24 hours
		if (request.timestamp < now - maxAge || request.timestamp > now + 1000) {
			return false;
		}

		return true;
	}

	/**
	 * Create multiple identical copies of a request for parallel processing
	 * @param request The base request to clone
	 * @param modelIds The model IDs that will receive copies
	 * @returns Array of identical requests, one per model
	 */
	static createParallelRequests(
		request: ClonedChatRequest,
		modelIds: string[]
	): Array<ClonedChatRequest & { targetModelId: string }> {

		return modelIds.map(modelId => ({
			...request,
			// Create a completely new history reference for each model
			history: this.cloneHistory(request.history),
			targetModelId: modelId
		}));
	}

	/**
	 * Deep clone chat history to ensure no shared references between models
	 */
	private static cloneHistory(
		history: ReadonlyArray<ChatRequestTurn | ChatResponseTurn>
	): ReadonlyArray<ChatRequestTurn | ChatResponseTurn> {

		// For now, we'll create a shallow copy since the history objects should be immutable
		// If we discover shared mutable state issues, we can implement deeper cloning
		return [...history];
	}

	/**
	 * Generate a unique request ID for tracking purposes
	 */
	private static generateRequestId(): string {
		// Use timestamp + random component for uniqueness
		const timestamp = Date.now().toString(36);
		const random = Math.random().toString(36).substring(2, 8);
		return `req_${timestamp}_${random}`;
	}

	/**
	 * Extract the original message from a cloned request
	 * @param request The cloned request
	 * @returns The original message string
	 */
	static extractMessage(request: ClonedChatRequest): string {
		return request.message;
	}

	/**
	 * Extract the original history from a cloned request
	 * @param request The cloned request
	 * @returns The original history array
	 */
	static extractHistory(request: ClonedChatRequest): ReadonlyArray<ChatRequestTurn | ChatResponseTurn> {
		return request.history;
	}

	/**
	 * Check if two requests are equivalent (same content, suitable for comparison)
	 * @param request1 First request
	 * @param request2 Second request
	 * @returns True if the requests have equivalent content
	 */
	static areRequestsEquivalent(request1: ClonedChatRequest, request2: ClonedChatRequest): boolean {
		// Check message equality
		if (request1.message !== request2.message) {
			return false;
		}

		// Check history length
		if (request1.history.length !== request2.history.length) {
			return false;
		}

		// For a more thorough comparison, we could check each history item
		// For now, assume equivalent if message and history length match
		return true;
	}
}