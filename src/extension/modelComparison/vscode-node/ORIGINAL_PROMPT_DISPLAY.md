# Original System Message Display Enhancement

## Overview

This enhancement adds the ability to view the original/default system message in the prompt editor modal, so users can see what the baseline prompt is before making modifications.

## Problem Solved

Previously, when opening the prompt editor for a model that had no custom modifications, the modal would show a blank textarea with no context about what the default system message actually was. This made it difficult for users to:
- Understand what they were modifying
- Make informed decisions about prepend vs. replace mode
- See the starting point for their customizations

## Solution

### 1. Prompt Capture Method

Added `captureOriginalSystemMessage()` method to `SingleModelChatHandler`:
- Renders a prompt using the intent system without sending it to the model
- Extracts the system message from the rendered prompt
- Returns the system message text for display

**Implementation approach:**
- Creates a temporary `ChatRequest` with test message
- Temporarily wraps the agent intent's `invoke` method
- Intercepts the `buildPrompt` call to capture rendered messages
- Extracts system message from the captured messages
- Restores original intent behavior

### 2. Message Handler Update

Updated `get-model-prompt` handler in `ModelComparisonViewProvider`:
- Calls `captureOriginalSystemMessage()` when loading prompt data
- Passes model metadata for accurate prompt rendering
- Returns original system message along with modification data

### 3. UI Enhancement

**Modal Layout:**
Now includes two sections:
1. **Original System Message (read-only)**: Shows the baseline prompt
2. **Custom System Message**: User's custom modifications

**Display characteristics:**
- Read-only scrollable box with max-height of 200px
- Monospace font matching VS Code editor style
- Loading state while fetching original message
- Error handling if capture fails

### 4. Styling

Added CSS for original prompt display:
- `.original-prompt-display`: Container with border and padding
- `.original-system-message-content`: Pre-wrapped text with monospace font
- Consistent with VS Code theme colors
- Scrollable for long prompts

## User Experience

### Before
1. User clicks "Edit Prompt"
2. Modal shows empty textarea
3. User has no context about what to modify

### After
1. User clicks "Edit Prompt"
2. Modal loads and shows "Loading original system message..."
3. Original system message appears in read-only section
4. User can see the default prompt and decide how to customize it
5. Custom modifications are shown in editable textarea below

## Technical Details

### Files Modified

1. **`singleModelChatHandler.ts`**
   - Added `captureOriginalSystemMessage()` method
   - Uses intent system to render prompt without execution
   - Extracts system message from rendered messages

2. **`modelComparisonViewProvider.ts`**
   - Updated `get-model-prompt` handler
   - Captures original system message on load
   - Returns both modification and original prompt

3. **`modelComparisonViewProvider.ts` (HTML)**
   - Added original prompt display section
   - Positioned above custom message textarea

4. **`script.js`**
   - Updated `openPromptEditor()` to display original message
   - Shows loading state and error handling
   - Populates original message element

5. **`styles.css`**
   - Added `.original-prompt-display` container styles
   - Added `.original-system-message-content` text styles
   - Made scrollable and theme-aware

### Prompt Capture Flow

```
User opens prompt editor
    ↓
JavaScript calls openPromptEditor(modelId)
    ↓
sendMessage('get-model-prompt', { modelId })
    ↓
ModelComparisonViewProvider.handleWebviewMessage()
    ↓
singleModelChatHandler.captureOriginalSystemMessage(modelId, 'test', metadata)
    ↓
Create temporary ChatRequest
    ↓
Wrap agent intent's invoke method
    ↓
Intercept buildPrompt call
    ↓
Render prompt with intent system
    ↓
Extract system message from rendered messages
    ↓
Restore original intent behavior
    ↓
Return system message text
    ↓
Send response to webview with originalSystemMessage
    ↓
Populate modal with original and custom messages
```

## Benefits

### For Users
- **Context**: See what the default prompt is
- **Informed decisions**: Better understand prepend vs. replace
- **Learning**: Understand how prompts are structured
- **Reference**: Keep original visible while editing

### For Development
- **Non-invasive**: Doesn't modify actual request flow
- **Reusable**: Method can be used for other purposes
- **Safe**: Doesn't send actual requests
- **Fast**: Lightweight prompt rendering only

## Edge Cases Handled

1. **Loading State**: Shows "Loading..." while fetching
2. **Error State**: Shows error message if capture fails
3. **Empty State**: Shows fallback message if no system message found
4. **Long Prompts**: Scrollable display for lengthy system messages

## Future Enhancements

Potential improvements:
1. **Syntax Highlighting**: Highlight markdown or code in system messages
2. **Diff View**: Show differences between original and custom
3. **Copy Button**: Allow copying original message
4. **Collapse/Expand**: Toggle visibility of original message
5. **Search**: Find text within original message
6. **Version History**: Show how system messages change over time

## Testing Checklist

✅ Open prompt editor for model with no modifications
✅ Verify original system message loads and displays
✅ Verify custom message textarea remains independent
✅ Test loading state appears briefly
✅ Test error handling when capture fails
✅ Verify scrolling works for long system messages
✅ Test with different models (different prompt templates)
✅ Verify styling matches VS Code theme
✅ Test modal remains functional with new section

## Example System Message

When opening the editor for GPT-4o, users might see:

```
Original System Message (read-only):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You are an expert AI programming assistant, working
with a user in the VS Code editor...

[Full agent prompt with instructions, tools, etc.]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Custom System Message:
[Empty or user's custom prompt]
```

This gives users full visibility into what they're modifying.
