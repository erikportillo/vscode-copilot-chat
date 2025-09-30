/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILoggedToolCall } from '../../../platform/requestLogger/node/requestLogger';

/**
 * Formatted tool call information for display in the comparison panel
 */
export interface IFormattedToolCall {
	id: string;
	toolName: string;
	displayMessage: string;
	parameters: Record<string, any>;
	timestamp: number;
}

/**
 * Format tool call parameters for display in the model comparison panel
 */
export class ToolCallFormatter {

	/**
	 * Format a logged tool call for display
	 */
	public static formatToolCall(toolCall: ILoggedToolCall): IFormattedToolCall {
		const toolName = toolCall.name;
		const args = this.parseArgs(toolCall.args);
		const displayMessage = this.generateDisplayMessage(toolName, args);

		return {
			id: toolCall.id,
			toolName,
			displayMessage,
			parameters: args,
			timestamp: toolCall.time
		};
	}

	/**
	 * Parse tool arguments into a usable object
	 */
	private static parseArgs(args: unknown): Record<string, any> {
		if (typeof args === 'string') {
			try {
				return JSON.parse(args);
			} catch {
				return { raw: args };
			}
		}
		if (typeof args === 'object' && args !== null) {
			return args as Record<string, any>;
		}
		return {};
	}

	/**
	 * Generate a human-readable display message for a tool call
	 */
	private static generateDisplayMessage(toolName: string, args: Record<string, any>): string {
		// Handle common tools with custom formatting
		switch (toolName) {
			case 'read_file':
			case 'copilot_readFile':
				return this.formatReadFile(args);

			case 'grep_search':
			case 'copilot_findTextInFiles':
				return this.formatGrepSearch(args);

			case 'file_search':
			case 'copilot_findFiles':
				return this.formatFileSearch(args);

			case 'semantic_search':
			case 'copilot_searchCodebase':
				return this.formatSemanticSearch(args);

			case 'list_dir':
			case 'copilot_listDirectory':
				return this.formatListDirectory(args);

			case 'get_errors':
			case 'copilot_getErrors':
				return this.formatGetErrors(args);

			case 'get_changed_files':
			case 'copilot_getChangedFiles':
				return this.formatGetChangedFiles(args);

			case 'list_code_usages':
			case 'copilot_listCodeUsages':
				return this.formatListCodeUsages(args);

			case 'replace_string_in_file':
			case 'copilot_replaceString':
				return this.formatReplaceString(args);

			case 'create_file':
			case 'copilot_createFile':
				return this.formatCreateFile(args);

			case 'run_in_terminal':
				return this.formatRunInTerminal(args);

			case 'get_terminal_output':
				return this.formatGetTerminalOutput(args);

			case 'runTests':
			case 'copilot_runTests1':
				return this.formatRunTests(args);

			case 'manage_todo_list':
				return this.formatManageTodoList(args);

			case 'create_and_run_task':
			case 'copilot_createAndRunTask':
				return this.formatCreateAndRunTask(args);

			case 'run_task':
				return this.formatRunTask(args);

			default:
				// Generic fallback for unknown tools
				return this.formatGenericTool(toolName, args);
		}
	}

	private static formatReadFile(args: Record<string, any>): string {
		const file = args.filePath || args.file_path || 'unknown file';
		const start = args.offset || args.start_line;
		const limit = args.limit || args.end_line;

		if (start !== undefined && limit !== undefined) {
			return `Read ${file} (lines ${start}-${limit})`;
		} else if (start !== undefined) {
			return `Read ${file} (from line ${start})`;
		}
		return `Read ${file}`;
	}

	private static formatGrepSearch(args: Record<string, any>): string {
		const query = args.query || args.pattern || 'unknown query';
		const includePattern = args.includePattern || args.include_pattern;
		const isRegex = args.isRegexp || args.is_regexp;

		let msg = `Search for "${query}"`;
		if (isRegex) {
			msg += ' (regex)';
		}
		if (includePattern) {
			msg += ` in ${includePattern}`;
		}
		return msg;
	}

	private static formatFileSearch(args: Record<string, any>): string {
		const query = args.query || args.pattern || '*';
		const maxResults = args.maxResults || args.max_results;

		let msg = `Find files matching "${query}"`;
		if (maxResults) {
			msg += ` (max ${maxResults})`;
		}
		return msg;
	}

	private static formatSemanticSearch(args: Record<string, any>): string {
		const query = args.query || 'unknown query';
		return `Semantic search: "${query}"`;
	}

	private static formatListDirectory(args: Record<string, any>): string {
		const path = args.path || args.directory || 'unknown directory';
		return `List directory: ${path}`;
	}

