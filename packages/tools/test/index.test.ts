import { describe, expect, it } from "vitest";
import { KESTREL_TOOLS_VERSION, createToolRegistry } from "../src/index.js";

describe("@kestrel/tools", () => {
  it("exports version", () => expect(KESTREL_TOOLS_VERSION).toBe("0.1.0"));

  const registry = createToolRegistry();

  it("has built-in tools", () => {
    expect(registry.list().length).toBeGreaterThanOrEqual(10);
  });

  it("gets tool by name", () => {
    expect(registry.get("read")!.riskLevel).toBe("low");
    expect(registry.get("bash")!.riskLevel).toBe("high");
  });

  it("returns undefined for unknown tool", () => {
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("filters by tool type", () => {
    const reads = registry.getByToolType("read");
    expect(reads.length).toBeGreaterThanOrEqual(3); // read, grep, find
    expect(reads.every((t) => t.toolType === "read")).toBe(true);
  });

  it("supports custom tools", () => {
    const custom = createToolRegistry([
      { name: "deploy", description: "Deploy", riskLevel: "high", requiredPermissions: ["bash"], toolType: "bash" },
    ]);
    expect(custom.list().length).toBeGreaterThan(registry.list().length);
    expect(custom.get("deploy")!.description).toBe("Deploy");
  });

  it("all tools have required permissions", () => {
    for (const tool of registry.list()) {
      expect(tool.requiredPermissions.length).toBeGreaterThan(0);
    }
  });
});
