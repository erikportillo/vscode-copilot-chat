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
	 * State management for model selection
	 */
	const modelSelectionState = {
		availableModels: [],
		selectedModels: [],
		initialized: false
	};

	/**
	 * State management for chat
	 */
	const chatState = {
		messages: [],
		isLoading: false
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
	 * Clear to minimal selection (1 model)
	 */
	async function clearAllModels() {
		// Check if we're already at minimal selection
		if (modelSelectionState.selectedModels.length <= 1) {
			showNotification('Already at minimal selection (1 model required)');
			return;
		}

		const previousCount = modelSelectionState.selectedModels.length;

		try {
			// Clear to minimal selection on the backend
			await sendMessage('clear-all');
			await loadSelectedModels();
			updateUI();

			// Show success notification
			const newCount = modelSelectionState.selectedModels.length;
			showNotification(`Reduced selection to minimal (${previousCount} → ${newCount} model${newCount > 1 ? 's' : ''})`);

			// Update the clear button state
			updateClearButtonState();
		} catch (error) {
			console.error('Failed to clear models:', error);
			showErrorMessage('Failed to clear models: ' + error.message);
		}
	}

	/**
	 * Update the clear button state based on selection
	 */
	function updateClearButtonState() {
		const clearButton = document.getElementById('clear-all');
		if (clearButton) {
			const selectionCount = modelSelectionState.selectedModels.length;

			// Disable if we're already at minimal selection (1 model) or no models available
			clearButton.disabled = selectionCount <= 1;

			// Update button text and tooltip based on selection count
			if (selectionCount <= 1) {
				clearButton.textContent = 'Clear';
				clearButton.title = 'Already at minimal selection (1 model required)';
			} else {
				clearButton.textContent = `Clear (${selectionCount})`;
				clearButton.title = `Reduce to minimal selection (keep only 1 model)`;
			}
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
		updateSelectedCount();
		updateChatUI();
		updateClearButtonState();
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
	 * Send a chat message to the extension
	 */
	async function sendChatMessage(message) {
		if (!message || message.trim() === '') {
			showErrorMessage('Please enter a message');
			return;
		}

		if (modelSelectionState.selectedModels.length === 0) {
			showErrorMessage('Please select at least one model for comparison');
			return;
		}

		try {
			chatState.isLoading = true;
			updateChatUI();

			// Add user message to chat
			const userMessage = {
				id: Date.now(),
				type: 'user',
				content: message,
				timestamp: Date.now()
			};

			chatState.messages.push(userMessage);
			updateChatUI();

			// Send message to extension and get responses
			const response = await sendMessage('send-chat-message', { message });

			// Add assistant responses to chat
			const assistantMessage = {
				id: Date.now() + 1,
				type: 'assistant',
				content: message,
				responses: response.responses,
				selectedModels: response.selectedModels,
				timestamp: response.timestamp
			};

			chatState.messages.push(assistantMessage);

		} catch (error) {
			console.error('Failed to send chat message:', error);
			showErrorMessage('Failed to send message: ' + error.message);
		} finally {
			chatState.isLoading = false;
			updateChatUI();
		}
	}

	/**
	 * Clear all chat messages
	 */
	function clearChat() {
		chatState.messages = [];
		updateChatUI();
	}

	/**
	 * Update the chat UI
	 */
	function updateChatUI() {
		renderChatMessages();
		updateSendButton();
	}

	/**
	 * Render chat messages in the UI
	 */
	function renderChatMessages() {
		const chatMessages = document.getElementById('chat-messages');
		if (!chatMessages) {
			return;
		}

		// Clear existing messages
		chatMessages.innerHTML = '';

		// Show instructions if no messages
		if (chatState.messages.length === 0) {
			const instructions = document.createElement('div');
			instructions.className = 'chat-instructions';
			instructions.textContent = 'Select models above and send a message to see side-by-side responses';
			chatMessages.appendChild(instructions);
			return;
		}

		// Render each message
		chatState.messages.forEach(message => {
			if (message.type === 'user') {
				renderUserMessage(chatMessages, message);
			} else if (message.type === 'assistant') {
				renderAssistantMessage(chatMessages, message);
			}
		});

		// Show loading indicator if needed
		if (chatState.isLoading) {
			renderLoadingMessage(chatMessages);
		}

		// Scroll to bottom
		chatMessages.scrollTop = chatMessages.scrollHeight;
	}

	/**
	 * Render a user message
	 */
	function renderUserMessage(container, message) {
		const messageGroup = document.createElement('div');
		messageGroup.className = 'message-group';

		const userMessage = document.createElement('div');
		userMessage.className = 'user-message';

		const text = document.createElement('div');
		text.className = 'user-message-text';
		text.textContent = message.content;

		userMessage.appendChild(text);
		messageGroup.appendChild(userMessage);
		container.appendChild(messageGroup);
	}

	/**
	 * Render assistant responses from multiple models
	 */
	function renderAssistantMessage(container, message) {
		const messageGroup = document.createElement('div');
		messageGroup.className = 'message-group';

		const modelResponses = document.createElement('div');
		modelResponses.className = 'model-responses';

		// Create response cards for each model
		message.selectedModels.forEach(modelId => {
			const model = modelSelectionState.availableModels.find(m => m.id === modelId);
			const responseText = message.responses[modelId];

			const responseCard = document.createElement('div');
			responseCard.className = 'model-response';

			// Response header with model info
			const header = document.createElement('div');
			header.className = 'model-response-header';

			const title = document.createElement('div');
			title.className = 'model-response-title';
			title.textContent = model?.name || modelId;

			const provider = document.createElement('div');
			provider.className = 'model-response-provider';
			provider.textContent = model?.provider || '';

			header.appendChild(title);
			header.appendChild(provider);

			// Response content
			const content = document.createElement('div');
			content.className = 'model-response-content';

			const text = document.createElement('div');
			text.className = 'model-response-text';
			text.textContent = responseText || 'No response';

			content.appendChild(text);

			responseCard.appendChild(header);
			responseCard.appendChild(content);
			modelResponses.appendChild(responseCard);
		});

		messageGroup.appendChild(modelResponses);
		container.appendChild(messageGroup);
	}

	/**
	 * Render loading message
	 */
	function renderLoadingMessage(container) {
		const messageGroup = document.createElement('div');
		messageGroup.className = 'message-group';

		const modelResponses = document.createElement('div');
		modelResponses.className = 'model-responses';

		// Create loading cards for each selected model
		modelSelectionState.selectedModels.forEach(modelId => {
			const model = modelSelectionState.availableModels.find(m => m.id === modelId);

			const responseCard = document.createElement('div');
			responseCard.className = 'model-response';

			// Response header
			const header = document.createElement('div');
			header.className = 'model-response-header';

			const title = document.createElement('div');
			title.className = 'model-response-title';
			title.textContent = model?.name || modelId;

			const provider = document.createElement('div');
			provider.className = 'model-response-provider';
			provider.textContent = model?.provider || '';

			header.appendChild(title);
			header.appendChild(provider);

			// Loading content
			const content = document.createElement('div');
			content.className = 'model-response-content';

			const loading = document.createElement('div');
			loading.className = 'response-loading';
			loading.textContent = 'Generating response';

			content.appendChild(loading);

			responseCard.appendChild(header);
			responseCard.appendChild(content);
			modelResponses.appendChild(responseCard);
		});

		messageGroup.appendChild(modelResponses);
		container.appendChild(messageGroup);
	}

	/**
	 * Update send button state
	 */
	function updateSendButton() {
		const sendButton = document.getElementById('send-button');
		if (sendButton) {
			sendButton.disabled = chatState.isLoading || modelSelectionState.selectedModels.length === 0;
			sendButton.textContent = chatState.isLoading ? 'Sending...' : 'Send';
		}
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

		// Set up chat interface event listeners
		const chatInput = document.getElementById('chat-input');
		const sendButton = document.getElementById('send-button');

		if (sendButton) {
			sendButton.onclick = () => {
				const message = chatInput?.value || '';
				if (message.trim()) {
					sendChatMessage(message.trim());
					if (chatInput) {
						chatInput.value = '';
					}
				}
			};
		}

		if (chatInput) {
			// Send message on Enter (but allow Shift+Enter for new lines)
			chatInput.addEventListener('keydown', (event) => {
				if (event.key === 'Enter' && !event.shiftKey) {
					event.preventDefault();
					const message = chatInput.value.trim();
					if (message) {
						sendChatMessage(message);
						chatInput.value = '';
					}
				}
			});

			// Update send button state when input changes
			chatInput.addEventListener('input', updateSendButton);

			// Handle Enter key to send message (Shift+Enter for new line)
			chatInput.addEventListener('keydown', (event) => {
				if (event.key === 'Enter' && !event.shiftKey) {
					event.preventDefault();
					const sendButton = document.getElementById('send-button');
					if (sendButton && !sendButton.disabled) {
						sendChatMessage();
					}
				}
			});
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
		loadAvailableModels,
		loadSelectedModels,
		updateSelectedModels,
		toggleModel,
		resetToDefaults,
		clearAllModels,
		sendChatMessage,
		clearChat,
		modelSelectionState,
		chatState,
		updateUI
	};

})();