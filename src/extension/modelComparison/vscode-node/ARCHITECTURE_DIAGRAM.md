# Option 3 Architecture Diagram

## Data Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         User Input: "Fix auth bug"                       │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      Model Comparison Panel                              │
│  Creates two parallel chat requests (one per model)                     │
└───────────────┬─────────────────────────────────┬───────────────────────┘
                │                                 │
                ▼                                 ▼
┌───────────────────────────┐   ┌───────────────────────────────────────┐
│  handleSingleModelChat    │   │  handleSingleModelChat                │
│  (Model A: GPT-4)         │   │  (Model B: Claude)                    │
│                           │   │                                       │
│  1. Subscribe to          │   │  1. Subscribe to                      │
│     onDidLogToolCall      │   │     onDidLogToolCall                  │
│                           │   │                                       │
│  2. Run within            │   │  2. Run within                        │
│     captureInvocation()   │   │     captureInvocation()               │
└──────────┬────────────────┘   └──────────┬────────────────────────────┘
           │                               │
           ▼                               ▼
┌───────────────────────────┐   ┌───────────────────────────────────────┐
│ ChatParticipantHandler    │   │ ChatParticipantHandler                │
│ (request A)               │   │ (request B)                           │
└──────────┬────────────────┘   └──────────┬────────────────────────────┘
           │                               │
           ▼                               ▼
┌───────────────────────────┐   ┌───────────────────────────────────────┐
│ ToolCallingLoop           │   │ ToolCallingLoop                       │
│ Model decides to call:    │   │ Model decides to call:                │
│ - copilot_readFile        │   │ - copilot_readFile                    │
│ - copilot_grepSearch      │   │ - copilot_listFiles                   │
└──────────┬────────────────┘   └──────────┬────────────────────────────┘
           │                               │
           ▼                               ▼
┌───────────────────────────┐   ┌───────────────────────────────────────┐
│ toolsService.invokeTool   │   │ toolsService.invokeTool               │
│                           │   │                                       │
│ Parameters:               │   │ Parameters:                           │
│ {                         │   │ {                                     │
│   file_path: "src/auth",  │   │   file_path: "src/auth",              │
│   start_line: 1,          │   │   // no line numbers                  │
│   end_line: 50            │   │ }                                     │
│ }                         │   │                                       │
└──────────┬────────────────┘   └──────────┬────────────────────────────┘
           │                               │
           ▼                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      RequestLogger.logToolCall()                         │
│                                                                          │
│  Stores in LoggedToolCall:                                              │
│  - id: "abc123"                                                         │
│  - name: "copilot_readFile"                                             │
│  - args: { file_path: "src/auth", start_line: 1, end_line: 50 }        │
│  - chatRequest: requestA (or requestB)                                  │
│  - time: 1234567890                                                     │
│  - response: LanguageModelToolResult                                    │
│  - thinking: ThinkingData (optional)                                    │
│                                                                          │
│  Fires event: onDidLogToolCall.fire(loggedToolCall)                     │
└────────────────────┬────────────────────────┬───────────────────────────┘
                     │                        │
                     ▼                        ▼
┌───────────────────────────┐   ┌───────────────────────────────────────┐
│ Event Listener (Model A)  │   │ Event Listener (Model B)              │
│                           │   │                                       │
│ if (toolCall.chatRequest  │   │ if (toolCall.chatRequest              │
│     === requestA) {       │   │     === requestB) {                   │
│                           │   │                                       │
│   formatted =             │   │   formatted =                         │
│     formatToolCallMessage │   │     formatToolCallMessage             │
│     ("copilot_readFile",  │   │     ("copilot_readFile",              │
│      args)                │   │      args)                            │
│                           │   │                                       │
│   // Returns:             │   │   // Returns:                         │
│   "Read src/auth          │   │   "Read src/auth"                     │
│    (lines 1-50)"          │   │                                       │
│                           │   │                                       │
│   onDelta(modelA, '', {   │   │   onDelta(modelB, '', {               │
│     copilotToolCalls: [   │   │     copilotToolCalls: [               │
│       {                   │   │       {                               │
│         name: "...",      │   │         name: "...",                  │
│         arguments: "...", │   │         arguments: "...",             │
│         formattedMessage  │   │         formattedMessage              │
│       }                   │   │       }                               │
│     ]                     │   │     ]                                 │
│   });                     │   │   });                                 │
│ }                         │   │ }                                     │
└──────────┬────────────────┘   └──────────┬────────────────────────────┘
           │                               │
           └───────────────┬───────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    Model Comparison Panel UI                             │
