/**
 * KCP-0601: Durable cron jobs/runs/missed-runs schema.
 *
 * cron_jobs       — persistent job definitions
 * cron_runs       — execution history
 * cron_missed_runs — detected missed executions with catch-up policy
 */

export const CRON_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS cron_jobs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    schedule TEXT NOT NULL,
    command TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    catch_up_policy TEXT NOT NULL DEFAULT 'skip'
      CHECK(catch_up_policy IN ('skip','run_once','run_all')),
    max_retries INTEGER NOT NULL DEFAULT 0,
    timeout_ms INTEGER NOT NULL DEFAULT 60000,
    last_run_at TEXT,
    next_run_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_cron_jobs_next ON cron_jobs(enabled, next_run_at)",

  `CREATE TABLE IF NOT EXISTS cron_runs (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES cron_jobs(id) ON DELETE CASCADE,
    scheduled_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    status TEXT NOT NULL DEFAULT 'scheduled'
      CHECK(status IN ('scheduled','running','succeeded','failed','missed','cancelled')),
    exit_code INTEGER,
    output TEXT,
    error TEXT,
    retry_of TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_cron_runs_job ON cron_runs(job_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_cron_runs_status ON cron_runs(status)",

  `CREATE TABLE IF NOT EXISTS cron_missed_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL REFERENCES cron_jobs(id) ON DELETE CASCADE,
    scheduled_at TEXT NOT NULL,
    detected_at TEXT NOT NULL DEFAULT (datetime('now')),
    handled INTEGER NOT NULL DEFAULT 0,
    catch_up_run_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_cron_missed ON cron_missed_runs(job_id, handled)",
];
