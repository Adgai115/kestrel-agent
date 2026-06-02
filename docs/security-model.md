# Kestrel Agent Security Model

> Status: Phase 3 (Implemented)
> Implements: SOP Section 6

## Principles

1. Security > Feature completeness
2. All tool calls go through PermissionEngine
3. Remote channels are low-trust by default
4. Secrets are never logged or stored in memory

## Permission Model

ABAC: Subject × TrustLevel × Channel × ChatType × Tool × Target → Decision

- **Decision**: allow | ask | deny
- **Risk**: low | medium | high | critical (auto-classified by tool)
- **Trust**: local | trusted | limited | unknown (auto-detected from channel + context)

## Protected Paths

| Path Pattern | Local CLI | All Other Channels |
|---|---|---|
| .env, .env.* | ask | deny |
| *.pem, *.key | ask | deny |
| id_rsa, id_ed25519 | ask | deny |
| .ssh/ | ask | deny |
| .aws/, .gcp/, .azure/ | ask | deny |

## Channel Defaults

| Channel | Default Trust | Bash | Write | Edit | Memory |
|---|---|---|---|---|---|
| CLI | local (full trust) | ask | ask | ask | allow |
| WebChat | trusted | ask | ask | ask | ask |
| Feishu private | trusted | deny | ask | ask | ask |
| Feishu group | limited | deny | deny | ask | ask |
| Telegram/Slack | trusted (escalated to high risk) | ask | ask | ask | ask |
| Cron/System | local | ask | ask | ask | allow |
| Unknown peer | unknown | deny | deny | deny | deny |

## Sandbox Rules (Phase 4 — PARTIAL)

- LocalProcess executor available for development (NOT a security boundary)
- Docker rootless executor planned but not yet implemented
- Host shell requires explicit local CLI authorization
- Timeout + env allowlist enforced; path isolation (readOnly/writable) rejected with error

## Gateway Rules (Phase 5)

- Default listen: 127.0.0.1
- All remote access requires auth token
- Each channel adapter must verify signatures
