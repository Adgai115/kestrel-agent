# Kestrel Agent / 红隼

> 自托管 AI 编码助手 CLI。直连 DeepSeek API，快速、私有、独立。
>
> Fast eyes. Sharp actions. Reliable execution.

[中文文档](README.zh-CN.md) | [部署指南](docs/deployment.zh-CN.md)

Kestrel (红隼) is a self-hosted AI coding agent CLI. It connects directly to the DeepSeek API for fast, private, and independent code assistance.

## License Notice

Kestrel Agent is source-available for noncommercial use only.

- Noncommercial use is licensed under the PolyForm Noncommercial License 1.0.0.
- Commercial use requires a separate written commercial license from the project owner.
- See [LICENSE](LICENSE), [NOTICE.md](NOTICE.md), and [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md).

## Quick Start

```bash
# Install dependencies
pnpm install

# Set up your API key
cp .env.example .env
# Edit .env — add your KESTREL_API_KEY

# Start interactive REPL
pnpm dev
```

For Windows, Docker, split Web Console, and WSL/Linux deployment options, see
[中文部署指南](docs/deployment.zh-CN.md).

## Features

- **Interactive REPL** — chat with AI, execute tools, switch models at runtime
- **Gateway API** — HTTP/WebSocket/SSE server for external tool integration
- **Built-in Tools** — read, write, edit, bash, grep, find, lsp_diagnostics, memory_search, task_create
- **MCP Protocol** — connect any stdio MCP server, auto-register tools with ABAC checks
- **Memory Engine** — persistent searchable memory with audit trail
- **Skill System** — pluggable skills with permission gating
- **Multi-Channel** — Feishu, Slack, Telegram, WebChat adapters
- **Sandbox** — Docker-based code execution (optional)
- **Rate Limiting** — built-in Gateway rate limiting
- **Secret Scanning** — pre-commit hook prevents accidental secret commits

## Commands

```
kestrel chat        Start interactive session (default)
kestrel gateway     Start API server
kestrel task        Manage tasks
kestrel memory      Search memories
kestrel skill       List skills
kestrel doctor      System health check
```

## Development

```bash
pnpm build          # Build all packages
pnpm test           # Run all tests (~230)
pnpm check          # Lint + typecheck
pnpm run setup          # Install git hooks
.\scripts\verify.ps1 # Full CI pipeline
```

## Architecture

```
apps/bootstrap  →  wires Gateway + ConversationLoop
packages/core   →  ConversationLoop, KestrelClient, config
packages/cli    →  REPL, terminal UI, command routing
packages/gateway → Fastify HTTP/WS/SSE server
packages/storage → SQLite (sql.js WASM) — sessions, tasks, audit
packages/memory →  file-based memory engine
packages/mcp   →  MCP stdio transport + tool bridge
packages/skills →  skill registry with permission engine
packages/channels → Feishu/Slack/Telegram/WebChat adapters
packages/permissions → ABAC permission engine
packages/sandbox → Docker executor
packages/tools  →  built-in tool registry
packages/lsp    →  LSP diagnostics
packages/observability → metrics, logging
packages/web-console → React dashboard (Vite + Tailwind)
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `KESTREL_PROVIDER` | `deepseek` | LLM provider |
| `KESTREL_MODEL` | `deepseek-v4-pro` | Model ID |
| `KESTREL_API_KEY` | — | API key |
| `KESTREL_HOME` | `.kestrel` | Data directory |
| `KESTREL_PORT` | `3100` | Gateway port |

## License

PolyForm Noncommercial License 1.0.0. Commercial use requires separate written authorization.