│                                                                          │
│  ┌────────────────────────────┐  ┌────────────────────────────────────┐│
│  │ Model A (GPT-4)            │  │ Model B (Claude)                   ││
│  ├────────────────────────────┤  ├────────────────────────────────────┤│
│  │ Let me check that file.    │  │ I'll examine the auth code.        ││
│  │                            │  │                                    ││
│  │ 🔧 Read src/auth           │  │ 🔧 Read src/auth                   ││
│  │    (lines 1-50)            │  │    (entire file)                   ││
│  │    ▼ Parameters            │  │    ▼ Parameters                    ││
│  │    {                       │  │    {                               ││
│  │      file_path: "src/auth",│  │      file_path: "src/auth"         ││
│  │      start_line: 1,        │  │    }                               ││
│  │      end_line: 50          │  │                                    ││
│  │    }                       │  │                                    ││
│  │                            │  │                                    ││
│  │ 🔧 Search for "auth"       │  │ 🔧 List files in src/              ││
│  │    ▼ Parameters            │  │    ▼ Parameters                    ││
│  │    {                       │  │    {                               ││
│  │      pattern: "auth",      │  │      path: "src/"                  ││
│  │      is_regexp: false      │  │    }                               ││
│  │    }                       │  │                                    ││
│  │                            │  │                                    ││
│  │ Based on the code...       │  │ Looking at the files...            ││
│  └────────────────────────────┘  └────────────────────────────────────┘│
│                                                                          │
│  Insights:                                                               │
│  • Model A read specific lines (more targeted)                          │
│  • Model B read entire file (broader context)                           │
│  • Model A used grep search, Model B used list files                    │
│  • Different tool strategies for same problem                           │
└─────────────────────────────────────────────────────────────────────────┘
```

## Key Components

### 1. RequestLogger (Existing)
**Location**: `src/extension/prompt/vscode-node/requestLoggerImpl.ts`

**Current State**:
- ✅ Already logs tool calls with full parameters
- ✅ Stores last 100 entries
- ✅ Has `chatRequest` correlation

**What We Add**:
- 🆕 `onDidLogToolCall` event
- 🆕 `getToolCallsForRequest()` query method

### 2. Tool Call Formatter (New)
**Location**: `src/extension/modelComparison/vscode-node/toolCallFormatter.ts`

**Purpose**:
- Convert raw parameters to human-readable messages
- Handle common tools (readFile, grepSearch, etc.)
- Provide fallback for unknown tools

### 3. Single Model Handler (Modified)
**Location**: `src/extension/modelComparison/vscode-node/singleModelChatHandler.ts`

**Changes**:
- Subscribe to tool call events
- Filter by request instance
- Format and send to UI

### 4. Model Comparison Panel (Modified)
**Location**: `src/extension/modelComparison/vscode-node/modelComparisonPanel.ts`

**Changes**:
- Display formatted tool messages
- Show expandable parameter details
- Highlight tool strategy differences

## Sequence Diagram

```
User         Panel           HandlerA        HandlerB     ToolLoop    RequestLogger
 │              │                │               │            │              │
 │─"Fix bug"──>│                │               │            │              │
 │              │                │               │            │              │
 │              │─Start A──────>│               │            │              │
 │              │─Start B───────────────────────>│            │              │
 │              │                │               │            │              │
 │              │                │─Subscribe─────────────────────────────────>│
 │              │                │               │            │              │
 │              │                │               │─Subscribe─────────────────>│
 │              │                │               │            │              │
 │              │                │─Run Chat─────>│            │              │
 │              │                │               │─Run Chat──>│              │
 │              │                │               │            │              │
 │              │                │               │            │─invokeTool─>│
 │              │                │               │            │             │
 │              │                │               │            │<─logToolCall│
 │              │                │               │            │   (with args)│
 │              │                │               │            │              │
 │              │                │<──Event(tool, args)────────────────────────│
 │              │                │               │            │              │
 │              │                │─format()─────>│            │              │
 │              │                │<─"Read..."────│            │              │
 │              │                │               │            │              │
 │              │<─onDelta(A)────│               │            │              │
 │              │                │               │            │              │
 │<─Update UI───│                │               │            │              │
 │              │                │               │            │              │
 │              │                │               │<───────Event(tool, args)───│
 │              │                │               │            │              │
 │              │                │               │─format()──>│              │
 │              │                │               │<─"List..." │              │
 │              │                │               │            │              │
 │              │<─onDelta(B)───────────────────>│            │              │
 │              │                │               │            │              │
 │<─Update UI───│                │               │            │              │
 │              │                │               │            │              │
