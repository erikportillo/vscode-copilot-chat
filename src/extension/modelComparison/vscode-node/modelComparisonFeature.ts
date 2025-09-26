/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { IExtensionContribution } from '../../common/contributions';
import { ModelComparisonViewProvider } from './modelComparisonViewProvider';

/**
 * Contribution that registers the Model Comparison WebView panel
 */
export class ModelComparisonFeature extends Disposable implements IExtensionContribution {
	readonly id = 'modelComparisonFeature';

	constructor(
		@IVSCodeExtensionContext extensionContext: IVSCodeExtensionContext,
	) {
		super();

		// Create and register the webview view provider
		const provider = this._register(new ModelComparisonViewProvider(extensionContext.extensionUri));

		this._register(vscode.window.registerWebviewViewProvider(
			ModelComparisonViewProvider.viewType,
			provider
		));
	}
}