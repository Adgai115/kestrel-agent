/**
 * KCP-1132: Channel configuration persistence.
 *
 * Stores per-channel config (credentials, enabled status, health) so
 * channel state survives Gateway restarts.
 */

export const CHANNEL_CONFIG_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS channel_config (
    channel TEXT PRIMARY KEY NOT NULL
      CHECK(channel IN ('feishu','telegram','slack','webchat')),
    enabled INTEGER NOT NULL DEFAULT 1,
    config_json TEXT,
    status TEXT NOT NULL DEFAULT 'unconfigured'
      CHECK(status IN ('unconfigured','connected','disconnected','error')),
    last_error TEXT,
    last_connected_at TEXT,
    last_error_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_channel_config_enabled ON channel_config(enabled)",
];
