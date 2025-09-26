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
	 * Initialize the webview
	 */
	function init() {
		console.log('Model Comparison webview initialized');

		// Add test button for manual testing
		const container = document.querySelector('.container');
		if (container) {
			const testButton = document.createElement('button');
			testButton.textContent = 'Send Test Message';
			testButton.className = 'test-button';
			testButton.onclick = sendTestMessage;
			container.appendChild(testButton);

			const instructions = document.createElement('p');
			instructions.textContent = 'Click the button above to test message passing. Check the Developer Console for detailed logs.';
			instructions.className = 'instructions';
			container.appendChild(instructions);
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

	// Make sendMessage available globally for debugging
	window.modelComparison = {
		sendMessage,
		sendTestMessage
	};

})();