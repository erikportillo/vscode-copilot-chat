/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IEndpointProvider } from '../../../platform/endpoint/common/endpointProvider';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { ModelSelectionService } from './modelSelectionService';

/**
 * Provider for the Model Comparison WebView panel
 */
export class ModelComparisonViewProvider extends Disposable implements vscode.WebviewViewProvider {

	public static readonly viewType = 'model-comparison-panel';

	private readonly modelSelectionService: ModelSelectionService;

	constructor(
		private readonly extensionUri: vscode.Uri,
		context: vscode.ExtensionContext,
		endpointProvider: IEndpointProvider
	) {
		super();

		// Initialize the model selection service with endpoint provider
		this.modelSelectionService = this._register(new ModelSelectionService(context, endpointProvider));
	}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	): void {
		webviewView.webview.options = {
			// Allow scripts in the webview
			enableScripts: true,

			localResourceRoots: [
				this.extensionUri
			]
		};

		webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

		// Set up message handling
		this.setupMessageHandling(webviewView.webview);

		// Retry loading models in case they weren't available during initial construction
		// This helps with timing issues during window reload
		setTimeout(() => {
			this.modelSelectionService.retryLoadingModels();
		}, 1000); // Give the backend time to initialize
	}

	private getHtmlForWebview(webview: vscode.Webview): string {
		// Get the local path to assets directory
		const assetsPath = vscode.Uri.joinPath(this.extensionUri, 'assets', 'modelComparison');
		const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsPath, 'styles.css'));
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsPath, 'script.js'));

		// Generate nonce for Content Security Policy
		const nonce = this.getNonce();

		return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
				<link href="${stylesUri}" rel="stylesheet">
				<title>Model Comparison Panel</title>
			</head>
			<body>
				<div class="container">
					<h1>Model Comparison Panel</h1>

					<!-- Compact Model Selection Section -->
					<div class="model-selection-section">
						<div class="model-selection-header">
							<h2>Models</h2>
							<div class="selected-count">
								<span id="selected-count">0</span>/4 selected
							</div>
						</div>

						<div class="model-list" id="model-list">
							<!-- Model checkboxes will be populated by JavaScript -->
						</div>

						<div class="selection-controls">
							<button id="reset-selection" class="secondary-button" title="Reset to default model selection">Reset</button>
							<button id="clear-all" class="secondary-button" title="Reduce to minimal selection">Clear</button>
						</div>
					</div>

					<!-- Chat Messages Display -->
					<div class="chat-messages" id="chat-messages">
						<div class="chat-instructions">
							Select models above and send a message to see side-by-side responses
						</div>
					</div>

					<!-- Chat Input Section -->
					<div class="chat-input-section">
						<div class="chat-input-container">
							<textarea id="chat-input" placeholder="Type your message here..." rows="2"></textarea>
							<button id="send-button" class="primary-button">Send</button>
						</div>
					</div>


				</div>
				<script nonce="${nonce}" src="${scriptUri}"></script>
			</body>
			</html>`;
	}

	/**
	 * Generate a nonce for Content Security Policy
	 */
	private getNonce(): string {
		let text = '';
		const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
		for (let i = 0; i < 32; i++) {
			text += possible.charAt(Math.floor(Math.random() * possible.length));
		}
		return text;
	}

	/**
	 * Set up bidirectional message handling between extension and webview
	 */
	private setupMessageHandling(webview: vscode.Webview): void {
		// Listen for messages from the webview
		this._register(webview.onDidReceiveMessage(async (message) => {
			try {
				console.log('Extension received message from webview:', message);

				if (!message || typeof message !== 'object') {
					throw new Error('Invalid message format');
				}

				const response = await this.handleWebviewMessage(message);

				// Send response back to webview
				if (message.id) {
					webview.postMessage({
						id: message.id,
						data: response
					});
				}
			} catch (error) {
				console.error('Error handling webview message:', error);

				// Send error response back to webview
				if (message?.id) {
					webview.postMessage({
						id: message.id,
						error: error instanceof Error ? error.message : 'Unknown error'
					});
				}
			}
		}));
	}

	/**
	 * Generate mock response for a given model and message
	 */
	private generateMockResponse(modelId: string, message: string): string {
		const model = this.modelSelectionService.getAvailableModels().find(m => m.id === modelId);
		const modelName = model?.name || modelId;

		// Generate different mock responses based on the model to simulate differences
		const responses = {
			'gpt-5': [
				`As GPT-5, I'd be happy to help with "${message}". Here's a comprehensive response that demonstrates advanced reasoning capabilities...`,
				`From a GPT-5 perspective on "${message}": I can provide detailed analysis with multiple viewpoints...`,
				`GPT-5 analysis of "${message}": Let me break this down systematically with enhanced understanding...`
			],
			'claude-sonnet-4': [
				`Claude Sonnet 4 responding to "${message}": I'll approach this thoughtfully with careful consideration...`,
				`As Claude Sonnet 4, regarding "${message}": I believe a nuanced approach would be most beneficial...`,
				`Claude Sonnet 4's perspective on "${message}": Let me provide a balanced and thorough response...`
			],
			'gpt-4.1': [
				`GPT-4.1 here! For "${message}", I can offer this insight based on my training...`,
				`From GPT-4.1: "${message}" is an interesting query. Here's my analysis...`,
				`GPT-4.1 response to "${message}": I'll provide a detailed breakdown...`
			]
		};

		// Get model-specific responses or fall back to generic ones
		const modelResponses = responses[modelId as keyof typeof responses] || [
			`[${modelName}] Mock response to: "${message}". This is a simulated response for testing purposes.`,
			`[${modelName}] Analyzing "${message}"... Here's what I think about this query.`,
			`[${modelName}] Responding to "${message}": This is a mock response to demonstrate the comparison interface.`
		];

		// Pick a random response for variety
		const randomResponse = modelResponses[Math.floor(Math.random() * modelResponses.length)];

		// Add some random content to make responses more realistic
		const additionalContent = [
			'\n\nThis response demonstrates how different models might approach the same query with varying perspectives and detail levels.',
			'\n\nNote: This is a mock response for development testing. Real model responses would provide actual AI-generated content.',
			'\n\nIn a real implementation, this would contain the actual model output with proper reasoning and analysis.',
			''
		];

		return randomResponse + additionalContent[Math.floor(Math.random() * additionalContent.length)];
	}

	/**
	 * Handle messages received from the webview
	 */
	private async handleWebviewMessage(message: any): Promise<any> {
		switch (message.command) {
			case 'ping':
				// Respond to ping with pong
				return {
					command: 'pong',
					timestamp: Date.now(),
					source: 'extension'
				};

			case 'test-command':
				// Handle test command from webview
				return {
					message: `Extension received: ${message.data?.message || 'no message'}`,
					timestamp: Date.now(),
					success: true
				};

			case 'get-available-models': {
				// Return available models from the service, waiting for initialization if needed
				const availableModels = await this.modelSelectionService.getAvailableModelsAsync();
				return {
					models: availableModels
				};
			}

			case 'get-selected-models': {
				// Return currently selected models, waiting for initialization if needed
				const selectedModels = await this.modelSelectionService.getSelectedModelsAsync();
				const selectedModelMetadata = await this.modelSelectionService.getSelectedModelMetadataAsync();
				return {
					selectedModels,
					selectedModelMetadata
				};
			}

			case 'set-selected-models':
				// Update selected models
				if (!message.data?.modelIds || !Array.isArray(message.data.modelIds)) {
					throw new Error('Invalid modelIds provided');
				}
				await this.modelSelectionService.setSelectedModels(message.data.modelIds);
				return {
					success: true,
					selectedModels: this.modelSelectionService.getSelectedModels()
				};

			case 'toggle-model':
				// Toggle a model's selection state
				if (!message.data?.modelId) {
					throw new Error('No modelId provided');
				}
				await this.modelSelectionService.toggleModel(message.data.modelId);
				return {
					success: true,
					selectedModels: this.modelSelectionService.getSelectedModels()
				};

			case 'reset-to-defaults':
				// Reset to default model selection
				await this.modelSelectionService.resetToDefaults();
				return {
					success: true,
					selectedModels: this.modelSelectionService.getSelectedModels()
				};

			case 'clear-all':
				// Clear all selected models
				await this.modelSelectionService.clearAll();
				return {
					success: true,
					selectedModels: this.modelSelectionService.getSelectedModels()
				};

			case 'get-selection-state':
				// Get full selection state for debugging
				return {
					selectionState: this.modelSelectionService.getSelectionState(),
					availableModels: this.modelSelectionService.getAvailableModels()
				};

			case 'send-chat-message': {
				// Handle chat message and generate mock responses
				if (!message.data?.message || typeof message.data.message !== 'string') {
					throw new Error('No message provided');
				}

				const selectedModels = this.modelSelectionService.getSelectedModels();
				if (selectedModels.length === 0) {
					throw new Error('No models selected for comparison');
				}

				// Generate mock responses for each selected model
				const responses: { [modelId: string]: string } = {};
				for (const modelId of selectedModels) {
					responses[modelId] = this.generateMockResponse(modelId, message.data.message);
				}

				// Simulate some delay to make it feel more realistic
				await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1000));

				return {
					message: message.data.message,
					responses,
					selectedModels,
					timestamp: Date.now()
				};
			}

			default:
				throw new Error(`Unknown command: ${message.command}`);
		}
	}

	/**
	 * Send a message to the webview
	 */
	public sendMessageToWebview(webview: vscode.Webview, command: string, data: any = {}): void {
		try {
			webview.postMessage({
				command,
				data
			});
		} catch (error) {
			console.error('Error sending message to webview:', error);
		}
	}
}