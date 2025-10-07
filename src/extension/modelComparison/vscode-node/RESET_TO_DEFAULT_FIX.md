# Reset to Default Fix

## Problem
When clicking "Reset to Default" and then "Save" in the prompt editor, the following error occurred:

```
Error handling webview message: Error: Modification data is required
    at ModelComparisonViewProvider.handleWebviewMessage (...:522:12)

Failed to save prompt modification: Error: Modification data is required
```

## Root Cause
The backend handler for `save-model-prompt` had a validation check that rejected `null` modifications:

```typescript
if (!modification) {
    throw new Error('Modification data is required');
}
```

However, the frontend intentionally sends `modification: null` when the edited text matches the original text (i.e., when resetting to default). This is by design in `script.js`:

```javascript
await sendMessage('save-model-prompt', {
    modelId,
    modification: hasModification ? {
        customSystemMessage: editedMessage,
        replaceSystemMessage: true
    } : null // Clear the modification if unchanged
});
```

## Solution
Modified the `save-model-prompt` handler in `modelComparisonViewProvider.ts` to properly handle `null` modifications:

```typescript
case 'save-model-prompt': {
    const { modelId, modification } = message.data;
    if (!modelId) {
        throw new Error('Model ID is required');
    }

    // If modification is null or undefined, remove the modification (reset to default)
    if (!modification) {
        await this.promptModificationStore.removeModification(modelId);
        console.log(`[ModelComparisonViewProvider] Cleared prompt modification for ${modelId} (reset to default)`);
        return {
            success: true,
            modelId,
            modification: null
        };
    }

    // ... rest of the logic for non-null modifications
}
```

## How It Works Now

### User Workflow:
1. **Edit a prompt** for a model → Custom system message is saved
2. **Click "Edit Prompt"** again → See the custom message in the textarea
3. **Click "Reset to Default"** → Textarea is populated with the original system message
4. **Click "Save"** → Frontend compares edited text with original:
   - If they match → sends `modification: null`
   - If different → sends actual modification data
5. **Backend receives `modification: null`** → Removes the stored modification
6. **Model returns to default prompt** → Edit button no longer shows modification indicator

### Alternative: Direct Reset
There's also a `reset-model-prompt` command that can be used to directly clear modifications without going through the editor UI.

## Key Points
- `null` modification is a valid state meaning "no custom modification" or "reset to default"
- The frontend uses this pattern to simplify the logic: edit text equals original → null
- The backend must accept `null` and treat it as a removal operation
- This pattern is consistent with how other state management works (absent value = default)

## Testing
After this fix:
1. ✅ Edit a prompt and save → Works
2. ✅ Reset to default and save → Works (removes modification)
3. ✅ Edit then restore original text and save → Works (removes modification)
4. ✅ Multiple edit/reset cycles → Works correctly

## Related Files
- `modelComparisonViewProvider.ts` - Backend handler (fixed here)
- `script.js` - Frontend logic (unchanged, was already correct)
- `promptModificationStore.ts` - Storage layer (unchanged, already handles removal)
