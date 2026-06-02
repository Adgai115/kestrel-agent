/**
 * @kestrel/skills - Skill registry with proposal system and audit.
 */

export { SkillRegistry, type SkillRegistryConfig } from "./registry.js";
export { type ToolCallRecord, type WorkflowPattern, detectWorkflows, toSkillProposal } from "./workflow-detector.js";
export type {
  Skill,
  SkillAuditEvent,
  SkillAuditSink,
  SkillExecutionContext,
  SkillManifest,
  SkillProposal,
  SkillReviewStatus,
  SkillRiskLevel,
} from "./types.js";

export const KESTREL_SKILLS_VERSION = "0.0.1";
