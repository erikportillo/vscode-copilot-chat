/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Emitter, Event } from '../../../util/vs/base/common/event';
import { Disposable } from '../../../util/vs/base/common/lifecycle';

export interface ModelConfiguration {
	readonly modelId: string;
	readonly enabled: boolean;
	readonly customName?: string;
	readonly priority: number;
	readonly settings?: {
		readonly temperature?: number;
		readonly maxTokens?: number;
		readonly topP?: number;
		readonly frequencyPenalty?: number;
		readonly presencePenalty?: number;
	};
}

export interface ModelConfigurationState {
	readonly configurations: ModelConfiguration[];
	readonly lastUpdated: number;
}

/**
 * Service for storing and managing model configurations persistently
 */
export class ModelConfigurationStore extends Disposable {

	private static readonly STORAGE_KEY = 'modelComparison.configurations';

	private _configurations: Map<string, ModelConfiguration> = new Map();
	private readonly _onDidConfigurationsChange = this._register(new Emitter<void>());
	readonly onDidConfigurationsChange: Event<void> = this._onDidConfigurationsChange.event;

	constructor(
		private readonly context: vscode.ExtensionContext
	) {
		super();

		// Load stored configurations
		this._loadConfigurations();
	}

	/**
	 * Get configuration for a specific model
	 */
	public getModelConfiguration(modelId: string): ModelConfiguration | undefined {
		return this._configurations.get(modelId);
	}

	/**
	 * Get all model configurations
	 */
	public getAllConfigurations(): ModelConfiguration[] {
		return Array.from(this._configurations.values());
	}

	/**
	 * Update configuration for a specific model
	 */
	public async setModelConfiguration(config: ModelConfiguration): Promise<void> {
		this._configurations.set(config.modelId, config);
		await this._saveConfigurations();
		this._onDidConfigurationsChange.fire();
	}

	/**
	 * Update multiple model configurations
	 */
	public async setModelConfigurations(configs: ModelConfiguration[]): Promise<void> {
		for (const config of configs) {
			this._configurations.set(config.modelId, config);
		}
		await this._saveConfigurations();
		this._onDidConfigurationsChange.fire();
	}

	/**
	 * Remove configuration for a specific model
	 */
	public async removeModelConfiguration(modelId: string): Promise<void> {
		if (this._configurations.delete(modelId)) {
			await this._saveConfigurations();
			this._onDidConfigurationsChange.fire();
		}
	}

	/**
	 * Check if a model has configuration
	 */
	public hasConfiguration(modelId: string): boolean {
		return this._configurations.has(modelId);
	}

	/**
	 * Get or create default configuration for a model
	 */
	public getOrCreateDefaultConfiguration(modelId: string, modelName: string): ModelConfiguration {
		let config = this._configurations.get(modelId);

		if (!config) {
			config = {
				modelId,
				enabled: true,
				customName: modelName,
				priority: this._configurations.size,
				settings: {
					temperature: 1.0,
					maxTokens: undefined, // Use model default
					topP: 1.0,
					frequencyPenalty: 0,
					presencePenalty: 0
				}
			};
		}

		return config;
	}

	/**
	 * Enable or disable a model
	 */
	public async setModelEnabled(modelId: string, enabled: boolean): Promise<void> {
		const existing = this._configurations.get(modelId);
		if (existing) {
			const updated: ModelConfiguration = {
				...existing,
				enabled
			};
			await this.setModelConfiguration(updated);
		}
	}

	/**
	 * Update model priority (for ordering in UI)
	 */
	public async setModelPriority(modelId: string, priority: number): Promise<void> {
		const existing = this._configurations.get(modelId);
		if (existing) {
			const updated: ModelConfiguration = {
				...existing,
				priority
			};
			await this.setModelConfiguration(updated);
		}
	}

	/**
	 * Update model settings
	 */
	public async updateModelSettings(modelId: string, settings: Partial<ModelConfiguration['settings']>): Promise<void> {
		const existing = this._configurations.get(modelId);
		if (existing) {
			const updated: ModelConfiguration = {
				...existing,
				settings: {
					...existing.settings,
					...settings
				}
			};
			await this.setModelConfiguration(updated);
		}
	}

	/**
	 * Get configurations sorted by priority
	 */
	public getConfigurationsByPriority(): ModelConfiguration[] {
		return Array.from(this._configurations.values())
			.sort((a, b) => a.priority - b.priority);
	}

	/**
	 * Get enabled configurations only
	 */
	public getEnabledConfigurations(): ModelConfiguration[] {
		return Array.from(this._configurations.values())
			.filter(config => config.enabled)
			.sort((a, b) => a.priority - b.priority);
	}

	/**
	 * Get current configuration state for export/import
	 */
	public getConfigurationState(): ModelConfigurationState {
		return {
			configurations: this.getAllConfigurations(),
			lastUpdated: Date.now()
		};
	}

	/**
	 * Import configuration state
	 */
	public async importConfigurationState(state: ModelConfigurationState): Promise<void> {
		this._configurations.clear();

		for (const config of state.configurations) {
			this._configurations.set(config.modelId, config);
		}

		await this._saveConfigurations();
		this._onDidConfigurationsChange.fire();
	}

	/**
	 * Reset all configurations to defaults
	 */
	public async resetToDefaults(): Promise<void> {
		this._configurations.clear();
		await this._saveConfigurations();
		this._onDidConfigurationsChange.fire();
	}

	/**
	 * Load configurations from workspace state
	 */
	private _loadConfigurations(): void {
		try {
			const stored = this.context.workspaceState.get<ModelConfiguration[]>(ModelConfigurationStore.STORAGE_KEY);

			if (Array.isArray(stored)) {
				for (const config of stored) {
					this._configurations.set(config.modelId, config);
				}
			}
		} catch (error) {
			console.error('Error loading model configurations from workspace state:', error);
		}
	}

	/**
	 * Save configurations to workspace state
	 */
	private async _saveConfigurations(): Promise<void> {
		try {
			const configurations = Array.from(this._configurations.values());
			await this.context.workspaceState.update(ModelConfigurationStore.STORAGE_KEY, configurations);
		} catch (error) {
			console.error('Error saving model configurations to workspace state:', error);
			throw new Error('Failed to save model configurations');
		}
	}

	/**
	 * Clear workspace state (for testing)
	 */
	public async clearStoredState(): Promise<void> {
		await this.context.workspaceState.update(ModelConfigurationStore.STORAGE_KEY, undefined);
		this._configurations.clear();
		this._onDidConfigurationsChange.fire();
	}
}