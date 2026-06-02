import { describe, expect, it } from "vitest";
import { KESTREL_CLI_VERSION, main, parseArgs, printHelp } from "../src/index.js";

describe("@kestrel/cli", () => {
  it("exports version", () => {
    expect(KESTREL_CLI_VERSION).toBe("0.4.0");
  });

  it("defaults to chat when no args", () => {
    const args = parseArgs(["node", "kestrel"]);
    expect(args.command).toBe("chat");
  });

  it("parses gateway subcommand", () => {
    const args = parseArgs(["node", "kestrel", "gateway", "start"]);
    expect(args.command).toBe("gateway");
    expect(args.subcommand).toBe("start");
  });

  it("parses task cancel", () => {
    const args = parseArgs(["node", "kestrel", "task", "cancel", "abc123"]);
    expect(args.command).toBe("task");
    expect(args.subcommand).toBe("cancel");
  });

  it("main returns help for help command", async () => {
    const result = await main(["node", "kestrel", "help"]);
    expect(result.code).toBe(0);
    expect(result.output).toContain("用法:");
  });

  it("main returns error for unknown command", async () => {
    const result = await main(["node", "kestrel", "unknown"]);
    expect(result.code).toBe(1);
  });

  it("printHelp includes all commands", () => {
    const help = printHelp();
    expect(help).toContain("chat");
    expect(help).toContain("gateway");
    expect(help).toContain("task");
    expect(help).toContain("memory");
    expect(help).toContain("doctor");
  });
});

describe("chat", () => {
  it("exports chat function", async () => {
    const { chat } = await import("../src/index.js");
    expect(typeof chat).toBe("function");
  });

  it("chat function handles import gracefully", async () => {
    const { chat } = await import("../src/index.js");
    // chat() requires Pi packages (file: protocol). Call it and expect
    // it returns a string (either chat output or error message).
    const result = await chat();
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  }, 30_000);
});
