/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { IEndpointProvider } from '../../../../platform/endpoint/common/endpointProvider';
import { ModelComparisonViewProvider } from '../modelComparisonViewProvider';

/**
 * Integration test to verify ModelComparisonViewProvider functionality
 */
export function testModelComparisonViewProvider() {
	// Create a mock extension context
	const mockContext: vscode.ExtensionContext = {
		subscriptions: [],
		workspaceState: {
			get: () => undefined,
			update: async () => undefined,
			keys: () => []
		},
		globalState: {
			get: () => undefined,
			setKeysForSync: () => undefined,
			update: async () => undefined,
			keys: () => []
		},
		secrets: {} as any,
		extensionUri: vscode.Uri.file('/test'),
		extension: {} as any,
		environmentVariableCollection: {} as any,
		extensionPath: '/test',
		asAbsolutePath: (path: string) => `/test/${path}`,
		storageUri: vscode.Uri.file('/test/storage'),
		storagePath: '/test/storage',
		globalStorageUri: vscode.Uri.file('/test/global-storage'),
		globalStoragePath: '/test/global-storage',
		logUri: vscode.Uri.file('/test/logs'),
		logPath: '/test/logs',
		extensionMode: vscode.ExtensionMode.Test,
		languageModelAccessInformation: {} as any
	};

	// Create a mock endpoint provider
	const mockEndpointProvider: IEndpointProvider = {
		_serviceBrand: undefined,
		getAllCompletionModels: async () => [],
		getAllChatEndpoints: async () => [],
		getChatEndpoint: async () => ({} as any),
		getEmbeddingsEndpoint: async () => ({} as any)
	};

	const provider = new ModelComparisonViewProvider(vscode.Uri.file('/test'), mockContext, mockEndpointProvider);

	// Test that provider is created properly
	assert.ok(provider, 'ModelComparisonViewProvider should be created');

	// Test message handling by calling the handler directly (simulating webview messages)
	const testMessage = async (command: string, data?: any) => {
		try {
			// Access the private handler method via any type assertion for testing
			const response = await (provider as any).handleWebviewMessage({ command, data });
			return response;
		} catch (error) {
			console.error(`Error testing command ${command}:`, error);
			throw error;
		}
	};

	// Test ping command
	testMessage('ping')
		.then(response => {
			assert.ok(response, 'Ping should return a response');
			assert.strictEqual(response.command, 'pong', 'Ping should return pong');
			console.log('Ping test passed');
		})
		.catch(error => {
			console.error('Ping test failed:', error);
		});

	// Test get-available-models command
	testMessage('get-available-models')
		.then(response => {
			assert.ok(response, 'get-available-models should return a response');
			assert.ok(Array.isArray(response.models), 'Response should contain models array');
			console.log('Get available models test passed');
		})
		.catch(error => {
			console.error('Get available models test failed:', error);
		});

	// Test get-selected-models command
	testMessage('get-selected-models')
		.then(response => {
			assert.ok(response, 'get-selected-models should return a response');
			assert.ok(Array.isArray(response.selectedModels), 'Response should contain selectedModels array');
			console.log('Get selected models test passed');
		})
		.catch(error => {
			console.error('Get selected models test failed:', error);
		});

	// Dispose the provider
	provider.dispose();

	console.log('ModelComparisonViewProvider basic tests completed');
}

// Run test if this file is executed directly
if (require.main === module) {
	testModelComparisonViewProvider();
}