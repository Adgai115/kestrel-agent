# Kestrel Agent Channel Model

> Status: Phase 6 (PARTIAL — Feishu sendMessage deferred)

## Implemented

| Channel | Adapter | Trust | Auth | Response |
|---|---|---|---|---|
| WebChat | `WebChatAdapter` | trusted | Gateway token | SSE/WS (via Gateway) |
| Feishu | `FeishuAdapter` | trusted (private) / limited (group) | SHA256 hex (encryptKey) + allowlist | DEFERRED (throws clear error) |

## Feishu Verification

Supported mode: **Event callback with encrypt key signature**.

Algorithm: `SHA256(timestamp + nonce + encryptKey + rawBody) → hex`

Requires:
- `encryptKey`: Feishu event subscription encrypt key
- `allowlist`: OpenID allowlist (REQUIRED, empty = deny all)

Verification token and message card callback modes are not supported.

## WebChat

Returns `trusted` trust level. Local trust escalation is handled by Gateway auth verification.

## Known Residuals

| Item | Task | Status |
|---|---|---|
| Feishu sendMessage (tenant token) | TASK-0013 (backlog) | DEFERRED |
