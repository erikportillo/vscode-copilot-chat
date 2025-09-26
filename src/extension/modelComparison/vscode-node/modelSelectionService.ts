/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Disposable } from '../../../util/vs/base/common/lifecycle';

export interface ModelMetadata {
	readonly id: string;
	readonly name: string;
	readonly provider: string;
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
	private static readonly DEFAULT_SELECTIONS = ['gpt-5', 'claude-sonnet-4'];

	// Mock model data as specified in the task
	private static readonly MOCK_MODELS: ModelMetadata[] = [
		{ id: 'gpt-5', name: 'GPT-5', provider: 'OpenAI' },
		{ id: 'claude-sonnet-4', name: 'Claude Sonnet 4', provider: 'Anthropic' },
		{ id: 'gpt-4.1', name: 'GPT-4.1', provider: 'OpenAI' },
		{ id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'Google' },
		{ id: 'gpt-4-turbo', name: 'GPT-4 Turbo', provider: 'OpenAI' }
	];

	private _selectedModels: Set<string>;

	constructor(
		private readonly context: vscode.ExtensionContext
	) {
		super();

		// Load persisted selections or use defaults
		this._selectedModels = new Set(this.loadSelectedModels());
	}

	/**
	 * Get all available models (mock data for now)
	 */
	public getAvailableModels(): ModelMetadata[] {
		return [...ModelSelectionService.MOCK_MODELS];
	}

	/**
	 * Get currently selected model IDs
	 */
	public getSelectedModels(): string[] {
		return Array.from(this._selectedModels);
	}

	/**
	 * Get metadata for currently selected models
	 */
	public getSelectedModelMetadata(): ModelMetadata[] {
		return ModelSelectionService.MOCK_MODELS.filter(model =>
			this._selectedModels.has(model.id)
		);
	}

	/**
	 * Update the selected models
	 */
	public async setSelectedModels(modelIds: string[]): Promise<void> {
		// Validate that all provided model IDs exist
		const availableIds = new Set(ModelSelectionService.MOCK_MODELS.map(m => m.id));
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
		await this.saveSelectedModels(modelIds);
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
		return ModelSelectionService.MOCK_MODELS.find(model => model.id === modelId);
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
	private loadSelectedModels(): string[] {
		try {
			const stored = this.context.workspaceState.get<string[]>(ModelSelectionService.STORAGE_KEY);

			if (Array.isArray(stored) && stored.length > 0) {
				// Validate that all stored models still exist in our mock data
				const availableIds = new Set(ModelSelectionService.MOCK_MODELS.map(m => m.id));
				const validModels = stored.filter(id => availableIds.has(id));

				if (validModels.length > 0) {
					return validModels;
				}
			}
		} catch (error) {
			console.error('Error loading selected models from workspace state:', error);
		}

		// Return defaults if no valid stored selection
		return [...ModelSelectionService.DEFAULT_SELECTIONS];
	}

	/**
	 * Save selected models to workspace state
	 */
	private async saveSelectedModels(modelIds: string[]): Promise<void> {
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
		await this.setSelectedModels([...ModelSelectionService.DEFAULT_SELECTIONS]);
	}

	/**
	 * Clear workspace state (for testing)
	 */
	public async clearStoredState(): Promise<void> {
		await this.context.workspaceState.update(ModelSelectionService.STORAGE_KEY, undefined);
	}
}