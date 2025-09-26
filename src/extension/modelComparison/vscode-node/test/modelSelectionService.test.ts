/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { ModelSelectionService } from '../modelSelectionService';

/**
 * Simple test to verify ModelSelectionService functionality
 */
export function testModelSelectionService() {
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

	const service = new ModelSelectionService(mockContext);

	// Test that service is initialized properly
	assert.ok(service, 'ModelSelectionService should be created');

	// Test that we can get available models (should be empty initially in test environment)
	const availableModels = service.getAvailableModels();
	assert.ok(Array.isArray(availableModels), 'Available models should be an array');

	// Test that we can get selected models (should be empty initially)
	const selectedModels = service.getSelectedModels();
	assert.ok(Array.isArray(selectedModels), 'Selected models should be an array');

	// Dispose the service
	service.dispose();

	console.log('ModelSelectionService basic test passed');
}

// Run test if this file is executed directly
if (require.main === module) {
	testModelSelectionService();
}