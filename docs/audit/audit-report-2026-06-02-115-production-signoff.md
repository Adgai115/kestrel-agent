# Audit Report 115 - Public Production Release Signoff

> Auditor: Codex acting as audit-agent
> Date: 2026-06-02 Asia/Shanghai
> Scope: Kestrel Agent public production release signoff
> Baseline: `master` at `792dc74` plus release-closure task-board/doc updates
> Verdict: **GO for self-hosted public production release**

---

## Release Boundary

This signoff covers Kestrel as a self-hosted coding agent and local Gateway/Web Console product.

It does not approve direct unauthenticated public internet exposure of the Gateway. Internet-facing deployments must place the Gateway behind TLS, a reverse proxy, explicit origin policy, and a production secret store.

---

## Gate Results

| Gate | Result |
|---|:--:|
| `.\scripts\verify.ps1` | PASS, 4/4 phases, 41.9s |
| `pnpm build` | PASS, workspace build and Web Console production bundle |
| Security E2E | PASS, 12/12 |
| Task workflow E2E | PASS, 13/13 |
| Gateway endpoint smoke | PASS, 10/10 |
| CLI command matrix | PASS, 19/19 command scenarios |
| MCP integration | PASS, 16/16 |
| Gateway pressure | PASS, 1000 requests, 50 concurrency, 0 failures, p95 75.37ms |
| ABAC pressure | PASS, 100000 evaluations, 0 bad, 0.628us/op |
| Web Console browser smoke | PASS, token flow, Gateway reachability, no CORS errors |
| Secret scan | PASS, 0 real-looking secret candidates |
| Process cleanup | PASS, no release test listener left running |

---

## Audit Findings

| Finding | Status | Evidence |
|---|:--:|---|
| `KCP-0105` task-board row still showed `BUG` after fix | CLOSED | `gateway restart --verify` passed; row updated to `DONE 8313ba1` |
| Web Console production preview blocked by Gateway CORS | CLOSED | `127.0.0.1/localhost:4173/4174` allowed; Playwright smoke passed |
| E2E scripts crashed on Windows/Node 24 after all assertions passed | CLOSED | `process.exit()` replaced with `process.exitCode`; E2E exit codes now clean |
| Token leakage in diagnostics | CLOSED | Security E2E confirmed full token absent from diagnostics |
| Gateway auth bypass | CLOSED | `/status` requires auth; valid token path passed |
| CLI product surface drift | CLOSED | `session`, `timeline`, `review`, `queue list` command matrix passed |

---

## Release Conditions

These are release constraints, not blockers:

1. Commit the release closure changes before tagging.
2. Do not publish `.env`, `.kestrel/gateway-token`, local databases, or runtime audit stores.
3. Production Gateway token must be injected through environment variables or a secret store.
4. Keep Gateway bound to `127.0.0.1` unless a reverse proxy with TLS and auth policy is configured.
5. If Web Console is hosted on a non-local origin, add an explicit production CORS origin before deployment.
6. Run the release smoke commands on the target production host after deployment.

---

## Signoff

| Role | Decision |
|---|:--:|
| Audit agent | **GO** |
| Release owner | **GO after commit/tag closure** |
| Security posture | **PASS for self-hosted production** |
| Reliability posture | **PASS for release candidate** |

Final decision: **Kestrel is approved for public production release in the self-hosted/local Gateway deployment model.**
