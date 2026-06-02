/**
 * Skill engine types. Per SOP Section 10.
 */

export type SkillRiskLevel = "low" | "medium" | "high" | "critical";
export type SkillReviewStatus = "pending" | "accepted" | "rejected";

export interface SkillManifest {
  name: string;
  version: string;
  description: string;
  /** Permissions this skill requires (e.g. ["read", "web"]) */
  permissions: string[];
  /** Tools this skill registers */
  tools: string[];
  /** Optional tags for discovery */
  tags?: string[];
  riskLevel: SkillRiskLevel;
  createdBy: string;
  reviewStatus: SkillReviewStatus;
}

export interface Skill {
  manifest: SkillManifest;
  /** Path to SKILL.md content */
  skillMd: string;
  /** Path to the skill directory */
  path: string;
  loadedAt: string;
}

export interface SkillProposal {
  skill: Skill;
  status: SkillReviewStatus;
  proposedAt: string;
  reason: string;
}

export interface SkillExecutionContext {
  skillName: string;
  /** Who invoked the skill */
  invokedBy: string;
  /** Channel it was invoked from */
  channel: string;
  timestamp: string;
}

export type SkillAuditEvent =
  | { type: "skill.proposed"; name: string; timestamp: string }
  | { type: "skill.accepted"; name: string; reviewer: string; timestamp: string }
  | { type: "skill.rejected"; name: string; reviewer: string; timestamp: string }
  | { type: "skill.executed"; name: string; context: SkillExecutionContext }
  | { type: "skill.published"; name: string }
  | { type: "skill.installed"; name: string };

export type SkillAuditSink = (event: SkillAuditEvent) => void;
