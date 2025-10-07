# Clear Chat Button

## Feature Overview

Added a clear chat button to the chat input section that allows users to quickly clear all chat messages and responses from the model comparison panel.

## Implementation Details

### Visual Design

- **Icon**: Trash can/delete icon from VS Code's icon library
- **Position**: Left side of the chat actions area, before the approve/cancel/stop/send buttons
- **Visibility**: Only shown when:
  - There are chat messages present
  - Not currently loading/streaming responses
- **Styling**:
  - Semi-transparent (opacity: 0.7) by default
  - Full opacity on hover
  - Subtle hover background effect

### User Experience

1. **Automatic Show/Hide**: Button appears only when there are messages to clear
2. **One-Click Clear**: No confirmation dialog for better UX - users can quickly clear and start fresh
3. **State Persistence**: Clearing chat also updates the persisted state, so the cleared state is maintained when switching panels
4. **Visual Feedback**: Button hover state provides clear indication of interactivity

### Technical Implementation

#### HTML (modelComparisonViewProvider.ts)
```html
<button id="clear-chat-button" class="icon-button clear-chat-button"
        title="Clear all chat messages" style="display: none;">
    <!-- Trash can SVG icon -->
</button>
```

#### CSS (styles.css)
```css
.clear-chat-button {
    opacity: 0.7;
}

.clear-chat-button:hover {
    opacity: 1;
    background-color: var(--vscode-button-secondaryHoverBackground);
}
```

#### JavaScript (script.js)

**Event Listener Setup:**
```javascript
const clearChatButton = document.getElementById('clear-chat-button');
if (clearChatButton) {
    clearChatButton.onclick = () => {
        if (chatState.messages.length > 0) {
            clearChat();
        }
    };
}
```

**Visibility Control:**
Updated `updateSendButton()` function to control clear button visibility:
```javascript
if (clearChatButton) {
    clearChatButton.style.display =
        (chatState.messages.length > 0 && !chatState.isLoading) ? 'flex' : 'none';
}
```

### Integration with Existing Features

- **State Persistence**: Works seamlessly with the state persistence system - cleared state is saved
- **Loading State**: Button is hidden during streaming/loading to prevent accidental clears
- **Chat State**: Uses the existing `clearChat()` function which properly clears messages and updates UI
- **Debug Access**: Available via `window.modelComparison.clearChat()` for debugging

### Files Modified

1. **`/src/extension/modelComparison/vscode-node/modelComparisonViewProvider.ts`**
   - Added clear chat button HTML with trash icon

2. **`/assets/modelComparison/styles.css`**
   - Added `.clear-chat-button` styling with hover effects

3. **`/assets/modelComparison/script.js`**
   - Added event listener for clear button
   - Updated `updateSendButton()` to control clear button visibility

## User Benefits

1. **Quick Reset**: One-click way to start a fresh conversation
2. **Clean UI**: Button only appears when needed, reducing clutter
3. **No Interruptions**: No confirmation dialogs for faster workflow
4. **Visual Clarity**: Clear trash icon makes the function immediately obvious
5. **Smart Behavior**: Automatically hides during loading to prevent accidents

## Future Enhancements

Possible future improvements:
- Optional confirmation dialog via settings
- Keyboard shortcut for clearing chat
- Undo functionality to restore cleared messages
- Clear with history preservation (similar to browser history)
