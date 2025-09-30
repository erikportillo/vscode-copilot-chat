# Tool Call Parameter Tracking - Documentation Index

## Overview

This directory contains comprehensive documentation for implementing tool call parameter tracking in the model comparison panel using **Option 3: Enhanced Telemetry/Logging**.

## Quick Links

### 📋 Start Here
- **[OPTION_3_SUMMARY.md](./OPTION_3_SUMMARY.md)** - Executive summary and recommendation
  - TL;DR of the solution
  - Key benefits and comparison with other options
  - Quick implementation timeline
  - **Read this first for a high-level overview**

### 🏗️ Architecture & Design
- **[OPTION_3_DESIGN.md](./OPTION_3_DESIGN.md)** - Detailed technical design
  - Current logging flow analysis
  - Proposed implementation phases
  - Benefits and considerations
  - Comparison with alternative approaches
  - **Read this for architectural details**

- **[ARCHITECTURE_DIAGRAM.md](./ARCHITECTURE_DIAGRAM.md)** - Visual flow diagrams
  - Data flow diagram
  - Sequence diagram
  - Component interactions
  - Correlation strategy visualization
  - **Read this for visual understanding**

### 🛠️ Implementation
- **[IMPLEMENTATION_GUIDE.md](./IMPLEMENTATION_GUIDE.md)** - Step-by-step implementation
  - Phase-by-phase checklist
  - Code snippets for each phase
  - Testing strategy
  - Edge case handling
  - **Read this when ready to implement**

### 📖 Context
- **[TOOL_CALL_TRACKING.md](./TOOL_CALL_TRACKING.md)** - Problem statement and context
  - What we can and cannot track currently
  - Why the limitation exists
  - Alternative options considered
  - Future enhancement possibilities
  - **Read this for background context**

## Document Flow

```
Start Here
    ↓
OPTION_3_SUMMARY.md
    │
    ├─→ Want details? ──→ OPTION_3_DESIGN.md
    │                          │
    │                          ├─→ Need visuals? ──→ ARCHITECTURE_DIAGRAM.md
    │                          │
    │                          └─→ Ready to build? ──→ IMPLEMENTATION_GUIDE.md
    │
    └─→ Need context? ──→ TOOL_CALL_TRACKING.md
```

## Key Findings

### The Problem
The model comparison panel can track which tools are called but not the parameters passed to those tools, limiting our ability to compare how different models use the same tools.

### The Discovery
**Tool parameters are already being logged!** The `RequestLogger.logToolCall()` method receives and stores complete parameter objects. We just need to expose them to the comparison panel.

### The Solution
Add a simple event-based retrieval system:
1. Fire event when tools are logged (30 lines)
2. Create formatter for common tools (100 lines)
3. Subscribe in model handler (50 lines)
4. Update comparison panel UI (80 lines)

**Total: ~360 lines of code, 1-2 days implementation**

### Why Option 3?
- ✅ **Fast**: 1-2 days vs 1-2 weeks for alternatives
- ✅ **Safe**: No core system changes
- ✅ **Complete**: Full parameters + bonus data (timing, responses, etc.)
- ✅ **Simple**: Leverages existing infrastructure
- ✅ **Maintainable**: Additive changes only

## Implementation Phases

### Phase 1: Core Infrastructure (Day 1 Morning)
Extend `RequestLogger` with event and query methods.

**Files**:
- `src/platform/requestLogger/node/requestLogger.ts`
- `src/extension/prompt/vscode-node/requestLoggerImpl.ts`

**Effort**: 2-3 hours

### Phase 2: Tool Formatting (Day 1 Morning)
Create formatter for common tools.

**Files**:
- `src/extension/modelComparison/vscode-node/toolCallFormatter.ts` (new)

**Effort**: 1 hour

### Phase 3: Handler Integration (Day 1 Afternoon)
Subscribe to tool call events in single model handler.

**Files**:
- `src/extension/modelComparison/vscode-node/singleModelChatHandler.ts`

**Effort**: 3-4 hours

### Phase 4: UI Updates (Day 2 Morning)
Display formatted tool calls in comparison panel.

**Files**:
- `src/extension/modelComparison/vscode-node/modelComparisonPanel.ts`
- `assets/modelComparison/script.js` (if needed)

**Effort**: 2-3 hours

### Phase 5: Testing (Day 2 Afternoon)
Comprehensive testing and bug fixes.

**Effort**: 2-3 hours

## Expected Outcome

After implementation, the comparison panel will show:

