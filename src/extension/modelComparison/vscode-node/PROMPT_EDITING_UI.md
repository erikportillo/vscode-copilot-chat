# Prompt Editing UI Implementation

This document describes the implementation of the live prompt editing feature for the Model Comparison Panel.

## Overview

The prompt editing feature allows users to customize the system prompt for each model individually. Custom prompts are persisted across sessions and can be either prepended to or replace the default system message.

## Architecture

### Components

#### 1. **PromptModificationStore** (`promptModificationStore.ts`)
- Stores per-model prompt modifications using VS Code's workspace state
- Provides API for get/set/remove operations
- Supports exporting/importing modifications as JSON
- Each modification contains:
  - `customSystemMessage`: The custom prompt text
  - `replaceSystemMessage`: Whether to replace (true) or prepend (false)
  - `lastModified`: Timestamp of last update

#### 2. **SingleModelChatHandler Integration**
- Accepts optional `PromptModificationStore` in constructor
- Applies stored modifications before sending prompts to models
- Uses existing prompt interception infrastructure (`onPromptRendered` and `promptModifier` callbacks)
- Modifications are applied in `combinedPromptModifier` function

#### 3. **ComparisonChatOrchestrator Integration**
- Accepts optional `PromptModificationStore` in constructor
- Passes store to all `SingleModelChatHandler` instances
- Ensures prompt modifications work in multi-model scenarios

#### 4. **ModelComparisonViewProvider**
- Creates and manages `PromptModificationStore` instance
- Implements message handlers:
  - `get-model-prompt`: Retrieve modification for a model
  - `save-model-prompt`: Save/update modification
  - `reset-model-prompt`: Remove modification (reset to default)
- Passes store to both orchestrator and single handler

### UI Components

#### 5. **Modal Dialog** (HTML)
- Modal overlay with centered dialog
- Textarea for editing custom system message
- Checkbox to choose between prepend/replace mode
- Save, Reset, and Cancel buttons
- Info section with usage tips

#### 6. **Styling** (CSS)
- Modal overlay with backdrop
- Responsive dialog sizing (90% width, max 700px)
- VS Code theme integration
- Edit button states (normal/modified)
- Modal animations and transitions

#### 7. **JavaScript Logic** (script.js)
- `openPromptEditor(modelId)`: Opens modal and loads current modification
- `closePromptEditor()`: Closes modal and resets state
- `savePromptModification()`: Saves modification to extension
- `resetPromptToDefault()`: Removes modification
- `updateEditButtonState(modelId, hasModification)`: Updates button appearance
- `loadPromptModificationStatus()`: Loads modification status on init

## User Flow

### Editing a Prompt

1. User clicks **🛠️ Edit Prompt** button on a model's response header
2. Modal opens with current prompt pre-filled (if exists)
3. User edits the custom system message
4. User toggles replace/prepend mode
5. User clicks **Save** to persist changes
6. Modal closes and button shows modified indicator (blue dot)
7. Subsequent requests to that model use the custom prompt

### Resetting a Prompt

1. User opens prompt editor for a model
2. User clicks **Reset to Default**
3. Confirmation dialog appears
4. On confirm, modification is removed
5. Model returns to using default system prompt
6. Button loses modified indicator

## Data Flow

```
User clicks Edit → JavaScript calls openPromptEditor(modelId)
    ↓
sendMessage('get-model-prompt', { modelId })
    ↓
ModelComparisonViewProvider.handleWebviewMessage()
    ↓
promptModificationStore.getModification(modelId)
    ↓
Response sent back to webview
    ↓
Modal populated with current modification

User clicks Save → JavaScript calls savePromptModification()
    ↓
sendMessage('save-model-prompt', { modelId, modification })
    ↓
ModelComparisonViewProvider.handleWebviewMessage()
    ↓
promptModificationStore.setModification(modelId, modification)
    ↓
Modification saved to workspace state
    ↓
Response sent back to webview
    ↓
Modal closes, button updated

Chat request sent → ComparisonChatOrchestrator.sendChatMessageToMultipleModels()
    ↓
Creates/reuses SingleModelChatHandler with promptModificationStore
    ↓
SingleModelChatHandler.sendChatMessage()
    ↓
Loads stored modification for modelId
    ↓
Wraps agent intent with prompt interceptor
    ↓
combinedPromptModifier applies stored modification
    ↓
Modified prompt sent to model
```

