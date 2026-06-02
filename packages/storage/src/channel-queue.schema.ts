/**
 * KCP-0501: Channel inbox/outbox/dead-letter schemas.
 *
 * inbox  — inbound messages from channels (Feishu/Telegram/WebChat)
 * outbox — outbound messages pending delivery
 * dead_letter — permanently failed deliveries
 */

export const CHANNEL_QUEUE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS channel_inbox (
    id TEXT PRIMARY KEY,
    channel TEXT NOT NULL CHECK(channel IN ('feishu','telegram','webchat')),
    chat_type TEXT DEFAULT 'private',
    peer_id TEXT NOT NULL,
    message_id TEXT NOT NULL UNIQUE,
    content TEXT NOT NULL,
    raw_payload TEXT,
    session_id TEXT,
    task_id TEXT,
    status TEXT NOT NULL DEFAULT 'received'
      CHECK(status IN ('received','claimed','processing','completed','failed')),
    claimed_by TEXT,
    claimed_at TEXT,
    processed_at TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_inbox_status ON channel_inbox(status, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_inbox_channel ON channel_inbox(channel, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_inbox_session ON channel_inbox(session_id)",
  "CREATE INDEX IF NOT EXISTS idx_inbox_task ON channel_inbox(task_id)",

  `CREATE TABLE IF NOT EXISTS channel_outbox (
    id TEXT PRIMARY KEY,
    channel TEXT NOT NULL,
    peer_id TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK(status IN ('pending','sending','sent','failed','dead')),
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,
    last_error TEXT,
    next_retry_at TEXT,
    sent_at TEXT,
    session_id TEXT,
    task_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_outbox_status ON channel_outbox(status, next_retry_at)",
  "CREATE INDEX IF NOT EXISTS idx_outbox_channel ON channel_outbox(channel, created_at)",

  `CREATE TABLE IF NOT EXISTS channel_dead_letter (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    original_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    peer_id TEXT NOT NULL,
    content TEXT NOT NULL,
    last_error TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    failed_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dead_letter_channel ON channel_dead_letter(channel, failed_at)",
];
