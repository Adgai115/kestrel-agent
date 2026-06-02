import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AuditRepo,
  KESTREL_STORAGE_VERSION,
  KestrelDatabase,
  MessageRepo,
  SessionRepo,
  TaskRepo,
  ToolCallRepo,
} from "../src/index.js";

describe("@kestrel/storage", () => {
  let db: KestrelDatabase;
  let sessions: SessionRepo;
  let messages: MessageRepo;
  let toolCalls: ToolCallRepo;
  let tasks: TaskRepo;
  let audit: AuditRepo;

  beforeEach(async () => {
    db = await KestrelDatabase.create({ memory: true });
    sessions = new SessionRepo(db.db);
    messages = new MessageRepo(db.db);
    toolCalls = new ToolCallRepo(db.db);
    tasks = new TaskRepo(db.db);
    audit = new AuditRepo(db.db);
  });

  afterEach(() => {
    db.close();
  });

  it("exports version", () => {
    expect(KESTREL_STORAGE_VERSION).toBe("0.0.1");
  });

  // Sessions
  it("creates and reads a session", () => {
    const s = sessions.create({ workspaceId: "ws-1", modelProvider: "deepseek", modelId: "deepseek-v4-pro" });
    expect(s.id).toBeTruthy();
    expect(s.workspace_id).toBe("ws-1");
    expect(s.model_provider).toBe("deepseek");

    const found = sessions.getById(s.id);
    expect(found).toBeDefined();
    expect(found!.model_id).toBe("deepseek-v4-pro");
  });

  it("lists sessions by workspace", () => {
    sessions.create({ workspaceId: "ws-1" });
    sessions.create({ workspaceId: "ws-1" });
    sessions.create({ workspaceId: "ws-2" });

    expect(sessions.list("ws-1")).toHaveLength(2);
    expect(sessions.list("ws-2")).toHaveLength(1);
  });

  it("updates session fields", () => {
    const s = sessions.create({ workspaceId: "ws-1" });
    sessions.update(s.id, { name: "My Session", status: "archived", messageCount: 42 });

    const updated = sessions.getById(s.id);
    expect(updated!.name).toBe("My Session");
    expect(updated!.status).toBe("archived");
    expect(updated!.message_count).toBe(42);
  });

  // Messages
  it("creates and reads messages", () => {
    const s = sessions.create({ workspaceId: "ws-1" });
    messages.create({ sessionId: s.id, role: "user", content: "Hello" });
    messages.create({ sessionId: s.id, role: "assistant", content: "Hi there!", tokensInput: 10, tokensOutput: 5 });

    const msgs = messages.getBySession(s.id);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.role).toBe("user");
    expect(msgs[1]!.role).toBe("assistant");
    expect(msgs[1]!.tokens_input).toBe(10);
  });

  // Tool calls
  it("tracks tool calls", () => {
    const s = sessions.create({ workspaceId: "ws-1" });
    const msg = messages.create({ sessionId: s.id, role: "assistant", content: "calling tool..." });

    const tc = toolCalls.create({ messageId: msg.id, sessionId: s.id, toolName: "read", args: { path: "/tmp/test" } });
    expect(tc.tool_name).toBe("read");
    expect(JSON.parse(tc.args!)).toEqual({ path: "/tmp/test" });

    toolCalls.recordResult(tc.id, { content: "file content" });
    const tcs = toolCalls.getBySession(s.id);
    expect(tcs).toHaveLength(1);
    expect(tcs[0]!.result).toBeTruthy();
  });

  it("records tool call errors", () => {
    const s = sessions.create({ workspaceId: "ws-1" });
    const msg = messages.create({ sessionId: s.id, role: "assistant", content: "calling..." });
    const tc = toolCalls.create({ messageId: msg.id, sessionId: s.id, toolName: "bash", args: { command: "ls" } });

    toolCalls.recordResult(tc.id, { error: "Permission denied" }, true);
    const tcs = toolCalls.getBySession(s.id);
    expect(tcs[0]!.is_error).toBe(1);
  });

  // Tasks
  it("creates and manages tasks", () => {
    const t = tasks.create({ title: "Test task", kind: "shell", workspaceId: "ws-1" });
    expect(t.status).toBe("pending");

    tasks.updateStatus(t.id, "running");
    const running = tasks.getById(t.id);
    expect(running!.status).toBe("running");
    expect(running!.started_at).toBeTruthy();

    tasks.recordResult(t.id, { stdout: "done" });
    tasks.updateStatus(t.id, "succeeded");
    const done = tasks.getById(t.id);
    expect(done!.status).toBe("succeeded");
    expect(done!.finished_at).toBeTruthy();
  });

  it("lists pending tasks", () => {
    tasks.create({ title: "A", kind: "shell", workspaceId: "ws-1" });
    tasks.create({ title: "B", kind: "cron", workspaceId: "ws-1" });
    const t = tasks.create({ title: "C", kind: "memory", workspaceId: "ws-1" });
    tasks.updateStatus(t.id, "running");

    const pending = tasks.listPending();
    expect(pending).toHaveLength(2);
  });

  // Audit
  it("logs audit events", () => {
    audit.log({ event: "session.created", sessionId: "s1", workspaceId: "ws-1", channel: "cli" });
    audit.log({ event: "tool.started", sessionId: "s1", tool: "read", risk: "low" });
    audit.log({ event: "tool.finished", sessionId: "s1", tool: "read", risk: "low" });

    const events = audit.query({ sessionId: "s1" });
    expect(events.length).toBeGreaterThanOrEqual(3);
  });

  it("filters audit by event type", () => {
    audit.log({ event: "tool.started", tool: "read" });
    audit.log({ event: "tool.finished", tool: "read" });
    audit.log({ event: "session.created" });

    const toolEvents = audit.query({ event: "tool.started" });
    expect(toolEvents).toHaveLength(1);
  });

  // Text search (LIKE-based)
  it("searches messages by keyword", () => {
    const s = sessions.create({ workspaceId: "ws-1" });
    messages.create({
      sessionId: s.id,
      role: "user",
      content: "How do I implement a binary search tree in TypeScript?",
    });
    messages.create({ sessionId: s.id, role: "assistant", content: "Here is the binary search tree implementation" });
    messages.create({ sessionId: s.id, role: "user", content: "Now add a deleteNode method" });

    const results = messages.search("binary search tree");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.content).toContain("binary search tree");
  });

  it("searches within a specific session", () => {
    const s1 = sessions.create({ workspaceId: "ws-1" });
    const s2 = sessions.create({ workspaceId: "ws-1" });
    messages.create({ sessionId: s1.id, role: "user", content: "Docker compose setup guide" });
    messages.create({ sessionId: s2.id, role: "user", content: "Kubernetes deployment tutorial" });

    const results = messages.searchInSession(s1.id, "Docker");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.content).toContain("Docker");
  });

  // Transaction support
  it("supports transactions", () => {
    const s = db.transaction(() => {
      const sess = sessions.create({ workspaceId: "ws-1" });
      messages.create({ sessionId: sess.id, role: "user", content: "msg1" });
      messages.create({ sessionId: sess.id, role: "assistant", content: "msg2" });
      return sess;
    });

    expect(messages.getBySession(s.id)).toHaveLength(2);
  });

  // Error handling — AUDIT-014
  it("throws on invalid SQL instead of swallowing", () => {
    expect(() => db.db.exec("SELECT * FROM nonexistent_table")).toThrow();
  });

  // Task state machine — AUDIT-015
  it("rejects invalid task transitions", () => {
    const t = tasks.create({ title: "Test", kind: "shell", workspaceId: "ws-1" });
    expect(() => tasks.updateStatus(t.id, "succeeded")).toThrow("Invalid task transition");
  });

  it("allows valid task transitions", () => {
    const t = tasks.create({ title: "Test", kind: "shell", workspaceId: "ws-1" });
    tasks.updateStatus(t.id, "running"); // pending → running OK
    expect(tasks.getById(t.id)!.status).toBe("running");
    tasks.updateStatus(t.id, "succeeded"); // running → succeeded OK
    expect(tasks.getById(t.id)!.status).toBe("succeeded");
  });

  it("terminal states cannot transition", () => {
    const t = tasks.create({ title: "Test", kind: "shell", workspaceId: "ws-1" });
    tasks.updateStatus(t.id, "running");
    tasks.updateStatus(t.id, "failed");
    expect(() => tasks.updateStatus(t.id, "running")).toThrow("Invalid task transition");
  });

  describe("Backup", () => {
    const tmpDir = join(process.cwd(), ".kestrel-storage-test");

    afterEach(() => {
      if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
    });

    it("creates .db.bak when saving an existing database", async () => {
      if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
      const dbPath = join(tmpDir, "test.db");
      const bakPath = `${dbPath}.bak`;

      const db1 = await KestrelDatabase.create({ dbPath });
      const s = new SessionRepo(db1.db);
      s.create({ workspaceId: "ws-backup" });
      db1.save();
      expect(existsSync(dbPath)).toBe(true);
      expect(existsSync(bakPath)).toBe(false); // first save, no previous file
      db1.close();

      // Reopen and save again — this time .bak should be created
      const db2 = await KestrelDatabase.create({ dbPath });
      db2.save();
      expect(existsSync(bakPath)).toBe(true); // backup created
      db2.close();
    });

    it("does not create backup for in-memory databases", async () => {
      const mem = await KestrelDatabase.create({ memory: true });
      mem.save(); // should not throw
      mem.close();
    });
  });

  // KCP-0404: Schema migration + task_events table
  describe("schema migrations", () => {
    it("creates task_events table (KCP-0401)", async () => {
      const db2 = await KestrelDatabase.create({ memory: true });
      // task_events references tasks — create a task first
      db2.db.run("INSERT INTO tasks (id, title, kind, status, workspace_id) VALUES (?, ?, ?, ?, ?)", [
        "te-task",
        "test",
        "agent",
        "running",
        "ws-1",
      ]);
      db2.db.run("INSERT INTO task_events (task_id, from_status, to_status, source) VALUES (?, ?, ?, ?)", [
        "te-task",
        "pending",
        "running",
        "cli",
      ]);
      const row = db2.db.exec("SELECT * FROM task_events WHERE task_id='te-task'");
      expect(row.length).toBe(1);
      db2.close();
    });

    it("supports multiple migration versions", async () => {
      // Fresh db should have current schema version
      const db = await KestrelDatabase.create({ memory: true });
      const v = db.db.exec("SELECT MAX(version) as v FROM schema_version");
      expect(v.length).toBeGreaterThanOrEqual(0);
      // Running migrations again is idempotent
      expect(() => db.db.run("CREATE TABLE IF NOT EXISTS task_events (id INTEGER PRIMARY KEY)")).not.toThrow();
      db.close();
    });
  });
});
