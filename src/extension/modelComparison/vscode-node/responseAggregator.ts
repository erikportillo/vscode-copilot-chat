/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { ModelChatResponse } from './comparisonChatOrchestrator';

/**
 * Represents the aggregated state of responses from multiple models
 */
export interface AggregatedResponse {
	/** Unique identifier for this response batch */
	requestId: string;
	/** The original message that was sent */
	originalMessage: string;
	/** Responses from each model, keyed by model ID */
	responses: Map<string, ModelChatResponse>;
	/** Models that are still processing */
	pendingModels: Set<string>;
	/** Models that have completed (either successfully or with error) */
	completedModels: Set<string>;
	/** Whether all models have completed */
	isComplete: boolean;
	/** Timestamp when aggregation started */
	startTime: number;
	/** Timestamp when aggregation completed (if complete) */
	endTime?: number;
	/** Summary statistics about the responses */
	stats: ResponseStats;
}

/**
 * Statistics about aggregated responses
 */
export interface ResponseStats {
	/** Number of successful responses */
	successCount: number;
	/** Number of failed responses */
	errorCount: number;
	/** Number of pending responses */
	pendingCount: number;
	/** Average response length (successful responses only) */
	averageResponseLength: number;
	/** Fastest response time in milliseconds */
	fastestResponseTime?: number;
	/** Slowest response time in milliseconds */
	slowestResponseTime?: number;
}

/**
 * Callback for response aggregation updates
 */
export type AggregationUpdateCallback = (aggregated: AggregatedResponse) => void;

/**
 * Service that aggregates and synchronizes responses from multiple models
 * Handles different response speeds, streaming updates, and error states
 */
export class ResponseAggregator extends Disposable {

	private readonly activeAggregations = new Map<string, AggregatedResponse>();

	/**
	 * Start aggregating responses for a new request
	 * @param requestId Unique identifier for the request
	 * @param originalMessage The original message sent to models
	 * @param modelIds Array of model IDs that will respond
	 * @param onUpdate Optional callback for aggregation updates
	 * @returns The initial aggregated response object
	 */
	startAggregation(
		requestId: string,
		originalMessage: string,
		modelIds: string[],
		onUpdate?: AggregationUpdateCallback
	): AggregatedResponse {

		const startTime = Date.now();
		const pendingModels = new Set(modelIds);
		const completedModels = new Set<string>();
		const responses = new Map<string, ModelChatResponse>();

		const aggregated: AggregatedResponse = {
			requestId,
			originalMessage,
			responses,
			pendingModels,
			completedModels,
			isComplete: false,
			startTime,
			stats: this.calculateStats(responses, startTime)
		};

		this.activeAggregations.set(requestId, aggregated);

		// Call update callback if provided
		if (onUpdate) {
			onUpdate(aggregated);
		}

		return aggregated;
	}

	/**
	 * Add or update a response from a specific model
	 * @param requestId The request ID
	 * @param response The model's response
	 * @param onUpdate Optional callback for aggregation updates
	 * @returns The updated aggregated response, or undefined if request not found
	 */
	updateResponse(
		requestId: string,
		response: ModelChatResponse,
		onUpdate?: AggregationUpdateCallback
	): AggregatedResponse | undefined {

		const aggregated = this.activeAggregations.get(requestId);
		if (!aggregated) {
			return undefined;
		}

		// Update the response for this model
		aggregated.responses.set(response.modelId, response);

		// If this response is complete, move model from pending to completed
		if (response.isComplete) {
			aggregated.pendingModels.delete(response.modelId);
			aggregated.completedModels.add(response.modelId);

			// Check if all models are now complete
			if (aggregated.pendingModels.size === 0) {
				aggregated.isComplete = true;
				aggregated.endTime = Date.now();
			}
		}

		// Recalculate statistics
		aggregated.stats = this.calculateStats(aggregated.responses, aggregated.startTime, aggregated.endTime);

		// Call update callback if provided
		if (onUpdate) {
			onUpdate(aggregated);
		}

		return aggregated;
	}