```
┌─────────────────────────────────┬──────────────────────────────────┐
│ Model A (GPT-4)                 │ Model B (Claude)                 │
├─────────────────────────────────┼──────────────────────────────────┤
│ Let me check that file.         │ I'll examine the auth code.      │
│                                 │                                  │
│ 🔧 Read src/auth.ts             │ 🔧 Read src/auth.ts              │
│    (lines 1-50)                 │    (entire file)                 │
│    ▼ Parameters                 │    ▼ Parameters                  │
│    {                            │    {                             │
│      file_path: "src/auth.ts",  │      file_path: "src/auth.ts"    │
│      start_line: 1,             │    }                             │
│      end_line: 50               │                                  │
│    }                            │                                  │
│                                 │                                  │
│ 🔧 Search for "authenticate"    │ 🔧 List files in src/            │
│    ▼ Parameters                 │    ▼ Parameters                  │
│                                 │                                  │
│ Based on the code...            │ Looking at the files...          │
└─────────────────────────────────┴──────────────────────────────────┘

Insights:
• Model A read specific lines (more targeted)
• Model B read entire file (broader context)
• Different tool strategies for same problem
```

## Testing Checklist

- [ ] Single model, single tool call
- [ ] Single model, multiple tool calls
- [ ] Multiple models, same tool with different parameters
- [ ] Multiple models, different tools
- [ ] Rapid sequential requests (no cross-contamination)
- [ ] Concurrent requests (proper correlation)
- [ ] Cancelled requests (proper cleanup)
- [ ] Unknown/custom tools (fallback formatting)
- [ ] Complex parameter objects
- [ ] Edge cases (empty parameters, malformed JSON, etc.)

## Success Metrics

✅ **Must Have** (MVP):
- Tool names displayed for each model
- Formatted messages for common tools
- Full parameter objects available
- Correct correlation (no cross-contamination)

✅ **Should Have** (Phase 2):
- Collapsible parameter details
- Timing information
- Tool response summaries

✅ **Nice to Have** (Future):
- Parameter diff highlighting
- Tool call statistics
- Export comparison data
- Tool call replay

## Related Work

### Current Tracking Document
- `TOOL_CALL_TRACKING.md` - Documents the current limitation and why it exists

### Alternative Approaches Considered
1. **Option 1**: Wait for VS Code API enhancement
   - **Status**: No timeline, depends on VS Code team
   - **Why rejected**: Unknown timeline, can't wait

2. **Option 2**: Hybrid approach with deep service changes
   - **Status**: Technically feasible but complex
   - **Why rejected**: ~1000 lines of code, 10+ files, high maintenance burden

3. **Option 3**: Enhanced telemetry/logging ✅ **SELECTED**
   - **Status**: Ready to implement
   - **Why selected**: Fast, safe, complete, simple

## Key Contacts & Resources

### Code Locations
- **Request Logger**: `src/extension/prompt/vscode-node/requestLoggerImpl.ts`
- **Tool Calling Loop**: `src/extension/intents/node/toolCallingLoop.ts` (line 654)
- **Model Comparison**: `src/extension/modelComparison/vscode-node/`
- **Tools Service**: `src/extension/tools/vscode-node/toolsService.ts`

### Key Interfaces
- `IRequestLogger` - Request logging interface
- `ILoggedToolCall` - Tool call log structure
- `ChatRequest` - Request instance for correlation
- `LanguageModelToolResult2` - Tool result type

## Development Workflow

### Before Starting
1. Read `OPTION_3_SUMMARY.md` for overview
2. Review `OPTION_3_DESIGN.md` for architecture
3. Check `IMPLEMENTATION_GUIDE.md` for steps
4. Verify watch tasks are running (`start-watch-tasks`)

### During Development
1. Make changes incrementally (one phase at a time)
2. Check compilation output after each change
3. Test each phase before moving to next
4. Commit after each working phase

### After Implementation
1. Run full test suite
2. Manual testing with real models
3. Performance verification
4. Documentation updates

## Questions?

If you have questions or need clarification on any aspect:

1. **Technical Design**: See `OPTION_3_DESIGN.md`
2. **Implementation Steps**: See `IMPLEMENTATION_GUIDE.md`
3. **Visual Flow**: See `ARCHITECTURE_DIAGRAM.md`
4. **Background/Context**: See `TOOL_CALL_TRACKING.md`
5. **Quick Overview**: See `OPTION_3_SUMMARY.md`

## Next Steps

1. ✅ **Review** this index and understand the structure
2. ✅ **Read** `OPTION_3_SUMMARY.md` for high-level overview
3. ✅ **Study** `OPTION_3_DESIGN.md` for technical details
4. ✅ **Follow** `IMPLEMENTATION_GUIDE.md` to build
5. ✅ **Test** thoroughly using testing strategy
6. ✅ **Ship** with feature flag for gradual rollout

---

**Last Updated**: September 30, 2025
**Status**: Ready for Implementation
**Estimated Effort**: 1-2 days (11-15 hours)
**Risk Level**: Low
**Recommended Approach**: Option 3 (This documentation)
