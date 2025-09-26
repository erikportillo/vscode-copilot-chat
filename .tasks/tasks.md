# TASKS: Model Comparison Panel Implementation

## Overview
Create a dedicated model comparison panel that provides a "carbon copy UX clone" of the regular chat experience while enabling precise control over tool execution for meaningful model comparisons.

## Architecture Goals
- **Identical Backend**: Use the real `ChatParticipantRequestHandler` pipeline with identical prompts and context resolution
- **Tool Execution Control**: Pause before tool calls to allow user approval/comparison
- **Dedicated UI**: WebView panel with full control over layout and interaction
- **Model Orchestration**: Run multiple models simultaneously with synchronized control

## Development Philosophy: Progressive Enhancement

This implementation follows a **progressive enhancement approach** to ensure each step is fully testable and functional:

1. **Phase 1**: Start with static UI and mock data
   - Build working WebView panel with fake responses
   - Establish all UI patterns and message passing
   - Enable full manual testing of user experience

2. **Phase 2**: Add real model integration incrementally
   - Single model first, then multi-model
   - Real API calls replace mock responses
   - Maintain all UI functionality throughout

3. **Phase 3**: Add advanced features on solid foundation
   - Tool execution control
   - Response analysis and comparison
   - Performance optimizations

**Key Benefits**:
- Each task produces working, testable functionality
- UI/UX can be refined early with mock data
- Technical integration happens on proven foundation
- Easy rollback points at each major milestone

---

## Phase 1: Core Infrastructure (Progressive Enhancement Approach)

> **Development Philosophy**: Start with mock data and static UI, then progressively enhance with real functionality. Each task should be fully testable in isolation.

### [DONE] TASK 1A: Basic WebView Panel Foundation
**Objective**: Create minimal working WebView side panel that appears in VS Code

**Implementation Details**:
- Create `src/extension/modelComparison/vscode-node/` directory structure
- Implement `ModelComparisonViewProvider` class implementing `vscode.WebviewViewProvider`
- Use `vscode.window.registerWebviewViewProvider` to register the side panel view
- Create basic HTML template in `assets/modelComparison/index.html`
- Add view definition to package.json

**Key Files**:
- `src/extension/modelComparison/vscode-node/modelComparisonViewProvider.ts`
- `assets/modelComparison/index.html`
- `assets/modelComparison/styles.css`
- Update `package.json` views and viewsContainers configuration

**Package.json Changes**:
```json
"viewsContainers": {
  "activitybar": [
    {
      "id": "model-comparison",
      "title": "Model Comparison",
      "icon": "$(compare-changes)"
    }
  ]
},
"views": {
  "model-comparison": [
    {
      "id": "model-comparison-panel",
      "name": "Model Comparison",
      "type": "webview"
    }
  ]
}
```

**Manual Testing Steps**:
1. Run `Developer: Reload Window` from Command Palette
2. Check Activity Bar for new "Model Comparison" icon (compare-changes icon)
3. Click icon → verify side panel opens
4. Verify panel shows "Model Comparison Panel" text

**Acceptance Criteria**:
- Side panel appears in Activity Bar
- Panel opens when clicked
- Shows basic static content
- No console errors

**Rollback Point**: Tag as `model-comparison-basic-panel`

---

### TASK 1B: Message Passing Infrastructure
**Objective**: Enable bidirectional communication between extension and webview

**Prerequisites**: Task 1A must be completed and tested

**Implementation Details**:
- Add message passing setup in `ModelComparisonViewProvider`
- Create command handling in webview JavaScript
- Implement basic request/response pattern
- Add error handling for message failures

**Key Files**:
- Update `src/extension/modelComparison/vscode-node/modelComparisonViewProvider.ts`
- Update `assets/modelComparison/script.js`

**Manual Testing Steps**:
1. Open Model Comparison panel
2. Open Developer Tools → Console
3. Send test command from webview
4. Verify extension receives and responds to message
5. Check for proper error handling with invalid messages

**Acceptance Criteria**:
- Extension can send messages to webview
- Webview can send messages to extension
- Basic error handling works
- Messages logged in developer console for debugging

---

