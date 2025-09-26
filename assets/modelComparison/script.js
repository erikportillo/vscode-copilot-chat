/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

(function () {
	'use strict';

	// VS Code API object
	const vscode = acquireVsCodeApi();

	// Message counter for request/response matching
	let messageId = 0;

	// Track pending requests for response matching
	const pendingRequests = new Map();

	/**
	 * Send a message to the extension and return a promise that resolves with the response
	 * @param {string} command - The command to send
	 * @param {any} data - The data to send with the command
	 * @returns {Promise<any>} Promise that resolves with the response
	 */
	function sendMessage(command, data = {}) {
		return new Promise((resolve, reject) => {
			const id = ++messageId;
			const message = {
				id,
				command,
				data
			};

			// Store the promise resolvers for when we get a response
			pendingRequests.set(id, { resolve, reject });

			// Set a timeout to prevent hanging requests
			setTimeout(() => {
				if (pendingRequests.has(id)) {
					pendingRequests.delete(id);
					reject(new Error(`Request ${id} timed out after 10 seconds`));
				}
			}, 10000);

			try {
				vscode.postMessage(message);
				console.log('Sent message to extension:', message);
			} catch (error) {
				pendingRequests.delete(id);
				reject(error);
			}
		});
	}

	/**
	 * Handle messages received from the extension
	 * @param {MessageEvent} event - The message event from VS Code
	 */
	function handleMessage(event) {
		const message = event.data;
		console.log('Received message from extension:', message);

		try {
			if (!message || typeof message !== 'object') {
				throw new Error('Invalid message format');
			}

			// Handle responses to our requests
			if (message.id && pendingRequests.has(message.id)) {
				const { resolve, reject } = pendingRequests.get(message.id);
				pendingRequests.delete(message.id);

				if (message.error) {
					reject(new Error(message.error));
				} else {
					resolve(message.data);
				}
				return;
			}

			// Handle commands from the extension
			switch (message.command) {
				case 'ping':
					// Respond to ping with pong
					vscode.postMessage({
						id: message.id,
						command: 'pong',
						data: { timestamp: Date.now() }
					});
					break;

				case 'test-notification':
					// Handle test notifications from extension
					showNotification(message.data?.text || 'Test notification from extension');
					break;

				default:
					console.warn('Unknown command received:', message.command);
			}
		} catch (error) {
			console.error('Error handling message:', error);

			// Send error response if this was a request
			if (message?.id) {
				vscode.postMessage({
					id: message.id,
					error: error.message
				});
			}
		}
	}

	/**
	 * Show a notification in the webview UI
	 * @param {string} text - The notification text
	 */
	function showNotification(text) {
		const notification = document.createElement('div');
		notification.className = 'notification';
		notification.textContent = text;

		const container = document.querySelector('.container');
		if (container) {
			container.appendChild(notification);

			// Remove notification after 3 seconds
			setTimeout(() => {
				if (notification.parentNode) {
					notification.parentNode.removeChild(notification);
				}
			}, 3000);
		}
	}

	/**
	 * Test function to send a test message to the extension
	 */
	function sendTestMessage() {
		sendMessage('test-command', { message: 'Hello from webview!' })
			.then(response => {
				console.log('Test message response:', response);
				showNotification(`Extension responded: ${JSON.stringify(response)}`);
			})
			.catch(error => {
				console.error('Test message error:', error);
				showNotification(`Error: ${error.message}`);
			});
	}

	/**
	 * State management for model selection
	 */
	const modelSelectionState = {
		availableModels: [],
		selectedModels: [],
		initialized: false
	};

	/**
	 * Load available models from the extension
	 */
	async function loadAvailableModels() {
		try {
			const response = await sendMessage('get-available-models');
			modelSelectionState.availableModels = response.models || [];
			return modelSelectionState.availableModels;
		} catch (error) {
			console.error('Failed to load available models:', error);
			showErrorMessage('Failed to load available models: ' + error.message);
			return [];
		}
	}

	/**
	 * Load currently selected models from the extension
	 */
	async function loadSelectedModels() {
		try {
			const response = await sendMessage('get-selected-models');
			modelSelectionState.selectedModels = response.selectedModels || [];
			return modelSelectionState.selectedModels;
		} catch (error) {
			console.error('Failed to load selected models:', error);
			showErrorMessage('Failed to load selected models: ' + error.message);
			return [];
		}
	}

	/**
	 * Update selected models in the extension
	 */
	async function updateSelectedModels(modelIds) {
		try {
			await sendMessage('set-selected-models', { modelIds });
			modelSelectionState.selectedModels = modelIds;
			updateUI();
			return true;
		} catch (error) {
			console.error('Failed to update selected models:', error);
			showErrorMessage('Failed to update selected models: ' + error.message);
			return false;
		}
	}

	/**
	 * Toggle a model's selection state
	 */
	async function toggleModel(modelId) {
		try {
			await sendMessage('toggle-model', { modelId });
			// Reload selected models to get the updated state
			await loadSelectedModels();
			updateUI();
		} catch (error) {
			console.error('Failed to toggle model:', error);
			showErrorMessage('Failed to toggle model: ' + error.message);
		}
	}

	/**
	 * Reset to default model selection
	 */
	async function resetToDefaults() {
		try {
			await sendMessage('reset-to-defaults');
			await loadSelectedModels();
			updateUI();
		} catch (error) {
			console.error('Failed to reset to defaults:', error);
			showErrorMessage('Failed to reset to defaults: ' + error.message);
		}
	}

	/**
	 * Clear all selected models
	 */
	async function clearAllModels() {
		// Since we need at least one model, we can't actually clear all
		// Instead, reset to a single default model
		try {
			await sendMessage('set-selected-models', { modelIds: ['gpt-5'] });
			await loadSelectedModels();
			updateUI();
		} catch (error) {
			console.error('Failed to clear models:', error);
			showErrorMessage('Failed to clear models: ' + error.message);
		}
	}

	/**
	 * Render the model list UI
	 */
	function renderModelList() {
		const modelList = document.getElementById('model-list');
		if (!modelList) {
			return;
		}

		modelList.innerHTML = '';

		modelSelectionState.availableModels.forEach(model => {
			const isSelected = modelSelectionState.selectedModels.includes(model.id);

			const modelItem = document.createElement('div');
			modelItem.className = `model-item ${isSelected ? 'selected' : ''}`;
			modelItem.onclick = () => toggleModel(model.id);

			modelItem.innerHTML = `
				<input type="checkbox" ${isSelected ? 'checked' : ''} readonly>
				<div class="model-info">
					<div class="model-name">${escapeHtml(model.name)}</div>
					<div class="model-provider">${escapeHtml(model.provider)}</div>
				</div>
			`;

			modelList.appendChild(modelItem);
		});
	}

	/**
	 * Render the selected models display
	 */
	function renderSelectedModels() {
		const selectedModelsDisplay = document.getElementById('selected-models-display');
		if (!selectedModelsDisplay) {
			return;
		}

		selectedModelsDisplay.innerHTML = '';

		if (modelSelectionState.selectedModels.length === 0) {
			selectedModelsDisplay.innerHTML = '<p class="instructions">No models selected</p>';
			return;
		}

		modelSelectionState.selectedModels.forEach(modelId => {
			const model = modelSelectionState.availableModels.find(m => m.id === modelId);
			if (!model) {
				return;
			}

			const selectedItem = document.createElement('div');
			selectedItem.className = 'selected-model-item';

			selectedItem.innerHTML = `
				<div>
					<span class="selected-model-name">${escapeHtml(model.name)}</span>
					<span class="selected-model-provider">(${escapeHtml(model.provider)})</span>
				</div>
				<button class="remove-model" title="Remove model">×</button>
			`;

			// Add event listener to the remove button
			const removeButton = selectedItem.querySelector('.remove-model');
			if (removeButton) {
				removeButton.onclick = () => toggleModel(model.id);
			}

			selectedModelsDisplay.appendChild(selectedItem);
		});
	}

	/**
	 * Update the selected count display
	 */
	function updateSelectedCount() {
		const selectedCountElement = document.getElementById('selected-count');
		if (selectedCountElement) {
			selectedCountElement.textContent = modelSelectionState.selectedModels.length;
		}
	}

	/**
	 * Update the entire UI
	 */
	function updateUI() {
		renderModelList();
		renderSelectedModels();
		updateSelectedCount();
	}

	/**
	 * Show an error message to the user
	 */
	function showErrorMessage(message) {
		const errorDiv = document.createElement('div');
		errorDiv.className = 'error-message';
		errorDiv.textContent = message;

		const container = document.querySelector('.container');
		if (container) {
			container.insertBefore(errorDiv, container.firstChild);

			// Remove error message after 5 seconds
			setTimeout(() => {
				if (errorDiv.parentNode) {
					errorDiv.parentNode.removeChild(errorDiv);
				}
			}, 5000);
		}
	}

	/**
	 * Escape HTML to prevent XSS
	 */
	function escapeHtml(text) {
		const div = document.createElement('div');
		div.textContent = text;
		return div.innerHTML;
	}

	/**
	 * Initialize the webview
	 */
	async function init() {
		console.log('Model Comparison webview initialized');

		// Set up event listeners for control buttons
		const resetButton = document.getElementById('reset-selection');
		const clearButton = document.getElementById('clear-all');

		if (resetButton) {
			resetButton.onclick = resetToDefaults;
		}

		if (clearButton) {
			clearButton.onclick = clearAllModels;
		}

		// Add test button for manual testing in the testing section
		const testingSection = document.querySelector('.testing-section');
		if (testingSection) {
			const testButton = document.createElement('button');
			testButton.textContent = 'Send Test Message';
			testButton.className = 'test-button';
			testButton.onclick = sendTestMessage;
			testingSection.appendChild(testButton);

			const instructions = document.createElement('p');
			instructions.textContent = 'Click the button above to test message passing. Check the Developer Console for detailed logs.';
			instructions.className = 'instructions';
			testingSection.appendChild(instructions);
		}

		// Initialize model selection
		try {
			console.log('Loading models and selection state...');

			// Load both available models and current selection
			await Promise.all([
				loadAvailableModels(),
				loadSelectedModels()
			]);

			console.log('Models loaded:', {
				available: modelSelectionState.availableModels,
				selected: modelSelectionState.selectedModels
			});

			// Update UI with loaded data
			updateUI();
			modelSelectionState.initialized = true;

		} catch (error) {
			console.error('Failed to initialize model selection:', error);
			showErrorMessage('Failed to initialize model selection. Please reload the panel.');
		}

		// Send initial ping to extension
		sendMessage('ping', { source: 'webview-init' })
			.then(response => {
				console.log('Initial ping response:', response);
			})
			.catch(error => {
				console.error('Initial ping failed:', error);
			});
	}

	// Listen for messages from the extension
	window.addEventListener('message', handleMessage);

	// Initialize when DOM is ready
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}

	// Make functions available globally for debugging
	window.modelComparison = {
		sendMessage,
		sendTestMessage,
		loadAvailableModels,
		loadSelectedModels,
		updateSelectedModels,
		toggleModel,
		resetToDefaults,
		clearAllModels,
		modelSelectionState,
		updateUI
	};

})();