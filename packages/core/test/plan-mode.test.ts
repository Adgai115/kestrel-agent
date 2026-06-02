import { describe, expect, it } from "vitest";
import { PlanMode } from "../src/plan-mode.js";

describe("PlanMode", () => {
  it("starts inactive", () => {
    expect(new PlanMode().isActive).toBe(false);
  });

  it("enters and exits plan mode", () => {
    const pm = new PlanMode();
    pm.enter();
    expect(pm.isActive).toBe(true);

    const result = pm.exit("# Plan\nRead src/app.ts and src/utils.ts");
    expect(pm.isActive).toBe(false);
    expect(result.plan).toContain("# Plan");
    expect(result.enteredAt).toBeTruthy();
  });

  it("tracks examined files", () => {
    const pm = new PlanMode();
    pm.enter();
    pm.recordFile("src/app.ts");
    pm.recordFile("src/app.ts"); // duplicate — should only count once
    pm.recordFile("src/utils.ts");

    const result = pm.exit("ok");
    expect(result.filesExamined).toHaveLength(2);
    expect(result.filesExamined).toContain("src/app.ts");
    expect(result.filesExamined).toContain("src/utils.ts");
  });

  it("allows read-only tools", () => {
    const pm = new PlanMode();
    pm.enter();
    expect(pm.isToolAllowed("read")).toBe(true);
    expect(pm.isToolAllowed("grep")).toBe(true);
    expect(pm.isToolAllowed("find")).toBe(true);
    expect(pm.isToolAllowed("ls")).toBe(true);
    expect(pm.isToolAllowed("lsp_diagnostics")).toBe(true);
    expect(pm.isToolAllowed("memory_search")).toBe(true);
  });

  it("denies modification tools", () => {
    const pm = new PlanMode();
    pm.enter();
    expect(pm.isToolAllowed("write")).toBe(false);
    expect(pm.isToolAllowed("edit")).toBe(false);
    expect(pm.isToolAllowed("bash")).toBe(false);
  });

  it("denies unknown tools (deny-by-default)", () => {
    const pm = new PlanMode();
    pm.enter();
    expect(pm.isToolAllowed("custom_tool")).toBe(false);
    expect(pm.isToolAllowed("deploy")).toBe(false);
  });

  it("allows all tools when inactive", () => {
    const pm = new PlanMode();
    expect(pm.isToolAllowed("write")).toBe(true);
    expect(pm.isToolAllowed("bash")).toBe(true);
  });

  it("throws when entering twice", () => {
    const pm = new PlanMode();
    pm.enter();
    expect(() => pm.enter()).toThrow("Already in plan mode");
  });

  it("throws when exiting without entering", () => {
    expect(() => new PlanMode().exit("x")).toThrow("Not in plan mode");
  });

  it("does not record files when inactive", () => {
    const pm = new PlanMode();
    pm.recordFile("secret.ts");
    expect(pm.isActive).toBe(false);
  });
});
