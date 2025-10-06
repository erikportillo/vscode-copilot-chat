# Tool Call Tracking in Model Comparison Panel

## Summary

The model comparison panel tracks which tools are called during model responses, but **cannot access tool parameters** due to architectural limitations with `ChatParticipantToolToken`.

## What We Can Track

✅ **Tool name** - Which tool was invoked (e.g., `copilot_readFile`)
✅ **Tool timing** - When the tool was called during the response
✅ **Tool count** - How many tools each model used
✅ **Tool order** - The sequence of tool calls

## What We Cannot Track

❌ **Tool parameters** - Specific arguments passed to the tool (e.g., which file was read)
❌ **Formatted invocation messages** - Human-readable descriptions like "Read src/index.ts"

## Why This Limitation Exists

### The `toolInvocationToken` Problem

`ChatToolInvocationPart` (which contains the `invocationMessage` with formatted parameters) is only created by VS Code core when a tool is invoked with a valid `ChatParticipantToolToken`.

This token:
- Is an opaque type that cannot be created by extensions
- Only exists in the context of real user-initiated chat requests
- Is required for the full tool invocation UI and parameter tracking

Since the model comparison panel creates **synthetic** `ChatRequest` objects for testing, we cannot obtain a real `toolInvocationToken`.

### What Actually Flows Through

Without a real token, we only receive:
- **`ChatPrepareToolInvocationPart`** - Contains only the tool name
- No `ChatToolInvocationPart` with `invocationMessage`

## Design Decision: Prioritize Fidelity

We chose to **accept this limitation** rather than use workarounds because:

### ✅ Pros of Current Approach
1. **Production Fidelity** - Uses the exact same code path as the real chat panel
2. **Automatic Updates** - Improvements to `ChatParticipantRequestHandler` automatically apply
3. **Accurate Comparison** - Models receive identical prompts, context, and tool results as in production
4. **Simplicity** - No complex workarounds or alternative implementations

### ❌ Why We Rejected Alternatives

**Direct Language Model API** (would give us parameters)
- ❌ Bypasses `ChatParticipantRequestHandler`
- ❌ Loses intent detection and context gathering
- ❌ Models would receive different prompts than production
- ❌ Comparison results would be misleading for testing improvements

**Hybrid Approach** (keep fidelity + add parameter tracking)
- ❌ Very complex implementation
- ❌ Requires modifying internal services
- ❌ Fragile and difficult to maintain

## Usage in Comparison UI

The comparison panel should display tool calls as:

```
Model A Response:
  - Text: "I'll help you with that."
  - Tool: copilot_readFile
  - Tool: copilot_grepSearch
  - Text: "Based on the code..."

Model B Response:
  - Text: "Let me check that."
  - Tool: copilot_readFile
  - Tool: copilot_readFile
  - Tool: copilot_listFiles
  - Text: "Here's what I found..."
```

This gives engineers sufficient information to compare:
- Which tools each model chose to use
- How many tool calls were made
- The timing/order of tool calls
- Tool usage patterns and differences

## Implementation

See `singleModelChatHandler.ts` for the implementation. Key points:

```typescript
// Tool calls are detected via ChatPrepareToolInvocationPart
if ((part as any).toolName) {
    const toolName = (part as any).toolName;
    console.log(`Tool call: ${toolName}`);

    // Report to comparison UI
    onDelta(modelId, '', {
        copilotToolCalls: [{
            name: toolName,
            // Note: Parameters not available
        }]
    });
}
```

## Future Enhancements

### Why Tool Parameters Matter

Being able to compare **how different models use the same tool with different arguments** would provide valuable insights:

**Example Use Case:**
```
User: "Find the bug in my authentication code"

Model A: copilot_readFile({ file_path: "/src/auth.ts", start_line: 1, end_line: 50 })
Model B: copilot_readFile({ file_path: "/src/auth.ts" })  // Reads entire file
Model C: copilot_grepSearch({ pattern: "authentication.*bug" })  // Different strategy
```

This would reveal:
- **Tool usage strategies** - Which model uses tools more efficiently
- **Parameter patterns** - How models scope their tool calls (specific lines vs. whole files)
- **Tool selection logic** - Different approaches to the same problem

### Potential Solutions (If This Becomes Critical)

#### Option 1: VS Code API Enhancement ⭐ Recommended
Request a new VS Code API that allows tracking tool invocations without requiring a real `ChatParticipantToolToken`:
- New event: `vscode.lm.onWillInvokeTool` that fires with full parameters
- Could be scoped to specific language model requests
- Wouldn't require changes to existing chat infrastructure

#### Option 2: Hybrid Approach (Complex)
Implement parameter tracking alongside the current approach:
- Thread a callback through `ChatParticipantRequestHandler` → `LanguageModelAccess`
- Intercept at line 471 of `languageModelAccess.ts` where parameters exist
- **Requires changes to ~10 files** across the service chain
- See `RECOMMENDATION.md` for detailed implementation notes

#### Option 3: Enhanced Telemetry
Add detailed tool call logging at the language model level:
- Log parameters before they're consumed by the chat system
- Could be enabled via a setting for comparison mode
- Retrieve from logs rather than live tracking

#### Option 4: Tool Result Analysis
Infer tool behavior from results rather than parameters:
- Analyze the tool results to understand what was requested
- E.g., a file read result shows which file and range was read
- Less direct but might provide sufficient insight

### Current Status

For now, tool name tracking is sufficient for the panel's primary goal: enabling engineers to test and compare improvements to the chat system. The limitation is **documented and understood**, and we have a clear path forward if parameter tracking becomes essential.
