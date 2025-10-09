# Model Comparison Panel - User Guide

## Overview

The **Model Comparison Panel** is a powerful feature in GitHub Copilot Chat that allows you to compare responses from multiple AI models side-by-side. This enables you to:

- **Compare model behaviors** on the same prompts
- **Control tool execution** with fine-grained approval mechanisms
- **Analyze differences** in how models approach problems
- **Customize prompts** per model for experimentation

## Getting Started

### Opening the Panel

1. Look for **Model Comparison** in VS Code's Panel area (bottom of the screen)
2. Click on "Model Comparison" to open the panel
3. The panel will dock in the bottom panel area alongside Terminal, Output, etc.

### Initial Setup

When you first open the panel, you'll see:
- A **model selection area** showing all available language models
- An empty **chat interface** ready for your first comparison
- A **send button** to submit messages

## Selecting Models for Comparison

### Choosing Models

1. In the **Model Selection** area at the top, you'll see a list of available models (e.g., GPT-4, Claude Sonnet, etc.)
2. **Click the checkboxes** next to 2-4 models you want to compare
3. The selected count will update to show how many models are active
4. Your selections are **automatically saved** and will persist between VS Code sessions

**Tips:**
- Select at least 2 models for meaningful comparison
- You can select up to 4 models simultaneously
- Different models may excel at different tasks - experiment!

### Model Information

Each model card shows:
- **Model name** (e.g., "GPT-4", "Claude Sonnet 4")
- **Provider** (e.g., "OpenAI", "Anthropic")
- **Checkbox** for selection
- **Edit icon** (🛠️) for customizing the system prompt (see Advanced Features)

## Using the Chat Interface

### Sending Messages

1. Type your question or prompt in the **input field** at the bottom
2. Click the **Send** button or press `Enter`
3. All selected models will receive **identical prompts** simultaneously
4. Responses will stream in **side-by-side** in real-time

**Example:**
```
You: "Explain the difference between async/await and Promises in JavaScript"

[GPT-4 Response]        [Claude Sonnet Response]        [Gemini Response]
Async/await is...       Promises and async/await...     JavaScript async...
```

### Understanding the Response Layout

- **User messages** appear at the top with your original question
- **Model responses** are displayed in columns, one per selected model
- Each column shows:
  - Model name and icon
  - Streaming response text
  - Tool calls (if any - see Tool Execution Control)
  - Error messages (if the model failed)

### Message History

- All messages and responses are preserved in the chat history
- Scroll up to see previous comparisons
- Use the **Clear Chat** button to start fresh

## Tool Execution Control

One of the most powerful features of the Model Comparison Panel is **tool execution control**. When models want to use tools (like searching your workspace, reading files, or running commands), you can review and approve them before they execute.

### What Are Tools?

Tools are actions that AI models can take to gather information or perform tasks:
- 🔍 **Workspace Search**: Finding files or code in your project
- 📄 **File Reading**: Reading specific files for context
- 🔧 **Code Analysis**: Analyzing code structure or dependencies
- And more...

### Tool Call Preview

When a model wants to use a tool, you'll see:

