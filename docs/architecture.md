# Kestrel Agent Architecture

> Status: v0.1 + v0.2 Complete, v0.3 in Progress

## Overview

Kestrel Agent connects directly to DeepSeek API via ConversationLoop + KestrelClient, with Gateway, Permission, Memory, Task, Skills, MCP, and Sandbox layers.

## Layer Diagram

```
Channel Adapters (CLI / Feishu / WebChat / Telegram / Slack)
       |
Gateway (Auth / Route / Rate-limit / Session Select / Permission Preflight)
       |
Agent Runtime (ConversationLoop + KestrelClient + Tool Loop)
       |
Context Engine (SYSTEM.md / AGENTS.md / MEMORY.md / Session Search / Skills)
       |
Tool Router (Permission Check -> MCP Bridge -> Execution -> Audit)
       |
Event Store (Messages / Tool Calls / Tasks / Memory Proposals / Audit Logs)
       |
Learning Loop (Session Review / Memory Consolidation / Skill Generation)
```

## Packages

| Package | Responsibility |
|---|---|
| @kestrel/core | ConversationLoop, KestrelClient, config, plan-mode |
| @kestrel/cli | CLI/TUI entry point, Ink-based REPL |
| @kestrel/gateway | Fastify + WebSocket + SSE |
| @kestrel/channels | Feishu/WebChat/Telegram adapters |
| @kestrel/tools | Tool definitions + registry |
| @kestrel/permissions | ABAC permission engine |
| @kestrel/sandbox | Docker/gVisor executor |
| @kestrel/mcp | MCP protocol (stdio transport) |
| @kestrel/memory | File-based memory engine |
| @kestrel/tasks | Task engine + workers |
| @kestrel/skills | Skill registry + runtime |
| @kestrel/lsp | LSP diagnostics adapters |
| @kestrel/storage | SQLite (sql.js WASM) adapter |
| @kestrel/observability | Logs/traces/audit |
| @kestrel/web-console | React dashboard (Vite + Tailwind) |

## Tech Stack

- Runtime: Node.js 24 LTS / TypeScript
- Package: pnpm workspace
- Agent Kernel: ConversationLoop + KestrelClient (direct DeepSeek API)
- Gateway: Fastify
- Storage: SQLite (sql.js WASM) + WAL + FTS5
- Sandbox: Docker rootless
- Build: TypeScript project references
- Lint: Biome
- Test: Vitest
