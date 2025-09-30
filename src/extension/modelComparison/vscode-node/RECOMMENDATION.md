# Model Comparison Panel - Tool Call Tracking

## Project Goal

The model comparison panel is designed to **replicate the exact behavior of the chat panel** so that engineers can:
- Compare how different models perform with identical prompts
- Test improvements to prompting, tool calling, and context gathering
- Ensure changes work correctly before deploying to production

**Critical Requirement:** Must use the same code path as the real chat panel (`ChatParticipantRequestHandler`) to ensure fidelity.

## The `toolInvocationToken` Problem

### Why We Can't Get Tool Parameters

`ChatToolInvocationPart` (which contains the `invocationMessage` with formatted parameters) is only created when there's a valid `toolInvocationToken`. This token:

- Is an opaque type (`export type ChatParticipantToolToken = never`)
- Can only be created by VS Code core during a real chat request
- Cannot be synthesized or created by extensions

Since the model comparison panel creates synthetic `ChatRequest` objects for testing, there's no way to obtain a real token.

### What We CAN See

✅ **`ChatPrepareToolInvocationPart`** - Created before tool execution
- Contains: `toolName` only
- Example: `copilot_readFile`

❌ **`ChatToolInvocationPart`** - Would contain full invocation details
- Would contain: `toolName`, `toolCallId`, `invocationMessage`
- Example invocationMessage: `"Read src/index.ts"`
- **Not available without valid toolInvocationToken**

## Decision: Accept the Limitation

**Chosen Approach: Option A - Use ChatParticipantRequestHandler as-is**

### Rationale

1. **Fidelity is paramount** - Using the same code path as the real chat panel is more important than having detailed tool parameters
2. **Tool names are sufficient** - Knowing which tools were called is valuable for comparison even without parameters
3. **Simplicity** - No complex workarounds or alternative implementations
4. **Maintainability** - Changes to chat panel behavior automatically apply to comparison panel

### What the Comparison Panel Will Show

- ✅ Which tools were called
- ✅ When tools were called (order)
- ✅ Tool call success/failure
- ❌ Specific parameters passed to tools (e.g., which file was read)

### Implementation

Current implementation in `singleModelChatHandler.ts`:
- Captures `ChatPrepareToolInvocationPart` with tool name
- Reports tool calls to the comparison UI
- Logs detailed information for debugging

## Alternative Approaches Considered (and Why Rejected)

### Option B: Direct Language Model API
**Pros:** Full access to tool parameters via `LanguageModelToolCallPart.input`
**Cons:** Bypasses `ChatParticipantRequestHandler`, losing fidelity with chat panel behavior
**Verdict:** ❌ Violates the core requirement of matching production behavior

### Option C: Hybrid Approach
**Pros:** Keep fidelity, add parameter tracking
**Cons:** Very complex, requires modifying internal services, fragile
**Verdict:** ❌ Not worth the complexity for marginal benefit

## Future Possibilities

If detailed tool parameters become critical for comparison:

1. **Request VS Code API enhancement** - Propose a way to get tool invocation details even without a real chat context
2. **Enhanced logging** - Add logging at the language model level to capture parameters
3. **Tool result analysis** - Infer tool behavior from results rather than parameters

For now, the basic tool name tracking is sufficient for the comparison panel's goals.