1. **Automatic Pause**: The response pauses before executing tools
2. **Tool Call Preview**: A collapsible section showing:
   - Tool name (e.g., "Workspace Search")
   - Tool parameters (what it's searching for)
   - Display message explaining what the tool will do
3. **Approval Buttons**: Options to approve or cancel

**Example:**
```
┌─ Tool Calls (2) ──────────────────┐
│ 🔍 Workspace Search                │
│ Searching for: "authentication"   │
│                                    │
│ 📄 Read File                       │
│ File: src/auth/login.ts            │
└────────────────────────────────────┘
  [✅ Approve All]  [❌ Cancel All]
```

### Approval Options

#### Global Approval (All Models)
- **Approve All Tools**: Approve and execute all tool calls from all models
- **Cancel All Tools**: Cancel all pending tool calls from all models

#### Per-Model Approval
Each model has its own approval buttons:
- **✅ Approve**: Approve and execute tools for this specific model
- **❌ Cancel**: Cancel tools for this specific model

**Use Cases:**
- **Compare tool strategies**: See which tools different models choose
- **Selective execution**: Let one model execute tools, block others
- **Safety**: Review potentially expensive or risky operations before execution

### Tool Call Comparison

When comparing tool calls across models:

1. **Expand each model's tool calls** to see what they're requesting
2. **Compare approaches**: Different models may use different tools for the same task
3. **Analyze efficiency**: Some models may request fewer tools or more targeted searches
4. **Make informed decisions**: Approve the most appropriate tool strategy

## Advanced Features

### Customizing System Prompts

You can customize the system prompt (instructions) for each model individually:

1. Click the **🛠️ icon** next to any model in the selection area
2. The **Prompt Editor** modal will open
3. Edit the system message in the text area:
   - Add custom instructions
   - Modify behavior guidelines
   - Set response format preferences
4. Click **Save** to apply changes
5. The model card will show a **blue dot** indicator when using a custom prompt

**Example Custom Prompts:**
```
Model A: "Always provide code examples in TypeScript with detailed comments"
Model B: "Focus on security best practices and potential vulnerabilities"
Model C: "Explain concepts at a beginner level with analogies"
```

### Resetting Custom Prompts

To restore the default system prompt:
1. Open the prompt editor for a model
2. Click the **Reset to Default** button
3. The blue indicator will disappear

### Viewing Modified Models

Models with custom prompts show:
- **Blue dot** indicator next to the model name
- Visual distinction in the model selection area

## Tips and Best Practices

### Effective Comparisons

1. **Start broad, then narrow**: Begin with general questions, then drill into specifics
2. **Test edge cases**: Try unusual or ambiguous prompts to see how models differ
3. **Compare reasoning**: Look at *how* models explain things, not just *what* they say
4. **Tool usage patterns**: Pay attention to which tools models prefer

### Performance Optimization

1. **Select fewer models** for faster responses
2. **Clear chat history** periodically to improve performance
3. **Cancel unwanted requests** promptly to free up resources

### Debugging and Troubleshooting

If a model fails to respond:
- Check the **error message** in that model's column
- Verify you're **authenticated** with the model provider
- Try **selecting different models** to isolate the issue
- Use the **Clear Chat** button to reset state

## Keyboard Shortcuts

- **`Enter`**: Send message (when input field is focused)
- **`Escape`**: Close prompt editor modal

## Understanding the UI

### Status Indicators

- **Loading spinner**: Model is generating a response
- **Blue dot**: Model has a custom system prompt
- **Checkbox**: Model selection state
- **Tool call count**: Number of pending tool calls (e.g., "Tool Calls (2)")

### Color Coding

- **User messages**: Distinct background color
- **Model responses**: Clean, separated columns
- **Error states**: Red text and error styling
- **Tool previews**: Highlighted sections with icons

## Common Use Cases

### 1. Comparing Code Quality
```
Prompt: "Refactor this function to improve readability"
Compare: Code style, optimization approaches, comments
```

### 2. Evaluating Explanations
```
Prompt: "Explain how React hooks work"
Compare: Clarity, depth, examples provided
```

### 3. Testing Problem-Solving
```
Prompt: "Find the bug in this code: [paste code]"
Compare: Debugging strategies, accuracy, explanations
```

### 4. Analyzing Tool Usage
```
Prompt: "What authentication mechanisms are used in this project?"
Compare: Which files each model examines, search strategies
```

## Limitations and Considerations

- **Resource intensive**: Running multiple models simultaneously uses more API quota
- **Response timing**: Models stream at different speeds; faster doesn't mean better
- **Context limits**: Each model may have different context window sizes
- **Tool capabilities**: Not all models may support the same tools

## Troubleshooting

### "Please select at least one model"
**Solution**: Check at least one model in the Model Selection area

### Responses not appearing
**Solution**: Check Developer Console (Help → Toggle Developer Tools) for errors

### Tool calls stuck in pending state
**Solution**: Click "Cancel All Tools" and retry the request

### Models showing authentication errors
**Solution**: Ensure you're signed in to GitHub Copilot and have access to the models

## Feedback and Support

The Model Comparison Panel is designed to help you make informed decisions about model selection and understand model behaviors. If you encounter issues or have suggestions:

1. Check the **Developer Console** for error messages
2. File an issue on the GitHub repository
3. Share feedback through VS Code's feedback channels

---

**Happy Comparing! 🚀**