## Persistence

- Modifications are stored in VS Code workspace state
- Key: `modelComparison.promptModifications`
- Format: `Record<string, PromptModification>`
- Survives:
  - VS Code window reload
  - Extension reload
  - Webview disposal/recreation

## UI Elements

### Edit Prompt Button
- Location: Top-right of each model response header
- States:
  - **Normal**: Gray border, "🛠️ Edit Prompt"
  - **Modified**: Blue border with dot indicator, "🛠️ Edit Prompt ●"
- Action: Opens prompt editor modal

### Prompt Editor Modal
- **Title**: "Edit Prompt for [Model Name]"
- **Fields**:
  - Large textarea for custom system message
  - Checkbox: "Replace entire system message (unchecked = prepend to existing)"
- **Buttons**:
  - Reset to Default (left)
  - Cancel (right)
  - Save (right, primary)
- **Info Section**: Tips and usage guidance

## Testing

### Manual Testing Checklist
✅ Open prompt editor for a model
✅ Enter custom prompt and save
✅ Verify button shows modified indicator
✅ Send chat request - verify custom prompt is used
✅ Reload webview - verify modification persists
✅ Edit prompt again - verify previous value loads
✅ Reset prompt - verify returns to default
✅ Test with multiple models - verify independent prompts
✅ Test prepend vs replace modes
✅ Close modal without saving - verify no changes
✅ Test Escape key to close modal
✅ Test clicking outside modal to close

## Files Modified

### New Files
- `src/extension/modelComparison/vscode-node/promptModificationStore.ts`

### Modified Files
1. `src/extension/modelComparison/vscode-node/singleModelChatHandler.ts`
   - Added promptModificationStore parameter
   - Implemented combinedPromptModifier
   - Applied modifications before sending to model

2. `src/extension/modelComparison/vscode-node/comparisonChatOrchestrator.ts`
   - Added promptModificationStore parameter
   - Pass store to SingleModelChatHandler instances

3. `src/extension/modelComparison/vscode-node/modelComparisonViewProvider.ts`
   - Created PromptModificationStore instance
   - Added message handlers for get/save/reset
   - Pass store to orchestrator and handler
   - Added modal HTML to webview

4. `assets/modelComparison/styles.css`
   - Added modal styles
   - Added edit button styles
   - Added modified indicator styles

5. `assets/modelComparison/script.js`
   - Added promptEditorState
   - Implemented prompt editing functions
   - Added event listeners for modal
   - Added edit buttons to response headers
   - Load modification status on init

## Integration Points

### Existing Prompt Interception
The implementation leverages the existing prompt interception infrastructure documented in `PROMPT_INTERCEPTION.md`:

- Uses `onPromptRendered` callback for capturing prompts
- Uses `promptModifier` callback for modifying prompts
- Works with `ChatParticipantRequestHandler` benefits
- Compatible with conversation history and tools

### Message Protocol
New message commands:
- `get-model-prompt`: Get modification for a model
- `save-model-prompt`: Save/update modification
- `reset-model-prompt`: Remove modification

## Future Enhancements

Potential improvements:
1. **Prompt Templates**: Pre-defined prompt variations
2. **Preview Mode**: Show prompt before sending
3. **Diff View**: Compare original vs modified prompts
4. **Share Prompts**: Export/import prompt configurations
5. **Prompt History**: Track prompt evolution
6. **Model Recommendations**: Suggest prompts per model type
7. **Syntax Highlighting**: Better prompt editing experience
8. **Token Counter**: Show estimated token usage

## Best Practices

1. **Always provide context**: Custom prompts should include task context
2. **Test modifications**: Verify custom prompts work as expected
3. **Use prepend mode**: Generally safer than full replacement
4. **Keep prompts concise**: Avoid overly long system messages
5. **Document purposes**: Note why certain prompts are used
6. **Reset when done**: Remove temporary test modifications
