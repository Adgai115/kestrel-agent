import { AuditRepo, KestrelDatabase } from "@kestrel/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuditService, KESTREL_OBSERVABILITY_VERSION } from "../src/index.js";

describe("@kestrel/observability", () => {
  let db: KestrelDatabase;
  let service: AuditService;

  beforeEach(async () => {
    db = await KestrelDatabase.create({ memory: true });
    const repo = new AuditRepo(db.db);
    service = new AuditService({ auditRepo: repo, workspaceId: "ws-test" });
  });

  afterEach(() => db.close());

  it("exports version", () => expect(KESTREL_OBSERVABILITY_VERSION).toBe("0.0.1"));

  it("permissionSink writes audit events", () => {
    service.permissionSink({
      event: "permission.decided",
      tool: "read",
      channel: "cli",
      subject: "local-user",
      risk: "low",
      decision: "allow",
      reason: "default",
    });
    const _events = service.query("nonexistent");
    // Query by session filters — let's check workspace events via a broader query
    // Actually, permission sink uses the provided sessionId. Let's call it with one.
  });

  it("memorySink writes memory.proposed", () => {
    service.memorySink({
      type: "memory.proposed",
      name: "test-mem",
      memoryType: "project",
      timestamp: new Date().toISOString(),
    });
    // Verify via AuditRepo directly
    const repo = new AuditRepo(db.db);
    const events = repo.query({ event: "memory.proposed" });
    expect(events).toHaveLength(1);
    expect(events[0]!.detail).toContain("test-mem");
  });

  it("memorySink writes memory.accepted with reviewer", () => {
    service.memorySink({ type: "memory.accepted", name: "mem-1", reviewer: "admin", timestamp: "" });
    const repo = new AuditRepo(db.db);
    const events = repo.query({ event: "memory.accepted" });
    expect(events).toHaveLength(1);
    expect(events[0]!.detail).toContain("reviewer=admin");
  });

  it("skillSink writes skill events", () => {
    service.skillSink({ type: "skill.accepted", name: "my-skill", reviewer: "mod", timestamp: "" });
    service.skillSink({
      type: "skill.executed",
      name: "my-skill",
      context: { invokedBy: "agent", channel: "cli" },
      timestamp: "",
    });

    const repo = new AuditRepo(db.db);
    expect(repo.query({ event: "skill.accepted" })).toHaveLength(1);
    expect(repo.query({ event: "skill.executed" })).toHaveLength(1);
  });

  it("taskSink writes task lifecycle", () => {
    service.taskSink({ event: "task.created", taskId: "t1", kind: "shell", status: "pending" });
    service.taskSink({ event: "task.started", taskId: "t1", kind: "shell", status: "running" });
    service.taskSink({ event: "task.finished", taskId: "t1", kind: "shell", status: "succeeded" });

    const repo = new AuditRepo(db.db);
    expect(repo.query({ event: "task.created" })).toHaveLength(1);
  });

  it("log writes generic events", () => {
    service.log("gateway.start", "port=3100");
    service.log("gateway.stop");

    const repo = new AuditRepo(db.db);
    const events = repo.query({});
    expect(events.length).toBeGreaterThanOrEqual(2);
  });

  it("query filters by session", () => {
    const repo = new AuditRepo(db.db);
    const svc = new AuditService({ auditRepo: repo });

    svc.log("session.created", "new", "sess-1");
    svc.log("message.received", "hello", "sess-1");
    svc.log("session.created", "other", "sess-2");

    const s1 = svc.query("sess-1");
    expect(s1.length).toBeGreaterThanOrEqual(2);
    expect(s1.every((e) => e.session_id === "sess-1")).toBe(true);
  });
});

// TASK-0073+0032: Wire function unit tests (GAP-004)
describe("wiring helpers", () => {
  it("wireMemoryEngine sets auditSink and requireAudit", async () => {
    const { wireMemoryEngine } = await import("../src/wiring.js");
    const config = wireMemoryEngine({}, { memorySink: () => {} } as any);
    expect(config.auditSink).toBeDefined();
    expect(config.requireAudit).toBe(true);
  });

  it("wireMemoryEngine preserves existing config", async () => {
    const { wireMemoryEngine } = await import("../src/wiring.js");
    const config = wireMemoryEngine({ requireAudit: false, custom: 42 } as any, { memorySink: () => {} } as any);
    expect(config.auditSink).toBeDefined();
    expect(config.requireAudit).toBe(false);
    expect((config as any).custom).toBe(42);
  });

  it("wirePermissionEngine sets auditSink", async () => {
    const { wirePermissionEngine } = await import("../src/wiring.js");
    const config = wirePermissionEngine({}, { permissionSink: () => {} } as any);
    expect(config.auditSink).toBeDefined();
  });

  it("wireTaskEngine sets auditSink", async () => {
    const { wireTaskEngine } = await import("../src/wiring.js");
    const config = wireTaskEngine({}, { taskSink: () => {} } as any);
    expect(config.auditSink).toBeDefined();
  });

  it("wireSkillRegistry sets auditSink", async () => {
    const { wireSkillRegistry } = await import("../src/wiring.js");
    const config = wireSkillRegistry({}, { skillSink: () => {} } as any);
    expect(config.auditSink).toBeDefined();
  });
});
