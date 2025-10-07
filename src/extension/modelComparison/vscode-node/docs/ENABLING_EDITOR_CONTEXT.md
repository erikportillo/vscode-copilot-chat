# Enabling Editor Context in Model Comparison Panel

## Summary of Changes

I've successfully enabled automatic editor context collection for the Model Comparison panel. The implementation allows the panel to automatically include the active file or selection when sending messages to models.

### Changes Made:

1. **Updated `comparisonChatOrchestrator.ts`:**
   - Added `includeEditorContext` parameter to `sendChatMessageToMultipleModels()`
   - Added `additionalReferences` parameter for custom context
   - Updated `handleSingleModelRequest()` to pass these through to `SingleModelChatHandler`
   - Added import for `ChatPromptReference` type

2. **Updated `modelComparisonViewProvider.ts`:**
   - Enabled `includeEditorContext: true` in the main chat request call
   - This means all model comparison requests now automatically include active editor context

## How It Works Now

When a user sends a message in the Model Comparison panel:

1. **Active Editor Detection**: The system checks for an active text editor
2. **Context Selection**:
   - If there's a **selection** → Includes the selected code range
   - If **no selection** → Includes the entire active file
3. **Reference Creation**: Creates a `ChatPromptReference` with:
   - ID: `vscode.implicit`
   - Value: Either `Location` (for selection) or `Uri` (for file)
   - Description: Helps the model understand what the context is
4. **Prompt Integration**: The reference is processed by `ChatVariablesCollection` and rendered in the prompt

## Alternative Approaches

### Option 1: Always Enable (Current Implementation) ✅
**What I implemented:**
```typescript
const modelResponses = await this.comparisonChatOrchestrator.sendChatMessageToMultipleModels(
    selectedModels,
    clonedRequest.message,
    clonedRequest.history,
    cancellationToken,
    // ... callbacks ...
    true  // includeEditorContext - always enabled
);
```

**Pros:**
- Simple and consistent
- Works like the regular chat panel
- Users don't need to think about it

**Cons:**
- Always includes context (might not always be desired)
- Uses token budget even when not needed

### Option 2: Make It User-Configurable (Recommended Enhancement)

Add a toggle in the UI to let users enable/disable context:

```typescript
// In modelComparisonViewProvider.ts - receive from webview message
const includeContext = message.data.includeEditorContext ?? true;

const modelResponses = await this.comparisonChatOrchestrator.sendChatMessageToMultipleModels(
    selectedModels,
    clonedRequest.message,
    clonedRequest.history,
    cancellationToken,
    // ... callbacks ...
    includeContext  // User-controlled
);
```

**Add to webview UI:**
```html
<!-- In the webview HTML -->
<label>
    <input type="checkbox" id="includeContext" checked>
    Include active editor context
</label>
```

### Option 3: Smart Context Detection

Only include context when the message seems to reference it:

```typescript
// Smart detection based on message content
const messageNeedsContext = /\b(this|current|selected|file|code|here)\b/i.test(clonedRequest.message);

const modelResponses = await this.comparisonChatOrchestrator.sendChatMessageToMultipleModels(
    // ... params ...
    messageNeedsContext  // Smart detection
);
```

### Option 4: Custom References via UI

Allow users to manually select files/ranges:

```typescript
// Build custom references from user selections
const customReferences: ChatPromptReference[] = selectedFiles.map(file => ({
    id: 'custom.file',
    name: `file:${file.path}`,
    value: file.uri
}));

const modelResponses = await this.comparisonChatOrchestrator.sendChatMessageToMultipleModels(
    // ... params ...
    false,  // Don't auto-include
    customReferences  // User-selected files
);
```

## Testing the Implementation

To verify it's working:

1. **Open a file** in VS Code
2. **Select some code** (or leave no selection to include whole file)
3. **Open Model Comparison panel**
4. **Send a message** like "Explain this code"
5. **Check the responses** - models should reference the code context

## Debugging Tips

If context isn't being included:

1. **Check active editor**: Ensure `window.activeTextEditor` is not undefined
2. **Check references**: Add logging in `gatherEditorContext()`:
   ```typescript
   console.log('Active editor:', activeTextEditor?.document.uri.toString());
   console.log('Selection:', selection?.isEmpty ? 'empty' : 'has selection');
   console.log('References created:', references.length);
   ```
3. **Check prompt**: Use `onPromptRendered` callback to see final prompt with context
4. **Monitor chat variables**: Log `chatRequest.references` to verify they're passed through

## Token Budget Considerations

Including editor context uses tokens from the model's context window:
- **Small file (~100 lines)**: ~500-1000 tokens
- **Medium file (~500 lines)**: ~2000-5000 tokens
- **Large file (1000+ lines)**: ~5000-15000 tokens
- **Selection only**: Typically much smaller

**Recommendation**: If implementing user control (Option 2), default to `true` but allow users to disable for large files.

## Future Enhancements

1. **Context Preview**: Show users what context will be included before sending
2. **Smart Truncation**: Automatically truncate large files to fit token budget
3. **Multi-file Support**: Allow users to add multiple files as context
4. **Workspace-wide Context**: Include related files based on imports/dependencies
5. **Persistent Preferences**: Remember user's context inclusion preference

## Related Files

- `singleModelChatHandler.ts` - Core context collection logic
- `comparisonChatOrchestrator.ts` - Orchestrates multi-model requests
- `modelComparisonViewProvider.ts` - Main entry point for chat requests
- `CONTEXT_COLLECTION.md` - Detailed documentation on context system