### TASK 1C: Model Selection UI with Mock Data
**Objective**: Create model selection interface using mock model data

**Prerequisites**: Task 1B must be completed and tested

**Implementation Details**:
- Add dropdown/selection UI for available models (use mock data)
- Implement workspace state storage for model selections
- Create basic model metadata structure
- Add model selection persistence

**Mock Models Data**:
```typescript
const MOCK_MODELS = [
  { id: 'gpt-4', name: 'GPT-4', provider: 'OpenAI' },
  { id: 'claude-3', name: 'Claude 3', provider: 'Anthropic' },
  { id: 'gpt-3.5', name: 'GPT-3.5 Turbo', provider: 'OpenAI' }
];
```

**Key Files**:
- `src/extension/modelComparison/vscode-node/modelSelectionService.ts`
- Update webview HTML/CSS/JS for model selection UI

**Manual Testing Steps**:
1. Open Model Comparison panel
2. Verify model dropdown shows mock models
3. Select 2-3 models
4. Reload VS Code → verify selections persist
5. Test with different combinations

**Acceptance Criteria**:
- Model selection UI is functional
- Can select 2-4 models simultaneously
- Selections persist across VS Code sessions
- UI shows selected models clearly

---

### TASK 1D: Basic Chat Interface with Mock Responses
**Objective**: Create chat input and response display using mock data

**Prerequisites**: Task 1C must be completed and tested

**Implementation Details**:
- Add input field and send button to webview
- Create side-by-side response display layout
- Implement mock response generation for selected models
- Add basic message history display

**Mock Response Logic**:
```typescript
function generateMockResponse(model: string, message: string): string {
  return `[${model}] Mock response to: "${message}"`;
}
```

**Key Files**:
- Update webview HTML/CSS for chat interface
- Update webview JavaScript for chat functionality
- Update `ModelComparisonViewProvider` for mock response handling

**Manual Testing Steps**:
1. Select 2-3 models in comparison panel
2. Type message in input field
3. Click send button
4. Verify mock responses appear for each selected model
5. Test multiple messages to verify history

**Acceptance Criteria**:
- Chat input and send functionality works
- Side-by-side response display for selected models
- Message history is maintained
- UI is responsive and follows VS Code theming

**Rollback Point**: Tag as `model-comparison-mock-chat`

---

### TASK 2: Real Model Integration Foundation
**Objective**: Replace mock data with real model selection from existing VS Code language model API

**Prerequisites**: Task 1D must be completed and tested
**Dependencies**: Requires understanding of existing model selection in codebase

**Implementation Details**:
- Replace mock model data with real available language models
- Integrate with existing endpoint provider system
- Add model capability detection
- Create model configuration storage service

**Key Files**:
- Update `src/extension/modelComparison/vscode-node/modelSelectionService.ts`
- `src/extension/modelComparison/vscode-node/modelConfigurationStore.ts`

**Manual Testing Steps**:
1. Verify panel shows actual available models (not mock data)
2. Test model selection with real OpenAI/Anthropic models
3. Verify model configurations are stored properly
4. Test with different authentication states

**Acceptance Criteria**:
- Shows real available language models
- Model selection works with actual model endpoints
- Configurations persist and load correctly
- Handles authentication requirements

---

### TASK 3: Single Model Chat Integration
**Objective**: Enable real chat with one selected model (not comparison yet)

**Prerequisites**: Task 2 must be completed and tested

**Implementation Details**:
- Create simplified ChatParticipantRequestHandler integration
- Implement basic request/response flow for single model
- Add proper error handling and loading states
- Integrate with existing conversation system

**Key Files**:
- `src/extension/modelComparison/vscode-node/singleModelChatHandler.ts`
- Update webview for real response handling

**Manual Testing Steps**:
1. Select one model in comparison panel
2. Send a real chat message
3. Verify actual AI response appears
4. Test error handling (network issues, auth failures)
5. Verify loading states work properly

**Acceptance Criteria**:
- Can chat with one real model
- Proper loading and error states
- Responses are streamed properly
- Error handling works correctly

**Rollback Point**: Tag as `model-comparison-single-model`

---

## Phase 2: Multi-Model Comparison

