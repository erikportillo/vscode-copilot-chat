# Context Collection in Model Comparison Panel

This document explains how to add context (open files, selected text, custom references) to the Model Comparison panel, similar to how the regular chat panel does it.

## Overview

The Model Comparison panel now supports automatic context collection from:
- **Active editor file** (when no selection is active)
- **Selected text** in the active editor
- **Custom references** (files, locations, or other values)

This context is automatically included in the prompt sent to each model through the `ChatParticipantRequestHandler`.

## How It Works

### Context as ChatPromptReferences

Context is added through **ChatPromptReferences**, which are part of the `ChatRequest.references` array. These references:
1. Are passed to `ChatParticipantRequestHandler`
2. Get converted to a `ChatVariablesCollection`
3. Are processed by prompt components (e.g., `<ChatVariables>`, `<ChatVariablesAndQuery>`)
4. Appear in the final prompt sent to the model

### The gatherEditorContext() Method

The `SingleModelChatHandler` includes a `gatherEditorContext()` helper method that:

```typescript
private gatherEditorContext(): ChatPromptReference[] {
    return this.instantiationService.invokeFunction(accessor => {
        const tabsAndEditorsService = accessor.get<ITabsAndEditorsService>(ITabsAndEditorsService);
        const activeTextEditor = tabsAndEditorsService.activeTextEditor;
        const references: ChatPromptReference[] = [];

        if (activeTextEditor) {
            const selection = activeTextEditor.selection;
            if (selection && !selection.isEmpty) {
                // Add the selection as a reference
                references.push({
                    id: 'vscode.implicit',
                    name: `file:${activeTextEditor.document.uri.path}`,
                    value: new Location(activeTextEditor.document.uri, selection),
                    modelDescription: `User's active selection`
                } as ChatPromptReference);
            } else {
                // Add the whole file if no selection
                references.push({
                    id: 'vscode.implicit',
                    name: `file:${activeTextEditor.document.uri.path}`,
                    value: activeTextEditor.document.uri,
                    modelDescription: `User's active file`
                } as ChatPromptReference);
            }
        }

        return references;
    });
}
```

## Usage Examples

### Example 1: Include Active Editor Context

```typescript
// Enable automatic context collection from the active editor
const result = await handler.sendChatMessage(
    modelId,
    "Explain this code",
    history,
    cancellationToken,
    onProgress,
    modelMetadata,
    onDelta,
    onCompletion,
    onToolCall,
    onPromptRendered,
    promptModifier,
    true  // includeEditorContext = true
);
```

### Example 2: Add Custom File References

```typescript
import { Uri } from 'vscode';

// Create custom file references
const customReferences: ChatPromptReference[] = [
    {
        id: 'custom.file.1',
        name: 'file:src/utils/helper.ts',
        value: Uri.file('/path/to/src/utils/helper.ts'),
        modelDescription: 'Helper utility file'
    }
];

const result = await handler.sendChatMessage(
    modelId,
    "Review these files",
    history,
    cancellationToken,
    onProgress,
    modelMetadata,
    onDelta,
    onCompletion,
    onToolCall,
    onPromptRendered,
    promptModifier,
    false,  // includeEditorContext = false
    customReferences  // additionalReferences
);
```

### Example 3: Combine Editor Context with Custom References

```typescript
import { Location, Uri, Range, Position } from 'vscode';

// Add both editor context and custom references
const customReferences: ChatPromptReference[] = [
    {
        id: 'custom.selection',
        name: 'file:config.json',
        value: new Location(
            Uri.file('/path/to/config.json'),
            new Range(new Position(10, 0), new Position(20, 0))
        ),
        modelDescription: 'Configuration section'
    }
];

const result = await handler.sendChatMessage(
    modelId,
    "Compare these code sections",
    history,
    cancellationToken,
    onProgress,
    modelMetadata,
    onDelta,
    onCompletion,
    onToolCall,
    onPromptRendered,
    promptModifier,
    true,  // Include active editor context
    customReferences  // Plus additional custom references
);
```

### Example 4: Working with Variables (like #file or #selection)

To simulate the behavior of chat variables like `#file` or `#selection`:

