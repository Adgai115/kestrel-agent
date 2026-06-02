# Kestrel Agent Task Model

> Status: Phase 8 (Implemented — TaskEngine with worker pool, abort, audit events)
> Implements: SOP Section 7

## Task State Machine

```
pending → running → succeeded | failed | cancelled | waiting_for_approval | blocked
```

## Task Record

```ts
type AgentTask = {
  id: string;
  title: string;
  kind: "agent" | "shell" | "workflow" | "cron" | "memory" | "skill";
  status: "pending" | "running" | "succeeded" | "failed" | "cancelled" | "waiting_for_approval" | "blocked";
  workspaceId: string;
  sessionId: string;
  createdBy: string;
  channel: string;
  input: unknown;
  output?: unknown;
  error?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
};
```

## Storage

- SQLite `tasks` table in `@kestrel/storage`
- `TaskRepo` provides CRUD + status machine

## Phase 8 Scope

- Task engine worker loop
- Concurrency control (p-limit)
- AbortController support
- Long-running task lifecycle