### TASK 4: Multi-Model Chat Orchestration
**Objective**: Enable real chat comparison with multiple selected models simultaneously

**Prerequisites**: Task 3 must be completed and tested

**Implementation Details**:
- Create `ComparisonChatOrchestrator` that manages multiple chat handlers
- Implement request cloning to ensure identical inputs across models
- Set up conversation history tracking per model
- Create response aggregation and synchronization logic
- Handle different response speeds and error states per model

**Key Files**:
- `src/extension/modelComparison/vscode-node/comparisonChatOrchestrator.ts`
- `src/extension/modelComparison/vscode-node/chatRequestCloner.ts`
- `src/extension/modelComparison/vscode-node/responseAggregator.ts`

**Manual Testing Steps**:
1. Select 2-3 models in comparison panel
2. Send a chat message
3. Verify all selected models receive identical requests
4. Verify responses appear side-by-side as they come in
5. Test with one model failing/timing out

**Acceptance Criteria**:
- Can create multiple ChatParticipantRequestHandler instances
- Identical requests sent to all selected models
- Responses tracked and aggregated properly
- Side-by-side comparison display works
- Error handling for individual model failures

**Rollback Point**: Tag as `model-comparison-multi-model`

---

## Phase 3: Tool Execution Control

### TASK 5: Tool Call Detection and Pause
**Objective**: Detect when models want to call tools and pause for user approval

**Prerequisites**: Task 4 must be completed and tested

**Implementation Details**:
- Create `ComparisonToolCoordinator` that manages multiple `PauseController` instances
- Implement tool call detection in model responses
- Add pause mechanism before tool execution
- Create basic tool call preview UI

**Technical Approach**: Use composition over inheritance - create a coordinator that manages multiple `PauseController` instances rather than extending the base class.

**Key Files**:
- `src/extension/modelComparison/vscode-node/comparisonToolCoordinator.ts`
- `src/extension/modelComparison/vscode-node/toolCallDetectionService.ts`
- Update webview for tool call preview

**Manual Testing Steps**:
1. Send a message that would trigger tool calls (e.g., "What files are in my workspace?")
2. Verify all models pause before executing tools
3. Verify tool call preview shows what each model wants to do
4. Test continuing with tool execution
5. Test canceling tool execution

**Acceptance Criteria**:
- All models pause before tool execution
- User can preview what tools each model wants to call
- User can continue or cancel tool execution
- Tool call preview is clear and informative

---

### TASK 6: Tool Call Comparison and Analysis
**Objective**: Provide detailed comparison of tool calls across models

**Prerequisites**: Task 5 must be completed and tested

**Implementation Details**:
- Create tool call diff service to compare intended tool calls
- Implement tool call visualization in the comparison UI
- Add tool call parameter comparison and analysis
- Create tool execution result comparison interface

**Key Files**:
- `src/extension/modelComparison/vscode-node/toolCallDiffService.ts`
- `src/extension/modelComparison/vscode-node/toolVisualizationService.ts`
- Update webview for tool call comparison display

**Manual Testing Steps**:
1. Send message that triggers different tool calls per model
2. Verify side-by-side tool call comparison shows differences
3. Test parameter diff highlighting
4. Verify tool execution result comparison
5. Test with identical tool calls across models

**Acceptance Criteria**:
- Side-by-side tool call comparison
- Parameter diff highlighting works
- Tool execution result comparison is clear
- Handles identical and different tool calls properly

**Rollback Point**: Tag as `model-comparison-tool-analysis`

---

### TASK 7: Synchronized Tool Execution Control
**Objective**: Enable fine-grained control over tool execution across models

**Prerequisites**: Task 6 must be completed and tested

**Implementation Details**:
- Implement synchronized resume/pause across all model handlers
- Add selective tool execution (approve tools per model)
- Create tool execution result broadcasting
- Implement rollback mechanism for failed tool executions

**Key Files**:
- `src/extension/modelComparison/vscode-node/synchronizedToolExecutor.ts`
- `src/extension/modelComparison/vscode-node/toolExecutionCoordinator.ts`

**Manual Testing Steps**:
1. Trigger tool calls on multiple models
2. Test "Approve All" vs selective approval per model
3. Test execution with one model failing
4. Verify tool results are shared appropriately
5. Test rollback functionality

