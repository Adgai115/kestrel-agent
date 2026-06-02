# Kestrel Agent Permission Model

> Status: Implemented (Phase 3)
> Implements: SOP Section 6

## API

```ts
const engine = new PermissionEngine({
  overrides?: Partial<Record<TrustLevel, Partial<Record<RiskLevel, Decision>>>>,
  allowlist?: Record<string, string[]>,
  auditSink?: AuditSink,  // callback for permission.decided events
});

const result: PermissionResult = engine.evaluate({
  subject: "local-user" | "feishu-user" | "web-user" | "system-task",
  channel: "cli" | "feishu" | "webchat" | "telegram" | "slack" | "cron",
  tool: "read" | "write" | "edit" | "bash" | ...,
  target?: string,
  trustLevel?: "local" | "trusted" | "limited" | "unknown",  // override auto-detection
  chatType?: "private" | "group",  // Feishu private/group distinction
  isUnknownPeer?: boolean,  // unauthenticated/pairing not done
  sessionId?: string,
  workspaceId?: string,
});
```

## Trust Level Detection

| Channel | chatType | Trust Level |
|---|---|---|
| cli, cron | — | local |
| feishu | private | trusted |
| feishu | group | limited |
| webchat, slack, telegram | — | trusted |
| any | isUnknownPeer=true | unknown |

## Default Policy

| Trust Level | Low | Medium | High | Critical |
|---|---|---|---|---|
| local | allow | allow | ask | ask |
| trusted | allow | ask | ask | deny |
| limited | ask | ask | deny | deny |
| unknown | deny | deny | deny | deny |

## Overrides

- Feishu bash: deny (all trust levels)
- Unknown peer: deny all tools regardless of risk
- Protected paths (.env, .ssh/, .aws/, *.pem, *.key, id_rsa): ask for local CLI, deny for all other channels
- Risk escalation: limited trust bumps risk up one level; protected paths → critical

## Audit Events

Every `evaluate()` call emits via `auditSink`:
```ts
{ event: "permission.decided", tool, channel, subject, risk, decision, reason }
```
