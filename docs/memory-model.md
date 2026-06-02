# Kestrel Agent Memory Model

> Status: Phase 7 (PARTIAL — session-to-memory deferred, TASK-0015)

## Implemented

| Feature | Status |
|---|---|
| MemoryEngine (.agent-memory tree) | DONE |
| 4 types: user/feedback/project/reference | DONE |
| Propose → review-queue/pending | DONE |
| Review (accept/reject) with auditor identity | DONE |
| MEMORY.md index | DONE |
| Search across all types | DONE |
| Secret detection (content/description/reason) | DONE |
| Audit events (proposed/accepted/rejected) | DONE |
| Session-to-memory background task | DEFERRED (TASK-0015, owner accepted audit-018) |

## API

```ts
const engine = new MemoryEngine(cwd, { auditSink });  // auditSink required by default
engine.propose(entry, reason);      // → review-queue/pending/, requires auditSink
engine.listPending();               // → MemoryProposal[]
engine.review({name, decision, reviewer});  // requires reviewer identity + auditSink
engine.search(query);               // → MemorySearchResult[]
engine.getIndex();                  // → MemoryIndexEntry[]
```

## Security

- Proposals + review require auditSink by default (requireAudit=true)
- Proposals rejected if secrets detected in content, description, or reason
- Review requires reviewer identity + auditSink
- Audit events emitted via configured auditSink callback
