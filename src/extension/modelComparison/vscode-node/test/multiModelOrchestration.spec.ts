/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ok, strictEqual } from 'assert';
import { describe, it } from 'vitest';
import { ChatRequestCloner, ClonedChatRequest } from '../chatRequestCloner';
import { ModelChatResponse } from '../comparisonChatOrchestrator';
import { ResponseAggregator } from '../responseAggregator';

describe('Multi-Model Chat Orchestration', () => {

	describe('ChatRequestCloner', () => {
		it('should clone a request with proper structure', () => {
			const message = 'Hello, world!';
			const history: any[] = [];

			const cloned = ChatRequestCloner.cloneRequest(message, history);

			strictEqual(cloned.message, message);
			strictEqual(cloned.history.length, 0);
			ok(cloned.requestId.startsWith('req_'));
			ok(cloned.timestamp > 0);
		});

		it('should validate requests correctly', () => {
			const validRequest: ClonedChatRequest = {
				message: 'Valid message',
				history: [],
				timestamp: Date.now(),
				requestId: 'req_123'
			};

			const invalidRequest: ClonedChatRequest = {
				message: '',
				history: [],
				timestamp: Date.now(),
				requestId: 'req_456'
			};

			strictEqual(ChatRequestCloner.validateRequest(validRequest), true);
			strictEqual(ChatRequestCloner.validateRequest(invalidRequest), false);
		});

		it('should create parallel requests for multiple models', () => {
			const request = ChatRequestCloner.cloneRequest('Test message', []);
			const modelIds = ['model1', 'model2', 'model3'];

			const parallelRequests = ChatRequestCloner.createParallelRequests(request, modelIds);

			strictEqual(parallelRequests.length, 3);
			parallelRequests.forEach((req, index) => {
				strictEqual(req.targetModelId, modelIds[index]);
				strictEqual(req.message, request.message);
				strictEqual(req.requestId, request.requestId);
			});
		});
	});

	describe('ResponseAggregator', () => {
		it('should start aggregation correctly', () => {
			const aggregator = new ResponseAggregator();
			const requestId = 'test-request';
			const message = 'Test message';
			const modelIds = ['model1', 'model2'];

			const aggregated = aggregator.startAggregation(requestId, message, modelIds);

			strictEqual(aggregated.requestId, requestId);
			strictEqual(aggregated.originalMessage, message);
			strictEqual(aggregated.pendingModels.size, 2);
			strictEqual(aggregated.completedModels.size, 0);
			strictEqual(aggregated.isComplete, false);

			aggregator.dispose();
		});

		it('should update responses and track completion', () => {
			const aggregator = new ResponseAggregator();
			const requestId = 'test-request';
			const message = 'Test message';
			const modelIds = ['model1', 'model2'];

			aggregator.startAggregation(requestId, message, modelIds);

			// Add first response
			const response1: ModelChatResponse = {
				modelId: 'model1',
				response: 'Response from model 1',
				error: undefined,
				isComplete: true,
				timestamp: Date.now()
			};

			const updated1 = aggregator.updateResponse(requestId, response1);
			ok(updated1);
			strictEqual(updated1.completedModels.size, 1);
			strictEqual(updated1.pendingModels.size, 1);
			strictEqual(updated1.isComplete, false);

			// Add second response
			const response2: ModelChatResponse = {
				modelId: 'model2',
				response: 'Response from model 2',
				error: undefined,
				isComplete: true,
				timestamp: Date.now()
			};

			const updated2 = aggregator.updateResponse(requestId, response2);
			ok(updated2);
			strictEqual(updated2.completedModels.size, 2);
			strictEqual(updated2.pendingModels.size, 0);
			strictEqual(updated2.isComplete, true);
			ok(updated2.endTime);

			aggregator.dispose();
		});

		it('should handle errors in responses', () => {
			const aggregator = new ResponseAggregator();
			const requestId = 'test-request';
			const message = 'Test message';
			const modelIds = ['model1'];

			aggregator.startAggregation(requestId, message, modelIds);

			const errorResponse: ModelChatResponse = {
				modelId: 'model1',
				response: '',
				error: 'Test error',
				isComplete: true,
				timestamp: Date.now()
			};

			const updated = aggregator.updateResponse(requestId, errorResponse);
			ok(updated);
			strictEqual(updated.stats.errorCount, 1);
			strictEqual(updated.stats.successCount, 0);

			aggregator.dispose();
		});

		it('should convert to webview format correctly', () => {
			const aggregator = new ResponseAggregator();
			const requestId = 'test-request';
			const message = 'Test message';
			const modelIds = ['model1', 'model2'];

			const aggregated = aggregator.startAggregation(requestId, message, modelIds);

			// Add responses
			aggregator.updateResponse(requestId, {
				modelId: 'model1',
				response: 'Success response',
				isComplete: true,
				timestamp: Date.now()
			});

			aggregator.updateResponse(requestId, {
				modelId: 'model2',
				response: '',
				error: 'Error response',
				isComplete: true,
				timestamp: Date.now()
			});

			const webviewFormat = ResponseAggregator.toWebviewFormat(aggregated);

			strictEqual(webviewFormat.message, message);
			strictEqual(webviewFormat.responses.model1, 'Success response');
			strictEqual(webviewFormat.responses.model2, '');
			strictEqual(webviewFormat.errors.model2, 'Error response');
			strictEqual(webviewFormat.selectedModels.length, 2);

			aggregator.dispose();
		});
	});
});