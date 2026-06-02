/**
 * Database schema and migrations for sql.js.
 */

import type { Database as SqlJsDatabase } from "sql.js";
import { CHANNEL_CONFIG_SCHEMA } from "./channel-config.schema.js";
import { CHANNEL_QUEUE_SCHEMA } from "./channel-queue.schema.js";
import { CRON_SCHEMA } from "./cron.schema.js";

const MIGRATIONS: Record<number, string[]> = {
  1: [
    "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)",

    `CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      name TEXT,
      workspace_id TEXT NOT NULL,
      model_provider TEXT,
      model_id TEXT,
      thinking_level TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      message_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,

    `CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user','assistant','tool','system','custom')),
      content TEXT,
      tool_call_id TEXT,
      tokens_input INTEGER DEFAULT 0,
      tokens_output INTEGER DEFAULT 0,
      tokens_cache_read INTEGER DEFAULT 0,
      cost_input REAL DEFAULT 0,
      cost_output REAL DEFAULT 0,
      channel TEXT DEFAULT 'cli',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,

    `CREATE TABLE IF NOT EXISTS tool_calls (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      tool_name TEXT NOT NULL,
      args TEXT,
      result TEXT,
      is_error INTEGER NOT NULL DEFAULT 0,
      started_at TEXT,
      finished_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,

    `CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('agent','shell','workflow','cron','memory','skill')),
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending','running','succeeded','failed','cancelled','waiting_for_approval','blocked')),
      workspace_id TEXT NOT NULL,
      session_id TEXT,
      created_by TEXT,
      channel TEXT DEFAULT 'cli',
      input TEXT,
      output TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      started_at TEXT,
      finished_at TEXT
    )`,

    `CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL DEFAULT (datetime('now')),
      level TEXT NOT NULL DEFAULT 'info',
      event TEXT NOT NULL,
      session_id TEXT,
      workspace_id TEXT,
      tool TEXT,
      channel TEXT,
      subject TEXT,
      risk TEXT,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,

    "CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id)",
    "CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)",
    "CREATE INDEX IF NOT EXISTS idx_audit_event ON audit_events(event)",
    "CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_events(session_id)",

    // KCP-0401: Task event timeline for state machine transitions
    `CREATE TABLE IF NOT EXISTS task_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      from_status TEXT,
      to_status TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'cli',
      session_id TEXT,
      peer_id TEXT,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    "CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events(task_id, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_task_events_session ON task_events(session_id)",
  ],
  // KCP-0501 + KCP-0601: channel queue + durable cron
  2: [...CHANNEL_QUEUE_SCHEMA, ...CRON_SCHEMA],
  // TASK-1132: channel configuration persistence
  3: [...CHANNEL_CONFIG_SCHEMA],
};

export function runMigrations(db: SqlJsDatabase): void {
  db.run("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)");

  const currentVersion = ((): number => {
    try {
      const rows = db.exec("SELECT COALESCE(MAX(version), 0) as v FROM schema_version");
      if (rows.length > 0 && rows[0]!.values.length > 0) {
        return Number(rows[0]!.values[0]![0]) || 0;
      }
      return 0;
    } catch {
      return 0;
    }
  })();

  for (let v = currentVersion + 1; v <= Object.keys(MIGRATIONS).length; v++) {
    const statements = MIGRATIONS[v];
    if (statements) {
      try {
        db.run("BEGIN");
        for (const sql of statements) {
          db.run(sql);
        }
        db.run("INSERT OR REPLACE INTO schema_version (version) VALUES (?)", [v]);
        db.run("COMMIT");
      } catch (e) {
        try {
          db.run("ROLLBACK");
        } catch {
          /* ignore */
        }
        throw e;
      }
    }
  }
}
