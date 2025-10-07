# Prompt Interception in SingleModelChatHandler

This document describes the prompt interception and modification capabilities added to `SingleModelChatHandler` for the Model Comparison Panel.

## Overview

The hybrid approach combines the benefits of `ChatParticipantRequestHandler` (history management, conversation store, variable sanitization, etc.) with the ability to intercept and modify prompts before they're sent to language models.

## Key Features

### 1. **Prompt Capture**
Capture the exact prompt messages sent to each model, including:
- System messages with instructions
- User messages with context
- Assistant messages (in conversation history)
- Tool call definitions

### 2. **Prompt Modification**
Modify prompts before sending to models:
- Add custom instructions
- Remove or edit specific messages
- A/B test different prompt variations
- Customize prompts per model

### 3. **Prompt Analysis**
Analyze prompt composition:
- Count messages by role (system/user/assistant)
- Estimate token count
- Detect tool usage
- Format for display

## Usage

### Basic Prompt Capture

```typescript
import { SingleModelChatHandler } from './singleModelChatHandler';
import { Raw } from '@vscode/prompt-tsx';

await handler.sendChatMessage(
    modelId,
    message,
    history,
    cancellationToken,
    onProgress,
    modelMetadata,
    onDelta,
    onCompletion,
    onToolCall,
    // Capture the rendered prompt
    (modelId, messages) => {
        console.log(`Prompt for ${modelId}:`, messages);

        // Format for display
        const formatted = SingleModelChatHandler.formatPromptForDisplay(messages);
        console.log(formatted);

        // Analyze the prompt
        const analysis = SingleModelChatHandler.analyzePrompt(messages);
        console.log('Analysis:', analysis);
    }
);
```

### Prompt Modification

```typescript
await handler.sendChatMessage(
    modelId,
    message,
    history,
    cancellationToken,
    onProgress,
    modelMetadata,
    onDelta,
    onCompletion,
    onToolCall,
    undefined, // onPromptRendered
    // Modify the prompt before sending
    (modelId, messages) => {
        const modified = [...messages];

        // Add custom instruction to system message
        if (modified[0]?.role === Raw.ChatRole.System) {
            const content = modified[0].content;
            const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
            modified[0] = {
                ...modified[0],
                content: `[CUSTOM INSTRUCTION]\n\n${contentStr}` as any
            };
        }

        return modified;
    }
);
```

### Both Capture and Modify

```typescript
await handler.sendChatMessage(
    modelId,
    message,
    history,
    cancellationToken,
    onProgress,
    modelMetadata,
    onDelta,
    onCompletion,
    onToolCall,
    // First: capture the original prompt
    (modelId, messages) => {
        console.log('Original prompt:', messages);
        storePrompt(modelId, messages);
    },
    // Then: modify before sending
    (modelId, messages) => {
        return applyModifications(modelId, messages);
    }
);
```

## API Reference

### New Parameters

#### `onPromptRendered`
```typescript
(modelId: string, messages: Raw.ChatMessage[]) => void
```
Called when the prompt is rendered, before sending to the model.
- **modelId**: The model receiving this prompt
- **messages**: Array of chat messages (system, user, assistant)

#### `promptModifier`
```typescript
(modelId: string, messages: Raw.ChatMessage[]) => Raw.ChatMessage[]
```
Allows modifying the prompt before sending to the model.
- **modelId**: The model receiving this prompt
- **messages**: Original prompt messages
- **Returns**: Modified prompt messages

### Utility Methods

#### `formatPromptForDisplay`
```typescript
static formatPromptForDisplay(messages: Raw.ChatMessage[]): string
```
Formats prompt messages into a human-readable string.

**Example output:**
```
[Message 1: SYSTEM]
You are an expert AI programming assistant...

---

[Message 2: USER]
How do I implement authentication?
```

#### `analyzePrompt`
```typescript
static analyzePrompt(messages: Raw.ChatMessage[]): {
    systemMessageCount: number;
    userMessageCount: number;
    assistantMessageCount: number;
    totalTokensEstimate: number;
    hasTools: boolean;
}
```
Extracts key metrics from prompt messages.

**Example output:**
```typescript
{
    systemMessageCount: 1,
    userMessageCount: 2,
    assistantMessageCount: 1,
    totalTokensEstimate: 1250,
    hasTools: true
}
```

## Implementation Details

### How It Works

