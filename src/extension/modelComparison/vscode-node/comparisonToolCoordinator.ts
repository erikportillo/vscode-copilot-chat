/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../util/vs/base/common/event';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { PauseController } from '../../intents/node/pauseController';
import { IToolCall } from '../../prompt/common/intents';

export interface IToolCallPreview {
	modelId: string;
	toolCalls: IToolCall[];
}

export interface IComparisonToolState {
	isAllPaused: boolean;
	toolCallPreviews: IToolCallPreview[];
	canResume: boolean;
	canCancel: boolean;
}

/**
 * Coordinates tool execution control across multiple models in a comparison.
 *
 * This class uses composition over inheritance to manage multiple PauseController
 * instances, one for each model in the comparison. It provides centralized control
 * over tool execution pauses and previews.
 *
 * Key responsibilities:
 * - Manage pause/resume state for all models simultaneously
 * - Coordinate tool call detection and preview across models
 * - Provide unified interface for tool execution control
 * - Handle selective approval/cancellation of tool calls per model
 */
export class ComparisonToolCoordinator extends Disposable {
	private readonly _onDidChangeToolState = this._register(new Emitter<IComparisonToolState>());
	public readonly onDidChangeToolState: Event<IComparisonToolState> = this._onDidChangeToolState.event;

	private readonly _onDidChangePause = this._register(new Emitter<boolean>());
	public readonly onDidChangePause: Event<boolean> = this._onDidChangePause.event;

	// Individual pause events per model
	private readonly modelPauseEmitters = new Map<string, Emitter<boolean>>();

	private readonly modelPauseControllers = new Map<string, PauseController>();
	private readonly modelToolCalls = new Map<string, IToolCall[]>();
	private _isAllPaused = false;

	constructor() {
		super();
	}

	/**
	 * Get the pause event for a specific model
	 */
	public getModelPauseEvent(modelId: string): Event<boolean> {
		let emitter = this.modelPauseEmitters.get(modelId);
		if (!emitter) {
			emitter = this._register(new Emitter<boolean>());
			this.modelPauseEmitters.set(modelId, emitter);
		}
		return emitter.event;
	}

	/**
	 * Register a PauseController for a specific model
	 */
	public registerModel(modelId: string, pauseController: PauseController): void {
		if (this.modelPauseControllers.has(modelId)) {
			throw new Error(`Model ${modelId} is already registered`);
		}

		// Create model-specific pause emitter if it doesn't exist
		if (!this.modelPauseEmitters.has(modelId)) {
			const emitter = this._register(new Emitter<boolean>());
			this.modelPauseEmitters.set(modelId, emitter);
		}

		this.modelPauseControllers.set(modelId, pauseController);
		this.modelToolCalls.set(modelId, []);

		// Listen for pause changes from this model's controller
		this._register(pauseController.onDidChangePause(isPaused => {
			this.updatePauseState();
		}));
	}

	/**
	 * Unregister a model and clean up its PauseController
	 */
	public unregisterModel(modelId: string): void {
		const controller = this.modelPauseControllers.get(modelId);
		if (controller) {
			controller.dispose();
			this.modelPauseControllers.delete(modelId);
			this.modelToolCalls.delete(modelId);

			// Clean up model-specific emitter
			const emitter = this.modelPauseEmitters.get(modelId);
			if (emitter) {
				emitter.dispose();
				this.modelPauseEmitters.delete(modelId);
			}

			this.updatePauseState();
		}
	}

	/**
	 * Get the PauseController for a specific model (if registered)
	 */
	public getPauseController(modelId: string): PauseController | undefined {
		return this.modelPauseControllers.get(modelId);
	}

	/**
	 * Update tool calls detected for a specific model
	 */
	public updateModelToolCalls(modelId: string, toolCalls: IToolCall[]): void {
		this.modelToolCalls.set(modelId, toolCalls);
		this.emitToolStateChange();
	}

	/**
	 * Pause a specific model before tool execution
	 */
	public pauseModel(modelId: string): void {
		const controller = this.modelPauseControllers.get(modelId);
		const emitter = this.modelPauseEmitters.get(modelId);

		if (!controller || !emitter) {
			console.warn(`⚠️ [${modelId}] Missing pause controller or emitter`);
			return;
		}

		if (!controller.isPaused) {
			// Fire pause event for this specific model only
			emitter.fire(true);
		}

		// Update the all-paused state based on whether any model is paused
		this.updatePauseStateFromControllers();
	}

	/**
	 * Resume a specific model after tool execution
	 */
	public resumeModel(modelId: string): void {
		const controller = this.modelPauseControllers.get(modelId);
		const emitter = this.modelPauseEmitters.get(modelId);

		if (!controller || !emitter) {
			console.warn(`⚠️ [${modelId}] Missing pause controller or emitter`);
			return;
		}

		// Clear tool calls immediately since user has approved/cancelled them
		const hadToolCalls = (this.modelToolCalls.get(modelId)?.length ?? 0) > 0;
		this.modelToolCalls.set(modelId, []);

		// Fire resume event regardless of current pause state
		// This is important for cancellation scenarios where the pause promise
		// may already be completed but we still need to signal the resume
		if (controller.isPaused || hadToolCalls) {
			emitter.fire(false);
			// Update UI immediately to reflect cleared tool calls
			this.emitToolStateChange();
		}

		// Update the all-paused state based on whether any model is paused
		this.updatePauseStateFromControllers();
	}

