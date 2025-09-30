# Option 3: Enhanced Telemetry/Logging for Tool Call Parameter Tracking

## Overview

This approach leverages the existing logging infrastructure (`IRequestLogger` and `logToolCall`) to capture tool call parameters, then makes them available to the model comparison panel through a queryable interface.

## Key Insight

**Tool parameters ARE already being logged!** The `logToolCall` method in `requestLoggerImpl.ts` (line 328) already receives and stores:
- Tool name
- **Full arguments object** (the `args` parameter)
- Tool response
- Timing information
- Thinking data

This data is stored in `LoggedToolCall` instances and maintained in the `_entries` array (up to 100 most recent entries).

## Architecture

### 1. Current Logging Flow

```
Tool Invocation (toolCallingLoop.ts:654)
    ↓
IRequestLogger.logToolCall(id, name, args, response, thinking)
    ↓
RequestLogger._addEntry(new LoggedToolCall(...))
    ↓
Stored in _entries array (last 100 entries)
    ↓
Currently accessible via:
    - ccreq: URI scheme for viewing in editor
    - onDidChangeRequests event
    - getRequests() method
```

### 2. What We Need to Add

We need to:
1. **Make logged tool calls queryable by request/session ID**
2. **Correlate tool calls with model comparison sessions**
3. **Add an API to retrieve tool parameters for a given session**
4. **Integrate with the model comparison panel to display parameters**

## Implementation Plan

### Phase 1: Extend Request Logger Interface

Add methods to `IRequestLogger` for querying tool calls:

```typescript
// In src/platform/requestLogger/node/requestLogger.ts

export interface IRequestLogger {
	// ... existing methods ...

	/**
	 * Get all tool calls associated with a specific chat request
	 */
	getToolCallsForRequest(chatRequest: ChatRequest): ILoggedToolCall[];

	/**
	 * Get all tool calls within a time range
	 */
	getToolCallsInTimeRange(startTime: number, endTime: number): ILoggedToolCall[];

	/**
	 * Subscribe to tool call events
	 */
	onDidLogToolCall: Event<ILoggedToolCall>;
}
```

### Phase 2: Implement in RequestLogger

```typescript
// In src/extension/prompt/vscode-node/requestLoggerImpl.ts

export class RequestLogger extends AbstractRequestLogger {
	private readonly _onDidLogToolCall = this._register(new Emitter<ILoggedToolCall>());
	public readonly onDidLogToolCall = this._onDidLogToolCall.event;

	public override logToolCall(
		id: string,
		name: string,
		args: unknown,
		response: LanguageModelToolResult2,
		thinking?: ThinkingData
	): void {
		const edits = this._workspaceEditRecorder?.getEditsAndReset();
		const toolMetadata = 'toolMetadata' in response
			? (response as ExtendedLanguageModelToolResult).toolMetadata
			: undefined;

		const loggedCall = new LoggedToolCall(
			id,
			name,
			args,
			response,
			this.currentRequest,
			Date.now(),
			thinking,
			edits,
			toolMetadata
		);

		this._addEntry(loggedCall);
		this._onDidLogToolCall.fire(loggedCall); // NEW: Fire event
	}

	// NEW: Query methods
	public getToolCallsForRequest(chatRequest: ChatRequest): ILoggedToolCall[] {
		return this._entries
			.filter((e): e is ILoggedToolCall =>
				e.kind === LoggedInfoKind.ToolCall &&
				e.chatRequest === chatRequest
			);
	}

	public getToolCallsInTimeRange(startTime: number, endTime: number): ILoggedToolCall[] {
		return this._entries
			.filter((e): e is ILoggedToolCall =>
				e.kind === LoggedInfoKind.ToolCall &&
				e.time >= startTime &&
				e.time <= endTime
			);
	}
}
```

### Phase 3: Track Tool Calls in Model Comparison Panel

Add a tool call tracker to the comparison panel:

