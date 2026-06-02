# Kestrel Production Release Closure

> Date: 2026-06-02
> Owner: Codex acting as release/audit agent
> Release target: Kestrel Agent public production release
> Signoff report: `docs/audit/audit-report-2026-06-02-115-production-signoff.md`

## Release Scope

Approved scope:

- Self-hosted Kestrel CLI.
- Localhost-bound Gateway.
- Web Console served locally or from approved local preview origins.
- ABAC, audit, memory, skills, task, cron, channel queue, MCP, LSP, and Web Console minimum user paths.

Out of scope for this release:

- Direct public internet exposure of the Gateway.
- Hosted multi-tenant SaaS operation.
- Non-local Web Console origin without an explicit production CORS entry.

## Closure Checklist

| Item | Status | Evidence |
|---|:--:|---|
| KCP board reconciled | DONE | `KCP-0105` changed from stale `BUG` to `DONE` |
| Static/type/unit/security gate | DONE | `.\scripts\verify.ps1`, 4/4 PASS |
| Release build | DONE | `pnpm build` PASS |
| Gateway security E2E | DONE | 12/12 PASS |
| Task workflow E2E | DONE | 13/13 PASS |
| CLI full matrix | DONE | 19/19 PASS |
| Gateway smoke | DONE | 10/10 endpoint PASS |
| Gateway pressure | DONE | 1000 requests, 50 concurrency, 0 failures |
| ABAC pressure | DONE | 100000 evaluations, 0 bad |
| MCP verification | DONE | 16/16 PASS |
| Web Console browser smoke | DONE | PASS, no CORS errors |
| Secret scan | DONE | 0 real-looking candidates |
| Runtime cleanup | DONE | No release test listener left running |

## Release Sequence

Use this sequence to publish the sanitized public release export:

```powershell
git status --short
git add .
git commit -m "release: Kestrel Agent v1.0.0"
git tag v1.0.0
```

Then on the production host:

```powershell
pnpm install --frozen-lockfile
pnpm build
.\scripts\verify.ps1
$env:KESTREL_GATEWAY_TOKEN="<secret-from-vault>"
$env:KESTREL_GATEWAY_HOST="127.0.0.1"
$env:KESTREL_GATEWAY_PORT="3100"
node packages/gateway/dist/bin.js --port 3100
```

Production smoke:

```powershell
node scripts\e2e-security.mjs --port 3100 --token $env:KESTREL_GATEWAY_TOKEN
node scripts\e2e-task-workflow.mjs --port 3100
node packages/cli/bin/kestrel.js gateway status
```

## Rollback Plan

1. Stop the Gateway process.
2. Revert to the previous release tag or commit.
3. Restore previous `.env` or secret-store values.
4. Run `.\scripts\verify.ps1`.
5. Start Gateway and run `/ready`, `/status`, and E2E security smoke.

## Final Status

Release status: **READY FOR PUBLIC PRODUCTION RELEASE**, with the deployment boundary defined in Audit Report 115.
