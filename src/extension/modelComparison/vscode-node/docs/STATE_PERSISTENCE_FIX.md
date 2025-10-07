# State Persistence Fix

## Problem

When navigating away from the Model Comparison panel to another panel and then returning, the chat messages and UI state were not persisted. The panel would reload with an empty state, losing all conversation history.

## Root Cause

The webview was not using VS Code's state persistence API (`vscode.getState()` and `vscode.setState()`). The chat state, tool call section states, and prompt modification states were only stored in memory, which gets cleared when the webview is hidden and recreated.

## Solution

Implemented state persistence using VS Code's webview state management API:

### 1. State Management Functions

Added two core functions to manage state persistence:

```javascript
/**
 * Save the current state to VS Code's webview state
 */
function saveState() {
    try {
        const state = {
            chatMessages: chatState.messages,
            toolCallOpenSections: Array.from(toolCallState.openSections.entries()),
            modifiedModels: Array.from(promptEditorState.modifiedModels)
        };
        vscode.setState(state);
    } catch (error) {
        console.error('Failed to save state:', error);
    }
}

/**
 * Restore state from VS Code's webview state
 */
function restoreState() {
    try {
        const state = vscode.getState();
        if (state) {
            // Restore chat messages
            if (state.chatMessages && Array.isArray(state.chatMessages)) {
                chatState.messages = state.chatMessages;
                // Clear any streaming state from restored messages
                chatState.messages.forEach(msg => {
                    if (msg.type === 'assistant') {
                        msg.isStreaming = false;
                        delete msg.streamingResponses;
                    }
                });
            }

            // Restore tool call open sections
            if (state.toolCallOpenSections && Array.isArray(state.toolCallOpenSections)) {
                toolCallState.openSections = new Map(state.toolCallOpenSections);
            }

            // Restore modified models set
            if (state.modifiedModels && Array.isArray(state.modifiedModels)) {
                promptEditorState.modifiedModels = new Set(state.modifiedModels);
            }

            console.log(`🔄 Restored state: ${chatState.messages.length} messages`);
        }
    } catch (error) {
        console.error('Failed to restore state:', error);
    }
}
```

### 2. State Restoration on Initialization

Added `restoreState()` call at the beginning of the `init()` function:

```javascript
async function init() {
    console.log('🚀 Model Comparison initialized');

    // Restore state from previous session
    restoreState();

    // ... rest of initialization
}
```

### 3. State Saving Trigger Points

Added `saveState()` calls at all points where the state changes:

1. **When messages are added**:
   ```javascript
   chatState.messages.push(userMessage);
   chatState.messages.push(assistantMessage);
   saveState(); // Save state after adding messages
   ```

2. **When messages are updated**:
   ```javascript
   assistantMessage.isStreaming = false;
   saveState(); // Save state after updating message
   ```

3. **When chat is cleared**:
   ```javascript
   function clearChat() {
       chatState.messages = [];
       saveState(); // Save state after clearing
       updateChatUI();
   }
   ```

4. **When tool call sections are toggled**:
   ```javascript
   function captureToolCallSectionStates() {
       // ... capture logic
       saveState(); // Save state when tool call sections change
   }
   ```

5. **When prompt modifications change**:
   ```javascript
   if (hasModification) {
       promptEditorState.modifiedModels.add(modelId);
   } else {
       promptEditorState.modifiedModels.delete(modelId);
   }
   saveState(); // Save state when prompt modifications change
   ```

6. **When prompt modifications are loaded**:
   ```javascript
   async function loadPromptModificationStatus() {
       // ... load modifications
       saveState(); // Save state after loading modifications
   }
   ```

### 4. Streaming State Cleanup

When restoring state, any streaming-related properties are cleaned up since streaming is not persisted:

```javascript
chatState.messages.forEach(msg => {
    if (msg.type === 'assistant') {
        msg.isStreaming = false;
        delete msg.streamingResponses;
    }
});
```

## Testing

To verify the fix works:

1. Open the Model Comparison panel
2. Select some models and send a chat message
3. Wait for responses to complete
4. Toggle some tool call sections open/closed
5. Navigate to another panel (e.g., Explorer, Source Control)
6. Navigate back to the Model Comparison panel
7. Verify that:
   - All chat messages are still visible
   - Tool call sections retain their open/closed state
   - Model selection is preserved
   - Prompt modifications are preserved

## State Data Structure

The persisted state includes:

```typescript
interface PersistedState {
    chatMessages: ChatMessage[];           // All conversation messages
    toolCallOpenSections: [string, boolean][]; // Map entries of section states
    modifiedModels: string[];              // Set of model IDs with custom prompts
}
```

## Benefits

1. **User Experience**: Users can switch between panels without losing their conversation
2. **Data Preservation**: All chat history, tool calls, and UI state are maintained
3. **Seamless Navigation**: Panel state is automatically restored when returning
4. **No Performance Impact**: State is saved/loaded efficiently using native VS Code APIs

## Files Modified

- `/assets/modelComparison/script.js`: Added state persistence logic
