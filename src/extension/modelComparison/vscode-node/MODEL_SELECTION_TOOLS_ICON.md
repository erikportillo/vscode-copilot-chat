# Model Selection Tools Icon Feature

## Overview
Added a tools icon (⚙️) to the model selection section that appears for selected models and allows prompt customization before sending chat requests.

## Features

### Visual Indicator
- **Tools icon**: Appears in the bottom-right corner of selected model cards
- **Modified state**: Shows a blue dot indicator when a model has a custom prompt
- **Hover effect**: Scales up slightly and changes opacity on hover
- **Click action**: Opens the prompt editor modal for that specific model

### Behavior
1. **Selection-based**: Icon only appears for models that are currently selected
2. **Dynamic**: When a new model is selected, the tools icon appears immediately
3. **State tracking**: The icon reflects whether a model has a custom prompt (modified state)
4. **Non-blocking**: Clicking the icon doesn't toggle the model selection

## Implementation Details

### JavaScript Changes (`script.js`)

#### State Management
Added `modifiedModels` Set to `promptEditorState`:
```javascript
const promptEditorState = {
    isOpen: false,
    currentModelId: null,
    currentModification: null,
    originalSystemMessage: '',
    modifiedModels: new Set() // Track which models have custom prompts
};
```

#### Model List Rendering
Updated `renderModelList()` to:
1. Check if each model has modifications
2. Create tools icon button for selected models
3. Apply `modified` class when model has custom prompt
4. Prevent event bubbling to avoid toggling selection

#### Prompt Editor Integration
- **`openPromptEditorForModel(modelId)`**: New helper function to open editor from model selection
- **Updated `savePromptModification()`**:
  - Adds/removes model from `modifiedModels` Set
  - Re-renders model list to update icon states
  - Maintains modified state across UI updates

### CSS Styling (`styles.css`)

#### Tools Icon Styling
```css
.model-tools-icon {
    position: absolute;
    bottom: 6px;
    right: 6px;
    background: var(--vscode-button-secondaryBackground);
    border: 1px solid var(--vscode-button-secondaryBorder, transparent);
    padding: 2px 6px;
    border-radius: 3px;
    cursor: pointer;
    font-size: 12px;
    opacity: 0.85;
    transition: background-color 0.2s, border-color 0.2s, transform 0.1s;
}
```

#### Modified State
```css
.model-tools-icon.modified {
    border-color: var(--vscode-charts-blue);
    background-color: var(--vscode-inputOption-activeBackground);
}

.model-tools-icon.modified::before {
    content: '●';
    color: var(--vscode-charts-blue);
    font-size: 8px;
    position: absolute;
    top: -2px;
    right: -2px;
}
```

#### Layout Adjustments
- Updated `.model-info` padding to accommodate the tools icon
- Added `padding-bottom: 20px` for proper spacing

## User Workflow

### Customizing Prompts Before Chat
1. **Select models** in the model selection section
2. **Click the tools icon (⚙️)** on any selected model
3. **Edit the prompt** in the modal that opens
4. **Save** to apply the custom prompt
5. **Send chat request** - the model will use the custom prompt

### Visual Feedback
- **Default state**: Grey tools icon with subtle opacity
- **Hover**: Icon scales up and becomes fully opaque
- **Modified**: Blue border and dot indicator
- **Tooltip**: Shows "Customize prompt" or "Edit custom prompt"

## Benefits

1. **Proactive customization**: Set prompts before starting a comparison
2. **Clear visibility**: Easy to see which models have custom prompts
3. **Consistent UX**: Same prompt editor modal used from both locations
4. **State persistence**: Modified state persists across UI updates
5. **Non-intrusive**: Icon appears only for selected models

## Testing

### Test Cases
1. ✅ Select a model → Tools icon appears
2. ✅ Click tools icon → Prompt editor opens for that model
3. ✅ Customize and save → Icon shows modified state (blue dot)
4. ✅ Select another model → Tools icon appears for new model
5. ✅ Deselect a model → Tools icon disappears
6. ✅ Reset to default → Blue dot disappears
7. ✅ Send chat request → Custom prompts are used

## Related Files
- `assets/modelComparison/script.js` - Tools icon rendering and event handling
- `assets/modelComparison/styles.css` - Tools icon styling and layout
- `promptModificationStore.ts` - Backend storage (unchanged, already working)
- `singleModelChatHandler.ts` - Per-model prompt application (unchanged)

## Future Enhancements
- Batch edit: Edit prompts for multiple models at once
- Templates: Save and reuse common prompt modifications
- Quick presets: One-click prompt templates (e.g., "Be more concise")