	/**
	 * Mark tool execution as completed for a specific model
	 * This is called when a model finishes its response, but tool calls
	 * are already cleared when approved, so this is mainly for logging
	 */
	public markToolExecutionCompleted(modelId: string): void {
		// Tool calls are already cleared when approved via resumeModel()
		// No need to clear them again here since the model handles tool execution internally

		// Just update the UI state in case there are any other changes
		this.emitToolStateChange();
	}

	/**
	 * Update the all-paused state based on individual controller states
	 */
	private updatePauseStateFromControllers(): void {
		const allPaused = Array.from(this.modelPauseControllers.values()).every(controller => controller.isPaused);
		this._isAllPaused = allPaused;
		this.updatePauseState();
	}

	/**
	 * Pause all models before tool execution
	 */
	public pauseAllModels(): void {
		// Fire pause event for each individual model
		for (const [modelId, controller] of this.modelPauseControllers.entries()) {
			if (!controller.isPaused) {
				const emitter = this.modelPauseEmitters.get(modelId);
				if (emitter) {
					emitter.fire(true);
				}
			}
		}

		this._isAllPaused = true;
		this.updatePauseState();

		// Also fire the coordinator's own event for backward compatibility
		this._onDidChangePause.fire(true);
	}

	/**
	 * Resume all models to continue with tool execution
	 */
	public resumeAllModels(): void {
		// Fire resume event for each individual model
		for (const [modelId, controller] of this.modelPauseControllers.entries()) {
			if (controller.isPaused) {
				const emitter = this.modelPauseEmitters.get(modelId);
				if (emitter) {
					emitter.fire(false);
				}
			}
		}

		this._isAllPaused = false;
		this.updatePauseState();
	}



	/**
	 * Clear tool calls for a specific model
	 */
	public clearModelToolCalls(modelId: string): void {
		this.modelToolCalls.set(modelId, []);
		this.emitToolStateChange();
	}

	/**
	 * Clear all tool calls
	 */
	public clearAllToolCalls(): void {
		this.modelToolCalls.clear();
		this.emitToolStateChange();
	}

	/**
	 * Cancel tool execution for a specific model (legacy method for backward compatibility)
	 * @deprecated Use clearModelToolCalls() and resumeModel() separately for better control
	 */
	public cancelModelToolExecution(modelId: string): void {
		// Clear tool calls for this model
		this.modelToolCalls.set(modelId, []);

		// Resume the model so it can detect the cancellation token
		// Without this, the model stays paused forever waiting for approval
		this.resumeModel(modelId);

		// Emit tool state change to update the UI
		this.emitToolStateChange();
	}

	/**
	 * Cancel tool execution for all models (legacy method for backward compatibility)
	 * @deprecated Use clearAllToolCalls() and resumeAllModels() separately for better control
	 */
	public cancelAllToolExecution(): void {
		// Resume all models so they can detect the cancellation token
		// Without this, paused models stay paused forever waiting for approval
		this.resumeAllModels();

		// Clear all tool calls
		this.modelToolCalls.clear();

		// Emit tool state change to update the UI
		this.emitToolStateChange();
	}

	/**
	 * Get the current tool state for all models
	 */
	public getCurrentToolState(): IComparisonToolState {
		const toolCallPreviews: IToolCallPreview[] = [];

		for (const [modelId, toolCalls] of this.modelToolCalls) {
			if (toolCalls.length > 0) {
				toolCallPreviews.push({
					modelId,
					toolCalls: [...toolCalls] // Create a copy
				});
			}
		}

		return {
			isAllPaused: this._isAllPaused,
			toolCallPreviews,
			canResume: this._isAllPaused && toolCallPreviews.length > 0,
			canCancel: this._isAllPaused && toolCallPreviews.length > 0
		};
	}

	/**
	 * Check if any model has tool calls pending
	 */
	public hasToolCallsPending(): boolean {
		for (const toolCalls of this.modelToolCalls.values()) {
			if (toolCalls.length > 0) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Get all registered model IDs
	 */
	public getRegisteredModelIds(): string[] {
		return Array.from(this.modelPauseControllers.keys());
	}

	private updatePauseState(): void {
		// Check if all models are paused
		const allPaused = Array.from(this.modelPauseControllers.values())
			.every(controller => controller.isPaused);

		if (this._isAllPaused !== allPaused) {
			this._isAllPaused = allPaused;
		}

		this.emitToolStateChange();
	}

	private emitToolStateChange(): void {
		const toolState = this.getCurrentToolState();
		this._onDidChangeToolState.fire(toolState);
	}

	public override dispose(): void {
		// Dispose all pause controllers
		for (const controller of this.modelPauseControllers.values()) {
			controller.dispose();
		}
		this.modelPauseControllers.clear();

		// Dispose all model-specific emitters
		for (const emitter of this.modelPauseEmitters.values()) {
			emitter.dispose();
		}
		this.modelPauseEmitters.clear();

		this.modelToolCalls.clear();
		super.dispose();
	}
}