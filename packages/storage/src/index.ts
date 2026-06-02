/**
 * @kestrel/storage - SQLite-based event store with FTS5 search.
 */

export { KestrelDatabase, type StorageConfig } from "./database.js";
export {
  type AuditEventRow,
  ChannelConfigRepo,
  type ChannelConfigRow,
  AuditRepo,
  MessageRepo,
  type MessageRow,
  type SearchResult,
  SessionRepo,
  type SessionRow,
  TaskRepo,
  type TaskRow,
  OutboxRepo,
  type OutboxRow,
  TaskTimeline,
  ToolCallRepo,
  type ToolCallRow,
} from "./repositories.js";

export const KESTREL_STORAGE_VERSION = "0.0.1";
