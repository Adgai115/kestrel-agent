/**
 * TASK-0032: AuditService wiring helpers.
 *
 * Each helper takes a subsystem config object plus an AuditService,
 * and returns the config augmented with the correct audit sink.
 *
 * These use structural typing — no hard imports from other packages.
 * Just call `wireXxx(config, auditService)` and pass the result
 * to the subsystem constructor.
 */

import type { AuditService } from "./audit.js";

// ============================================================================
// MemoryEngine
// ============================================================================

export interface MemoryEngineConfig {
  auditSink?: (event: {
    type: string;
    name: string;
    memoryType?: string;
    reviewer?: string;
    timestamp: string;
  }) => void;
  requireAudit?: boolean;
  [key: string]: unknown;
}

export function wireMemoryEngine(config: MemoryEngineConfig, audit: AuditService): MemoryEngineConfig {
  return {
    ...config,
    auditSink: (e) => audit.memorySink(e),
    requireAudit: config.requireAudit ?? true,
  };
}

// ============================================================================
// PermissionEngine
// ============================================================================

export interface PermissionEngineConfig {
  auditSink?: (event: {
    event: string;
    sessionId?: string;
    workspaceId?: string;
    tool?: string;
    channel?: string;
    subject?: string;
    risk?: string;
    decision?: string;
    reason?: string;
  }) => void;
  [key: string]: unknown;
}

export function wirePermissionEngine(config: PermissionEngineConfig, audit: AuditService): PermissionEngineConfig {
  return { ...config, auditSink: (e) => audit.permissionSink(e) };
}

// ============================================================================
// TaskEngine
// ============================================================================

export interface TaskEngineConfig {
  auditSink?: (event: { event: string; taskId: string; kind: string; status: string }) => void;
  [key: string]: unknown;
}

export function wireTaskEngine(config: TaskEngineConfig, audit: AuditService): TaskEngineConfig {
  return { ...config, auditSink: (e) => audit.taskSink(e) };
}

// ============================================================================
// SkillRegistry
// ============================================================================

export interface SkillRegistryConfig {
  auditSink?: (event: {
    type: string;
    name: string;
    reviewer?: string;
    context?: { invokedBy: string; channel: string };
    timestamp: string;
  }) => void;
  [key: string]: unknown;
}

export function wireSkillRegistry(config: SkillRegistryConfig, audit: AuditService): SkillRegistryConfig {
  return { ...config, auditSink: (e) => audit.skillSink(e) };
}
