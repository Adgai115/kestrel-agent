# Kestrel Agent — Platform / Security / Storage Boundaries

> KCP-0004 · agent-2 · Phase 0
> Defines platform infrastructure, security model, and storage layer ownership.

---

## 1. Platform Layer

**What it is**: The runtime infrastructure that hosts Kestrel — Gateway, deployment, observability, identity.

### Gateway (@kestrel/gateway)

**Owns**:
- HTTP/WebSocket/SSE server (Fastify)
- Auth hook (Gateway token, GitHub OAuth, Google OAuth)
- CORS configuration (loopback origins only)
- Rate limiting (per-IP, /health exempt)
- Health check endpoints: `/live`, `/ready`, `/health`, `/status`, `/diagnostics`
- JSON-RPC endpoint (`/rpc`)
- SSE streaming (`/sse`, `/sse/chat`)
- WebSocket chat (`/ws`)
- Session tracking (`/sessions`)
- Permission confirmations (`/confirm`, `/confirm/:id`)
- Channel webhooks (`/webhook/:channel`)
- Status cache with stale marker (15s TTL, 2min max age)

**Boundary rules**:
- Must NOT import CLI or Ink
- Status cache must NOT hold stale data >2min
- Auth must validate every non-public endpoint
- Logger configurable via `KESTREL_LOG_LEVEL`

### Runtime Identity (KCP-0101)

`getRuntimeIdentity()` provides:
- `machineId` — stable per hostname + cwd (djb2 hash)
- `instanceId` — UUID per process start
- `pid`, `host`, `cwd`, `startedAt`, `nodeVersion`, `platform`

Exposed via `/diagnostics` for consistent identity across all components.

### Deployment

- Dockerfile: multi-stage (deps → builder → runner), alpine base
- docker-compose.yml: `--profile prod` (gateway + web-console), `--profile dev`
- start.ps1: one-click PowerShell launcher with env validation
- verify.ps1: CI pipeline (check → typecheck → parallel test + test:security)

---

## 2. Security Layer

### ABAC Engine (@kestrel/permissions)

**Trust levels**: `local` > `trusted` > `limited` > `unknown`

**Risk levels**: `low` < `medium` < `high` < `critical`

**Rules**:
- CLI (local): allow read, ask write/bash (danger patterns → critical)
- WebChat (trusted): allow read, ask write, deny sensitive paths
- Feishu private (limited): allow read, deny bash
- Feishu group (limited): ask read, deny write/bash
- Unknown: deny all

**Protected paths**: `.env`, `*.key`, `*.pem`, `id_rsa`, `credentials.*`, cloud config dirs

**Scoped approvals**: `bash:<command>`, `write:<path>`, `read:<path>` — granular, not tool-name only

### Authentication

- Primary: Gateway token (static or auto-generated UUID)
- Secondary: GitHub OAuth (`ghp_`/`github_pat_` → api.github.com/user, 5min cache)
- Secondary: Google OAuth (`ya29.` → oauth2/v3/userinfo, 5min cache)
- WebSocket: Bearer header OR `?token=` query param (localhost only)

### Audit

- Hash-chained audit log: `appendFileSync` with SHA-256 chain, 16-char hex prefix
- Located at `.agent-memory/audit/audit.log`
- Events: `memory.proposed`, `memory.accepted`, `memory.rejected`
- Reviewer identity required (3-64 chars, validated)

### Secret Scanning

- Pre-commit hook: regex scan for `sk-*`, `eyJ*`, `api_key=`, `token=`, `secret=`
- MemoryEngine gate: rejects proposals containing secrets in content/description/reason

---

## 3. Storage Layer

### Memory Engine (@kestrel/memory)

- File-based: `.agent-memory/memories/{user,feedback,project,reference}/`
- Review queue: `review-queue/{pending,accepted,rejected}/`
- Index: `MEMORY.md` (max 200 lines)
- Search: full-text over accepted memories
- MemoryLearner: pattern detection → auto-propose (user/feedback only, project/reference require human review)
- Write gate (MM-001): only user/feedback types auto-proposed

### Database (@kestrel/storage)

- SQLite via sql.js (WASM, no native deps)
- Tables: sessions, tasks, task_events, tool_calls, audit_events
- Indices: idx_tool_calls_session, idx_tasks_status, idx_audit_event, idx_audit_session
- KestrelDatabase.create({ memory: false }) for file-based, memory mode for tests

### Session Tracking

- In-memory Map in Gateway (TrackedSession)
- Type: "sse" or "ws", with connectedAt timestamp
- REST: GET /sessions, auto-cleanup on socket close

### Confirmation Queue

- In-memory Map in Gateway (PendingConfirmation)
- POST /confirm to create, POST /confirm/:id to resolve
- Auto-timeout >5min → denied
- Used by CLI ABAC flow and Web Console

---

## 4. Integration Rules

```
Gateway ↔ Identity: /diagnostics exposes RuntimeIdentity
Gateway ↔ Memory: AuditSink writes to audit.log (hash-chained)
Gateway ↔ Channels: /webhook/:channel routes to Feishu/Telegram/WebChat
Gateway ↔ Core: Chat RPC wires into ConversationLoop per-request
CLI ↔ ABAC: Tool executor calls PermissionEngine.evaluate() before OS access
```

**Cross-layer prohibition**: No layer shall import from a layer above it. Platform (gateway) imports Core, not CLI. Security (permissions) imports nothing else. Storage (memory, storage) imports nothing else.
