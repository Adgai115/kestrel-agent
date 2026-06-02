import { checkDuplicate } from "./deduper.js";
/**
 * Lesson Extractor (KCP-0701) — extracts patterns from task/audit timelines
 * and produces scored lesson proposals for the memory engine.
 */
import { type ProposalScore, scoreProposal } from "./scorer.js";
import { containsSecrets } from "./secret-detector.js";

export interface LessonCandidate {
  name: string;
  type: "user" | "feedback" | "project" | "reference";
  content: string;
  reason: string;
  score: ProposalScore;
}

export interface ExtractionResult {
  candidates: LessonCandidate[];
  summary: string;
}

/**
 * Extract lessons from task_events + audit_events data.
 * Consumes row arrays from TaskTimeline.list() and AuditRepo.query().
 */
export function extractLessons(params: {
  taskEvents: Array<{ fromStatus: string; toStatus: string; createdAt: string }>;
  auditEvents: Array<{ event: string; tool?: string; detail?: string; ts?: string; level?: string }>;
  existingProposals: Array<{ name: string; content: string }>;
}): ExtractionResult {
  const candidates: LessonCandidate[] = [];
  const patterns: string[] = [];

  // ---- Pattern 1: Task failures ----
  const failures = params.taskEvents.filter((e) => e.toStatus === "failed" || e.toStatus === "cancelled");
  const successes = params.taskEvents.filter((e) => e.toStatus === "completed");

  if (failures.length > 0) {
    const failureRate =
      params.taskEvents.length > 0 ? Math.round((failures.length / params.taskEvents.length) * 100) : 0;
    patterns.push(`${failures.length} failures in ${params.taskEvents.length} task transitions (${failureRate}%)`);

    if (failureRate >= 30) {
      const name = "high-task-failure-rate";
      const content = `Task failure rate is ${failureRate}% across ${params.taskEvents.length} status transitions. Consider reviewing task creation patterns and error handling.`;
      const score = scoreProposal({ content, source: "audit", frequency: failures.length });
      candidates.push({
        name,
        type: "feedback",
        content,
        reason: `Failure rate ${failureRate}% exceeds 30% threshold`,
        score,
      });
    }

    // Extract common failure prefix from audit events
    const failureAudit = params.auditEvents.filter(
      (e) => e.level === "warn" || e.event?.includes("denied") || e.event?.includes("failed"),
    );
    if (failureAudit.length >= 3) {
      const name = "repeated-tool-failures";
      const tools = [...new Set(failureAudit.map((e) => e.tool).filter(Boolean))].slice(0, 5).join(", ");
      const content = `Multiple tool failures detected: ${tools}. Review tool usage patterns and error messages.`;
      const score = scoreProposal({ content, source: "audit", frequency: failureAudit.length });
      candidates.push({
        name,
        type: "feedback",
        content,
        reason: `${failureAudit.length} failed/denied tool events`,
        score,
      });
    }
  }

  // ---- Pattern 2: Success patterns ----
  if (successes.length > 0 && failures.length < successes.length) {
    patterns.push(`${successes.length} successful task completions`);
  }

  // ---- Pattern 3: Bash tool safety ----
  const bashEvents = params.auditEvents.filter((e) => e.tool === "bash");
  if (bashEvents.length >= 5) {
    const name = "frequent-bash-usage";
    const content = `Bash tool was used ${bashEvents.length} times. Consider creating automated scripts or skill templates for repeated operations.`;
    const score = scoreProposal({ content, source: "audit", frequency: bashEvents.length });
    candidates.push({
      name,
      type: "reference",
      content,
      reason: `Bash used ${bashEvents.length} times — repeated commands may benefit from automation`,
      score,
    });
  }

  // ---- Pattern 4: Approval patterns ----
  const approvals = params.auditEvents.filter((e) => e.event?.includes("approved") || e.event?.includes("allow"));
  const denials = params.auditEvents.filter((e) => e.event?.includes("denied") || e.event?.includes("deny"));
  if (approvals.length > denials.length * 3 && approvals.length > 3) {
    const name = "trust-level-adjustment-suggested";
    const content = `High approval-to-denial ratio (${approvals.length}/${denials.length || 0}). Consider raising the default trust level.`;
    const score = scoreProposal({ content, source: "audit", frequency: approvals.length });
    candidates.push({
      name,
      type: "project",
      content,
      reason: `${approvals.length} approvals vs ${denials.length || 0} denials`,
      score,
    });
  }

  // ---- Filter: deduplicate against existing ----
  const filtered = candidates.filter((c) => {
    const dup = checkDuplicate(c.name, c.content, params.existingProposals);
    return !dup.isDuplicate || dup.similarity < 0.8;
  });

  // ---- Filter: secret safety ----
  const safe = filtered.filter((c) => !containsSecrets(c.content));

  // ---- Sort by score ----
  safe.sort((a, b) => b.score.total - a.score.total);

  return {
    candidates: safe.slice(0, 5), // top 5
    summary: patterns.join("; ") || "No significant patterns detected",
  };
}