```typescript
import { Uri, Location, Range, Position } from 'vscode';

// Simulate #file variable
const fileReference: ChatPromptReference = {
    id: 'copilot.file',
    name: 'file:src/app.ts',
    value: Uri.file('/path/to/src/app.ts')
};

// Simulate #selection variable
const selectionReference: ChatPromptReference = {
    id: 'copilot.selection',
    name: 'selection',
    value: new Location(
        Uri.file('/path/to/src/app.ts'),
        new Range(new Position(5, 0), new Position(15, 0))
    )
};

const result = await handler.sendChatMessage(
    modelId,
    "Refactor this code",
    history,
    cancellationToken,
    onProgress,
    modelMetadata,
    onDelta,
    onCompletion,
    onToolCall,
    onPromptRendered,
    promptModifier,
    false,
    [fileReference, selectionReference]
);
```

## ChatPromptReference Structure

```typescript
interface ChatPromptReference {
    /**
     * A unique identifier for this reference
     */
    id: string;

    /**
     * The name/label of the reference (displayed to user)
     * For files, use format: "file:relativePath"
     */
    name: string;

    /**
     * The actual value - can be:
     * - Uri: for entire files
     * - Location: for specific file ranges/selections
     * - string: for text content
     * - unknown: for custom data
     */
    value: Uri | Location | string | unknown;

    /**
     * Optional description for the model (appears in prompt)
     */
    modelDescription?: string;

    /**
     * Optional range in the user's input where this reference appears
     */
    range?: [start: number, end: number];
}
```

## Reference ID Conventions

The extension uses specific ID patterns for different types of references:

- **`vscode.implicit`**: Automatically added context from active editor
- **`copilot.file`**: File references (like `#file` variable)
- **`copilot.selection`**: Selection references (like `#selection` variable)
- **`vscode.prompt.instructions`**: Prompt instruction files
- **`vscode.prompt.file`**: Prompt files
- **`custom.*`**: Custom application-specific references

## How Context Appears in Prompts

When you add ChatPromptReferences, they are processed by the prompt system and appear in the final prompt to the model. The exact format depends on the prompt components being used:

### For File References (Uri)
```
File: src/app.ts
```typescript
// File contents here
```

### For Selection References (Location)
```
Selection from src/app.ts (lines 5-15):
```typescript
// Selected code here
```

### For String Content
```
Custom content: Your string content here
```

## Integration Points

The context collection integrates with:

1. **ChatParticipantRequestHandler**: Receives the ChatRequest with references
2. **ChatVariablesCollection**: Wraps references for prompt components
3. **Prompt Components**: Process variables in TSX prompts
   - `<ChatVariables>`: Renders all chat variables
   - `<ChatVariablesAndQuery>`: Renders variables + user query
   - `<CurrentEditor>`: Can render active editor (separate from references)
   - `<CurrentSelection>`: Can render active selection (separate from references)

## Best Practices

1. **Use meaningful IDs**: Choose descriptive IDs for custom references
2. **Set modelDescription**: Helps the model understand context purpose
3. **Avoid duplicates**: Check if a reference already exists before adding
4. **Respect user privacy**: Only include files/content the user has access to
5. **Consider token limits**: Large files/selections consume token budget
6. **Use Location for selections**: Prefer Location over Uri when you have a specific range

## Debugging Context

To debug what context is being sent:

1. **Check the ChatRequest**: Inspect `chatRequest.references` array
2. **Use onPromptRendered callback**: See the final prompt with context included
3. **Monitor ChatVariablesCollection**: Check what variables are processed
4. **Use logging**: Add console.log to track reference flow

```typescript
console.log('References:', chatRequest.references.map(r => ({
    id: r.id,
    name: r.name,
    valueType: typeof r.value
})));
```

## Related Files

- `singleModelChatHandler.ts`: Main implementation
- `src/extension/prompt/common/chatVariablesCollection.ts`: Variable collection handling
- `src/extension/prompt/node/chatParticipantRequestHandler.ts`: Request processing
- `src/extension/prompts/node/panel/chatVariables.tsx`: Variable rendering in prompts
- `test/simulation/panelCodeMapperSimulator.ts`: Example of reference contribution
