/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Disposable } from '../../../util/vs/base/common/lifecycle';

/**
 * Represents a modification to a model's prompt
 */
export interface PromptModification {
	/**
	 * Custom system message to prepend or replace the original system message
	 */
	customSystemMessage?: string;

	/**
	 * Whether to replace the entire system message (true) or prepend to it (false)
	 */
	replaceSystemMessage?: boolean;

	/**
	 * Timestamp when this modification was last updated
	 */
	lastModified?: number;
}

/**
 * Service for storing and managing per-model prompt modifications
 * in the Model Comparison Panel
 */
export class PromptModificationStore extends Disposable {

	private static readonly STORAGE_KEY = 'modelComparison.promptModifications';

	// In-memory cache of prompt modifications
	private readonly modifications = new Map<string, PromptModification>();

	constructor(
		private readonly context: vscode.ExtensionContext
	) {
		super();
		this.loadFromStorage();
	}

	/**
	 * Get the prompt modification for a specific model
	 */
	public getModification(modelId: string): PromptModification | undefined {
		return this.modifications.get(modelId);
	}

	/**
	 * Get all stored prompt modifications
	 */
	public getAllModifications(): Map<string, PromptModification> {
		return new Map(this.modifications);
	}

	/**
	 * Set a prompt modification for a specific model
	 */
	public async setModification(modelId: string, modification: PromptModification): Promise<void> {
		// Update the modification with timestamp
		const updatedModification: PromptModification = {
			...modification,
			lastModified: Date.now()
		};

		this.modifications.set(modelId, updatedModification);
		await this.saveToStorage();
	}

	/**
	 * Remove the prompt modification for a specific model (reset to default)
	 */
	public async removeModification(modelId: string): Promise<void> {
		this.modifications.delete(modelId);
		await this.saveToStorage();
	}

	/**
	 * Clear all prompt modifications
	 */
	public async clearAll(): Promise<void> {
		this.modifications.clear();
		await this.saveToStorage();
	}

	/**
	 * Check if a model has a custom prompt modification
	 */
	public hasModification(modelId: string): boolean {
		return this.modifications.has(modelId);
	}

	/**
	 * Load prompt modifications from workspace state
	 */
	private loadFromStorage(): void {
		try {
			const stored = this.context.workspaceState.get<Record<string, PromptModification>>(
				PromptModificationStore.STORAGE_KEY,
				{}
			);

			// Populate the in-memory cache
			this.modifications.clear();
			for (const [modelId, modification] of Object.entries(stored)) {
				this.modifications.set(modelId, modification);
			}

			console.log(`[PromptModificationStore] Loaded ${this.modifications.size} prompt modifications from storage`);
		} catch (error) {
			console.error('[PromptModificationStore] Failed to load from storage:', error);
		}
	}

	/**
	 * Save prompt modifications to workspace state
	 */
	private async saveToStorage(): Promise<void> {
		try {
			// Convert Map to plain object for storage
			const toStore: Record<string, PromptModification> = {};
			for (const [modelId, modification] of this.modifications.entries()) {
				toStore[modelId] = modification;
			}

			await this.context.workspaceState.update(
				PromptModificationStore.STORAGE_KEY,
				toStore
			);

			console.log(`[PromptModificationStore] Saved ${this.modifications.size} prompt modifications to storage`);
		} catch (error) {
			console.error('[PromptModificationStore] Failed to save to storage:', error);
			throw error;
		}
	}

	/**
	 * Export prompt modifications as JSON for debugging/backup
	 */
	public exportAsJson(): string {
		const data: Record<string, PromptModification> = {};
		for (const [modelId, modification] of this.modifications.entries()) {
			data[modelId] = modification;
		}
		return JSON.stringify(data, null, 2);
	}

	/**
	 * Import prompt modifications from JSON
	 */
	public async importFromJson(json: string): Promise<void> {
		try {
			const data = JSON.parse(json) as Record<string, PromptModification>;

			this.modifications.clear();
			for (const [modelId, modification] of Object.entries(data)) {
				this.modifications.set(modelId, modification);
			}

			await this.saveToStorage();
			console.log(`[PromptModificationStore] Imported ${this.modifications.size} prompt modifications`);
		} catch (error) {
			console.error('[PromptModificationStore] Failed to import from JSON:', error);
			throw new Error('Invalid JSON format for prompt modifications');
		}
	}

	/**
	 * Get a summary of stored modifications for debugging
	 */
	public getSummary(): { modelId: string; hasCustomMessage: boolean; replaces: boolean; lastModified?: number }[] {
		const summary: { modelId: string; hasCustomMessage: boolean; replaces: boolean; lastModified?: number }[] = [];

		for (const [modelId, modification] of this.modifications.entries()) {
			summary.push({
				modelId,
				hasCustomMessage: !!modification.customSystemMessage,
				replaces: !!modification.replaceSystemMessage,
				lastModified: modification.lastModified
			});
		}

		return summary;
	}
}
