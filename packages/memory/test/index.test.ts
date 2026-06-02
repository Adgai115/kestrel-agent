import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MemoryAuditEvent } from "../src/index.js";
import { KESTREL_MEMORY_VERSION, MemoryEngine, MemoryLearner } from "../src/index.js";

describe("@kestrel/memory", () => {
  const tmpDir = join(process.cwd(), ".agent-memory-test");

  const noopAudit = () => {};
  function setupEngine(audit?: (e: MemoryAuditEvent) => void) {
    return new MemoryEngine(".", { auditSink: audit ?? noopAudit });
  }

  beforeEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
    mkdirSync(tmpDir, { recursive: true });
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(join(tmpDir, ".."));
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  });

  it("exports version", () => expect(KESTREL_MEMORY_VERSION).toBe("0.0.1"));

  // ==========================================================================
  // Directory
  // ==========================================================================

  it("creates .agent-memory tree", () => {
    setupEngine();
    expect(existsSync(".agent-memory/memories/user")).toBe(true);
    expect(existsSync(".agent-memory/review-queue/pending")).toBe(true);
  });

  // ==========================================================================
  // Propose
  // ==========================================================================

  it("proposes memory to review queue", () => {
    const engine = setupEngine();
    const p = engine.propose(
      {
        name: "user-pref",
        description: "short",
        type: "user",
        content: "Prefers terse.",
        createdAt: "",
        updatedAt: "",
      },
      "user requested",
    );
    expect(p.status).toBe("pending");
    expect(engine.listPending()).toHaveLength(1);
  });

  it("rejects duplicate proposals", () => {
    const engine = setupEngine();
    engine.propose({ name: "dup", description: "x", type: "project", content: "c", createdAt: "", updatedAt: "" }, "r");
    expect(() =>
      engine.propose(
        { name: "dup", description: "x", type: "project", content: "c", createdAt: "", updatedAt: "" },
        "r",
      ),
    ).toThrow("already exists");
  });

  // ==========================================================================
  // Secrets (AUDIT-014-004)
  // ==========================================================================

  it("rejects secrets in content", () => {
    expect(() =>
      setupEngine().propose(
        {
          name: "leak",
          description: "d",
          type: "project",
          content: "password=12345678",
          createdAt: "",
          updatedAt: "",
        },
        "r",
      ),
    ).toThrow("secrets");
  });

  it("rejects secrets in description", () => {
    expect(() =>
      setupEngine().propose(
        {
          name: "leak2",
          description: "token: abc12345",
          type: "project",
          content: "safe",
          createdAt: "",
          updatedAt: "",
        },
        "r",
      ),
    ).toThrow("secrets");
  });

  it("rejects secrets in reason", () => {
    expect(() =>
      setupEngine().propose(
        { name: "leak3", description: "safe", type: "project", content: "safe", createdAt: "", updatedAt: "" },
        "saved key API_KEY=secret1234",
      ),
    ).toThrow("secrets");
  });

  // ==========================================================================
  // Audit events (AUDIT-014-003)
  // ==========================================================================

  it("emits memory.proposed audit event", () => {
    const events: MemoryAuditEvent[] = [];
    const engine = setupEngine((e) => events.push(e));

    engine.propose(
      { name: "audit-test", description: "d", type: "project", content: "c", createdAt: "", updatedAt: "" },
      "r",
    );

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("memory.proposed");
    expect(events[0]!.name).toBe("audit-test");
  });

  it("emits memory.accepted with reviewer", () => {
    const events: MemoryAuditEvent[] = [];
    const engine = setupEngine((e) => events.push(e));

    engine.propose(
      { name: "accept-audit", description: "d", type: "project", content: "c", createdAt: "", updatedAt: "" },
      "r",
    );
    engine.review({ name: "accept-audit", decision: "accepted", reviewer: "admin" });

    expect(events).toHaveLength(2);
    expect(events[1]!.type).toBe("memory.accepted");
    expect((events[1] as any).reviewer).toBe("admin");
  });

  it("emits memory.rejected with reviewer", () => {
    const events: MemoryAuditEvent[] = [];
    const engine = setupEngine((e) => events.push(e));

    engine.propose(
      { name: "reject-audit", description: "d", type: "project", content: "c", createdAt: "", updatedAt: "" },
      "r",
    );
    engine.review({ name: "reject-audit", decision: "rejected", reviewer: "moderator" });

    expect(events).toHaveLength(2);
    expect(events[1]!.type).toBe("memory.rejected");
    expect((events[1] as any).reviewer).toBe("moderator");
  });

  // ==========================================================================
  // Review authorization (AUDIT-014-003)
  // ==========================================================================

  it("rejects empty reviewer", () => {
    const engine = setupEngine();
    engine.propose(
      { name: "no-reviewer", description: "d", type: "project", content: "c", createdAt: "", updatedAt: "" },
      "r",
    );
    expect(() => engine.review({ name: "no-reviewer", decision: "accepted", reviewer: "" })).toThrow(
      "Reviewer identity",
    );
  });

  it("rejects whitespace-only reviewer", () => {
    const engine = setupEngine();
    engine.propose(
      { name: "ws-reviewer", description: "d", type: "project", content: "c", createdAt: "", updatedAt: "" },
      "r",
    );
    expect(() => engine.review({ name: "ws-reviewer", decision: "accepted", reviewer: "   " })).toThrow(
      "Reviewer identity",
    );
  });

  it("rejects too-short reviewer", () => {
    const engine = setupEngine();
    engine.propose(
      { name: "short-rev", description: "d", type: "project", content: "c", createdAt: "", updatedAt: "" },
      "r",
    );
    expect(() => engine.review({ name: "short-rev", decision: "accepted", reviewer: "ab" })).toThrow("minimum 3");
  });

  it("accepts review with reviewer identity", () => {
    const engine = setupEngine();
    engine.propose(
      { name: "has-reviewer", description: "d", type: "project", content: "# Test", createdAt: "", updatedAt: "" },
      "r",
    );
    engine.review({ name: "has-reviewer", decision: "accepted", reviewer: "auditor" });
    expect(existsSync(".agent-memory/memories/project/has-reviewer.md")).toBe(true);
    expect(engine.listPending()).toHaveLength(0);
  });

  // TASK-0291: default auditSink writes to .agent-memory/audit/audit.log
  it("accepts propose with default file-based audit sink", () => {
    const engine = new MemoryEngine(".");
    expect(() =>
      engine.propose(
        { name: "default-audit", description: "d", type: "project", content: "c", createdAt: "", updatedAt: "" },
        "r",
      ),
    ).not.toThrow();
  });

  it("accepts review with requireAudit and audit sink", () => {
    const events: MemoryAuditEvent[] = [];
    const engine = new MemoryEngine(".", { auditSink: (e) => events.push(e) });
    engine.propose({ name: "ok", description: "d", type: "project", content: "c", createdAt: "", updatedAt: "" }, "r");
    engine.review({ name: "ok", decision: "accepted", reviewer: "admin" });
    expect(events).toHaveLength(2);
  });

  // ==========================================================================
  // Search
  // ==========================================================================

  it("searches accepted memories", () => {
    const engine = setupEngine();
    engine.propose(
      {
        name: "search-me",
        description: "x",
        type: "project",
        content: "Binary search O(log n)",
        createdAt: "",
        updatedAt: "",
      },
      "r",
    );
    engine.review({ name: "search-me", decision: "accepted", reviewer: "admin" });
    expect(engine.search("binary")).toHaveLength(1);
  });

  it("index returns entries with correct type", () => {
    const engine = setupEngine();
    engine.propose(
      { name: "u-mem", description: "x", type: "user", content: "# User", createdAt: "", updatedAt: "" },
      "r",
    );
    engine.review({ name: "u-mem", decision: "accepted", reviewer: "admin" });
    const idx = engine.getIndex();
    expect(idx).toHaveLength(1);
    expect(idx[0]!.type).toBe("user");
    expect(idx[0]!.path).toContain("memories/user");
  });

  // ==========================================================================
  // Four types
  // ==========================================================================

  it("supports all 4 memory types", () => {
    const engine = setupEngine();
    for (const type of ["user", "feedback", "project", "reference"] as const) {
      engine.propose({ name: `${type}-t`, description: "x", type, content: "# ok", createdAt: "", updatedAt: "" }, "r");
      engine.review({ name: `${type}-t`, decision: "accepted", reviewer: "admin" });
      expect(existsSync(`.agent-memory/memories/${type}/${type}-t.md`)).toBe(true);
    }
  });

  it("rejects non-kebab-case", () => {
    expect(() =>
      setupEngine().propose(
        { name: "Not Kebab", description: "x", type: "project", content: "x", createdAt: "", updatedAt: "" },
        "r",
      ),
    ).toThrow("kebab-case");
  });

  // ==========================================================================
  // TASK-0900: MemoryLearner auto-propose
  // ==========================================================================

  it("detects user preferences from conversation", () => {
    const engine = setupEngine();
    const learner = new MemoryLearner(engine, { maxProposals: 5 });
    const proposed = learner.learn([
      { role: "user", content: "I prefer short commit messages without prefixes like feat or fix." },
      { role: "assistant", content: "Got it, I'll keep commit messages short." },
    ]);
    expect(proposed.length).toBeGreaterThan(0);
    expect(proposed[0]).toMatch(/^pref-/);
    const pending = engine.listPending();
    expect(pending).toHaveLength(proposed.length);
  });

  it("detects corrections as feedback patterns", () => {
    const engine = setupEngine();
    const learner = new MemoryLearner(engine, { maxProposals: 5 });
    const proposed = learner.learn([
      { role: "user", content: "Don't mock the database in tests - we use real DB for integration testing." },
      { role: "assistant", content: "Understood, I'll use a real database." },
    ]);
    expect(proposed.length).toBeGreaterThan(0);
    expect(proposed[0]).toMatch(/^correction-/);
    // Verify the proposed memory is in review queue
    expect(engine.listPending().some((p) => p.entry.name === proposed[0])).toBe(true);
  });

  it("detects confirmed approaches", () => {
    const engine = setupEngine();
    const learner = new MemoryLearner(engine, { maxProposals: 5 });
    const proposed = learner.learn([
      { role: "user", content: "Yes exactly, keep doing single bundled PRs for refactors." },
      { role: "assistant", content: "Will do." },
    ]);
    expect(proposed.length).toBeGreaterThan(0);
    expect(proposed[0]).toMatch(/^confirmed-/);
  });

  it("detects project conventions but requires human review (MM-001)", () => {
    const engine = setupEngine();
    const learner = new MemoryLearner(engine, { maxProposals: 5 });
    const proposed = learner.learn([
      { role: "user", content: "In this project we use pnpm workspaces with --conditions development for dev mode." },
    ]);
    // MM-001: project type is gated — detected but not auto-proposed (requires human review)
    expect(proposed.length).toBe(0);
  });

  it("respects maxProposals limit", () => {
    const engine = setupEngine();
    const learner = new MemoryLearner(engine, { maxProposals: 2 });
    const proposed = learner.learn([
      { role: "user", content: "I prefer tabs. I like dark themes. I never use semicolons. Don't use var." },
    ]);
    expect(proposed.length).toBeLessThanOrEqual(2);
  });

  it("deduplicates against existing memories", () => {
    const engine = setupEngine();
    // First, accept a memory with the same content
    engine.propose(
      {
        name: "pref-short-commits",
        description: "Preference",
        type: "user",
        content: "short commit messages",
        createdAt: "",
        updatedAt: "",
      },
      "test",
    );
    engine.review({ name: "pref-short-commits", decision: "accepted", reviewer: "admin" });

    const learner = new MemoryLearner(engine, { maxProposals: 5 });
    const proposed = learner.learn([{ role: "user", content: "I prefer short commit messages without prefixes." }]);
    // Should not re-propose since "pref-short-commits" already exists
    expect(proposed.every((p) => p !== "pref-short-commits")).toBe(true);
  });

  it("does not propose when no patterns match", () => {
    const engine = setupEngine();
    const learner = new MemoryLearner(engine);
    const proposed = learner.learn([
      { role: "user", content: "What does this file do?" },
      { role: "assistant", content: "It handles authentication." },
    ]);
    expect(proposed).toHaveLength(0);
  });

  // MM-002: Hash chained audit log
  it("audit log entries include hash chain (MM-002)", () => {
    const { readFileSync, existsSync } = require("node:fs");
    const { join } = require("node:path");
    const engine = new MemoryEngine(".");
    engine.propose(
      { name: "hash-test", description: "d", type: "user", content: "c", createdAt: "", updatedAt: "" },
      "r",
    );
    const logPath = join(process.cwd(), ".agent-memory", "audit", "audit.log");
    expect(existsSync(logPath)).toBe(true);
    const log = readFileSync(logPath, "utf-8").trim().split("\n");
    expect(log.length).toBeGreaterThanOrEqual(1);
    // Each line should start with a 16-char hex hash followed by tab
    for (const line of log) {
      expect(line).toMatch(/^[0-9a-f]{16}\t/);
    }
  });
});