	private static formatGetErrors(args: Record<string, any>): string {
		const filePaths = args.filePaths || args.file_paths;
		if (filePaths && Array.isArray(filePaths) && filePaths.length > 0) {
			return `Get errors in ${filePaths.length} file(s)`;
		}
		return 'Get all errors';
	}

	private static formatGetChangedFiles(args: Record<string, any>): string {
		const state = args.sourceControlState || args.state;
		if (state && Array.isArray(state)) {
			return `Get changed files (${state.join(', ')})`;
		}
		return 'Get changed files';
	}

	private static formatListCodeUsages(args: Record<string, any>): string {
		const symbolName = args.symbolName || args.symbol_name || 'unknown symbol';
		const filePaths = args.filePaths || args.file_paths;

		let msg = `Find usages of "${symbolName}"`;
		if (filePaths && Array.isArray(filePaths) && filePaths.length > 0) {
			msg += ` in ${filePaths.length} file(s)`;
		}
		return msg;
	}

	private static formatReplaceString(args: Record<string, any>): string {
		const file = args.filePath || args.file_path || 'unknown file';
		const oldString = args.oldString || args.old_string;
		const newString = args.newString || args.new_string;

		if (oldString && newString) {
			const preview = oldString.substring(0, 30);
			return `Replace in ${file}: "${preview}${oldString.length > 30 ? '...' : ''}"`;
		}
		return `Replace in ${file}`;
	}

	private static formatCreateFile(args: Record<string, any>): string {
		const file = args.filePath || args.file_path || 'unknown file';
		const content = args.content;

		if (content && typeof content === 'string') {
			const lines = content.split('\n').length;
			return `Create ${file} (${lines} lines)`;
		}
		return `Create ${file}`;
	}

	private static formatRunInTerminal(args: Record<string, any>): string {
		const command = args.command || 'unknown command';
		const isBackground = args.isBackground || args.is_background;

		if (isBackground) {
			return `Run in terminal (background): ${command}`;
		}
		return `Run in terminal: ${command}`;
	}

	private static formatGetTerminalOutput(args: Record<string, any>): string {
		const id = args.id || 'unknown terminal';
		return `Get terminal output: ${id}`;
	}

	private static formatRunTests(args: Record<string, any>): string {
		const files = args.files;
		const testNames = args.testNames || args.test_names;

		if (files && Array.isArray(files) && files.length > 0) {
			return `Run tests in ${files.length} file(s)`;
		}
		if (testNames && Array.isArray(testNames) && testNames.length > 0) {
			return `Run ${testNames.length} test(s)`;
		}
		return 'Run all tests';
	}

	private static formatManageTodoList(args: Record<string, any>): string {
		const operation = args.operation || 'unknown';
		const todoList = args.todoList || args.todo_list;

		if (operation === 'write' && todoList && Array.isArray(todoList)) {
			return `Update todo list (${todoList.length} items)`;
		}
		if (operation === 'read') {
			return 'Read todo list';
		}
		return `Manage todo list: ${operation}`;
	}

	private static formatCreateAndRunTask(args: Record<string, any>): string {
		const task = args.task;
		if (task && typeof task === 'object' && task.label) {
			return `Create and run task: ${task.label}`;
		}
		return 'Create and run task';
	}

	private static formatRunTask(args: Record<string, any>): string {
		const id = args.id || 'unknown task';
		return `Run task: ${id}`;
	}

	private static formatGenericTool(toolName: string, args: Record<string, any>): string {
		const keys = Object.keys(args);
		if (keys.length === 0) {
			return toolName;
		}

		// Show first meaningful parameter
		const firstKey = keys.find(k => !k.startsWith('_') && args[k] !== undefined);
		if (firstKey) {
			const value = args[firstKey];
			const preview = typeof value === 'string'
				? value.substring(0, 30)
				: JSON.stringify(value).substring(0, 30);

			return `${toolName}: ${firstKey}="${preview}${preview.length >= 30 ? '...' : ''}"`;
		}

		return `${toolName} (${keys.length} param${keys.length === 1 ? '' : 's'})`;
	}

	/**
	 * Format multiple tool calls into a summary
	 */
	public static formatToolCallSummary(toolCalls: IFormattedToolCall[]): string {
		if (toolCalls.length === 0) {
			return 'No tools called';
		}

		if (toolCalls.length === 1) {
			return `🔧 ${toolCalls[0].displayMessage}`;
		}

		const toolCount = new Map<string, number>();
		for (const call of toolCalls) {
			toolCount.set(call.toolName, (toolCount.get(call.toolName) || 0) + 1);
		}

		const summary = Array.from(toolCount.entries())
			.map(([tool, count]) => count > 1 ? `${tool}(${count})` : tool)
			.join(', ');

		return `🔧 ${toolCalls.length} tools: ${summary}`;
	}
}