```typescript
// In src/extension/modelComparison/vscode-node/modelComparisonPanel.ts

export class ModelComparisonPanel {
	private toolCallsBySession = new Map<string, ILoggedToolCall[]>();

	constructor(
		// ... existing parameters ...
		@IRequestLogger private readonly requestLogger: IRequestLogger,
	) {
		// Subscribe to tool call events
		this._register(this.requestLogger.onDidLogToolCall(toolCall => {
			this.handleToolCall(toolCall);
		}));
	}

	private handleToolCall(toolCall: ILoggedToolCall): void {
		// Correlate with active comparison sessions
		for (const [sessionId, session] of this.activeSessions) {
			if (this.isToolCallForSession(toolCall, session)) {
				if (!this.toolCallsBySession.has(sessionId)) {
					this.toolCallsBySession.set(sessionId, []);
				}
				this.toolCallsBySession.get(sessionId)!.push(toolCall);

				// Update UI
				this.updateToolCallDisplay(sessionId, toolCall);
			}
		}
	}

	private isToolCallForSession(
		toolCall: ILoggedToolCall,
		session: ComparisonSession
	): boolean {
		// Match by ChatRequest instance or time range
		return toolCall.chatRequest === session.chatRequest ||
			(toolCall.time >= session.startTime &&
			 toolCall.time <= (session.endTime || Date.now()));
	}
}
```

### Phase 4: Update Single Model Chat Handler

Capture session metadata to correlate with logged tool calls:

```typescript
// In src/extension/modelComparison/vscode-node/singleModelChatHandler.ts

export async function handleSingleModelChat(
	modelId: string,
	request: vscode.ChatRequest,
	context: vscode.ChatContext,
	onDelta: (modelId: string, text: string, metadata?: IChatResponseMetadata) => void,
	// ... other params ...
): Promise<void> {
	// Track session timing for log correlation
	const sessionStartTime = Date.now();

	try {
		// Run chat participant handler
		await chatParticipantHandler(request, context, stream, token);

		// After completion, retrieve tool calls from logger
		const sessionEndTime = Date.now();
		const toolCalls = requestLogger.getToolCallsInTimeRange(
			sessionStartTime,
			sessionEndTime
		);

		// Send tool call details to comparison panel
		for (const toolCall of toolCalls) {
			onDelta(modelId, '', {
				copilotToolCalls: [{
					id: toolCall.id,
					name: toolCall.name,
					arguments: JSON.stringify(toolCall.args),
					formattedMessage: formatToolCallMessage(toolCall.name, toolCall.args)
				}]
			});
		}
	} catch (error) {
		// ...
	}
}

function formatToolCallMessage(toolName: string, args: unknown): string {
	// Similar to directModelChatHandler.ts formatting
	const params = typeof args === 'string' ? JSON.parse(args) : args;

	switch (toolName) {
		case 'copilot_readFile':
			return `Read ${params.file_path || params.filePath || 'file'}`;
		case 'copilot_grepSearch':
			return `Search for "${params.pattern || params.query}"`;
		case 'copilot_listFiles':
			return `List files in ${params.path || 'workspace'}`;
		// ... other tool formatters
		default:
			// Extract the most relevant parameter
			const primaryParam = params.file_path || params.filePath ||
				params.pattern || params.query || params.path;
			return primaryParam ? `${toolName}(${primaryParam})` : `Called ${toolName}`;
	}
}
```

### Phase 5: Alternative - Use Request Context

Instead of time-based correlation, use the `captureInvocation` mechanism:

```typescript
// In singleModelChatHandler.ts

export async function handleSingleModelChat(
	modelId: string,
	request: vscode.ChatRequest,
	// ...
): Promise<void> {
	const sessionToolCalls: ILoggedToolCall[] = [];

	// Subscribe to tool calls during this invocation
	const disposable = requestLogger.onDidLogToolCall(toolCall => {
		if (toolCall.chatRequest === request) {
			sessionToolCalls.push(toolCall);

			// Immediately send to UI
			onDelta(modelId, '', {
				copilotToolCalls: [{
					id: toolCall.id,
					name: toolCall.name,
					arguments: JSON.stringify(toolCall.args),
					formattedMessage: formatToolCallMessage(toolCall.name, toolCall.args)
				}]
			});
		}
	});

	try {
		// Execute within request context
		await requestLogger.captureInvocation(request, async () => {
			await chatParticipantHandler(request, context, stream, token);
		});
	} finally {
		disposable.dispose();
	}
}
```

## Benefits

### ✅ Advantages

1. **Leverages Existing Infrastructure**: Uses the already-working `logToolCall` system
2. **No Core Changes Needed**: No modifications to `ChatParticipantRequestHandler` or deep services
3. **Production Fidelity Maintained**: Still uses the same exact code path as real chat
4. **Full Parameter Access**: Gets complete tool arguments, not just names
5. **Bonus Data**: Also gets tool responses, timing, thinking data, and workspace edits
6. **Debugging Value**: Tool call logs useful beyond just comparison panel
7. **Simple Implementation**: Mostly additive changes, minimal refactoring

