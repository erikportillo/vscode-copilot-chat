# Implementation Guide: Tool Call Parameter Tracking via Logs

## Quick Start

### The Solution

Use the **existing logging infrastructure** to capture and retrieve tool call parameters. The `RequestLogger` already logs full tool parameters - we just need to:

1. Add query methods to retrieve logged tool calls
2. Correlate tool calls with comparison sessions
3. Format and display parameters in the UI

### Why This Works

```typescript
// This ALREADY happens in toolCallingLoop.ts line 654:
this._requestLogger.logToolCall(
    originalCall.id,
    originalCall.name,
    originalCall.arguments,  // ← Full parameters are here!
    metadata.result,
    lastTurn?.thinking
);
```

The `args` parameter contains the complete JSON object of tool arguments. We just need to retrieve it.

## Implementation Checklist

### Phase 1: Extend Request Logger (2-3 hours)

**Files to Modify:**
- `src/platform/requestLogger/node/requestLogger.ts`
- `src/extension/prompt/vscode-node/requestLoggerImpl.ts`

**Tasks:**
- [ ] Add `onDidLogToolCall` event to `IRequestLogger`
- [ ] Add query methods: `getToolCallsForRequest()`, `getToolCallsInTimeRange()`
- [ ] Implement event firing in `RequestLogger.logToolCall()`
- [ ] Implement query methods with proper filtering

**Code Snippet:**

```typescript
// In requestLogger.ts interface
export interface IRequestLogger {
    // ... existing ...
    onDidLogToolCall: Event<ILoggedToolCall>;
    getToolCallsForRequest(chatRequest: ChatRequest): ILoggedToolCall[];
}

// In requestLoggerImpl.ts
private readonly _onDidLogToolCall = this._register(new Emitter<ILoggedToolCall>());
public readonly onDidLogToolCall = this._onDidLogToolCall.event;

public override logToolCall(...args): void {
    const loggedCall = new LoggedToolCall(...);
    this._addEntry(loggedCall);
    this._onDidLogToolCall.fire(loggedCall); // NEW
}
```

### Phase 2: Tool Call Formatter (1 hour)

**Files to Create:**
- `src/extension/modelComparison/vscode-node/toolCallFormatter.ts`

**Tasks:**
- [ ] Create `formatToolCallMessage()` function
- [ ] Add formatters for common tools (readFile, grepSearch, etc.)
- [ ] Add generic fallback formatter

**Code Snippet:**

```typescript
export function formatToolCallMessage(toolName: string, args: unknown): string {
    const params = typeof args === 'string' ? JSON.parse(args) : args;

    switch (toolName) {
        case 'copilot_readFile':
        case 'vscode_readFile':
            const file = params.file_path || params.filePath || 'file';
            const lines = params.start_line
                ? ` (lines ${params.start_line}-${params.end_line})`
                : '';
            return `Read ${file}${lines}`;

        case 'copilot_grepSearch':
        case 'vscode_grepSearch':
            return `Search for "${params.pattern || params.query}"`;

        case 'copilot_listFiles':
            return `List files in ${params.path || 'workspace'}`;

        // ... more tools ...

        default:
            // Extract primary parameter
            const primaryParam = params.file_path || params.filePath ||
                params.pattern || params.query || params.path;
            return primaryParam
                ? `${toolName}(${primaryParam})`
                : `Called ${toolName}`;
    }
}
```

### Phase 3: Integrate with Single Model Handler (3 hours)

**Files to Modify:**
- `src/extension/modelComparison/vscode-node/singleModelChatHandler.ts`

**Tasks:**
- [ ] Add `IRequestLogger` dependency
- [ ] Subscribe to `onDidLogToolCall` event
- [ ] Correlate tool calls with current request
- [ ] Send formatted tool calls to comparison panel via `onDelta`

**Code Snippet:**

```typescript
export async function handleSingleModelChat(
    modelId: string,
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    onDelta: (modelId: string, text: string, metadata?: IChatResponseMetadata) => void,
    requestLogger: IRequestLogger, // NEW parameter
    // ... other params
): Promise<void> {
    const toolCallsForThisSession: ILoggedToolCall[] = [];

    // Subscribe to tool call events
    const toolCallListener = requestLogger.onDidLogToolCall(toolCall => {
        // Only track tool calls for THIS request
        if (toolCall.chatRequest === request) {
            toolCallsForThisSession.push(toolCall);

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
        // Run within request context so currentRequest is set
        await requestLogger.captureInvocation(request, async () => {
            await chatParticipantHandler(request, context, stream, token);
        });
    } finally {
        toolCallListener.dispose();
    }
}
```

### Phase 4: Update Comparison Panel UI (2 hours)

**Files to Modify:**
- `src/extension/modelComparison/vscode-node/modelComparisonPanel.ts`
- `assets/modelComparison/script.js` (if needed)

**Tasks:**
- [ ] Display formatted tool messages in response stream
- [ ] Show collapsible parameter details
- [ ] Add parameter diff highlighting (optional)

**UI Structure:**

```
Response:
  Text: "Let me check that file..."
  Tool: copilot_readFile
    → Read src/auth.ts (lines 1-50)
    Parameters: { file_path: "src/auth.ts", start_line: 1, end_line: 50 }
  Tool: copilot_grepSearch
    → Search for "authenticate"
    Parameters: { pattern: "authenticate", is_regexp: false }
  Text: "Based on the code..."
```

