import { describe, expect, it } from "vitest";
import type { AuditSink } from "../src/index.js";
import {
  KESTREL_PERMISSIONS_VERSION,
  PermissionEngine,
  escalateRisk,
  isDangerousCommand,
  isProtectedPath,
} from "../src/index.js";

describe("@kestrel/permissions", () => {
  it("exports version", () => {
    expect(KESTREL_PERMISSIONS_VERSION).toBe("0.0.1");
  });

  const engine = new PermissionEngine();

  // ==========================================================================
  // Risk Classification
  // ==========================================================================

  describe("risk classification", () => {
    it("read is low, bash is high", () => {
      expect(engine.evaluate({ subject: "local-user", channel: "cli", tool: "read", target: "src/app.ts" }).risk).toBe(
        "low",
      );
      expect(engine.evaluate({ subject: "local-user", channel: "cli", tool: "bash" }).risk).toBe("high");
    });

    it("protected paths escalate to critical", () => {
      expect(engine.evaluate({ subject: "local-user", channel: "cli", tool: "read", target: ".env" }).risk).toBe(
        "critical",
      );
      expect(engine.evaluate({ subject: "local-user", channel: "cli", tool: "read", target: ".ssh/id_rsa" }).risk).toBe(
        "critical",
      );
    });
  });

  // ==========================================================================
  // Trust Level Detection
  // ==========================================================================

  describe("trust level detection", () => {
    it("CLI is local trust", () => {
      const r = engine.evaluate({ subject: "local-user", channel: "cli", tool: "read", target: "README.md" });
      expect(r.trustLevel).toBe("local");
      expect(r.decision).toBe("allow");
    });

    it("Feishu private is trusted", () => {
      const r = engine.evaluate({
        subject: "feishu-user",
        channel: "feishu",
        chatType: "private",
        tool: "read",
        target: "README.md",
      });
      expect(r.trustLevel).toBe("trusted");
    });

    it("Feishu group is limited", () => {
      const r = engine.evaluate({
        subject: "feishu-user",
        channel: "feishu",
        chatType: "group",
        tool: "read",
        target: "README.md",
      });
      expect(r.trustLevel).toBe("limited");
      expect(r.decision).toBe("ask"); // limited + low = ask
    });

    it("unknown peer is always unknown trust", () => {
      const r = engine.evaluate({ subject: "web-user", channel: "feishu", tool: "read", isUnknownPeer: true });
      expect(r.trustLevel).toBe("unknown");
      expect(r.decision).toBe("deny");
    });

    it("explicit trustLevel overrides auto-detection", () => {
      const r = engine.evaluate({
        subject: "web-user",
        channel: "feishu",
        tool: "read",
        trustLevel: "limited",
        target: "README.md",
      });
      expect(r.trustLevel).toBe("limited");
    });
  });

  // ==========================================================================
  // Protected Paths — SOP: ask for local, deny for all others
  // ==========================================================================

  describe("protected paths", () => {
    it("local CLI: .env read → ask", () => {
      const r = engine.evaluate({ subject: "local-user", channel: "cli", tool: "read", target: ".env" });
      expect(r.decision).toBe("ask");
      expect(r.reason).toContain("Protected");
    });

    it("WebChat: .env read → deny", () => {
      const r = engine.evaluate({ subject: "web-user", channel: "webchat", tool: "read", target: ".env" });
      expect(r.decision).toBe("deny");
    });

    it("Feishu private: .env read → deny", () => {
      const r = engine.evaluate({
        subject: "feishu-user",
        channel: "feishu",
        chatType: "private",
        tool: "read",
        target: ".env",
      });
      expect(r.decision).toBe("deny");
    });

    it("Feishu group: .env read → deny", () => {
      const r = engine.evaluate({
        subject: "feishu-user",
        channel: "feishu",
        chatType: "group",
        tool: "read",
        target: ".env",
      });
      expect(r.decision).toBe("deny");
    });

    it("Slack: .env read → deny", () => {
      const r = engine.evaluate({ subject: "web-user", channel: "slack", tool: "read", target: ".env" });
      expect(r.decision).toBe("deny");
    });

    it("unknown peer: .env read → deny", () => {
      const r = engine.evaluate({
        subject: "web-user",
        channel: "cli",
        tool: "read",
        target: ".env",
        isUnknownPeer: true,
      });
      expect(r.decision).toBe("deny");
    });
  });

  // ==========================================================================
  // Unknown Peer — SOP: deny all
  // ==========================================================================

  describe("unknown peers", () => {
    it("denies read", () => {
      expect(
        engine.evaluate({ subject: "web-user", channel: "feishu", tool: "read", isUnknownPeer: true }).decision,
      ).toBe("deny");
    });
    it("denies write", () => {
      expect(
        engine.evaluate({ subject: "web-user", channel: "feishu", tool: "write", isUnknownPeer: true }).decision,
      ).toBe("deny");
    });
    it("denies bash", () => {
      expect(
        engine.evaluate({ subject: "web-user", channel: "feishu", tool: "bash", isUnknownPeer: true }).decision,
      ).toBe("deny");
    });
  });

  // ==========================================================================
  // Feishu Private vs Group
  // ==========================================================================

  describe("Feishu private vs group", () => {
    it("Feishu private: read → allow, bash → deny (tool override)", () => {
      const rRead = engine.evaluate({
        subject: "feishu-user",
        channel: "feishu",
        chatType: "private",
        tool: "read",
        target: "README.md",
      });
      expect(rRead.decision).toBe("allow");
      const rBash = engine.evaluate({ subject: "feishu-user", channel: "feishu", chatType: "private", tool: "bash" });
      expect(rBash.decision).toBe("deny"); // tool override
    });

    it("Feishu group: read → ask, write → deny", () => {
      const rRead = engine.evaluate({
        subject: "feishu-user",
        channel: "feishu",
        chatType: "group",
        tool: "read",
        target: "README.md",
      });
      expect(rRead.decision).toBe("ask"); // limited + low = ask
      const rWrite = engine.evaluate({ subject: "feishu-user", channel: "feishu", chatType: "group", tool: "write" });
      expect(rWrite.decision).toBe("deny"); // limited + high = deny
    });
  });

  // ==========================================================================
  // Local CLI Defaults
  // ==========================================================================

  describe("local CLI", () => {
    it("read → allow", () => {
      expect(
        engine.evaluate({ subject: "local-user", channel: "cli", tool: "read", target: "src/app.ts" }).decision,
      ).toBe("allow");
    });
    it("bash → ask", () => {
      expect(
        engine.evaluate({ subject: "local-user", channel: "cli", tool: "bash", target: "npm test" }).decision,
      ).toBe("ask");
    });
    it("write → ask", () => {
      expect(engine.evaluate({ subject: "local-user", channel: "cli", tool: "write" }).decision).toBe("ask");
    });
  });

  // ==========================================================================
  // Audit Events
  // ==========================================================================

  describe("audit events", () => {
    it("emits permission.decided on every evaluation", () => {
      const events: unknown[] = [];
      const sink: AuditSink = (e) => events.push(e);
      const eng = new PermissionEngine({ auditSink: sink });

      eng.evaluate({ subject: "local-user", channel: "cli", tool: "read", target: "src/app.ts" });
      eng.evaluate({ subject: "local-user", channel: "cli", tool: "bash" });

      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({ event: "permission.decided", tool: "read", decision: "allow" });
      expect(events[1]).toMatchObject({ event: "permission.decided", tool: "bash", decision: "ask" });
    });

    it("records deny decisions", () => {
      const events: unknown[] = [];
      const sink: AuditSink = (e) => events.push(e);
      const eng = new PermissionEngine({ auditSink: sink });

      eng.evaluate({ subject: "web-user", channel: "feishu", tool: "read", isUnknownPeer: true });

      expect(events[0]).toMatchObject({ event: "permission.decided", decision: "deny" });
    });
  });

  // ==========================================================================
  // Path Matcher & Command Detection
  // ==========================================================================

  describe("protected path matcher", () => {
    it("detects secrets", () => {
      expect(isProtectedPath(".env")).toBe(true);
      expect(isProtectedPath("cert.pem")).toBe(true);
      expect(isProtectedPath("id_rsa")).toBe(true);
      expect(isProtectedPath(".aws/credentials")).toBe(true);
      expect(isProtectedPath("src/index.ts")).toBe(false);
    });
  });

  describe("dangerous command detection", () => {
    it("detects dangerous commands", () => {
      expect(isDangerousCommand("rm -rf /")).toBe(true);
      expect(isDangerousCommand("npm install")).toBe(false);
    });
  });

  // ==========================================================================
  // Risk Escalation
  // ==========================================================================

  describe("risk escalation", () => {
    it("limited trust bumps risk up", () => {
      expect(escalateRisk("low", "limited", "README.md")).toBe("medium");
      expect(escalateRisk("medium", "limited", "README.md")).toBe("high");
    });

    it("local trust keeps risk as-is", () => {
      expect(escalateRisk("low", "local", "README.md")).toBe("low");
      expect(escalateRisk("high", "local", "npm test")).toBe("high");
    });

    it("protected paths → critical regardless of trust", () => {
      expect(escalateRisk("low", "local", ".env")).toBe("critical");
      expect(escalateRisk("low", "trusted", ".env")).toBe("critical");
    });
  });

  // ==========================================================================
  // Custom Config
  // ==========================================================================

  describe("custom configuration", () => {
    it("accepts policy overrides", () => {
      const custom = new PermissionEngine({ overrides: { trusted: { high: "allow" } } });
      const r = custom.evaluate({ subject: "web-user", channel: "webchat", tool: "bash" });
      expect(r.decision).toBe("allow");
    });

    it("accepts allowlists", () => {
      const custom = new PermissionEngine({ allowlist: { feishu: ["read"] } });
      expect(
        custom.evaluate({ subject: "feishu-user", channel: "feishu", tool: "read", target: "README.md" }).decision,
      ).toBe("allow");
      expect(custom.evaluate({ subject: "feishu-user", channel: "feishu", tool: "write" }).decision).toBe("deny");
    });
  });
});