### ⚠️ Considerations

1. **Timing Sensitivity**: Relies on correlating requests with logged tool calls
2. **Memory**: Keeps last 100 entries in memory (but already does this)
3. **Async Correlation**: Tool calls logged asynchronously, need proper correlation logic

## Comparison with Other Options

| Aspect | Option 1 (VS Code API) | Option 2 (Hybrid) | Option 3 (Logs) |
|--------|----------------------|-------------------|-----------------|
| **Complexity** | Low (wait for API) | Very High | Medium |
| **Core Changes** | None | ~10 files | None |
| **Fidelity** | Perfect | Perfect | Perfect |
| **Parameter Access** | Full | Full | Full |
| **Timeline** | Unknown | 1-2 weeks | 2-3 days |
| **Maintenance** | Low | High | Medium |
| **Bonus Features** | None | None | Tool responses, timing, edits |

## Implementation Steps

### Step 1: Extend IRequestLogger Interface (1 hour)
- Add query methods and event to interface
- Update AbstractRequestLogger base class

### Step 2: Implement in RequestLogger (2 hours)
- Add `onDidLogToolCall` event
- Implement query methods
- Add proper filtering and indexing

### Step 3: Create Tool Call Formatter (1 hour)
- Port formatting logic from `directModelChatHandler.ts`
- Support all common tools (readFile, grepSearch, etc.)
- Add fallback for unknown tools

### Step 4: Integrate with SingleModelChatHandler (3 hours)
- Add request logger dependency
- Subscribe to tool call events
- Correlate with current request/session
- Send formatted tool calls to UI

### Step 5: Update Model Comparison Panel (2 hours)
- Display tool parameters in UI
- Show formatted messages alongside tool names
- Add collapsible parameter details view

### Step 6: Testing (2 hours)
- Test with multiple models
- Verify parameter correlation
- Test edge cases (rapid requests, cancellations)

**Total Estimated Time: 11 hours (1-2 days)**

## UI Mockup

```
┌─────────────────────────────────────────────────────────────┐
│ Model A (GPT-4) Response                                    │
├─────────────────────────────────────────────────────────────┤
│ Let me check that file for you.                             │
│                                                              │
│ 🔧 Read src/auth.ts                                         │
│    ↪ Parameters: { file_path: "src/auth.ts", start_line: 1 }│
│                                                              │
│ 🔧 Search for "authenticate"                                │
│    ↪ Parameters: { pattern: "authenticate", is_regexp: false}│
│                                                              │
│ Based on the code I found...                                │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Model B (Claude) Response                                   │
├─────────────────────────────────────────────────────────────┤
│ I'll look into that.                                        │
│                                                              │
│ 🔧 Read src/auth.ts                                         │
│    ↪ Parameters: { file_path: "src/auth.ts" }              │
│    (Note: Read entire file vs specific lines)              │
│                                                              │
│ I can see the authentication logic...                       │
└─────────────────────────────────────────────────────────────┘
```

## Fallback Handling

If correlation fails (edge cases):

1. **Time-based correlation** as primary method
2. **Request instance matching** as secondary
3. **Manual session tracking** as fallback
4. **Graceful degradation**: Show tool names only if parameters unavailable

## Future Enhancements

1. **Tool Call Diff View**: Highlight parameter differences between models
2. **Performance Metrics**: Show tool call timing comparisons
3. **Tool Response Comparison**: Compare not just parameters but also results
4. **Export Tool Call Logs**: Export comparison data for analysis
5. **Tool Call Replay**: Re-run specific tool calls with different parameters

## Conclusion

**Option 3 is the optimal choice** because:

1. ✅ **Already implemented at the core**: `logToolCall` exists and works
2. ✅ **Fast to implement**: No deep architectural changes
3. ✅ **Production fidelity**: Maintains exact same code path
4. ✅ **Full parameter access**: Gets everything we need
5. ✅ **Bonus functionality**: Tool responses, timing, workspace edits
6. ✅ **Low maintenance burden**: Additive changes only

The key insight is that **we already log tool parameters** - we just need to make them accessible to the comparison panel through a simple query API.
