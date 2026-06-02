/**
 * AuditService — end-to-end audit wiring.
 *
 * Provides ready-made audit sinks for all subsystems, piping events
 * into the SQLite audit_events table via AuditRepo.
 */

import type { AuditRepo } from "@kestrel/storage";

export interface AuditServiceConfig {
  auditRepo: AuditRepo;
  /** Default workspace for audit events */
  workspaceId?: string;
}

export class AuditService {
  private repo: AuditRepo;
  private workspaceId: string;

  constructor(config: AuditServiceConfig) {
    this.repo = config.auditRepo;
    this.workspaceId = config.workspaceId ?? "default";
  }

  /** Audit sink for PermissionEngine */
  get permissionSink() {
    return (event: {
      event: string;
      sessionId?: string;
      workspaceId?: string;
      tool?: string;
      channel?: string;
      subject?: string;
      risk?: string;
      decision?: string;
      reason?: string;
    }) => {
      this.repo.log({
        event: event.event,
        sessionId: event.sessionId,
        workspaceId: event.workspaceId ?? this.workspaceId,
        tool: event.tool,
        channel: event.channel,
        subject: event.subject,
        risk: event.risk,
        detail: `decision=${event.decision} reason=${event.reason}`,
      });
    };
  }

  /** Audit sink for MemoryEngine (memory.proposed / accepted / rejected) */
  get memorySink() {
    return (event: { type: string; name: string; memoryType?: string; reviewer?: string; timestamp: string }) => {
      const detailParts = [`name=${event.name}`];
      if (event.memoryType) detailParts.push(`type=${event.memoryType}`);
      if (event.reviewer) detailParts.push(`reviewer=${event.reviewer}`);

      this.repo.log({
        event: event.type,
        workspaceId: this.workspaceId,
        detail: detailParts.join(" "),
      });
    };
  }

  /** Audit sink for SkillRegistry (skill.proposed / accepted / rejected / executed) */
  get skillSink() {
    return (event: {
      type: string;
      name: string;
      reviewer?: string;
      context?: { invokedBy: string; channel: string };
      timestamp: string;
    }) => {
      const detailParts = [`name=${event.name}`];
      if (event.reviewer) detailParts.push(`reviewer=${event.reviewer}`);
      if (event.context) detailParts.push(`invokedBy=${event.context.invokedBy} channel=${event.context.channel}`);

      this.repo.log({
        event: event.type,
        workspaceId: this.workspaceId,
        detail: detailParts.join(" "),
      });
    };
  }

  /** Audit sink for TaskEngine */
  get taskSink() {
    return (event: { event: string; taskId: string; kind: string; status: string }) => {
      this.repo.log({
        event: event.event,
        workspaceId: this.workspaceId,
        detail: `taskId=${event.taskId} kind=${event.kind} status=${event.status}`,
      });
    };
  }

  /** Generic audit log for ad-hoc events */
  log(event: string, detail?: string, sessionId?: string): void {
    this.repo.log({
      event,
      sessionId,
      workspaceId: this.workspaceId,
      detail,
    });
  }

  /** Query audit events by session */
  query(sessionId: string, limit?: number) {
    return this.repo.query({ sessionId, limit });
  }
}