```

## Correlation Strategy

### Primary: Request Instance Matching

```typescript
// When tool is logged
const loggedCall = new LoggedToolCall(
    id, name, args, response,
    this.currentRequest,  // ← ChatRequest instance
    Date.now(), thinking
);

// When handler receives event
requestLogger.onDidLogToolCall(toolCall => {
    if (toolCall.chatRequest === request) {  // ← Same instance
        // This tool call belongs to this model
        handleToolCall(toolCall);
    }
});
```

### Why This Works

1. `captureInvocation(request, fn)` sets `currentRequest` in async local storage
2. All tool calls within `fn()` will be tagged with that `request`
3. Event listeners filter by checking `toolCall.chatRequest === request`
4. No time-based heuristics needed - exact instance matching

### Fallback: Time-Based Correlation

If instance matching fails:

```typescript
const startTime = Date.now();
await runChat();
const endTime = Date.now();

const toolCalls = requestLogger.getToolCallsInTimeRange(startTime, endTime);
```

## Benefits Visualization

```
┌─────────────────────────────────────────────────────────────────┐
│                    What We Get For Free                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ✅ Tool Parameters (JSON)                                       │
│     {                                                            │
│       file_path: "src/auth.ts",                                  │
│       start_line: 1,                                             │
│       end_line: 50,                                              │
│       includePattern: "*.ts"                                     │
│     }                                                            │
│                                                                  │
│  ✅ Tool Response                                                │
│     Content of what the tool returned                            │
│                                                                  │
│  ✅ Timing Data                                                  │
│     When the tool was called (timestamp)                         │
│                                                                  │
│  ✅ Thinking Data (if available)                                 │
│     Model's reasoning before tool call                           │
│                                                                  │
│  ✅ Workspace Edits (if tracking enabled)                        │
│     Files modified during tool execution                         │
│                                                                  │
│  ✅ Tool Metadata                                                │
│     Additional context from tool implementation                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Implementation Complexity

```
Component                     Lines of Code    Complexity    Risk
────────────────────────────────────────────────────────────────
RequestLogger Extension               ~30         Low       Low
Tool Call Formatter                   ~100        Low       Low
Single Model Handler Changes          ~50         Low       Low
Panel UI Updates                      ~80         Med       Low
Testing                               ~100        Med       Low
────────────────────────────────────────────────────────────────
TOTAL                                 ~360        Low       Low
```

Compare to Option 2 (Hybrid):
- ~1000+ lines of code
- High complexity
- Medium-high risk
- 10+ files modified across service boundaries

## Rollout Risk Assessment

### Low Risk ✅
- Uses existing, battle-tested logging infrastructure
- Changes are additive (no modifications to core logic)
- Easy to feature-flag or disable
- No performance impact on normal chat

### Medium Risk ⚠️
- Request correlation might fail in edge cases
- Event listeners need proper disposal

### Mitigations
- Comprehensive testing with concurrent requests
- Fallback to time-based correlation
- Dispose listeners in try/finally blocks
- Monitor for memory leaks in dev tools

## Success Metrics

After implementation, we should be able to:

1. ✅ See tool names for each model
2. ✅ See formatted tool messages (e.g., "Read src/auth.ts")
3. ✅ Expand to view full parameter JSON
4. ✅ Compare parameter differences between models
5. ✅ No cross-contamination (Model A's tools in Model B's list)
6. ✅ Correct timing and ordering

## Next Steps

See `IMPLEMENTATION_GUIDE.md` for detailed step-by-step instructions.
