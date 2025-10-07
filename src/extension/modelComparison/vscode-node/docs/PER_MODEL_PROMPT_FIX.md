# Per-Model Prompt Modification Fix

## Problem
When editing the prompt for Model A in the model comparison panel, both Model A and Model B would use the modified prompt. This was unexpected behavior - only Model A should use its modified prompt.

## Root Cause
The issue was caused by **global intent method mutation** in a concurrent execution environment:

1. Each `SingleModelChatHandler` instance was modifying the **shared `agentIntent.invoke` method**
2. When Model A and Model B ran concurrently (which they do in the comparison panel), they would both try to replace the same global `agentIntent.invoke` method
3. Whichever model's request set up the intent wrapper **last** would "win", and **both models would use that closure**
4. This closure captured the `storedModification` variable from the last model to set it up, causing both models to use the same prompt modification

### Example Timeline:
```
Time 1: Model A starts request → Replaces agentIntent.invoke with wrapper using Model A's storedModification
Time 2: Model B starts request → Replaces agentIntent.invoke with wrapper using Model B's storedModification
Time 3: Model A's request executes → Uses Model B's wrapper (with Model B's storedModification)
Time 4: Model B's request executes → Uses Model B's wrapper (correct)
```

## Solution
The fix implements proper **intent restoration** using a `try-catch-finally` pattern:

### Key Changes:

1. **Preserve Original Intent Method** (static class variable):
   ```typescript
   private static _originalAgentInvoke: any = null;
   ```
   - Stores the true original intent invoke method the first time we see it
   - Never modified by subsequent requests

2. **Per-Request Variables** (function scope):
   ```typescript
   let originalInvoke: any = null;
   let agentIntent: any = null;
   ```
   - Declared at function scope (outside try block) so accessible in finally
   - Each request gets its own copies

3. **Request-Specific Wrapper** (closure captures correct modelId):
   ```typescript
   const requestSpecificInvoke = async (context: any) => {
       const invocation = await originalInvoke(context); // Uses true original
       invocation.buildPrompt = async (...) => {
           // This closure captures the current modelId and storedModification
           const modifiedMessages = combinedPromptModifier(modelId, result.messages);
           // ...
       };
       return invocation;
   };
   ```
   - Creates a closure that captures the **current request's `modelId`**
   - Uses `originalInvoke` from the static original, not a potentially wrapped version

4. **Restoration in Finally Block**:
   ```typescript
   finally {
       if (agentIntent && originalInvoke) {
           agentIntent.invoke = originalInvoke;
           console.log(`[SingleModelChatHandler] ${modelId} - Restored original intent invoke method`);
       }
   }
   ```
   - **Always** restores the intent after the request completes
   - Even if the request throws an error
   - Ensures the next request starts with a clean state

## How It Works Now

### Concurrent Execution:
```
Time 1: Model A starts → Saves original, wraps with Model A's closure
Time 2: Model B starts → Saves original, wraps with Model B's closure
Time 3: Model A executes → Uses its request-specific wrapper (Model A's modification)
Time 4: Model A completes → Restores original intent
Time 5: Model B executes → Uses its request-specific wrapper (Model B's modification)
Time 6: Model B completes → Restores original intent
```

### Per-Model Prompt Storage:
- `PromptModificationStore` stores modifications keyed by `modelId`
- Each model retrieves its own modification: `promptModificationStore.getModification(modelId)`
- The `combinedPromptModifier` closure captures the correct `modelId` for each request
- No cross-contamination between models

## Testing
After this fix:
1. ✅ Edit prompt for Model A → Only Model A uses modified prompt
2. ✅ Edit prompt for Model B → Only Model B uses modified prompt
3. ✅ Edit prompts for both → Each uses its own modification
4. ✅ Reset Model A → Model A returns to default, Model B keeps its modification
5. ✅ Concurrent requests → No interference between models

## Related Files
- `singleModelChatHandler.ts` - Main fix location (intent wrapping and restoration)
- `promptModificationStore.ts` - Per-model storage (already correct)
- `comparisonChatOrchestrator.ts` - Creates separate handlers per model (already correct)
