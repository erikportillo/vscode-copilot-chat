/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IEndpointProvider } from '../../../platform/endpoint/common/endpointProvider';
import { IChatEndpoint } from '../../../platform/networking/common/networking';
import { Emitter, Event } from '../../../util/vs/base/common/event';
import { Disposable } from '../../../util/vs/base/common/lifecycle';

export interface ModelMetadata {
	readonly id: string;
	readonly name: string;
	readonly provider: string;
	readonly family?: string;
	readonly version?: string;
	readonly maxInputTokens?: number;
	readonly maxOutputTokens?: number;
	readonly capabilities?: {
		readonly imageInput?: boolean;
		readonly toolCalling?: boolean;
	};
	readonly detail?: string;
	readonly tooltip?: string;
}

export interface ModelSelectionState {
	readonly selectedModels: string[];
	readonly lastUpdated: number;
}

/**
 * Service for managing model selection in the comparison panel
 */
export class ModelSelectionService extends Disposable {

	private static readonly STORAGE_KEY = 'modelComparison.selectedModels';

	private _selectedModels: Set<string>;
	private _availableModels: ModelMetadata[] = [];
	private readonly _onDidModelsChange = this._register(new Emitter<void>());
	readonly onDidModelsChange: Event<void> = this._onDidModelsChange.event;
	private _initializationPromise: Promise<void>;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly endpointProvider?: IEndpointProvider
	) {
		super();

		// Initialize models asynchronously
		this._selectedModels = new Set();
		this._initializationPromise = this._initialize();

		// Listen to VS Code model changes
		this._register(vscode.lm.onDidChangeChatModels(() => {
			this.refreshAvailableModels();
		}));
	}

	private async _initialize(): Promise<void> {
		await this._loadAvailableModels();

		// Load persisted selections or use defaults after models are loaded
		const selectedModels = await this._loadSelectedModels();
		this._selectedModels = new Set(selectedModels);
	}

	/**
	 * Load available models from VS Code Language Model API with fallback to endpoint provider
	 */
	private async _loadAvailableModels(): Promise<void> {
		try {
			// First try to get models from VS Code Language Model API
			const languageModels = await vscode.lm.selectChatModels({});

			if (languageModels.length > 0) {
				// Use VS Code Language Model API if models are available
				this._availableModels = languageModels.map((model: vscode.LanguageModelChat) => this._convertToModelMetadata(model));
			} else if (this.endpointProvider) {
				// Fallback to endpoint provider if no VS Code language models are available
				// Try to get endpoints with retry logic in case the provider isn't fully ready
				const chatEndpoints = await this._getEndpointsWithRetry();
				const filteredEndpoints = chatEndpoints.filter((endpoint: IChatEndpoint) => endpoint.showInModelPicker);
				this._availableModels = filteredEndpoints.map((endpoint: IChatEndpoint) => this._convertEndpointToModelMetadata(endpoint));
			} else {
				// No models available from either source - use empty array
				this._availableModels = [];
			}

			this._onDidModelsChange.fire();
		} catch (error) {
			console.error('[ModelComparison] Failed to load available models:', error);
			// Fallback to empty array if models can't be loaded
			this._availableModels = [];
			this._onDidModelsChange.fire();
		}
	}

	/**
	 * Convert VS Code LanguageModelChat to our ModelMetadata format
	 */
	private _convertToModelMetadata(model: vscode.LanguageModelChat): ModelMetadata {
		// Use vendor as provider, with fallback extraction from family or model ID
		let provider = model.vendor || 'Unknown';
		if (provider === 'Unknown') {
			if (model.family?.toLowerCase().includes('gpt') || model.id?.toLowerCase().includes('gpt')) {
				provider = 'OpenAI';
			} else if (model.family?.toLowerCase().includes('claude') || model.id?.toLowerCase().includes('claude')) {
				provider = 'Anthropic';
			} else if (model.family?.toLowerCase().includes('gemini') || model.id?.toLowerCase().includes('gemini')) {
				provider = 'Google';
			} else if (model.family) {
				// Use family as provider if we can't determine it
				provider = model.family.charAt(0).toUpperCase() + model.family.slice(1);
			}
		}

		return {
			id: model.id,
			name: model.name,
			provider,
			family: model.family,
			version: model.version,
			maxInputTokens: model.maxInputTokens,
			// LanguageModelChat doesn't have maxOutputTokens, capabilities, detail, or tooltip
			maxOutputTokens: undefined,
			capabilities: undefined,
			detail: undefined,
			tooltip: undefined
		};
	}

	/**
	 * Convert ChatEndpoint to our ModelMetadata format
	 */
	private _convertEndpointToModelMetadata(endpoint: IChatEndpoint): ModelMetadata {
		// Extract provider from family or model ID as a best-effort approach
		let provider = 'Unknown';
		if (endpoint.family?.toLowerCase().includes('gpt') || endpoint.model?.toLowerCase().includes('gpt')) {
			provider = 'OpenAI';
		} else if (endpoint.family?.toLowerCase().includes('claude') || endpoint.model?.toLowerCase().includes('claude')) {
			provider = 'Anthropic';
		} else if (endpoint.family?.toLowerCase().includes('gemini') || endpoint.model?.toLowerCase().includes('gemini')) {
			provider = 'Google';
		} else if (endpoint.family) {
			// Use family as provider if we can't determine it
			provider = endpoint.family.charAt(0).toUpperCase() + endpoint.family.slice(1);
		}

		return {
			id: endpoint.model,
			name: endpoint.name,
			provider,
			family: endpoint.family,
			version: endpoint.version,
			maxInputTokens: endpoint.modelMaxPromptTokens,
			maxOutputTokens: endpoint.maxOutputTokens,
			capabilities: {
				imageInput: endpoint.supportsVision,
				toolCalling: endpoint.supportsToolCalls
			},
			detail: endpoint.multiplier !== undefined ? `${endpoint.multiplier}x` : undefined,
			tooltip: undefined
		};
	}

	/**
	 * Get all available models
	 */
	public getAvailableModels(): ModelMetadata[] {
		return [...this._availableModels];
	}

	/**
	 * Get all available models, waiting for initialization if needed
	 */
	public async getAvailableModelsAsync(): Promise<ModelMetadata[]> {
		await this._initializationPromise;
		return [...this._availableModels];
	}

	/**
	 * Get currently selected model IDs
	 */
	public getSelectedModels(): string[] {
		return Array.from(this._selectedModels);
	}

	/**
	 * Get currently selected model IDs, waiting for initialization if needed
	 */
	public async getSelectedModelsAsync(): Promise<string[]> {
		await this._initializationPromise;
		return Array.from(this._selectedModels);
	}

	/**
	 * Get metadata for currently selected models
	 */
	public getSelectedModelMetadata(): ModelMetadata[] {
		return this._availableModels.filter((model: ModelMetadata) =>
			this._selectedModels.has(model.id)
		);
	}

	/**
	 * Get metadata for currently selected models, waiting for initialization if needed
	 */
	public async getSelectedModelMetadataAsync(): Promise<ModelMetadata[]> {
		await this._initializationPromise;
		return this._availableModels.filter((model: ModelMetadata) =>
			this._selectedModels.has(model.id)
		);
	}

	/**
	 * Update the selected models
	 */
	public async setSelectedModels(modelIds: string[]): Promise<void> {
		// Validate that all provided model IDs exist
		const availableIds = new Set(this._availableModels.map((m: ModelMetadata) => m.id));
		const invalidIds = modelIds.filter(id => !availableIds.has(id));

		if (invalidIds.length > 0) {
			throw new Error(`Invalid model IDs: ${invalidIds.join(', ')}`);
		}

		// Ensure we have between 1 and 4 models selected (as per task requirements)
		if (modelIds.length < 1 || modelIds.length > 4) {
			throw new Error('Must select between 1 and 4 models');
		}

		// Update selection
		this._selectedModels = new Set(modelIds);

		// Persist the selection
		await this._saveSelectedModels(modelIds);
	}

	/**
	 * Add a model to the selection
	 */
	public async addModel(modelId: string): Promise<void> {
		const currentSelection = this.getSelectedModels();

		if (currentSelection.includes(modelId)) {
			return; // Already selected
		}

		if (currentSelection.length >= 4) {
			throw new Error('Cannot select more than 4 models');
		}

		await this.setSelectedModels([...currentSelection, modelId]);
	}

	/**
	 * Remove a model from the selection
	 */
	public async removeModel(modelId: string): Promise<void> {
		const currentSelection = this.getSelectedModels().filter(id => id !== modelId);

		if (currentSelection.length === 0) {
			throw new Error('Must have at least one model selected');
		}

		await this.setSelectedModels(currentSelection);
	}

	/**
	 * Toggle a model's selection state
	 */
	public async toggleModel(modelId: string): Promise<void> {
		if (this._selectedModels.has(modelId)) {
			await this.removeModel(modelId);
		} else {
			await this.addModel(modelId);
		}
	}

	/**
	 * Check if a model is currently selected
	 */
	public isModelSelected(modelId: string): boolean {
		return this._selectedModels.has(modelId);
	}

	/**
	 * Get model metadata by ID
	 */
	public getModelMetadata(modelId: string): ModelMetadata | undefined {
		return this._availableModels.find((model: ModelMetadata) => model.id === modelId);
	}

	/**
	 * Get current selection state for persistence
	 */
	public getSelectionState(): ModelSelectionState {
		return {
			selectedModels: this.getSelectedModels(),
			lastUpdated: Date.now()
		};
	}

	/**
	 * Load selected models from workspace state
	 */
	private async _loadSelectedModels(): Promise<string[]> {
		try {
			const stored = this.context.workspaceState.get<string[]>(ModelSelectionService.STORAGE_KEY);

			if (Array.isArray(stored) && stored.length > 0) {
				// Validate that all stored models still exist in our available models
				const availableIds = new Set(this._availableModels.map((m: ModelMetadata) => m.id));
				const validModels = stored.filter(id => availableIds.has(id));

				if (validModels.length > 0) {
					return validModels;
				}
			}
		} catch (error) {
			console.error('Error loading selected models from workspace state:', error);
		}

		// Return first two available models as defaults if no valid stored selection
		const defaultModels = this._availableModels.slice(0, 2).map((m: ModelMetadata) => m.id);
		return defaultModels.length > 0 ? defaultModels : [];
	}

	/**
	 * Save selected models to workspace state
	 */
	private async _saveSelectedModels(modelIds: string[]): Promise<void> {
		try {
			await this.context.workspaceState.update(ModelSelectionService.STORAGE_KEY, modelIds);
		} catch (error) {
			console.error('Error saving selected models to workspace state:', error);
			throw new Error('Failed to save model selection');
		}
	}

	/**
	 * Reset to default selection
	 */
	public async resetToDefaults(): Promise<void> {
		// Use first two available models as defaults
		const defaultModels = this._availableModels.slice(0, 2).map((m: ModelMetadata) => m.id);
		if (defaultModels.length > 0) {
			await this.setSelectedModels(defaultModels);
		}
	}

	/**
	 * Clear to minimal selection (select only the first available model)
	 * This respects the 1-4 model constraint while providing a "clear" experience
	 */
	public async clearAll(): Promise<void> {
		// Select only the first available model to provide minimal selection
		const firstModel = this._availableModels.length > 0 ? [this._availableModels[0].id] : [];
		if (firstModel.length > 0) {
			await this.setSelectedModels(firstModel);
		}
	}

	/**
	 * Refresh available models from VS Code API
	 */
	public async refreshAvailableModels(): Promise<void> {
		await this._loadAvailableModels();
		// Revalidate current selection against updated models
		const currentSelection = this.getSelectedModels();
		const availableIds = new Set(this._availableModels.map((m: ModelMetadata) => m.id));
		const validSelection = currentSelection.filter(id => availableIds.has(id));

		if (validSelection.length !== currentSelection.length) {
			// Some selected models are no longer available, update selection
			if (validSelection.length > 0) {
				await this.setSelectedModels(validSelection);
			} else {
				// No valid models left, reset to defaults
				await this.resetToDefaults();
			}
		}
	}

	/**
	 * Retry loading models if they weren't loaded initially (for timing issues)
	 */
	public async retryLoadingModels(): Promise<void> {
		if (this._availableModels.length === 0) {
			await this._loadAvailableModels();

			// Also reload selections if models are now available
			if (this._availableModels.length > 0) {
				const selectedModels = await this._loadSelectedModels();
				this._selectedModels = new Set(selectedModels);
			}
		}
	}	/**
	 * Get endpoints with retry logic to handle timing issues during window reload
	 */
	private async _getEndpointsWithRetry(maxRetries: number = 3, delay: number = 500): Promise<IChatEndpoint[]> {
		if (!this.endpointProvider) {
			return [];
		}

		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			try {
				const endpoints = await this.endpointProvider.getAllChatEndpoints();
				if (endpoints.length > 0) {
					return endpoints;
				}

				if (attempt < maxRetries) {
					await new Promise(resolve => setTimeout(resolve, delay));
				}
			} catch (error) {
				console.error(`[ModelComparison] Error getting endpoints on attempt ${attempt}:`, error);
				if (attempt < maxRetries) {
					await new Promise(resolve => setTimeout(resolve, delay));
				}
			}
		}

		// Return empty array if all attempts fail
		return [];
	}

	/**
	 * Clear workspace state (for testing)
	 */
	public async clearStoredState(): Promise<void> {
		await this.context.workspaceState.update(ModelSelectionService.STORAGE_KEY, undefined);
	}
}