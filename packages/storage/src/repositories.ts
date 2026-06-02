/**
 * Typed repository operations for sql.js database.
 */

import { randomUUID } from "node:crypto";
import type { Database as SqlJsDatabase, SqlValue } from "sql.js";

// ============================================================================
// Helpers
// ============================================================================

type BindParams = SqlValue[];

function execAll(db: SqlJsDatabase, sql: string, params?: BindParams): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];
  const rows = db.exec(sql, params);
  if (!rows || rows.length === 0) return results;
  for (const row of rows) {
    const { columns, values } = row;
    for (const val of values) {
      const obj: Record<string, unknown> = {};
      for (let i = 0; i < columns.length; i++) {
        obj[columns[i]!] = val[i];
      }
      results.push(obj);
    }
  }
  return results;
}

function execOne(db: SqlJsDatabase, sql: string, params?: BindParams): Record<string, unknown> | undefined {
  const rows = execAll(db, sql, params);
  return rows.length > 0 ? rows[0] : undefined;
}

function execRun(db: SqlJsDatabase, sql: string, params?: BindParams): void {
  db.run(sql, params);
}

// ============================================================================
// Types
// ============================================================================

export interface SessionRow {
  id: string;
  name: string | null;
  workspace_id: string;
  model_provider: string | null;
  model_id: string | null;
  thinking_level: string | null;
  status: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string | null;
  tool_call_id: string | null;
  tokens_input: number;
  tokens_output: number;
  tokens_cache_read: number;
  cost_input: number;
  cost_output: number;
  channel: string;
  created_at: string;
}

