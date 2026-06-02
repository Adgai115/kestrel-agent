/**
 * Permission decision engine with audit event support.
 */

import { escalateRisk, isProtectedPath } from "./classifier.js";
import type {
  AuditSink,
  Channel,
  Decision,
  PermissionRequest,
  PermissionResult,
  RiskLevel,
  Subject,
  Tool,
  TrustLevel,
} from "./types.js";
import { getToolRisk, getTrustLevel } from "./types.js";

const DEFAULT_POLICY: Record<TrustLevel, Record<RiskLevel, Decision>> = {
  local: { low: "allow", medium: "allow", high: "ask", critical: "ask" },
  trusted: { low: "allow", medium: "ask", high: "ask", critical: "deny" },
  limited: { low: "ask", medium: "ask", high: "deny", critical: "deny" },
  unknown: { low: "deny", medium: "deny", high: "deny", critical: "deny" },
};

/** Tool/channel overrides. "feishu-group" uses limited trust (see getTrustLevel). */
const TOOL_OVERRIDES: Record<string, Partial<Record<Channel, Decision>>> = {
  bash: { feishu: "deny" },
};

export interface PermissionEngineConfig {
  overrides?: Partial<Record<TrustLevel, Partial<Record<RiskLevel, Decision>>>>;
  allowlist?: Record<string, string[]>;
  /** Audit event sink. Every evaluate() call will emit a permission.decided event. */
  auditSink?: AuditSink;
}

export class PermissionEngine {
  private policy: Record<TrustLevel, Record<RiskLevel, Decision>>;

  constructor(private config: PermissionEngineConfig = {}) {
    this.policy = structuredClone(DEFAULT_POLICY);
    if (config.overrides) {
      for (const [trust, risks] of Object.entries(config.overrides)) {
        const key = trust as TrustLevel;
        if (this.policy[key]) Object.assign(this.policy[key], risks);
      }
    }
  }

  evaluate(request: PermissionRequest): PermissionResult {
    const { subject, channel, tool, target, chatType } = request;

    // 1. Determine trust level: explicit override > unknown peer > auto-detect
    let trustLevel: TrustLevel;
    if (request.isUnknownPeer) {
      trustLevel = "unknown";
    } else if (request.trustLevel) {
      trustLevel = request.trustLevel;
    } else {
      trustLevel = getTrustLevel(channel, chatType);
    }

    // 2. Base risk
    const baseRisk = getToolRisk(tool);

    // 3. Escalate
    const risk = escalateRisk(baseRisk, trustLevel, target);

    // 4. Allowlist check
    if (this.config.allowlist) {
      const allowed = this.config.allowlist[channel];
      if (allowed && !allowed.includes(tool)) {
        return this.finalize(
          "deny",
          risk,
          subject,
          channel,
          tool,
          target,
          trustLevel,
          `Tool "${tool}" not in allowlist for "${channel}"`,
          request.sessionId,
        );
      }
    }

    // 5. Unknown peer → always deny
    if (trustLevel === "unknown") {
      return this.finalize(
        "deny",
        risk,
        subject,
        channel,
        tool,
        target,
        trustLevel,
        "Unknown peer denied",
        request.sessionId,
      );
    }

    // 6. Protected paths → ask for local, deny for all others
    if (isProtectedPath(target)) {
      const decision = trustLevel === "local" ? "ask" : "deny";
      return this.finalize(
        decision,
        risk,
        subject,
        channel,
        tool,
        target,
        trustLevel,
        `Protected path "${target}": ${decision}`,
        request.sessionId,
      );
    }

    // 7. Tool/channel override
    const toolOverride = TOOL_OVERRIDES[tool]?.[channel];
    if (toolOverride) {
      return this.finalize(
        toolOverride,
        risk,
        subject,
        channel,
        tool,
        target,
        trustLevel,
        `Tool "${tool}" blocked on "${channel}"`,
        request.sessionId,
      );
    }

    // 8. Default policy
    const decision = this.policy[trustLevel]?.[risk] ?? "deny";

    return this.finalize(
      decision,
      risk,
      subject,
      channel,
      tool,
      target,
      trustLevel,
      `${trustLevel}/${risk} → ${decision}`,
      request.sessionId,
    );
  }

  private finalize(
    decision: Decision,
    risk: RiskLevel,
    subject: Subject,
    channel: Channel,
    tool: Tool,
    target: string | undefined,
    trustLevel: TrustLevel,
    reason: string,
    sessionId?: string,
  ): PermissionResult {
    this.config.auditSink?.({
      event: "permission.decided",
      subject,
      channel,
      tool,
      sessionId,
      risk,
      decision,
      reason,
    });

    return { decision, risk, reason, subject, channel, tool, target, trustLevel };
  }
}