### Phase 5: Testing (2 hours)

**Test Cases:**
- [ ] Single model with single tool call
- [ ] Single model with multiple tool calls
- [ ] Multiple models with different tool strategies
- [ ] Rapid sequential requests (ensure correct correlation)
- [ ] Cancelled requests (ensure cleanup)
- [ ] Tool calls with complex parameters
- [ ] Unknown/custom tools (fallback formatting)

## Code Flow Diagram

```
User Prompt
    ↓
Model Comparison Panel
    ↓
[ModelA Handler]              [ModelB Handler]
    ↓                              ↓
ChatParticipantHandler        ChatParticipantHandler
    ↓                              ↓
ToolCallingLoop               ToolCallingLoop
    ↓                              ↓
toolsService.invokeTool       toolsService.invokeTool
    ↓                              ↓
requestLogger.logToolCall     requestLogger.logToolCall
    ↓                              ↓
onDidLogToolCall.fire()       onDidLogToolCall.fire()
    ↓                              ↓
singleModelHandler            singleModelHandler
receives event                receives event
    ↓                              ↓
formatToolCallMessage         formatToolCallMessage
    ↓                              ↓
onDelta(modelA, ...)          onDelta(modelB, ...)
    ↓                              ↓
Comparison Panel UI Updates
```

## Key Correlation Strategy

Use the `ChatRequest` instance as the correlation key:

1. **Request Context**: The `captureInvocation()` method sets `currentRequest`
2. **Tool Logging**: `logToolCall()` captures `this.currentRequest`
3. **Event Filtering**: `onDidLogToolCall` listener checks `toolCall.chatRequest === request`

This ensures perfect correlation without time-based heuristics.

## Alternative: Time-Based Correlation

If request instance matching doesn't work reliably:

```typescript
const sessionStartTime = Date.now();

try {
    await chatParticipantHandler(...);
} finally {
    const sessionEndTime = Date.now();

    // Retrieve all tool calls in this time window
    const toolCalls = requestLogger.getToolCallsInTimeRange(
        sessionStartTime,
        sessionEndTime
    );

    // Send to UI
    for (const tc of toolCalls) {
        onDelta(modelId, '', {
            copilotToolCalls: [{ ... }]
        });
    }
}
```

## Edge Cases to Handle

### 1. Multiple Concurrent Requests
**Problem**: Tool calls from different models might overlap in time.

**Solution**: Use request instance matching, not just time ranges.

### 2. Cached Tool Results
**Problem**: Tool might not be invoked if result is cached.

**Solution**: This is actually fine - we want to compare actual invocations, not cached lookups.

### 3. Tool Call Errors
**Problem**: Tool might fail or be cancelled.

**Solution**: Still log the attempt. The `response` will contain error info.

### 4. Unknown Tool Names
**Problem**: New or custom tools without formatters.

**Solution**: Generic fallback formatter extracts first significant parameter.

## Performance Considerations

### Memory
- Request logger already keeps last 100 entries
- No additional memory overhead
- Tool call listeners disposed after session

### CPU
- Event listeners are O(1) for correlation (request instance match)
- Formatting is lightweight (simple string templates)
- No performance impact on non-comparison requests

## Debugging Tips

### Enable Detailed Logging

```typescript
// In singleModelChatHandler.ts
console.log(`[${modelId}] Subscribed to tool call events`);

requestLogger.onDidLogToolCall(toolCall => {
    console.log(`[${modelId}] Tool call logged:`, {
        name: toolCall.name,
        args: toolCall.args,
        matchesRequest: toolCall.chatRequest === request
    });
});
```

### View Logged Entries

The request logger already provides URIs for viewing logs:

```
ccreq:latest.copilotmd  // Latest request
ccreq:<id>.copilotmd    // Specific request
ccreq:<id>.json         // JSON format
```

You can open these URIs in VS Code to inspect logged tool calls.

## Success Criteria

✅ **Must Have:**
- Tool names displayed for each model
- Full parameter objects available in UI
- Formatted messages for common tools (readFile, grepSearch, etc.)
- Correct correlation (no cross-model contamination)

✅ **Should Have:**
- Collapsible parameter details
- Timing information per tool call
- Tool response summaries

✅ **Nice to Have:**
- Parameter diff highlighting
- Tool call statistics (count, avg time)
- Export comparison data

## Rollout Plan

### Phase 1: Core Implementation (Week 1)
- Extend request logger
- Add formatters
- Integrate with single model handler
- Basic UI display

### Phase 2: Polish (Week 2)
- Enhanced UI (collapsible details)
- Additional tool formatters
- Testing and bug fixes

### Phase 3: Enhancements (Week 3+)
- Parameter diff view
- Performance metrics
- Export functionality

## Conclusion

This approach is **low-risk, high-reward**:

- ✅ Uses existing, proven infrastructure
- ✅ No changes to core chat system
- ✅ Fast to implement (1-2 days core work)
- ✅ Easy to test and debug
- ✅ Provides full parameter access
- ✅ Bonus: Tool responses, timing, workspace edits

The key insight: **The data already exists in logs - we just need to query it!**
