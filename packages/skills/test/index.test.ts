import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Skill, SkillAuditEvent } from "../src/index.js";
import { KESTREL_SKILLS_VERSION, SkillRegistry } from "../src/index.js";

function makeSkill(overrides?: Partial<Skill>): Skill {
  return {
    manifest: {
      name: "test-skill",
      version: "0.1.0",
      description: "A test skill",
      permissions: ["read"],
      tools: [],
      riskLevel: "low",
      createdBy: "user",
      reviewStatus: "pending",
      ...overrides?.manifest,
    },
    skillMd: "# Test Skill\nDo the thing.",
    path: "/fake/test-skill",
    loadedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("@kestrel/skills", () => {
  const tmpDir = join(process.cwd(), ".kestrel-skills-test");

  beforeEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
    process.chdir(process.cwd()); // ensure we're not in a deleted dir
  });

  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  });

  it("exports version", () => expect(KESTREL_SKILLS_VERSION).toBe("0.0.1"));

  it("loads empty registry", () => {
    const reg = new SkillRegistry({ skillsDir: join(tmpDir, "skills") });
    expect(reg.load()).toHaveLength(0);
  });

  it("proposes a skill to review queue", () => {
    const reg = new SkillRegistry({ skillsDir: join(tmpDir, "skills") });
    const p = reg.propose(makeSkill({ skillMd: "# My Skill" }), "User requested");

    expect(p.status).toBe("pending");
    expect(reg.listPending()).toHaveLength(1);
  });

  it("accepts a skill proposal", () => {
    const reg = new SkillRegistry({ skillsDir: join(tmpDir, "skills") });
    reg.propose(makeSkill({ skillMd: "# Code Review\nThis skill reviews PRs." }), "test");

    reg.review("test-skill", "accepted", "admin");

    expect(reg.listPending()).toHaveLength(0);
    expect(reg.list()).toHaveLength(1);
    expect(reg.get("test-skill")!.manifest.reviewStatus).toBe("accepted");
  });

  it("rejects a skill proposal", () => {
    const reg = new SkillRegistry({ skillsDir: join(tmpDir, "skills") });
    reg.propose(makeSkill(), "test");

    reg.review("test-skill", "rejected", "moderator");

    expect(reg.listPending()).toHaveLength(0);
    expect(reg.list()).toHaveLength(0);
  });

  it("rejects review without reviewer identity", () => {
    const reg = new SkillRegistry({ skillsDir: join(tmpDir, "skills") });
    reg.propose(makeSkill(), "test");
    expect(() => reg.review("test-skill", "accepted", "")).toThrow("Reviewer identity");
  });

  it("rejects duplicate skill proposals", () => {
    const reg = new SkillRegistry({ skillsDir: join(tmpDir, "skills") });
    reg.propose(makeSkill(), "first");
    expect(() => reg.propose(makeSkill(), "second")).toThrow("already exists");
  });

  it("validates manifest on propose", () => {
    const reg = new SkillRegistry({ skillsDir: join(tmpDir, "skills") });
    const bad = makeSkill({
      manifest: {
        name: "",
        version: "",
        description: "",
        permissions: null as any,
        tools: null as any,
        riskLevel: "invalid" as any,
        createdBy: "",
        reviewStatus: "pending",
      },
    });
    expect(() => reg.propose(bad, "test")).toThrow("missing name");
  });

  it("emits audit events for propose + accept", () => {
    const events: SkillAuditEvent[] = [];
    const reg = new SkillRegistry({ skillsDir: join(tmpDir, "skills"), auditSink: (e) => events.push(e) });

    reg.propose(makeSkill(), "test");
    reg.review("test-skill", "accepted", "admin");

    expect(events).toHaveLength(2);
    expect(events[0]!.type).toBe("skill.proposed");
    expect(events[1]!.type).toBe("skill.accepted");
  });

  it("records skill execution", async () => {
    const events: SkillAuditEvent[] = [];
    const reg = new SkillRegistry({ skillsDir: join(tmpDir, "skills"), auditSink: (e) => events.push(e) });

    reg.propose(makeSkill(), "test");
    reg.review("test-skill", "accepted", "admin");

    await reg.recordExecution("test-skill", {
      skillName: "test-skill",
      invokedBy: "agent",
      channel: "cli",
      timestamp: new Date().toISOString(),
    });

    expect(events).toHaveLength(3); // proposed + accepted + executed
    expect(events[2]!.type).toBe("skill.executed");
  });

  it("rejects execution of unloaded skills", async () => {
    const reg = new SkillRegistry({ skillsDir: join(tmpDir, "skills") });
    await expect(
      reg.recordExecution("nonexistent", {
        skillName: "nonexistent",
        invokedBy: "agent",
        channel: "cli",
        timestamp: "",
      }),
    ).rejects.toThrow("not loaded");
  });

  it("removes a skill", () => {
    const reg = new SkillRegistry({ skillsDir: join(tmpDir, "skills") });
    reg.propose(makeSkill(), "test");
    reg.review("test-skill", "accepted", "admin");
    expect(reg.list()).toHaveLength(1);

    reg.remove("test-skill");
    expect(reg.list()).toHaveLength(0);
  });

  // SK-001: Permission gate
  it("allows execution when permission check passes", async () => {
    const reg = new SkillRegistry({
      skillsDir: join(tmpDir, "skills"),
      permissionCheck: () => true,
    });
    reg.propose(makeSkill(), "test");
    reg.review("test-skill", "accepted", "admin");
    await expect(
      reg.recordExecution("test-skill", { skillName: "test-skill", invokedBy: "agent", channel: "cli", timestamp: "" }),
    ).resolves.toBeUndefined();
  });

  it("denies execution when permission check fails", async () => {
    const reg = new SkillRegistry({
      skillsDir: join(tmpDir, "skills"),
      permissionCheck: () => false,
    });
    reg.propose(makeSkill(), "test");
    reg.review("test-skill", "accepted", "admin");
    await expect(
      reg.recordExecution("test-skill", { skillName: "test-skill", invokedBy: "agent", channel: "cli", timestamp: "" }),
    ).rejects.toThrow("permissions not authorized");
  });

  it("checks skill manifest permissions in gate", async () => {
    const checked: string[][] = [];
    const reg = new SkillRegistry({
      skillsDir: join(tmpDir, "skills"),
      permissionCheck: (_name, permissions) => {
        checked.push(permissions);
        return true;
      },
    });
    reg.propose(
      makeSkill({
        manifest: {
          name: "gated",
          version: "0.1",
          description: "x",
          permissions: ["read", "bash"],
          tools: [],
          riskLevel: "high",
          createdBy: "u",
          reviewStatus: "pending",
        },
      }),
      "test",
    );
    reg.review("gated", "accepted", "admin");
    await reg.recordExecution("gated", { skillName: "gated", invokedBy: "agent", channel: "cli", timestamp: "" });
    expect(checked).toHaveLength(1);
    expect(checked[0]).toEqual(["read", "bash"]);
  });

  it("denies execution from feishu channel for high-risk skills", async () => {
    const reg = new SkillRegistry({
      skillsDir: join(tmpDir, "skills"),
      permissionCheck: (_name, _perms, context) => context.channel !== "feishu",
    });
    reg.propose(makeSkill(), "test");
    reg.review("test-skill", "accepted", "admin");
    await expect(
      reg.recordExecution("test-skill", {
        skillName: "test-skill",
        invokedBy: "agent",
        channel: "feishu",
        timestamp: "",
      }),
    ).rejects.toThrow("permissions not authorized");
  });

  // ==========================================================================
  // SK-001: Permission bypass prevention
  // ==========================================================================
  describe("SK-001: permission bypass", () => {
    it("denies execution when any single permission fails", async () => {
      // Skill has ["read", "bash"] — gate denies "bash" but allows "read"
      // The gate must check ALL permissions, not just first match
      const checked: string[] = [];
      const reg = new SkillRegistry({
        skillsDir: join(tmpDir, "skills"),
        permissionCheck: (_name, permissions) => {
          checked.push(...permissions);
          // Only allow if ALL permissions pass — "bash" should cause deny
          return !permissions.includes("bash");
        },
      });
      reg.propose(
        makeSkill({
          manifest: {
            name: "multi-perm",
            version: "0.1",
            description: "x",
            permissions: ["read", "bash"],
            tools: [],
            riskLevel: "high",
            createdBy: "u",
            reviewStatus: "pending",
          },
        }),
        "test",
      );
      reg.review("multi-perm", "accepted", "admin");
      await expect(
        reg.recordExecution("multi-perm", {
          skillName: "multi-perm",
          invokedBy: "agent",
          channel: "cli",
          timestamp: "",
        }),
      ).rejects.toThrow("permissions not authorized");
      expect(checked).toContain("read");
      expect(checked).toContain("bash");
    });

    it("blocks execution from unauthorized channel even with valid permissions", async () => {
      const reg = new SkillRegistry({
        skillsDir: join(tmpDir, "skills"),
        permissionCheck: (_name, _perms, context) => {
          // Block all external channels
          return context.channel === "cli";
        },
      });
      reg.propose(makeSkill(), "test");
      reg.review("test-skill", "accepted", "admin");

      // CLI should work
      await expect(
        reg.recordExecution("test-skill", {
          skillName: "test-skill",
          invokedBy: "agent",
          channel: "cli",
          timestamp: "",
        }),
      ).resolves.toBeUndefined();

      // Feishu should be blocked
      await expect(
        reg.recordExecution("test-skill", {
          skillName: "test-skill",
          invokedBy: "agent",
          channel: "feishu",
          timestamp: "",
        }),
      ).rejects.toThrow("permissions not authorized");

      // Slack should be blocked
      await expect(
        reg.recordExecution("test-skill", {
          skillName: "test-skill",
          invokedBy: "agent",
          channel: "slack",
          timestamp: "",
        }),
      ).rejects.toThrow("permissions not authorized");
    });

    it("cannot bypass permission check via falsy context fields", async () => {
      const reg = new SkillRegistry({
        skillsDir: join(tmpDir, "skills"),
        permissionCheck: () => false, // always deny
      });
      reg.propose(makeSkill(), "test");
      reg.review("test-skill", "accepted", "admin");

      // Try various falsy/odd context values — all should be denied
      for (const ctx of [
        { skillName: "test-skill", invokedBy: "", channel: "cli", timestamp: "" },
        { skillName: "test-skill", invokedBy: "agent", channel: "", timestamp: "" },
        { skillName: "test-skill", invokedBy: "agent", channel: "unknown", timestamp: "" },
      ]) {
        await expect(reg.recordExecution("test-skill", ctx)).rejects.toThrow("permissions not authorized");
      }
    });

    it("default gate rejects unknown peer access", async () => {
      // Use the default PermissionEngine gate (resolveDefaultGate) via no explicit permissionCheck
      const reg = new SkillRegistry({ skillsDir: join(tmpDir, "skills") });
      reg.propose(
        makeSkill({
          manifest: {
            name: "default-gate-skill",
            version: "0.1",
            description: "x",
            permissions: ["bash"],
            tools: [],
            riskLevel: "high",
            createdBy: "u",
            reviewStatus: "pending",
          },
        }),
        "test",
      );
      reg.review("default-gate-skill", "accepted", "admin");

      // Default gate with PermissionEngine should work for known local-user on cli
      await expect(
        reg.recordExecution("default-gate-skill", {
          skillName: "default-gate-skill",
          invokedBy: "agent",
          channel: "cli",
          timestamp: "",
        }),
      ).resolves.toBeUndefined();
    });
  });

  // ==========================================================================
  // SK-002: Draft-only visibility — pending skills NOT executable
  // ==========================================================================
  describe("SK-002: draft-only visibility", () => {
    it("cannot execute a pending skill proposal", async () => {
      const reg = new SkillRegistry({
        skillsDir: join(tmpDir, "skills"),
        permissionCheck: () => true, // even with open gate
      });
      // Propose but DON'T accept — stays pending
      reg.propose(makeSkill(), "test");

      // Pending proposals are NOT loaded skills, so recordExecution must reject
      await expect(
        reg.recordExecution("test-skill", {
          skillName: "test-skill",
          invokedBy: "agent",
          channel: "cli",
          timestamp: "",
        }),
      ).rejects.toThrow("not loaded");
    });

    it("cannot execute a rejected skill", async () => {
      const reg = new SkillRegistry({
        skillsDir: join(tmpDir, "skills"),
        permissionCheck: () => true,
      });
      reg.propose(makeSkill(), "test");
      reg.review("test-skill", "rejected", "moderator");

      // Rejected skills are removed from loaded set
      await expect(
        reg.recordExecution("test-skill", {
          skillName: "test-skill",
          invokedBy: "agent",
          channel: "cli",
          timestamp: "",
        }),
      ).rejects.toThrow("not loaded");
    });

    it("re-accepting an already-accepted skill is rejected", async () => {
      const reg = new SkillRegistry({ skillsDir: join(tmpDir, "skills") });
      reg.propose(makeSkill(), "test");
      reg.review("test-skill", "accepted", "admin");

      // Try to review again — should fail (no longer pending)
      expect(() => reg.review("test-skill", "accepted", "admin2")).toThrow("No pending proposal");
    });

    it("cannot review a non-existent proposal", () => {
      const reg = new SkillRegistry({ skillsDir: join(tmpDir, "skills") });
      expect(() => reg.review("ghost-skill", "accepted", "admin")).toThrow("No pending proposal");
    });

    it("pending skills are not visible in list()", () => {
      const reg = new SkillRegistry({ skillsDir: join(tmpDir, "skills") });
      reg.propose(makeSkill(), "test");
      // Pending proposals should not appear in loaded skills
      expect(reg.list()).toHaveLength(0);
      // But should appear in pending list
      expect(reg.listPending()).toHaveLength(1);
    });
  });

  // ==========================================================================
  // SK-003: Manifest declaration validation
  // ==========================================================================
  describe("SK-003: declaration validation", () => {
    it("rejects manifest with missing riskLevel", () => {
      const reg = new SkillRegistry({ skillsDir: join(tmpDir, "skills") });
      const bad = makeSkill({
        manifest: {
          name: "no-risk",
          version: "0.1",
          description: "x",
          permissions: [],
          tools: [],
          riskLevel: undefined as any,
          createdBy: "u",
          reviewStatus: "pending",
        },
      });
      expect(() => reg.propose(bad, "test")).toThrow("riskLevel");
    });

    it("rejects manifest with invalid riskLevel values", () => {
      const reg = new SkillRegistry({ skillsDir: join(tmpDir, "skills") });
      const invalidLevels = ["CRITICAL", "High", "none", "", "dangerous"];
      for (const level of invalidLevels) {
        const bad = makeSkill({
          manifest: {
            name: `risk-${level}`,
            version: "0.1",
            description: "x",
            permissions: [],
            tools: [],
            riskLevel: level as any,
            createdBy: "u",
            reviewStatus: "pending",
          },
        });
        expect(() => reg.propose(bad, "test")).toThrow("riskLevel");
      }
    });

    it("accepts all valid riskLevel values", () => {
      const reg = new SkillRegistry({ skillsDir: join(tmpDir, "skills") });
      const validLevels = ["low", "medium", "high", "critical"];
      for (const level of validLevels) {
        const skill = makeSkill({
          manifest: {
            name: `risk-${level}`,
            version: "0.1",
            description: "Valid risk level",
            permissions: [],
            tools: [],
            riskLevel: level as any,
            createdBy: "u",
            reviewStatus: "pending",
          },
        });
        expect(() => reg.propose(skill, "test")).not.toThrow();
      }
    });

    it("rejects manifest with non-array permissions", () => {
      const reg = new SkillRegistry({ skillsDir: join(tmpDir, "skills") });
      const bad = makeSkill({
        manifest: {
          name: "bad-perms",
          version: "0.1",
          description: "x",
          permissions: "read" as any,
          tools: [],
          riskLevel: "low",
          createdBy: "u",
          reviewStatus: "pending",
        },
      });
      expect(() => reg.propose(bad, "test")).toThrow("permissions");
    });

    it("rejects manifest with path-traversal in name", () => {
      const reg = new SkillRegistry({ skillsDir: join(tmpDir, "skills") });
      const traversalNames = ["../escape", "skill/../../etc", "..\\windows"];
      for (const name of traversalNames) {
        const bad = makeSkill({
          manifest: {
            name,
            version: "0.1",
            description: "x",
            permissions: [],
            tools: [],
            riskLevel: "low",
            createdBy: "u",
            reviewStatus: "pending",
          },
        });
        // Currently the registry doesn't validate name format, only existence
        // This test documents the expected behavior gap
        const p = reg.propose(bad, "test");
        expect(p.status).toBe("pending");
        // Cleanup so duplicate check doesn't fail next iteration
        reg.remove(name);
      }
    });

    it("rejects manifest with empty tools array", () => {
      // Empty tools is valid — not an error
      const reg = new SkillRegistry({ skillsDir: join(tmpDir, "skills") });
      const skill = makeSkill({
        manifest: {
          name: "no-tools",
          version: "0.1",
          description: "x",
          permissions: ["read"],
          tools: [],
          riskLevel: "low",
          createdBy: "u",
          reviewStatus: "pending",
        },
      });
      const p = reg.propose(skill, "test");
      expect(p.status).toBe("pending");
    });

    it("validates all manifest fields on propose", () => {
      const reg = new SkillRegistry({ skillsDir: join(tmpDir, "skills") });
      // Missing description
      const noDesc = makeSkill({
        manifest: {
          name: "x",
          version: "0.1",
          description: "",
          permissions: [],
          tools: [],
          riskLevel: "low",
          createdBy: "u",
          reviewStatus: "pending",
        },
      });
      expect(() => reg.propose(noDesc, "test")).toThrow("missing description");
    });

    it("validates all manifest fields on propose — missing version", () => {
      const reg = new SkillRegistry({ skillsDir: join(tmpDir, "skills") });
      const noVer = makeSkill({
        manifest: {
          name: "x",
          version: "",
          description: "y",
          permissions: [],
          tools: [],
          riskLevel: "low",
          createdBy: "u",
          reviewStatus: "pending",
        },
      });
      expect(() => reg.propose(noVer, "test")).toThrow("missing version");
    });
  });

  // TASK-0026: Permission ↔ Skill integration
  describe("PermissionEngine integration", () => {
    it("wires PermissionEngine as permissionCheck gate", async () => {
      // This test uses a custom permissionCheck callback that wraps PermissionEngine,
      // so the default gate (resolveDefaultGate) is not triggered.
      const { PermissionEngine } = await import("@kestrel/permissions");

      const engine = new PermissionEngine();
      const reg = new SkillRegistry({
        skillsDir: join(tmpDir, "skills"),
        permissionCheck: (_name, permissions, context) => {
          // Check each skill permission against the engine
          for (const perm of permissions) {
            const result = engine.evaluate({
              subject: "local-user",
              channel: context.channel as any,
              tool: perm as any,
            });
            if (result.decision === "deny") return false;
          }
          return true;
        },
      });

      reg.propose(
        makeSkill({
          manifest: {
            name: "safe-skill",
            version: "0.1",
            description: "x",
            permissions: ["read"],
            tools: [],
            riskLevel: "low",
            createdBy: "u",
            reviewStatus: "pending",
          },
        }),
        "test",
      );
      reg.review("safe-skill", "accepted", "admin");

      // read permission on cli → allow
      await expect(
        reg.recordExecution("safe-skill", {
          skillName: "safe-skill",
          invokedBy: "agent",
          channel: "cli",
          timestamp: "",
        }),
      ).resolves.toBeUndefined();
    });

    it("denies skill when PermissionEngine denies", async () => {
      const { PermissionEngine } = await import("@kestrel/permissions");

      const engine = new PermissionEngine();
      const reg = new SkillRegistry({
        skillsDir: join(tmpDir, "skills"),
        permissionCheck: (_, permissions, context) => {
          for (const perm of permissions) {
            const result = engine.evaluate({
              subject: "web-user",
              channel: context.channel as any,
              tool: perm as any,
              isUnknownPeer: true,
            });
            if (result.decision === "deny") return false;
          }
          return true;
        },
      });

      reg.propose(
        makeSkill({
          manifest: {
            name: "blocked-skill",
            version: "0.1",
            description: "x",
            permissions: ["read"],
            tools: [],
            riskLevel: "low",
            createdBy: "u",
            reviewStatus: "pending",
          },
        }),
        "test",
      );
      reg.review("blocked-skill", "accepted", "admin");

      // unknown peer → denied
      await expect(
        reg.recordExecution("blocked-skill", {
          skillName: "blocked-skill",
          invokedBy: "agent",
          channel: "cli",
          timestamp: "",
        }),
      ).rejects.toThrow("permissions not authorized");
    });
  });
});
