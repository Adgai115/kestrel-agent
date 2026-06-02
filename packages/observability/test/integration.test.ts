/**
 * TASK-0022: End-to-end audit pipeline integration.
 *
 * Proves that AuditService sinks, when wired to subsystems, write into
 * the same SQLite audit_events table via AuditRepo.
 */

import { AuditRepo, KestrelDatabase } from "@kestrel/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuditService } from "../src/index.js";

describe("AuditService pipeline integration", () => {
  let db: KestrelDatabase;
  let service: AuditService;
  let repo: AuditRepo;

  beforeEach(async () => {
    db = await KestrelDatabase.create({ memory: true });
    repo = new AuditRepo(db.db);
    service = new AuditService({ auditRepo: repo, workspaceId: "ws-integration" });
  });

  afterEach(() => db.close());

  it("all 4 sinks write to the same audit_events table", () => {
    // Permission events
    service.permissionSink({
      event: "permission.decided",
      tool: "bash",
      channel: "cli",
      subject: "local-user",
      risk: "high",
      decision: "ask",
      reason: "default policy",
      sessionId: "sess-1",
    });

    // Memory events
    service.memorySink({
      type: "memory.proposed",
      name: "user-pref",
      memoryType: "user",
      timestamp: new Date().toISOString(),
    });
    service.memorySink({ type: "memory.accepted", name: "user-pref", reviewer: "admin", timestamp: "" });

    // Skill events
    service.skillSink({ type: "skill.proposed", name: "code-review", timestamp: "" });
    service.skillSink({ type: "skill.accepted", name: "code-review", reviewer: "mod", timestamp: "" });
    service.skillSink({
      type: "skill.executed",
      name: "code-review",
      context: { invokedBy: "agent", channel: "cli" },
      timestamp: "",
    });

    // Task events
    service.taskSink({ event: "task.created", taskId: "t1", kind: "shell", status: "pending" });
    service.taskSink({ event: "task.started", taskId: "t1", kind: "shell", status: "running" });
    service.taskSink({ event: "task.finished", taskId: "t1", kind: "shell", status: "succeeded" });

    // Verify all in one query
    const all = repo.query({ limit: 50 });
    expect(all.length).toBeGreaterThanOrEqual(9);

    // Verify event types
    const types = new Set(all.map((e) => e.event));
    expect(types.has("permission.decided")).toBe(true);
    expect(types.has("memory.proposed")).toBe(true);
    expect(types.has("skill.executed")).toBe(true);
    expect(types.has("task.created")).toBe(true);

    // Verify workspace
    expect(all.every((e) => e.workspace_id === "ws-integration")).toBe(true);
  });

  it("log() writes to the same stream", () => {
    service.permissionSink({
      event: "permission.decided",
      tool: "read",
      channel: "cli",
      subject: "u",
      risk: "low",
      decision: "allow",
      reason: "ok",
    });
    service.log("custom.event", "detail here");

    const all = repo.query({});
    expect(all).toHaveLength(2);
  });

  // TASK-0032: Wiring helpers
  it("wireMemoryEngine connects audit sink", async () => {
    const { wireMemoryEngine } = await import("../src/wiring.js");
    const config = wireMemoryEngine({}, service);
    expect(config.auditSink).toBeDefined();
    expect(config.requireAudit).toBe(true);

    config.auditSink?.({
      type: "memory.proposed",
      name: "wired-mem",
      memoryType: "project",
      timestamp: new Date().toISOString(),
    });
    const events = repo.query({ event: "memory.proposed" });
    expect(events).toHaveLength(1);
  });

  it("wirePermissionEngine connects audit sink", async () => {
    const { wirePermissionEngine } = await import("../src/wiring.js");
    const config = wirePermissionEngine({}, service);
    expect(config.auditSink).toBeDefined();

    config.auditSink?.({
      event: "permission.decided",
      tool: "read",
      channel: "cli",
      subject: "u",
      risk: "low",
      decision: "allow",
      reason: "ok",
    });
    const events = repo.query({ event: "permission.decided" });
    expect(events).toHaveLength(1);
  });

  it("wireTaskEngine connects audit sink", async () => {
    const { wireTaskEngine } = await import("../src/wiring.js");
    const config = wireTaskEngine({}, service);
    expect(config.auditSink).toBeDefined();

    config.auditSink?.({ event: "task.created", taskId: "t1", kind: "shell", status: "pending" });
    const events = repo.query({ event: "task.created" });
    expect(events).toHaveLength(1);
  });

  it("wireSkillRegistry connects audit sink", async () => {
    const { wireSkillRegistry } = await import("../src/wiring.js");
    const config = wireSkillRegistry({}, service);
    expect(config.auditSink).toBeDefined();

    config.auditSink?.({ type: "skill.proposed", name: "my-skill", timestamp: new Date().toISOString() });
    const events = repo.query({ event: "skill.proposed" });
    expect(events).toHaveLength(1);
  });
});
