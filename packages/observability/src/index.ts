/** * @kestrel/observability — audit event wiring and logging. */ export {
  AuditService,
  type AuditServiceConfig,
} from "./audit.js";
export {
  formatError,
  KestrelError,
  NotFoundError,
  PermissionError,
  StorageError,
  TimeoutError,
  ValidationError,
} from "./errors.js";
export {
  type MemoryEngineConfig,
  type PermissionEngineConfig,
  type SkillRegistryConfig,
  type TaskEngineConfig,
  wireMemoryEngine,
  wirePermissionEngine,
  wireSkillRegistry,
  wireTaskEngine,
} from "./wiring.js";
export const KESTREL_OBSERVABILITY_VERSION = "0.0.1";
