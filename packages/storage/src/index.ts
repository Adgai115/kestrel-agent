/**
 * @kestrel/storage - SQLite-based event store with FTS5 search.
 */

export { KestrelDatabase, type StorageConfig } from "./database.js";
export {
  type AuditEventRow,
  AuditRepo,
  MessageRepo,
  type MessageRow,
  type SearchResult,
  SessionRepo,
  type SessionRow,
  TaskRepo,
  type TaskRow,
  TaskTimeline,
  ToolCallRepo,
  type ToolCallRow,
} from "./repositories.js";

export const KESTREL_STORAGE_VERSION = "0.0.1";
