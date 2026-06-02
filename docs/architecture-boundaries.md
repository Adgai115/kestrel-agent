# Architecture Boundaries — Core / Runtime / CLI

> KCP-0003 · agent-1 · Phase 0
> Defines the three-layer architecture and module ownership boundaries.

---

## Layer Diagram

```
┌─────────────────────────────────────────┐
│  CLI Layer (@kestrel/cli)               │
│  Ink UI, REPL, tool executor, commands  │
├─────────────────────────────────────────┤
│  Core Layer (@kestrel/core)             │
│  ConversationLoop, KestrelClient,       │
│  PlanMode, SubAgentScheduler, Cron      │
├─────────────────────────────────────────┤
│  Runtime                                │
│  Node 24+, DeepSeek API, fetch(),       │
│  process.stdin/stdout/stderr            │
└─────────────────────────────────────────┘
```

---

## 1. Runtime — Bottom Layer

**What it is**: The Node.js process + external API. No Kestrel code owns this layer — it's the environment.

**Provides**:
- `fetch()` — HTTP/SSE to DeepSeek API
- `process.stdout.columns` — terminal width
- `process.on("SIGINT")` — interrupt signals
- `node:fs`, `node:path`, `node:child_process` — OS primitives
- `.env` / `process.env` — configuration

**Boundary rule**: Core Layer is the ONLY consumer of `fetch()` to external APIs. CLI never calls `fetch()` directly — all model interaction goes through `ConversationLoop`.

---

## 2. Core Layer (@kestrel/core)

**What it is**: The conversation engine — model-agnostic, UI-agnostic, pure logic.

**Owns**:
- `KestrelClient` — SSE streaming, model provider resolution (DeepSeek/OpenAI/Anthropic/Google)
- `ConversationLoop` — message history, tool-call loop, `maxTurns` guard, retry with backoff
- `PlanMode` — structured planning state machine
- `SubAgentScheduler` — spawn/deduplicate/summarize sub-agents
- `CronScheduler` — natural language → cron, background polling
- `AskUserQuestion` — structured user prompts
- `loadConfig()` — `.env` parsing, config resolution

**Exports to CLI**:
- `ConversationLoop` class — `prompt()`, `onEvent()`, `dispose()`, `switchModel()`
- Event types: `ConversationLoopEvent`, `KestrelClientEvent`
- `PlanMode`, `SubAgentScheduler`, `CronScheduler`

**Boundary rules**:
- Zero UI imports (no `ink`, no `react`, no `chalk`)
- Zero filesystem writes (read-only config loading)
- Zero process control (no `exit()`, no signal handlers)
- Must not import from `@kestrel/cli`

---

## 3. CLI Layer (@kestrel/cli)

**What it is**: The user-facing terminal application. All UI, all tool execution, all command routing.

**Owns**:
- `app.tsx` — Ink React component tree (SplashBanner, TaskList, InfoPanel, Interaction, InputBox, Footer)
- `index.ts` — CLI argument parsing, `printHelp()`, tool executor (20+ tools), ABAC wiring, `runInkRepl()`
- `terminal.tsx` — diff parsing + ANSI rendering helpers

**Consumes from Core**:
- `ConversationLoop` — created in `repl()`, passed to `<App adapter={...}>`
- `loadConfig()` — reads `.env`, passes to `ConversationLoop`

**Tool Executor (index.ts)**: The switch statement handling read/write/edit/grep/find/bash/git_*/web_fetch/lsp_diagnostics/memory_search/task_create/agent/cron/pr_create. This is the LARGEST surface area — 20+ tools, each with ABAC checks.

**Boundary rules**:
- Must NOT import `ConversationLoop` internals (only public API)
- Must NOT call `fetch()` for model interaction
- Tool execution goes through ABAC `PermissionEngine.evaluate()` before OS access
- UI state (messages, loading, error) lives in `App` component — NOT in Core

---

## 4. Cross-Cutting: Tool Execution

Currently the tool executor lives in `packages/cli/src/index.ts`. This is the primary target for KCP Phase 3 extraction.

```
User Input → CLI (app.tsx)
  → ConversationLoop.prompt()     [Core]
    → SSE stream → tool_call event
  ← CLI receives tool_call        [Core→CLI boundary]
  → ABAC check → execute tool     [CLI]
  → return result to ConvLoop     [CLI→Core boundary]
  → next turn...
```

**Problem**: Gateway, channels, and cron also need tool execution but can't import CLI. Phase 3 extracts the executor to a shared package.

---

## 5. File Ownership Map

| Path | Owner | Layer |
|------|-------|-------|
| `packages/core/src/conversation-loop.ts` | agent-1 | Core |
| `packages/core/src/kestrel-client.ts` | agent-1 | Core |
| `packages/core/src/plan-mode.ts` | agent-1 | Core |
| `packages/core/src/sub-agent.ts` | agent-1 | Core |
| `packages/core/src/cron.ts` | agent-1 | Core |
| `packages/cli/src/app.tsx` | agent-1 | CLI |
| `packages/cli/src/index.ts` | agent-1 | CLI |
| `packages/cli/src/terminal.tsx` | agent-1 | CLI |
| `packages/permissions/src/engine.ts` | agent-2 | Security |
| `packages/gateway/src/server.ts` | agent-2 | Platform |
| `packages/storage/src/database.ts` | agent-2 | Platform |
| `packages/sandbox/src/executor.ts` | agent-2 | Security |

---

## 6. Data Flow (Happy Path)

```
1. CLI (app.tsx) receives user input
2. CLI calls adapter.prompt(text)  →  Core (ConversationLoop)
3. Core adds [System] prefix, sends to DeepSeek via KestrelClient
4. Core yields SSE events: text_delta → tool_call → done
5. CLI subscribes via adapter.onEvent(), updates UI state
6. On tool_call: CLI checks ABAC, executes tool, returns result to Core
7. Core sends tool result to model, loop continues
8. On done: CLI stops loading spinner, renders final message
```