	/**
	 * Get the current state of an aggregation
	 * @param requestId The request ID
	 * @returns The aggregated response, or undefined if not found
	 */
	getAggregation(requestId: string): AggregatedResponse | undefined {
		return this.activeAggregations.get(requestId);
	}

	/**
	 * Mark an aggregation as complete and clean up
	 * @param requestId The request ID
	 * @returns The final aggregated response, or undefined if not found
	 */
	completeAggregation(requestId: string): AggregatedResponse | undefined {
		const aggregated = this.activeAggregations.get(requestId);
		if (!aggregated) {
			return undefined;
		}

		// Mark as complete and set end time
		aggregated.isComplete = true;
		if (!aggregated.endTime) {
			aggregated.endTime = Date.now();
		}

		// Update final statistics
		aggregated.stats = this.calculateStats(aggregated.responses, aggregated.startTime, aggregated.endTime);

		// Remove from active aggregations to free memory
		this.activeAggregations.delete(requestId);

		return aggregated;
	}

	/**
	 * Cancel an active aggregation
	 * @param requestId The request ID
	 */
	cancelAggregation(requestId: string): void {
		this.activeAggregations.delete(requestId);
	}

	/**
	 * Get all active aggregation IDs
	 */
	getActiveAggregationIds(): string[] {
		return Array.from(this.activeAggregations.keys());
	}

	/**
	 * Calculate statistics for a set of responses
	 */
	private calculateStats(
		responses: Map<string, ModelChatResponse>,
		startTime: number,
		endTime?: number
	): ResponseStats {

		const allResponses = Array.from(responses.values());
		const successfulResponses = allResponses.filter(r => r.isComplete && !r.error);
		const failedResponses = allResponses.filter(r => r.isComplete && r.error);
		const pendingResponses = allResponses.filter(r => !r.isComplete);

		// Calculate average response length
		const totalLength = successfulResponses.reduce((sum, r) => sum + r.response.length, 0);
		const averageResponseLength = successfulResponses.length > 0
			? totalLength / successfulResponses.length
			: 0;

		// Calculate response times for completed responses
		const completedResponses = allResponses.filter(r => r.isComplete);
		let fastestResponseTime: number | undefined;
		let slowestResponseTime: number | undefined;

		if (completedResponses.length > 0) {
			const responseTimes = completedResponses.map(r => r.timestamp - startTime);
			fastestResponseTime = Math.min(...responseTimes);
			slowestResponseTime = Math.max(...responseTimes);
		}

		return {
			successCount: successfulResponses.length,
			errorCount: failedResponses.length,
			pendingCount: pendingResponses.length,
			averageResponseLength,
			fastestResponseTime,
			slowestResponseTime
		};
	}

	/**
	 * Convert aggregated response to a format suitable for the webview
	 */
	static toWebviewFormat(aggregated: AggregatedResponse): any {
		const responses: { [modelId: string]: string } = {};
		const errors: { [modelId: string]: string } = {};
		const toolCalls: { [modelId: string]: any[] } = {};
		const selectedModels: string[] = [];

		for (const [modelId, response] of aggregated.responses) {
			selectedModels.push(modelId);
			if (response.error) {
				errors[modelId] = response.error;
				responses[modelId] = '';
			} else {
				responses[modelId] = response.response;
			}
			// Include tool calls in the webview format
			if (response.toolCalls && response.toolCalls.length > 0) {
				toolCalls[modelId] = response.toolCalls;
			}
		}

		return {
			message: aggregated.originalMessage,
			responses,
			errors,
			selectedModels,
			timestamp: aggregated.endTime || aggregated.startTime,
			stats: aggregated.stats,
			isComplete: aggregated.isComplete,
			toolCalls
		};
	}

	/**
	 * Clean up all active aggregations
	 */
	override dispose(): void {
		this.activeAggregations.clear();
		super.dispose();
	}
}