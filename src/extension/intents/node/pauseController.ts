/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise } from '../../../util/vs/base/common/async';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { Event } from '../../../util/vs/base/common/event';
import { Disposable } from '../../../util/vs/base/common/lifecycle';


export class PauseController extends Disposable implements CancellationToken {
	private _pausePromise = new DeferredPromise<void>();

	public get onCancellationRequested() {
		return this.token.onCancellationRequested;
	}

	public get isCancellationRequested() {
		return this.token.isCancellationRequested;
	}

	public get isPaused() {
		return !this._pausePromise.isSettled;
	}

	constructor(
		public readonly onDidChangePause: Event<boolean>,
		private readonly token: CancellationToken,
	) {
		super();
		this._pausePromise.complete(); // requests are initially unpaused

		this._register(onDidChangePause(isPaused => {
			console.log('[PauseController] onDidChangePause event received:', {
				isPaused,
				currentlyPaused: this.isPaused,
				promiseSettled: this._pausePromise.isSettled
			});

			if (isPaused) {
				if (this._pausePromise.isSettled) {
					console.log('[PauseController] Creating new pause promise - pausing execution');
					this._pausePromise = new DeferredPromise();
				} else {
					console.log('[PauseController] Already paused, ignoring pause event');
				}
			} else {
				if (!this._pausePromise.isSettled) {
					console.log('[PauseController] Completing pause promise - resuming execution');
					this._pausePromise.complete();
				} else {
					console.log('[PauseController] Already resumed, ignoring resume event');
				}
			}
		}));

		this._register(token.onCancellationRequested(() => {
			this.dispose();
		}));
	}

	/** Waits to be unpaused or cancelled. */
	public waitForUnpause(): Promise<void> {
		return this._pausePromise.p;
	}

	public override dispose(): void {
		this._pausePromise.complete();
		super.dispose();
	}
}
