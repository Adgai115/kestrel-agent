# Changelog

## v1.1.0 (2026-06-02) — Remediation

### Core
- Closed the 20-item bug remediation plan from `kestrel-bug-remediation-2026-06-02.md`.
- Added explicit unsupported-provider errors for Anthropic/Google until non-OpenAI-compatible clients are implemented.
- Fixed `maxTurns` loop accounting, `web_fetch`, bash danger blocking, multi-match edit handling, shared tool execution, redaction edge cases, ABAC edit preview keys, and sub-agent tool schemas.

### Gateway / MCP / Channels
- Fixed per-request chat isolation, Gateway database reuse, session count derivation, expired confirmation cleanup, and confirmation/runtime diagnostics paths.
- Switched MCP stdio framing to newline-delimited JSON and isolated MCP call timeouts.
- Added Feishu WebSocket exponential backoff and complete ACK coverage.

### Cron / CLI
- Added DOW/DOM/month handling to cron next-run calculation and moved cron command execution off the scheduler loop.
- Normalized Gateway env var handling and verified CLI command matrix for release-critical commands.

### Release Quality
- Updated Biome scan boundaries to ignore local `.claude` nested worktrees.
- Added release audit evidence for build, verify, targeted package tests, MCP integration, Gateway E2E, CLI matrix, stress testing, and secret scan.

---

## v1.0.0 (2026-06-01) — Production

### Core
- Multi-model provider: DeepSeek, OpenAI, Anthropic, Google
- API retry with exponential backoff (max 3x)
- Sub-agent scheduler: Explore/Plan/Bash/General + concurrency pool
- Cron scheduler: natural language → cron expression, background daemon
- Skill community: publish/discover/install
- LSP diagnostics: TypeScript + Python (ruff/pylint) + Go (go vet)

### CLI / UX
- Chinese documentation: quickstart + deployment modes
- CLI help/ABAC confirm Chinese localization
- `/model` lists available models grouped by provider
- Version command: `kestrel version` / `--version`
- Context window tracking (128K, real char count)
- Token speed display (chars/4 estimation)
- Ctrl+C graceful: first press cancels, second exits
- Case-insensitive `/` commands with auto-complete hint
- InfoPanel real runtime state (ready/thinking/error)
- Animated thinking spinner (◐◓◑◒)
- History pagination (`/history next` / `/history prev`)
- Error classification with actionable Chinese hints
- Multi-agent toggle (`/agent1` / `/agent2`)
- `process.exit` → `process.exitCode` (fixes task list crash)
- Non-TTY graceful error for `kestrel chat`
- Git integration: status/diff/log/blame/commit tools
- Diff visualization: green/red/cyan Ink rendering
- Tool definitions with JSON Schema parameters

### Gateway
- SSE streaming chat (`POST /sse/chat`) + WebSocket chat RPC
- Confirmation API (`POST /confirm`, `/confirm/pending`)
- Session tracking, multi-channel webhook routing
- Unified token env vars (KESTREL_GATEWAY_TOKEN)

### Security
- ABAC target path/command passing to PermissionEngine
- Scoped approvals: command/path granularity (not just tool-wide)
- Bash injection detection, grep .gitignore awareness
- MCP env allowlist, JS-native grep fallback (Windows)
- Memory write gate: auto-propose limited to user/feedback
- Memory audit trail: SHA-256 hash chain

### Deployment
- Dockerfile (multi-stage) + docker-compose (dev/prod profiles)
- Web Console token setup UI + Chinese localization
- Gateway token persistence (`.kestrel/gateway-token`)

---

## v0.4.0 (2026-05-30) — Intelligence

- Memory self-learning: auto-propose patterns from conversation
- Skill publish/discover/install framework
- Cron natural language scheduling + background daemon
- LSP Python/Go adapters
- PR workflow: `pr_create` tool (branch → commit → push → gh pr create)
- ABAC scoped approvals (command/path granularity)
- Gateway multi-channel webhook routing
- Grep JS-native fallback (Windows, zero dependencies)

---

## v0.3.0 (2026-05-29) — Scale

- Sub-agent scheduler: Explore/Plan/Bash/General 4 types
- Git integration: status/diff/log/blame/commit
- Diff visualization (Ink green/red rendering)
- Sub-agent concurrency pool with deduplication
- Tool parameter JSON schemas
- Agent/task_create/lsp_diagnostics/memory_search tools

---

## v0.2.0 (2026-05-28) — Moat + Standards

- ABAC permission engine with ConfirmDialog UI
- deny/ask/allow decisions + session-scoped approvals
- MCP protocol: stdio transport + tool auto-registration
- Protected path detection (.env/.ssh/.aws/.pem)
- `/permissions` command with trust level switching
- Grep/find risk classification fix (critical→low)

---

## v0.1.0 (2026-05-28) — Foundation

- Direct DeepSeek API (Pi removed, KestrelClient + ConversationLoop)
- Ink (React) terminal UI: 6-zone layout
- ASCII KESTREL logo (responsive: ≥100/≥70/<70)
- Tool executor: read/write/edit/grep/find/bash/web_fetch
- System prompt injection, memory context, skill context
- Gateway: Fastify HTTP/WS/SSE, JSON-RPC
- Storage: SQLite via sql.js WASM
- Memory engine with proposal/review/search
- Skill registry with permission gate
- Pre-commit secret scanning hook
- 40 SOP security tests (38/40 PASS)
