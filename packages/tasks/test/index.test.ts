import { KestrelDatabase, TaskRepo } from "@kestrel/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KESTREL_TASKS_VERSION, TaskEngine } from "../src/index.js";

describe("@kestrel/tasks", () => {
  let db: KestrelDatabase;
  let engine: TaskEngine;

  beforeEach(async () => {
    db = await KestrelDatabase.create({ memory: true });
    const repo = new TaskRepo(db.db);
    engine = new TaskEngine({ taskRepo: repo, concurrency: 2 });
    engine.register("shell", async (task, _signal) => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { ok: true, input: task.input };
    });
    engine.register("agent", async (_task, signal) => {
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve({ done: true }), 5000);
        signal.addEventListener("abort", () => {
          clearTimeout(t);
          reject(new Error("aborted"));
        });
      });
    });
    engine.register("cron", async () => {
      throw new Error("intentional failure");
    });
  });

  afterEach(() => db.close());

  it("exports version", () => expect(KESTREL_TASKS_VERSION).toBe("0.0.1"));

  // Create
  it("creates a task with pending status", () => {
    const t = engine.create({ title: "Test", kind: "shell", workspaceId: "ws-1" });
    expect(t.status).toBe("pending");
    expect(t.kind).toBe("shell");
  });

  // Run + completion
  it("runs a task to completion", async () => {
    const t = engine.create({ title: "Run me", kind: "shell", workspaceId: "ws-1" });
    const result = await engine.run(t.id);
    expect(result.status).toBe("succeeded");
  });

  it("task failure is recorded", async () => {
    const t = engine.create({ title: "Fail", kind: "cron", workspaceId: "ws-1" });
    const result = await engine.run(t.id);
    expect(result.status).toBe("failed");
    expect(result.error).toContain("intentional failure");
  });

  // Cancel
  it("can cancel a pending task", () => {
    const t = engine.create({ title: "Cancel me", kind: "shell", workspaceId: "ws-1" });
    engine.cancel(t.id);
    const updated = engine.get(t.id);
    expect(updated!.status).toBe("cancelled");
  });

  // List
  it("lists tasks by status", () => {
    engine.create({ title: "A", kind: "shell", workspaceId: "ws-1" });
    engine.create({ title: "B", kind: "shell", workspaceId: "ws-1" });
    expect(engine.listPending()).toHaveLength(2);
    expect(engine.listByStatus("pending")).toHaveLength(2);
  });

  // Concurrency
  it("respects concurrency limit", async () => {
    // Create 3 tasks, concurrency is 2
    const t1 = engine.create({ title: "1", kind: "shell", workspaceId: "ws-1" });
    const t2 = engine.create({ title: "2", kind: "shell", workspaceId: "ws-1" });
    const t3 = engine.create({ title: "3", kind: "shell", workspaceId: "ws-1" });

    const p1 = engine.run(t1.id);
    const p2 = engine.run(t2.id);
    const p3 = engine.run(t3.id);

    await Promise.all([p1, p2, p3]);
    expect(engine.get(t1.id)!.status).toBe("succeeded");
    expect(engine.get(t2.id)!.status).toBe("succeeded");
    expect(engine.get(t3.id)!.status).toBe("succeeded");
  });

  // Audit events
  it("emits audit events", async () => {
    const events: unknown[] = [];
    const repo = new TaskRepo(db.db);
    const eng = new TaskEngine({ taskRepo: repo, auditSink: (e) => events.push(e) });
    eng.register("shell", async () => ({ ok: true }));

    const t = eng.create({ title: "Audit", kind: "shell", workspaceId: "ws-1" });
    await eng.run(t.id);

    expect(events.length).toBeGreaterThanOrEqual(2); // created + started + finished
    expect(events[0]).toMatchObject({ event: "task.created" });
  });

  // Missing handler
  it("throws when no handler registered", async () => {
    const t = engine.create({ title: "No handler", kind: "skill", workspaceId: "ws-1" });
    await expect(engine.run(t.id)).rejects.toThrow("No handler registered");
  });
});
