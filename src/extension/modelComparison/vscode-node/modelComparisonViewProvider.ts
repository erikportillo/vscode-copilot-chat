/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IEndpointProvider } from '../../../platform/endpoint/common/endpointProvider';
import { CancellationTokenSource } from '../../../util/vs/base/common/cancellation';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { ModelSelectionService } from './modelSelectionService';
import { SingleModelChatHandler } from './singleModelChatHandler';

/**
 * Provider for the Model Comparison WebView panel
 */
export class ModelComparisonViewProvider extends Disposable implements vscode.WebviewViewProvider {

	public static readonly viewType = 'model-comparison-panel';

	private readonly modelSelectionService: ModelSelectionService;
	private readonly singleModelChatHandler: SingleModelChatHandler;

	constructor(
		private readonly extensionUri: vscode.Uri,
		context: vscode.ExtensionContext,
		endpointProvider: IEndpointProvider,
		instantiationService: IInstantiationService
	) {
		super();

		// Initialize the model selection service with endpoint provider
		this.modelSelectionService = this._register(new ModelSelectionService(context, endpointProvider));

		// Initialize the single model chat handler
		this.singleModelChatHandler = this._register(new SingleModelChatHandler(instantiationService));
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
			'gpt-4o': [
				`As GPT-4o, I'd be happy to help with "${message}". Here's a comprehensive response that demonstrates advanced reasoning capabilities...`,
				`From a GPT-4o perspective on "${message}": I can provide detailed analysis with multiple viewpoints...`,
				`GPT-4o analysis of "${message}": Let me break this down systematically with enhanced understanding...`
			],
			'claude-3-5-sonnet-20241022': [
				`Claude 3.5 Sonnet responding to "${message}": I'll approach this thoughtfully with careful consideration...`,
				`As Claude 3.5 Sonnet, regarding "${message}": I believe a nuanced approach would be most beneficial...`,
				`Claude 3.5 Sonnet's perspective on "${message}": Let me provide a balanced and thorough response...`
			],
			'gpt-4o-mini': [
				`GPT-4o Mini here! For "${message}", I can offer this insight based on my training...`,
				`From GPT-4o Mini: "${message}" is an interesting query. Here's my analysis...`,
				`GPT-4o Mini response to "${message}": I'll provide a concise breakdown...`
			]
		};

		// Get model-specific responses or fall back to generic ones
		const modelResponses = responses[modelId as keyof typeof responses] || [
			`Hello! I'm ${modelName}. For your question "${message}", here's my simulated response. This is a mock response for testing purposes.`,
			`As ${modelName}, I'm analyzing "${message}"... Here's what I would say about this query if I were actually running.`,
			`${modelName} responding to "${message}": This is a simulated response to demonstrate the comparison interface.`
		];

		// Pick a random response for variety
		const randomResponse = modelResponses[Math.floor(Math.random() * modelResponses.length)];

		// Add some random content to make responses more realistic
		const additionalContent = [
			'\n\n📝 Note: This is a mock response for comparison. Only the first selected model uses real AI.',
			'\n\n🤖 Mock response for demonstration purposes.',
			'\n\n💭 This simulates how different models might respond differently.',
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
					selectedModels: await this.modelSelectionService.getSelectedModelsAsync()
				};

			case 'toggle-model':
				// Toggle a model's selection state
				if (!message.data?.modelId) {
					throw new Error('No modelId provided');
				}
				await this.modelSelectionService.toggleModel(message.data.modelId);
				return {
					success: true,
					selectedModels: await this.modelSelectionService.getSelectedModelsAsync()
				};

			case 'reset-to-defaults':
				// Reset to default model selection
				await this.modelSelectionService.resetToDefaults();
				return {
					success: true,
					selectedModels: await this.modelSelectionService.getSelectedModelsAsync()
				};

			case 'clear-all':
				// Clear all selected models
				await this.modelSelectionService.clearAll();
				return {
					success: true,
					selectedModels: await this.modelSelectionService.getSelectedModelsAsync()
				};

			case 'get-selection-state':
				// Get full selection state for debugging
				return {
					selectionState: this.modelSelectionService.getSelectionState(),
					availableModels: this.modelSelectionService.getAvailableModels()
				};

			case 'send-chat-message': {
				// Handle chat message and generate real AI responses
				if (!message.data?.message || typeof message.data.message !== 'string') {
					throw new Error('No message provided');
				}

				// Use async method to ensure we get the latest selection
				const selectedModelsRaw = await this.modelSelectionService.getSelectedModelsAsync();
				if (selectedModelsRaw.length === 0) {
					throw new Error('No models selected for comparison');
				}

				// Sort models to ensure consistent ordering regardless of selection order
				// This prevents confusion when models are added/removed
				const selectedModels = [...selectedModelsRaw].sort();

				const responses: { [modelId: string]: string } = {};
				const errors: { [modelId: string]: string } = {};

				// For Task 3: Real response for first model, mock responses for others
				// This provides a hybrid approach - users can see real AI output while
				// still being able to compare multiple models visually
				for (let i = 0; i < selectedModels.length; i++) {
					const modelId = selectedModels[i];

					if (i === 0) {
						// Use real AI response for the first selected model
						// Note: Currently uses system default model, not the specific requested model
						try {
							const cancellationTokenSource = new CancellationTokenSource();
							const cancellationToken = cancellationTokenSource.token;

							const result = await this.singleModelChatHandler.sendChatMessage(
								modelId,
								message.data.message,
								[], // No history for now
								cancellationToken,
								(chunk: string) => {
									// Stream progress callback - for now just log it
									console.log(`Streaming chunk for ${modelId}:`, chunk);
								}
							);

							if (result.error) {
								errors[modelId] = result.error;
								responses[modelId] = '';
							} else {
								// Add a note to clarify which model is actually being used
								const modelMetadata = this.modelSelectionService.getAvailableModels().find(m => m.id === modelId);
								const modelName = modelMetadata?.name || modelId;
								const responseWithNote = `🤖 **Real AI Response** (using system default model - ${modelName} selection will be supported in Task 4)\n\n${result.response}`;
								responses[modelId] = responseWithNote;
							}
						} catch (error) {
							const errorMsg = error instanceof Error ? error.message : String(error);
							errors[modelId] = errorMsg;
							responses[modelId] = '';
						}
					} else {
						// Generate mock responses for additional models
						responses[modelId] = this.generateMockResponse(modelId, message.data.message);
					}
				}

				return {
					message: message.data.message,
					responses,
					errors,
					selectedModels, // Return all selected models
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