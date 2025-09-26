/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
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
	) {
		super();

		// Initialize the model selection service
		this.modelSelectionService = this._register(new ModelSelectionService(context));
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
	}

	private getHtmlForWebview(webview: vscode.Webview): string {
		// Get the local path to assets directory
		const assetsPath = vscode.Uri.joinPath(this.extensionUri, 'assets', 'modelComparison');
		const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsPath, 'styles.css'));
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsPath, 'script.js'));

		return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<link href="${stylesUri}" rel="stylesheet">
				<title>Model Comparison Panel</title>
			</head>
			<body>
				<div class="container">
					<h1>Model Comparison Panel</h1>

					<!-- Model Selection Section -->
					<div class="model-selection-section">
						<h2>Select Models to Compare</h2>
						<div class="model-selection-info">
							<p>Choose 2-4 models for comparison:</p>
							<div class="selected-count">
								<span id="selected-count">0</span> models selected
							</div>
						</div>

						<div class="model-list" id="model-list">
							<!-- Model checkboxes will be populated by JavaScript -->
						</div>

						<div class="selection-controls">
							<button id="reset-selection" class="secondary-button">Reset to Defaults</button>
							<button id="clear-all" class="secondary-button">Clear All</button>
						</div>
					</div>

					<!-- Selected Models Display -->
					<div class="selected-models-section">
						<h3>Selected Models</h3>
						<div class="selected-models-display" id="selected-models-display">
							<!-- Selected models will be displayed here -->
						</div>
					</div>

					<!-- Testing Section (keep for development) -->
					<div class="testing-section">
						<h3>Development Testing</h3>
						<p>This section is for development testing and will be removed in later tasks.</p>
					</div>
				</div>
				<script src="${scriptUri}"></script>
			</body>
			</html>`;
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

			case 'get-available-models':
				// Return available models from the service
				return {
					models: this.modelSelectionService.getAvailableModels()
				};

			case 'get-selected-models':
				// Return currently selected models
				return {
					selectedModels: this.modelSelectionService.getSelectedModels(),
					selectedModelMetadata: this.modelSelectionService.getSelectedModelMetadata()
				};

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

			case 'get-selection-state':
				// Get full selection state for debugging
				return {
					selectionState: this.modelSelectionService.getSelectionState(),
					availableModels: this.modelSelectionService.getAvailableModels()
				};

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