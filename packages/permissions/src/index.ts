/**
 * @kestrel/permissions - ABAC permission engine with audit support.
 */

export { escalateRisk, isDangerousCommand, isProtectedPath } from "./classifier.js";
export { PermissionEngine, type PermissionEngineConfig } from "./engine.js";
export { ToolPolicy, type PolicyContext, type PolicyResult, type ToolCall } from "./policy.js";
export {
  type AuditSink,
  type Channel,
  type ChatType,
  type Decision,
  getToolRisk,
  getTrustLevel,
  type PermissionRequest,
  type PermissionResult,
  type RiskLevel,
  type Subject,
  type Tool,
  type TrustLevel,
} from "./types.js";

export const KESTREL_PERMISSIONS_VERSION = "0.0.1";