export interface ToolCallRow {
  id: string;
  message_id: string;
  session_id: string;
  tool_name: string;
  args: string | null;
  result: string | null;
  is_error: number;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface TaskRow {
  id: string;
  title: string;
  kind: string;
  status: string;
  workspace_id: string;
  session_id: string | null;
  created_by: string | null;
  channel: string;
  input: string | null;
  output: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface AuditEventRow {
  id: number;
  ts: string;
  level: string;
  event: string;
  session_id: string | null;
  workspace_id: string | null;
  tool: string | null;
  channel: string | null;
  subject: string | null;
  risk: string | null;
  detail: string | null;
  created_at: string;
}

export interface SearchResult {
  id: string;
  session_id: string;
  role: string;
  content: string;
}

// ============================================================================
// Session Repository
// ============================================================================

export class SessionRepo {
  constructor(private db: SqlJsDatabase) {}

  create(params: {
    id?: string;
    name?: string;
    workspaceId: string;
    modelProvider?: string;
    modelId?: string;
    thinkingLevel?: string;
  }): SessionRow {
    const id = params.id ?? randomUUID();
    execRun(
      this.db,
      "INSERT INTO sessions (id, name, workspace_id, model_provider, model_id, thinking_level) VALUES (?, ?, ?, ?, ?, ?)",
      [
        id,
        params.name ?? null,
        params.workspaceId,
        params.modelProvider ?? null,
        params.modelId ?? null,
        params.thinkingLevel ?? null,
      ],
    );
    return execOne(this.db, "SELECT * FROM sessions WHERE id=?", [id]) as unknown as SessionRow;
  }

  getById(id: string): SessionRow | undefined {
    return execOne(this.db, "SELECT * FROM sessions WHERE id=?", [id]) as unknown as SessionRow | undefined;
  }

  update(id: string, fields: { name?: string; status?: string; messageCount?: number }): void {
    const current = this.getById(id);
    if (!current) throw new Error(`Session not found: ${id}`);
    execRun(this.db, "UPDATE sessions SET name=?, status=?, message_count=?, updated_at=datetime('now') WHERE id=?", [
      fields.name ?? current.name,
      fields.status ?? current.status,
      fields.messageCount ?? current.message_count,
      id,
    ]);
  }

  list(workspaceId: string, limit = 50, offset = 0): SessionRow[] {
    return execAll(this.db, "SELECT * FROM sessions WHERE workspace_id=? ORDER BY updated_at DESC LIMIT ? OFFSET ?", [
      workspaceId,
      limit,
      offset,
    ]) as unknown as SessionRow[];
  }
}

// ============================================================================
// Message Repository
// ============================================================================

export class MessageRepo {
  constructor(private db: SqlJsDatabase) {}

  create(params: {
    id?: string;
    sessionId: string;
    role: string;
    content?: string;
    toolCallId?: string;
    tokensInput?: number;
    tokensOutput?: number;
    tokensCacheRead?: number;
    costInput?: number;
    costOutput?: number;
    channel?: string;
  }): MessageRow {
    const id = params.id ?? randomUUID();
    execRun(
      this.db,
      `INSERT INTO messages (id, session_id, role, content, tool_call_id, tokens_input, tokens_output, tokens_cache_read, cost_input, cost_output, channel)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        params.sessionId,
        params.role,
        params.content ?? null,
        params.toolCallId ?? null,
        params.tokensInput ?? 0,
        params.tokensOutput ?? 0,
        params.tokensCacheRead ?? 0,
        params.costInput ?? 0,
        params.costOutput ?? 0,
        params.channel ?? "cli",
      ],
    );
    return execOne(this.db, "SELECT * FROM messages WHERE id=?", [id]) as unknown as MessageRow;
  }

  getBySession(sessionId: string, limit = 500, offset = 0): MessageRow[] {
    return execAll(this.db, "SELECT * FROM messages WHERE session_id=? ORDER BY created_at ASC LIMIT ? OFFSET ?", [
      sessionId,
      limit,
      offset,
    ]) as unknown as MessageRow[];
  }

  search(query: string, limit = 50): SearchResult[] {
    return execAll(
      this.db,
      "SELECT id, session_id, role, content FROM messages WHERE content LIKE ? ORDER BY created_at DESC LIMIT ?",
      [`%${query}%`, limit],
    ) as unknown as SearchResult[];
  }

  searchInSession(sessionId: string, query: string, limit = 50): SearchResult[] {
    return execAll(
      this.db,
      "SELECT id, session_id, role, content FROM messages WHERE content LIKE ? AND session_id = ? ORDER BY created_at DESC LIMIT ?",
      [`%${query}%`, sessionId, limit],
    ) as unknown as SearchResult[];
  }
}

// ============================================================================
// ToolCall Repository
// ============================================================================

export class ToolCallRepo {
  constructor(private db: SqlJsDatabase) {}

  create(params: { id?: string; messageId: string; sessionId: string; toolName: string; args?: unknown }): ToolCallRow {
    const id = params.id ?? randomUUID();
    execRun(
      this.db,
      "INSERT INTO tool_calls (id, message_id, session_id, tool_name, args, started_at) VALUES (?, ?, ?, ?, ?, datetime('now'))",
      [id, params.messageId, params.sessionId, params.toolName, params.args ? JSON.stringify(params.args) : null],
    );
    return execOne(this.db, "SELECT * FROM tool_calls WHERE id=?", [id]) as unknown as ToolCallRow;
  }

  recordResult(id: string, result: unknown, isError = false): void {
    execRun(this.db, "UPDATE tool_calls SET result=?, is_error=?, finished_at=datetime('now') WHERE id=?", [
      JSON.stringify(result),
      isError ? 1 : 0,
      id,
    ]);
  }

  getBySession(sessionId: string, limit = 200): ToolCallRow[] {
    return execAll(this.db, "SELECT * FROM tool_calls WHERE session_id=? ORDER BY created_at ASC LIMIT ?", [
      sessionId,
      limit,
    ]) as unknown as ToolCallRow[];
  }
}

// ============================================================================
// Task Repository
// ============================================================================

export class TaskRepo {
  constructor(private db: SqlJsDatabase) {}

  create(params: {
    title: string;
    kind: string;
    workspaceId: string;
    sessionId?: string;
    createdBy?: string;
    channel?: string;
    input?: unknown;
  }): TaskRow {
    const id = randomUUID();
    execRun(
      this.db,
      "INSERT INTO tasks (id, title, kind, status, workspace_id, session_id, created_by, channel, input) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?)",
      [
        id,
        params.title,
        params.kind,
        params.workspaceId,
        params.sessionId ?? null,
        params.createdBy ?? null,
        params.channel ?? "cli",
        params.input ? JSON.stringify(params.input) : null,
      ],
    );
    return execOne(this.db, "SELECT * FROM tasks WHERE id=?", [id]) as unknown as TaskRow;
  }

  private static validTransitions: Record<string, string[]> = {
    pending: ["running", "cancelled", "blocked"],
    running: ["succeeded", "failed", "cancelled", "waiting_for_approval", "blocked"],
    succeeded: [],
    failed: [],
    cancelled: [],
    waiting_for_approval: ["running", "cancelled"],
    blocked: ["running", "cancelled"],
  };

  updateStatus(id: string, status: string): void {
    const current = this.getById(id);
    if (!current) throw new Error(`Task not found: ${id}`);

    const allowed = TaskRepo.validTransitions[current.status];
    if (!allowed || (!allowed.includes(status) && current.status !== status)) {
      throw new Error(`Invalid task transition: ${current.status} → ${status}`);
    }

    execRun(
      this.db,
      `UPDATE tasks SET status=?, updated_at=datetime('now'),
       started_at=COALESCE(started_at, CASE WHEN ?='running' THEN datetime('now') END),
       finished_at=CASE WHEN ? IN ('succeeded','failed','cancelled') THEN datetime('now') ELSE finished_at END
       WHERE id=?`,
      [status, status, status, id],
    );
  }

  recordResult(id: string, output?: unknown, error?: string): void {
    execRun(this.db, "UPDATE tasks SET output=?, error=?, updated_at=datetime('now') WHERE id=?", [
      output ? JSON.stringify(output) : null,
      error ?? null,
      id,
    ]);
  }

  getById(id: string): TaskRow | undefined {
    return execOne(this.db, "SELECT * FROM tasks WHERE id=?", [id]) as unknown as TaskRow | undefined;
  }

  listByStatus(status: string, limit = 50): TaskRow[] {
    return execAll(this.db, "SELECT * FROM tasks WHERE status=? ORDER BY created_at DESC LIMIT ?", [
      status,
      limit,
    ]) as unknown as TaskRow[];
  }

  listPending(limit = 50): TaskRow[] {
    return this.listByStatus("pending", limit);
  }
}

// ============================================================================
// Audit Repository
// ============================================================================

export class AuditRepo {
  constructor(private db: SqlJsDatabase) {}

  log(params: {
    level?: string;
    event: string;
    sessionId?: string;
    workspaceId?: string;
    tool?: string;
    channel?: string;
    subject?: string;
    risk?: string;
    detail?: string;
  }): void {
    execRun(
      this.db,
      "INSERT INTO audit_events (level, event, session_id, workspace_id, tool, channel, subject, risk, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        params.level ?? "info",
        params.event,
        params.sessionId ?? null,
        params.workspaceId ?? null,
        params.tool ?? null,
        params.channel ?? null,
        params.subject ?? null,
        params.risk ?? null,
        params.detail ?? null,
      ],
    );
  }

  /** Bridge to MemoryEngine auditSink: persist memory events to SQLite. */
  toAuditSink(): (event: { type: string; name?: string; reviewer?: string; timestamp?: string }) => void {
    return (event) => {
      this.log({
        event: event.type,
        subject: event.name,
        detail: event.reviewer ? `reviewer=${event.reviewer}` : undefined,
        level: event.type.includes("rejected") ? "warn" : "info",
      });
    };
  }

  query(params: {
    sessionId?: string;
    event?: string;
    limit?: number;
    offset?: number;
    since?: string;
    until?: string;
  }): AuditEventRow[] {
    let sql = "SELECT * FROM audit_events WHERE 1=1";
    const args: SqlValue[] = [];
    if (params.sessionId) {
      sql += " AND session_id=?";
      args.push(params.sessionId);
    }
    if (params.event) {
      sql += " AND event=?";
      args.push(params.event);
    }
    if (params.since) {
      sql += " AND ts >= ?";
      args.push(params.since);
    }
    if (params.until) {
      sql += " AND ts <= ?";
      args.push(params.until);
    }
    sql += " ORDER BY ts DESC LIMIT ?";
    args.push(params.limit ?? 100);
    if (params.offset) {
      sql += " OFFSET ?";
      args.push(params.offset);
    }
    return execAll(this.db, sql, args) as unknown as AuditEventRow[];
  }

  /** Replay audit events for a session in chronological order. */
  replay(sessionId: string, limit = 500): AuditEventRow[] {
    return execAll(this.db, "SELECT * FROM audit_events WHERE session_id=? ORDER BY ts ASC LIMIT ?", [
      sessionId,
      limit,
    ]) as unknown as AuditEventRow[];
  }

  /** Count audit events matching filter criteria. */
  count(params: { sessionId?: string; event?: string; since?: string } = {}): number {
    let sql = "SELECT COUNT(*) as c FROM audit_events WHERE 1=1";
    const args: SqlValue[] = [];
    if (params.sessionId) {
      sql += " AND session_id=?";
      args.push(params.sessionId);
    }
    if (params.event) {
      sql += " AND event=?";
      args.push(params.event);
    }
    if (params.since) {
      sql += " AND ts >= ?";
      args.push(params.since);
    }
    const row = execOne(this.db, sql, args);
    return Number(row?.c ?? 0);
  }
}

// ============================================================================
// TaskTimeline — task_events timeline (KCP-0401)
// ============================================================================

export class TaskTimeline {
  constructor(private db: SqlJsDatabase) {}

  record(params: {
    taskId: string;
    fromStatus?: string;
    toStatus: string;
    source?: string;
    sessionId?: string;
    peerId?: string;
    detail?: string;
  }): void {
    execRun(
      this.db,
      "INSERT INTO task_events (task_id, from_status, to_status, source, session_id, peer_id, detail) VALUES (?,?,?,?,?,?,?)",
      [
        params.taskId,
        params.fromStatus ?? null,
        params.toStatus,
        params.source ?? "cli",
        params.sessionId ?? null,
        params.peerId ?? null,
        params.detail ?? null,
      ],
    );
  }

  list(taskId: string, limit = 50): { fromStatus: string; toStatus: string; createdAt: string }[] {
    const rows = execAll(
      this.db,
      "SELECT from_status, to_status, created_at FROM task_events WHERE task_id=? ORDER BY created_at ASC LIMIT ?",
      [taskId, limit],
    );
    return rows.map((r) => ({
      fromStatus: String(r.from_status ?? ""),
      toStatus: String(r.to_status),
      createdAt: String(r.created_at),
    }));
  }
}
