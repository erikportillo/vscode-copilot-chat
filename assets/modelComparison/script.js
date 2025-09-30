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

			// Set a timeout to prevent hanging requests (120 seconds for agent mode with tools)
			setTimeout(() => {
				if (pendingRequests.has(id)) {
					pendingRequests.delete(id);
					reject(new Error(`Request ${id} timed out after 120 seconds`));
				}
			}, 120000);

			try {
				vscode.postMessage(message);
				// Only log non-routine messages
				if (!['get-available-models', 'get-selected-models', 'ping'].includes(command)) {
					console.log(`📤 ${command}:`, data);
				}
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

		// Only log important messages to reduce noise
		const routineMessages = ['streaming-chunk', 'pong'];
		const responseMessages = message.id && pendingRequests.has(message.id);

		if (!routineMessages.includes(message.command) && !responseMessages) {
			console.log(`📨 ${message.command}:`, message.data ? Object.keys(message.data) : '');
		}

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

				case 'tool-state-changed':
					// Handle tool state changes from extension
					if (message.data?.toolState) {
						updateToolCallPreview(message.data.toolState);
					}
					break;

				case 'streaming-chunk':
					// Handle streaming chunk updates
					if (message.data?.modelId && message.data?.chunk) {
						handleStreamingChunk(message.data.modelId, message.data.chunk, message.data.requestId);
					}
					break;

				case 'tool-call-update':
					// Handle real-time tool call updates
					if (message.data?.modelId && message.data?.toolCall) {
						handleToolCallUpdate(message.data.modelId, message.data.toolCall, message.data.requestId);
					}
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
	 * State management for tool calls
	 */
	const toolCallState = {
		isPreviewVisible: false,
		toolCallPreviews: [],
		canApprove: false,
		canCancel: false
	};

	/**
	 * Streaming progress tracking
	 */
	const streamingStats = {
		modelProgress: new Map(), // modelId -> { chunks: number, totalChars: number, lastUpdate: timestamp }
		debugMode: false // Set to true for detailed streaming logs
	};

	/**
	 * Track streaming progress in a more elegant way
	 */
	function trackStreamingProgress(modelId, chunkLength) {
		if (!streamingStats.modelProgress.has(modelId)) {
			streamingStats.modelProgress.set(modelId, { chunks: 0, totalChars: 0, lastUpdate: Date.now() });
		}

		const progress = streamingStats.modelProgress.get(modelId);
		progress.chunks++;
		progress.totalChars += chunkLength;
		progress.lastUpdate = Date.now();

		// Only log significant progress milestones
		if (streamingStats.debugMode || progress.chunks % 10 === 0) {
			console.log(`📡 ${modelId}: ${progress.chunks} chunks, ${progress.totalChars} chars`);
		}
	}

	/**
	 * Get streaming summary for debugging
	 */
	function getStreamingSummary() {
		const summary = {};
		for (const [modelId, progress] of streamingStats.modelProgress.entries()) {
			summary[modelId] = {
				chunks: progress.chunks,
				chars: progress.totalChars,
				avgChunkSize: Math.round(progress.totalChars / progress.chunks),
				lastUpdate: new Date(progress.lastUpdate).toLocaleTimeString()
			};
		}
		return summary;
	}

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
			// If there are active requests, cancel them before sending new message
			if (chatState.isLoading) {
				await cancelToolCalls();
			}

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

			// Create streaming assistant message immediately
			const assistantMessage = {
				id: Date.now() + 1,
				type: 'assistant',
				content: message,
				responses: {},
				errors: {},
				selectedModels: modelSelectionState.selectedModels,
				timestamp: Date.now(),
				streamingResponses: {},
				isStreaming: true
			};

			chatState.messages.push(assistantMessage);
			updateChatUI();

			// Send message to extension and get responses
			const response = await sendMessage('send-chat-message', { message });

			console.log('[ModelComparison] Received response with tool calls:', response.toolCalls);

			// Update assistant message with final responses
			assistantMessage.responses = response.responses;
			assistantMessage.errors = response.errors;
			assistantMessage.selectedModels = response.selectedModels;
			assistantMessage.timestamp = response.timestamp;
			assistantMessage.toolCalls = response.toolCalls; // Add tool calls to message
			assistantMessage.isStreaming = false;

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
	 * Handle streaming chunk updates from the extension
	 */
	function handleStreamingChunk(modelId, chunk, requestId) {
		// Track streaming progress more elegantly
		trackStreamingProgress(modelId, chunk.length);

		// Find the current loading assistant message
		const currentMessage = chatState.messages[chatState.messages.length - 1];
		if (!currentMessage || currentMessage.type !== 'assistant' || !chatState.isLoading) {
			console.warn('No active assistant message to update with streaming chunk');
			return;
		}

		// Initialize streaming responses if not exists
		if (!currentMessage.streamingResponses) {
			currentMessage.streamingResponses = {};
		}

		// Append chunk to the model's streaming response
		if (!currentMessage.streamingResponses[modelId]) {
			currentMessage.streamingResponses[modelId] = '';
		}
		currentMessage.streamingResponses[modelId] += chunk;

		// Update the UI to show the streaming content
		updateChatUI();
	}

	/**
	 * Handle real-time tool call updates
	 * @param {string} modelId - The model ID that called the tool
	 * @param {object} toolCall - The tool call object with displayMessage, toolName, etc.
	 * @param {string} requestId - The request ID
	 */
	function handleToolCallUpdate(modelId, toolCall, requestId) {
		console.log(`[ModelComparison] Real-time tool call update for ${modelId}:`, toolCall.displayMessage);

		// Find the current loading assistant message
		const currentMessage = chatState.messages[chatState.messages.length - 1];
		if (!currentMessage || currentMessage.type !== 'assistant') {
			console.warn('No active assistant message to update with tool call');
			return;
		}

		// Initialize toolCalls object if not exists
		if (!currentMessage.toolCalls) {
			currentMessage.toolCalls = {};
		}

		// Initialize tool calls array for this model if not exists
		if (!currentMessage.toolCalls[modelId]) {
			currentMessage.toolCalls[modelId] = [];
		}

		// Add the tool call to the model's tool calls array
		currentMessage.toolCalls[modelId].push(toolCall);

		// Update the UI immediately to show the new tool call
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

		// Check if user was scrolled near the bottom before updating
		// (within 100px is considered "at bottom")
		const wasNearBottom = chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < 100;

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

		// Note: We no longer render a separate loading message since streaming
		// is handled within the assistant message itself

		// Only auto-scroll if user was already near the bottom
		// This allows users to scroll up and read previous messages while streaming
		if (wasNearBottom) {
			chatMessages.scrollTop = chatMessages.scrollHeight;
		}
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
			const errorText = message.errors?.[modelId];
			const toolCalls = message.toolCalls?.[modelId];

			const responseCard = document.createElement('div');
			responseCard.className = `model-response ${errorText ? 'error' : ''}`;

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

			// Show tool calls if available
			if (toolCalls && toolCalls.length > 0) {
				const toolCallsSection = document.createElement('div');
				toolCallsSection.className = 'tool-calls-section';

				const toolCallsHeader = document.createElement('div');
				toolCallsHeader.className = 'tool-calls-header';
				toolCallsHeader.textContent = `🔧 ${toolCalls.length} Tool${toolCalls.length === 1 ? '' : 's'} Called`;

				toolCallsSection.appendChild(toolCallsHeader);

				const toolCallsList = document.createElement('div');
				toolCallsList.className = 'tool-calls-list';

				toolCalls.forEach((toolCall, index) => {
					const toolCallItem = document.createElement('div');
					toolCallItem.className = 'tool-call-item';

					const toolCallMessage = document.createElement('div');
					toolCallMessage.className = 'tool-call-message';
					toolCallMessage.textContent = toolCall.displayMessage;

					const toolCallParams = document.createElement('details');
					toolCallParams.className = 'tool-call-params';

					const paramsSummary = document.createElement('summary');
					paramsSummary.textContent = 'Parameters';
					toolCallParams.appendChild(paramsSummary);

					const paramsContent = document.createElement('pre');
					paramsContent.className = 'tool-call-params-content';
					paramsContent.textContent = JSON.stringify(toolCall.parameters, null, 2);
					toolCallParams.appendChild(paramsContent);

					toolCallItem.appendChild(toolCallMessage);
					toolCallItem.appendChild(toolCallParams);
					toolCallsList.appendChild(toolCallItem);
				});

				toolCallsSection.appendChild(toolCallsList);
				content.appendChild(toolCallsSection);
			}

			if (errorText) {
				// Show error message
				const errorDiv = document.createElement('div');
				errorDiv.className = 'model-response-error';
				errorDiv.textContent = `Error: ${errorText}`;
				content.appendChild(errorDiv);
			} else {
				// Show response text - prioritize streaming content if available
				const text = document.createElement('div');
				text.className = 'model-response-text';

				// Use streaming content if available and currently streaming, otherwise use final response
				const streamingText = message.streamingResponses?.[modelId];
				const finalText = responseText;

				if (message.isStreaming && streamingText) {
					// Show streaming content with typing indicator
					text.textContent = streamingText;
					text.classList.add('streaming');
				} else if (finalText) {
					// Show final response
					text.textContent = finalText;
					text.classList.remove('streaming');
				} else if (message.isStreaming) {
					// Show loading indicator if streaming but no content yet
					text.textContent = 'Thinking...';
					text.classList.add('loading');
				} else {
					// No response available
					text.textContent = 'No response';
				}

				content.appendChild(text);
			}

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
	 * Update send and stop button states
	 */
	function updateSendButton() {
		const sendButton = document.getElementById('send-button');
		const stopButton = document.getElementById('stop-button');

		if (sendButton) {
			// Send button is always enabled when models are selected
			sendButton.disabled = modelSelectionState.selectedModels.length === 0;
		}

		if (stopButton) {
			// Stop button only visible when actively loading
			stopButton.style.display = chatState.isLoading ? 'flex' : 'none';
		}
	}

	/**
	 * Update tool call preview based on tool state from extension
	 */
	function updateToolCallPreview(toolState) {
		// Show the preview if there are any tool call previews, regardless of pause state
		// This allows individual model approval even when not all models are paused
		toolCallState.isPreviewVisible = toolState.toolCallPreviews.length > 0;
		toolCallState.toolCallPreviews = toolState.toolCallPreviews || [];
		toolCallState.canApprove = toolState.canResume || false;
		toolCallState.canCancel = toolState.canCancel || false;

		renderToolCallPreview();
	}

	/**
	 * Render the tool call preview UI
	 */
	function renderToolCallPreview() {
		const previewContainer = document.getElementById('tool-call-preview');
		const previewContent = document.getElementById('tool-call-content');
		const approveButton = document.getElementById('approve-tools');
		const cancelButton = document.getElementById('cancel-tools');

		if (!previewContainer || !previewContent) {
			return;
		}

		// Show or hide the preview based on state
		previewContainer.style.display = toolCallState.isPreviewVisible ? 'block' : 'none';

		// Update button states
		if (approveButton) {
			approveButton.disabled = !toolCallState.canApprove;
		}
		if (cancelButton) {
			cancelButton.disabled = !toolCallState.canCancel;
		}

		// Clear existing content
		previewContent.innerHTML = '';

		if (!toolCallState.isPreviewVisible) {
			return;
		}

		// Create a more dynamic grid layout for tool approvals
		const toolGrid = document.createElement('div');
		toolGrid.className = 'tool-approval-grid';

		toolCallState.toolCallPreviews.forEach((preview, index) => {
			const model = modelSelectionState.availableModels.find(m => m.id === preview.modelId);
			const modelName = model?.name || preview.modelId;
			const modelProvider = model?.provider || '';

			// Create a compact card for each model
			const modelCard = document.createElement('div');
			modelCard.className = 'tool-approval-card';
			modelCard.setAttribute('data-model-id', preview.modelId);

			// Generate summary of tool calls for quick preview
			const toolSummary = preview.toolCalls.map(call => `${call.name}`).join(', ');
			const isExpanded = false; // Start collapsed for cleaner UI

			modelCard.innerHTML = `
				<div class="tool-card-header" data-action="expand">
					<div class="model-info">
						<div class="model-name">${escapeHtml(modelName)}</div>
						<div class="model-provider">${escapeHtml(modelProvider)}</div>
					</div>
					<div class="tool-summary">
						<div class="tool-preview">${escapeHtml(toolSummary)}</div>
						<div class="tool-count-badge">${preview.toolCalls.length}</div>
					</div>
					<div class="expand-indicator">
						<span class="expand-arrow">▼</span>
					</div>
				</div>

				<div class="tool-card-actions">
					<button class="approve-model-btn quick-approve" data-model-id="${escapeHtml(preview.modelId)}" title="Approve all tools for ${escapeHtml(modelName)}">
						<span class="btn-icon">✅</span>
						<span class="btn-text">Approve</span>
					</button>
					<button class="cancel-model-btn quick-cancel" data-model-id="${escapeHtml(preview.modelId)}" title="Cancel all tools for ${escapeHtml(modelName)}">
						<span class="btn-icon">❌</span>
						<span class="btn-text">Cancel</span>
					</button>
				</div>

				<div class="tool-details" style="display: none;">
					<div class="tool-details-header">
						<span>Tool Details</span>
						<button class="details-close" data-action="collapse" title="Collapse details">×</button>
					</div>
					<div class="tool-call-list">
						${preview.toolCalls.map(toolCall => {
				// Parse arguments safely
				let parsedArgs;
				try {
					parsedArgs = typeof toolCall.arguments === 'string'
						? JSON.parse(toolCall.arguments)
						: toolCall.arguments;
				} catch (e) {
					parsedArgs = toolCall.arguments;
				}

				// Create a more compact representation of arguments
				const argsPreview = JSON.stringify(parsedArgs, null, 2);
				const shortArgs = argsPreview.length > 100
					? argsPreview.substring(0, 100) + '...'
					: argsPreview;

				return `
								<div class="tool-call-compact">
									<div class="tool-call-header">
										<span class="tool-name">🔧 ${escapeHtml(toolCall.name)}</span>
										<span class="tool-id">${escapeHtml(toolCall.id.substring(0, 8))}</span>
									</div>
									<div class="tool-args-compact">
										<pre>${escapeHtml(shortArgs)}</pre>
									</div>
								</div>
							`;
			}).join('')}
					</div>
				</div>
			`;

			toolGrid.appendChild(modelCard);
		});

		previewContent.appendChild(toolGrid);

		// Add event listeners for individual model approve/cancel buttons
		previewContent.querySelectorAll('.approve-model-btn').forEach(btn => {
			btn.onclick = () => approveModelToolCalls(btn.dataset.modelId);
		});

		previewContent.querySelectorAll('.cancel-model-btn').forEach(btn => {
			btn.onclick = () => cancelModelToolCalls(btn.dataset.modelId);
		});

		// Add event listeners for expand/collapse functionality
		previewContent.querySelectorAll('.tool-card-header[data-action="expand"]').forEach(header => {
			header.onclick = (e) => {
				e.preventDefault();
				const card = header.closest('.tool-approval-card');
				const modelId = card.getAttribute('data-model-id');
				toggleToolCardExpansion(modelId);
			};
		});

		previewContent.querySelectorAll('.details-close[data-action="collapse"]').forEach(btn => {
			btn.onclick = (e) => {
				e.preventDefault();
				e.stopPropagation();
				const card = btn.closest('.tool-approval-card');
				const modelId = card.getAttribute('data-model-id');
				toggleToolCardExpansion(modelId);
			};
		});
	}

	/**
	 * Toggle expansion of tool card details
	 */
	function toggleToolCardExpansion(modelId) {
		const card = document.querySelector(`[data-model-id="${modelId}"]`);
		if (!card) {
			console.error(`🔧 Tool card not found: ${modelId}`);
			return;
		}

		const details = card.querySelector('.tool-details');
		const arrow = card.querySelector('.expand-arrow');

		if (!details || !arrow) {
			console.error(`🔧 Tool card elements missing for: ${modelId}`);
			return;
		}

		const isExpanded = details.style.display !== 'none';
		const action = isExpanded ? 'collapsed' : 'expanded';

		// Toggle state
		if (isExpanded) {
			details.style.display = 'none';
			arrow.textContent = '▼';
			card.classList.remove('expanded');
		} else {
			details.style.display = 'block';
			arrow.textContent = '▲';
			card.classList.add('expanded');
		}

		// Single clean log line
		console.log(`🔧 Tool card ${action}: ${modelId}`);
	}	// Make function globally available
	window.toggleToolCardExpansion = toggleToolCardExpansion;

	/**
	 * Approve all tool calls
	 */
	async function approveToolCalls() {
		try {
			await sendMessage('approve-tools');
			showNotification('✅ All tool calls approved and executing');
		} catch (error) {
			console.error('Failed to approve tool calls:', error);
			showErrorMessage('Failed to approve tool calls: ' + error.message);
		}
	}

	/**
	 * Cancel all tool calls
	 */
	async function cancelToolCalls() {
		try {
			await sendMessage('cancel-tools');

			// Immediately reset the loading state since we've cancelled the request
			chatState.isLoading = false;
			updateChatUI();

			showNotification('❌ All tool calls cancelled');
		} catch (error) {
			console.error('Failed to cancel tool calls:', error);
			showErrorMessage('Failed to cancel tool calls: ' + error.message);
		}
	}

	/**
	 * Approve tool calls for a specific model
	 */
	async function approveModelToolCalls(modelId) {
		try {
			const model = modelSelectionState.availableModels.find(m => m.id === modelId);
			const modelName = model?.name || modelId;

			await sendMessage('approve-model-tools', { modelId });
			showNotification(`✅ Tool calls approved for ${modelName}`);
		} catch (error) {
			console.error(`Failed to approve tool calls for ${modelId}:`, error);
			showErrorMessage(`Failed to approve tool calls for ${modelId}: ` + error.message);
		}
	}

	/**
	 * Cancel tool calls for a specific model
	 */
	async function cancelModelToolCalls(modelId) {
		try {
			const model = modelSelectionState.availableModels.find(m => m.id === modelId);
			const modelName = model?.name || modelId;

			await sendMessage('cancel-model-tools', { modelId });

			// If this was the only selected model, reset loading state
			// Otherwise, keep loading state active since other models might still be processing
			if (modelSelectionState.selectedModels.length === 1) {
				chatState.isLoading = false;
				updateChatUI();
			}

			showNotification(`❌ Tool calls cancelled for ${modelName}`);
		} catch (error) {
			console.error(`Failed to cancel tool calls for ${modelId}:`, error);
			showErrorMessage(`Failed to cancel tool calls for ${modelId}: ` + error.message);
		}
	}

	/**
	 * Initialize the webview
	 */
	async function init() {
		console.log('🚀 Model Comparison initialized');

		// Set up event listeners for control buttons
		const resetButton = document.getElementById('reset-selection');
		const clearButton = document.getElementById('clear-all');

		if (resetButton) {
			resetButton.onclick = resetToDefaults;
		}

		if (clearButton) {
			clearButton.onclick = clearAllModels;
		}

		// Set up tool call event listeners
		const approveToolsButton = document.getElementById('approve-tools');
		const cancelToolsButton = document.getElementById('cancel-tools');

		if (approveToolsButton) {
			approveToolsButton.onclick = approveToolCalls;
		}

		if (cancelToolsButton) {
			cancelToolsButton.onclick = cancelToolCalls;
		}

		// Set up chat interface event listeners
		const chatInput = document.getElementById('chat-input');
		const sendButton = document.getElementById('send-button');
		const stopButton = document.getElementById('stop-button');

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

		if (stopButton) {
			stopButton.onclick = () => {
				cancelToolCalls();
			};
		}

		if (chatInput) {
			// Send message on Enter (but allow Shift+Enter for new lines)
			chatInput.addEventListener('keydown', (event) => {
				if (event.key === 'Enter' && !event.shiftKey) {
					event.preventDefault();
					const message = chatInput.value.trim();
					const sendButton = document.getElementById('send-button');
					if (message && sendButton && !sendButton.disabled) {
						sendChatMessage(message);
						chatInput.value = '';
					}
				}
			});

			// Update send button state when input changes
			chatInput.addEventListener('input', updateSendButton);
		}



		// Initialize model selection
		try {
			// Load both available models and current selection
			await Promise.all([
				loadAvailableModels(),
				loadSelectedModels()
			]);

			// Only log summary for debugging
			console.log(`🤖 Initialized: ${modelSelectionState.availableModels.length} available, ${modelSelectionState.selectedModels.length} selected`);

			// Update UI with loaded data
			updateUI();
			modelSelectionState.initialized = true;

		} catch (error) {
			console.error('Failed to initialize model selection:', error);
			showErrorMessage('Failed to initialize model selection. Please reload the panel.');
		}

		// Send initial ping to extension
		sendMessage('ping', { source: 'webview-init' })
			.catch(error => {
				console.error('Connection failed:', error);
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
		updateUI,
		// Debug utilities
		getStreamingSummary,
		enableStreamingDebug: () => { streamingStats.debugMode = true; console.log('📡 Streaming debug enabled'); },
		disableStreamingDebug: () => { streamingStats.debugMode = false; console.log('📡 Streaming debug disabled'); }
	};

})();