1. **Intent Wrapping**: Before `ChatParticipantRequestHandler` is created, we intercept the Agent intent's `invoke` method.

2. **BuildPrompt Interception**: We wrap the intent invocation's `buildPrompt` method to capture the rendered prompt.

3. **Handler Execution**: `ChatParticipantRequestHandler` proceeds normally with all its features (history, tools, conversation store, etc.).

4. **Non-Invasive**: The wrapping is applied only when callbacks are provided, making it backward compatible.

### Benefits of the Hybrid Approach

✅ **Keeps all `ChatParticipantRequestHandler` features:**
- History management and session tracking
- Conversation store persistence
- Variable sanitization (`.copilotignore` support)
- Authentication upgrade flows
- Intent detection
- Telemetry

✅ **Adds prompt interception:**
- View exact prompts sent to models
- Modify prompts per-model
- Compare prompts across models
- Build prompt editing UIs

✅ **Future-proof:**
- When you add history support, it will just work
- Benefits from future improvements to `ChatParticipantRequestHandler`
- Less code to maintain

## Examples

See `promptInterceptionExample.ts` for comprehensive usage examples including:

1. **Basic prompt capture and display**
2. **Adding custom system messages**
3. **Interactive prompt editor class**
4. **Comparing prompts across models**
5. **A/B testing different prompt variations**

## Type Reference

### `Raw.ChatMessage`
From `@vscode/prompt-tsx`:

```typescript
type ChatMessage =
    | SystemChatMessage
    | UserChatMessage
    | AssistantChatMessage
    | ToolChatMessage;

enum ChatRole {
    System = 'system',
    User = 'user',
    Assistant = 'assistant',
    Tool = 'tool'
}
```

Each message has:
- `role`: The message role (system/user/assistant/tool)
- `content`: The message content (string or structured content)
- Additional properties depending on the role

## Best Practices

### 1. **Store Prompts for Comparison**
```typescript
const prompts = new Map<string, Raw.ChatMessage[]>();

await handler.sendChatMessage(
    modelId,
    message,
    // ...
    (modelId, messages) => {
        prompts.set(modelId, messages);
    }
);
```

### 2. **Handle Content Type Safely**
```typescript
const content = typeof msg.content === 'string'
    ? msg.content
    : JSON.stringify(msg.content);
```

### 3. **Copy Before Modifying**
```typescript
const modified = [...messages]; // Shallow copy array
modified[0] = { ...modified[0], content: newContent }; // Copy object
```

### 4. **Use Type Assertions for Modifications**
```typescript
modified[0] = {
    ...modified[0],
    content: newContent as any // TSX types can be strict
};
```

## Testing

To test prompt interception:

1. Create a handler instance
2. Send a message with callbacks
3. Verify prompts are captured
4. Verify modifications are applied
5. Check the model receives the modified prompt

```typescript
let capturedPrompt: Raw.ChatMessage[] | null = null;
let wasModified = false;

await handler.sendChatMessage(
    'gpt-4',
    'test message',
    [],
    cancellationToken,
    undefined, undefined, undefined, undefined, undefined,
    (modelId, messages) => {
        capturedPrompt = messages;
    },
    (modelId, messages) => {
        wasModified = true;
        return messages;
    }
);

assert(capturedPrompt !== null, 'Prompt should be captured');
assert(wasModified, 'Modifier should be called');
```

## Future Enhancements

Potential additions to this feature:

1. **Prompt Templates**: Pre-defined prompt modifications
2. **Diff View**: Show differences between original and modified prompts
3. **Prompt History**: Track prompt evolution across conversation
4. **Token Counting**: Accurate token counting per model
5. **Prompt Validation**: Warn about overly long prompts or missing context
6. **Export/Import**: Save and load prompt configurations

## Troubleshooting

### Callbacks not being called
- Ensure both `onPromptRendered` and/or `promptModifier` are provided
- Check that the intent invocation succeeds
- Verify `ChatParticipantRequestHandler` is being created

### Type errors with message content
- Use type assertions: `content as any`
- Handle both string and structured content types
- Copy messages before modifying

### Modifications not applied
- Return the modified messages array
- Don't mutate the original array
- Create new message objects with spread operator

## Related Files

- `singleModelChatHandler.ts` - Main implementation
- `promptInterceptionExample.ts` - Usage examples
- `chatParticipantRequestHandler.ts` - The handler we wrap
- `agentIntent.ts` - The intent whose invocation we intercept
