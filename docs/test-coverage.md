# Kestrel Agent Test Coverage Report

> Generated: 2026-05-29 | TASK-0220~0225 安全加固完成

## Per-Package Summary

| Package | Tests | Status |
|---------|-------|--------|
| @kestrel/core | 24 | PASS |
| @kestrel/cli | 9 | PASS |
| @kestrel/gateway | 17 | PASS (+4 rate limit) |
| @kestrel/channels | 26 | PASS |
| @kestrel/permissions | 31 | PASS |
| @kestrel/sandbox | 18 (+3 CI) | PASS |
| @kestrel/memory | 20 | PASS |
| @kestrel/tasks | 9 | PASS |
| @kestrel/storage | 20 | PASS (+2 backup) |
| @kestrel/skills | 18 | PASS |
| @kestrel/lsp | 6 | PASS |
| @kestrel/observability | 19 | PASS |
| @kestrel/tools | 7 | PASS |
| @kestrel/web-console | 3 | PASS |
| **Total** | **~230** | **PASS** |

## Security Test Coverage (test:security)

| Package | Tests | Domain |
|---------|-------|--------|
| @kestrel/storage | 20 | SQL, error handling, task state machine, backup |
| @kestrel/permissions | 31 | ABAC, protected paths, trust levels, audit |
| @kestrel/channels | 26 | Feishu/Telegram/Slack verification, allowlist |
| @kestrel/memory | 20 | Secrets, audit, reviewer identity |
| @kestrel/gateway | 17 | Auth, SSE, WebSocket, rate limiting |

## Verify Pipeline

```
pnpm check → pnpm typecheck → pnpm test → pnpm test:security
4/4 PASS (~48s)
```

## Known Gaps

- Docker sandbox tests: 3 CI-skipped (require Docker, see `scripts/test-docker.ps1`)
- web-console: stub only, no UI tests
- LSP: TypeScript only, Python/Go adapters pending (agent-1)
- Pre-commit hook: `scripts/pre-commit.ps1` blocks secrets in staged files