**Acceptance Criteria**:
- Can resume all models simultaneously
- Can approve tools selectively per model
- Tool execution results shared across all handlers
- Rollback works for failed executions

---

## Phase 4: Advanced Comparison Features

### TASK 8: Response Quality Analysis
**Objective**: Provide tools for analyzing and comparing response quality

**Implementation Details**:
- Create response comparison metrics (length, structure, accuracy)
- Implement side-by-side response diff visualization
- Add response rating and annotation system
- Create export functionality for comparison results

**Key Files**:
- `src/extension/modelComparison/vscode-node/responseAnalysisService.ts`
- `src/extension/modelComparison/vscode-node/responseDiffService.ts`
- `src/extension/modelComparison/vscode-node/comparisonExportService.ts`

**Acceptance Criteria**:
- Clear visual diff between responses
- Quality metrics displayed
- Can export comparison results

---

### TASK 8: Response Quality Analysis
**Objective**: Provide tools for analyzing and comparing response quality

**Prerequisites**: Task 7 must be completed and tested

**Implementation Details**:
- Create response comparison metrics (length, structure, accuracy)
- Implement side-by-side response diff visualization
- Add response rating and annotation system
- Create export functionality for comparison results

**Key Files**:
- `src/extension/modelComparison/vscode-node/responseAnalysisService.ts`
- `src/extension/modelComparison/vscode-node/responseDiffService.ts`
- `src/extension/modelComparison/vscode-node/comparisonExportService.ts`

**Manual Testing Steps**:
1. Generate responses from multiple models for the same query
2. Verify diff visualization highlights differences
3. Test quality metrics calculation and display
4. Test response rating functionality
5. Export comparison results and verify format

**Acceptance Criteria**:
- Clear visual diff between responses
- Quality metrics displayed accurately
- Can export comparison results in useful format
- Rating system works intuitively

---

### TASK 9: Context and Prompt Verification
**Objective**: Verify identical context and prompt construction across models

**Prerequisites**: Task 8 must be completed and tested

**Implementation Details**:
- Create context verification service to ensure identical inputs
- Implement prompt inspection and comparison tools
- Add context debugging interface
- Create prompt template verification system

**Key Files**:
- `src/extension/modelComparison/vscode-node/contextVerificationService.ts`
- `src/extension/modelComparison/vscode-node/promptInspectionService.ts`

**Manual Testing Steps**:
1. Send request and inspect context for each model
2. Verify context is identical across models
3. Test prompt template inspection
4. Check context debugging interface
5. Test with different types of context (files, selections, etc.)

**Acceptance Criteria**:
- Can verify identical context across models
- Prompt templates shown for each model
- Context differences highlighted (if any)
- Debugging interface is helpful for troubleshooting

---

### TASK 10: Performance and Token Analysis
**Objective**: Compare model performance metrics and token usage

**Prerequisites**: Task 9 must be completed and tested

**Implementation Details**:
- Implement token counting and cost calculation
- Add response time tracking and comparison
- Create performance metrics dashboard
- Implement token efficiency analysis

**Key Files**:
- `src/extension/modelComparison/vscode-node/performanceAnalysisService.ts`
- `src/extension/modelComparison/vscode-node/tokenAnalysisService.ts`

**Manual Testing Steps**:
1. Send requests and verify token counting accuracy
2. Test response time tracking across models
3. Verify cost calculations (where applicable)
4. Test performance metrics dashboard
5. Compare token efficiency between models

**Acceptance Criteria**:
- Token usage displayed accurately per model
- Response time comparison works
- Cost analysis shown (where applicable)
- Performance metrics are useful for comparison

---

## Phase 5: Integration and Polish

### TASK 11: Settings and Configuration UI
**Objective**: Create comprehensive settings for the comparison panel

**Prerequisites**: Task 10 must be completed and tested

**Implementation Details**:
- Add VS Code settings contributions for comparison panel
- Create settings UI within the comparison panel
- Implement comparison preferences and defaults
- Add keyboard shortcuts and commands

