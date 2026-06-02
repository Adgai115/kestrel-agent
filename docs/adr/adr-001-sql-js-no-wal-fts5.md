# ADR-001: sql.js with deferred WAL and FTS5

> Status: Accepted
> Date: 2026-05-28
> Accepted by: Project owner (explicit — confirmed acceptance during audit-005 review, 2026-05-28)
> Scope: WAL + FTS5 deferred to Phase 11-12. sql.js + LIKE search accepted for Phase 0-10.

## Context

Phase 2 Storage requires SQLite with WAL mode and FTS5 full-text search. The current implementation uses `sql.js` (SQLite compiled to WASM) which does not support WAL mode (WAL requires OS-level shared memory) and may not include FTS5 in the default build.

## Decision

Keep `sql.js` for Phase 0-5 development with LIKE-based search, and defer WAL + FTS5 to a later phase when the project migrates to a native SQLite backend (better-sqlite3, bun:sqlite, or Postgres).

## Consequences

**Positive**:
- Zero native dependencies — works on all platforms without compilation
- In-memory mode enables fast tests
- Simple save/load model for persistence

**Negative**:
- No WAL: writes block reads (acceptable for single-user MVP)
- No FTS5: LIKE-based search is slower on large datasets (acceptable until >10K messages)
- Phase 2 remains marked COMPLETED but with this known deviation

## Migration Plan

When native SQLite is reintroduced (Phase 11-12):
1. Replace sql.js with better-sqlite3
2. Enable `PRAGMA journal_mode=WAL`
3. Add FTS5 virtual tables with triggers
4. Migrate existing data

## Alternatives Considered

- better-sqlite3: Rejected for Phase 2 due to Windows native compilation issues
- Postgres: Overkill for MVP, planned for production phase
- bun:sqlite: Rejected due to Bun-only runtime constraint
