# Prompt Interception Race Condition Fix

## Problem

When running multiple model comparisons concurrently with different prompt modifications per model, there was a race condition where Model B would receive Model A's prompt modifications (or vice versa).

### Root Cause

The fundamental architectural issue was trying to use **shared mutable state** for **request-specific data**:

1. **Shared Singleton**: All concurrent requests shared a single `agentIntent` object from the intent service
2. **Method Mutation**: Each request would temporarily replace `agentIntent.invoke` with its own wrapper
3. **Race Condition**: When Model A and Model B ran concurrently, they would overwrite each other's wrappers

### Failed Approaches

1. **Closure Capture with Shared Map**: Store interceptors in a map, capture request ID in closure
   - **Problem**: The wrapper itself still gets overwritten on the shared `agentIntent.invoke`

2. **Mutex/Lock Pattern**: Serialize access to `agentIntent.invoke`
   - **Problem**: Defeats the purpose of concurrent model comparison (no parallelism)

Both approaches were fighting against the architecture instead of working with it.

## Solution: Store State on Request-Specific Objects

The correct architectural insight: **Don't use shared state for request-specific data**.

Instead of storing prompt modifiers in:
- ❌ Shared Map keyed by request ID
- ❌ Closure variables that can be overwritten

Store them in:
- ✅ **The request object itself** (which is already request-specific)

### Key Changes

1. **Extended ChatRequest with Request-Specific Properties**:
   ```typescript
   class ModelComparisonChatRequest implements ChatRequest {
       // ... existing properties ...

       // Store request-specific prompt modifier to avoid shared state issues
       public promptModifier?: (messages: Raw.ChatMessage[]) => Raw.ChatMessage[];
       public onPromptRendered?: (messages: Raw.ChatMessage[]) => void;
   }
   ```

2. **Store Modifiers on Request Object**:
   ```typescript
   // Before wrapping the intent, attach modifiers to the request
   request.promptModifier = (messages: Raw.ChatMessage[]) => combinedPromptModifier(modelId, messages);
   request.onPromptRendered = (messages: Raw.ChatMessage[]) => {
       if (onPromptRendered) {
           onPromptRendered(modelId, messages);
       }
   };
   ```

3. **Look Up Modifiers from Context (Not Closure)**:
   ```typescript
   const requestSpecificInvoke = async (context: IIntentInvocationContext) => {
       const invocation = await originalInvoke(context);

       invocation.buildPrompt = async (promptContext, progress, token) => {
           const result = await originalBuildPrompt(promptContext, progress, token);

           // Get the request object from the context (NOT from closure)
           const chatRequest = context.request as ModelComparisonChatRequest;

           // Use modifiers attached to THIS specific request
           if (chatRequest.onPromptRendered) {
               chatRequest.onPromptRendered(result.messages);
           }

           if (chatRequest.promptModifier) {
               const modifiedMessages = chatRequest.promptModifier(result.messages);
               return { ...result, messages: modifiedMessages };
           }

           return result;
       };

       return invocation;
   };
   ```

### Why This Works

1. **No Shared State**: Each request has its own `ModelComparisonChatRequest` instance with its own modifiers
2. **Request-Specific Lookup**: The wrapper looks up modifiers from `context.request`, which is the **actual request object** being processed
3. **No Race Conditions**: Even if the wrapper gets overwritten by another request, it still looks up the correct modifiers from the context
4. **True Concurrency**: Requests can run in parallel without serialization

### Request Timeline (Fixed)

Concurrent execution of Model A and Model B:

- T1: Model A creates `requestA` with `requestA.promptModifier = modifierA`
- T2: Model A wraps `agentIntent.invoke` with wrapper
- T3: Model B creates `requestB` with `requestB.promptModifier = modifierB`
- T4: Model B wraps `agentIntent.invoke` with wrapper (**overwrites** A's wrapper)
- T5: Model A's `ChatParticipantRequestHandler` invokes the (overwritten) wrapper with `context.request = requestA`
  - Wrapper looks up `context.request.promptModifier` → gets `modifierA` ✓
- T6: Model B's `ChatParticipantRequestHandler` invokes the wrapper with `context.request = requestB`
  - Wrapper looks up `context.request.promptModifier` → gets `modifierB` ✓

**Result**: Each model gets its own prompt modifications applied correctly ✓

### Architectural Lesson

**Use the right layer of abstraction for state storage:**

- ❌ **Wrong**: Store request-specific data in shared/global state (maps, closures on shared objects)
- ✅ **Right**: Store request-specific data on request-specific objects (the request itself)

The `ChatRequest` object flows through the entire request pipeline (`ChatParticipantRequestHandler` → `Intent` → `buildPrompt`), making it the perfect place to store request-specific configuration.

## Performance

This solution maintains **full concurrency**:
- ✅ Multiple model requests run in parallel
- ✅ No serialization or locking
- ✅ No performance degradation

## Testing

To verify the fix:
1. Create two models with different prompt modifications
2. Send concurrent requests to both models
3. Inspect the actual prompts sent to each model (use "Show Prompt" feature)
4. Verify each model receives its own modifications, not the other model's
5. Confirm both models run in parallel (not serialized)

## Related Files

- `singleModelChatHandler.ts`: Core fix implementation
- `comparisonChatOrchestrator.ts`: Orchestrates concurrent model requests
- `promptModificationStore.ts`: Stores per-model prompt modifications
- `intents.ts`: Defines `IIntentInvocationContext` with `request` property