**Key Files**:
- Update `package.json` with settings contributions
- `src/extension/modelComparison/vscode-node/settingsService.ts`
- Settings UI in webview

**Manual Testing Steps**:
1. Open VS Code Settings → search "model comparison"
2. Verify comparison panel settings appear
3. Test in-panel settings adjustments
4. Verify keyboard shortcuts work
5. Test settings persistence across sessions

**Acceptance Criteria**:
- Comprehensive settings in VS Code preferences
- In-panel settings for quick adjustments
- Keyboard shortcuts for common actions
- Settings persist correctly

---

### TASK 12: Testing and Documentation
**Objective**: Comprehensive testing and documentation for the comparison panel

**Prerequisites**: Task 11 must be completed and tested

**Implementation Details**:
- Create unit tests for all comparison services
- Implement integration tests for the full comparison flow
- Add simulation tests for various comparison scenarios
- Create user documentation and examples

**Key Files**:
- `src/extension/modelComparison/vscode-node/test/` directory with comprehensive tests
- Documentation updates
- Example comparison scenarios

**Manual Testing Steps**:
1. Run all unit tests → verify 90%+ coverage
2. Run integration tests → verify full workflows
3. Run simulation tests → verify various scenarios
4. Review documentation for completeness
5. Test examples work as documented

**Acceptance Criteria**:
- 90%+ test coverage for comparison functionality
- Integration tests covering full user workflows
- Clear documentation for users and developers
- Examples are accurate and helpful

---

### TASK 13: Performance Optimization
**Objective**: Optimize the comparison panel for performance and resource usage

**Prerequisites**: Task 12 must be completed and tested

**Implementation Details**:
- Implement efficient response streaming for multiple models
- Add request deduplication and caching where appropriate
- Optimize webview rendering for large responses
- Implement resource cleanup and memory management

**Key Files**:
- Performance optimizations across all comparison services
- Memory leak prevention and cleanup

**Manual Testing Steps**:
1. Test with large responses → verify smooth rendering
2. Run extended comparison session → check for memory leaks
3. Test with many models selected → verify performance
4. Monitor resource usage during heavy use
5. Test cleanup when panel is closed

**Acceptance Criteria**:
- Panel performs well with large responses
- No memory leaks during extended use
- Efficient resource utilization
- Proper cleanup when panel is disposed

---

## Technical Architecture Overview

### Service Dependencies (Final Architecture)
```
ModelComparisonPanel (WebView)
├── ModelSelectionService
├── ComparisonChatOrchestrator
│   ├── ChatParticipantRequestHandler (multiple instances)
│   ├── ChatRequestCloner
│   └── ResponseAggregator
├── ComparisonToolCoordinator
│   ├── PauseController (multiple instances, composition not inheritance)
│   ├── ToolCallDetectionService
│   └── SynchronizedToolExecutor
├── ResponseAnalysisService
├── PerformanceAnalysisService
└── SettingsService
```

### Progressive Architecture Evolution
- **Phase 1**: WebView + Mock data + UI patterns
- **Phase 2**: Real model integration + Single/Multi-model chat
- **Phase 3**: Tool execution control + Advanced analysis
- **Phase 4**: Polish + Performance + Documentation

### Key Integration Points
- **Chat System**: Full reuse of existing ChatParticipantRequestHandler pipeline
- **Tool System**: Integration with existing tool calling infrastructure using composition pattern
- **Model System**: Integration with existing model selection and endpoint management
- **VS Code**: WebView panels, settings, commands, and theming integration following existing patterns

### Success Criteria
1. **Functional Parity**: Identical prompts and context resolution as regular chat
2. **Tool Control**: Complete control over tool execution with user approval
3. **Usability**: Intuitive comparison interface with clear visualizations
4. **Performance**: Efficient handling of multiple concurrent model requests
5. **Reliability**: Robust error handling and recovery mechanisms
6. **Iterative Development**: Each task produces working, testable functionality

---

## Development Notes
- Follow existing extension architecture patterns and service injection
- Reuse existing services wherever possible (authentication, configuration, etc.)
- Maintain compatibility with existing @compare command during transition
- Use TypeScript strict mode and comprehensive error handling
- Follow VS Code extension best practices for webview security and performance