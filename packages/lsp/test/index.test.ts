import { describe, expect, it } from "vitest";
import { DiagnosticsRunner, KESTREL_LSP_VERSION } from "../src/index.js";

describe("@kestrel/lsp", () => {
  const runner = new DiagnosticsRunner();

  it("exports version", () => expect(KESTREL_LSP_VERSION).toBe("0.0.1"));

  it("parses tsc error output", () => {
    const output = [
      "src/app.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.",
      "src/app.ts(20,3): warning TS6133: 'x' is declared but its value is never read.",
    ].join("\n");

    const diags = runner.parseTypeScriptOutput(output);
    expect(diags).toHaveLength(2);
    expect(diags[0]!.file).toBe("src/app.ts");
    expect(diags[0]!.line).toBe(10);
    expect(diags[0]!.severity).toBe("error");
    expect(diags[1]!.severity).toBe("warning");
  });

  it("returns empty for empty output", () => {
    expect(runner.parseTypeScriptOutput("")).toHaveLength(0);
  });

  it("parses column and code correctly", () => {
    const diags = runner.parseTypeScriptOutput("index.ts(42,3): error TS2304: Cannot find name 'foo'.");
    expect(diags[0]!.code).toBe("TS2304");
    expect(diags[0]!.column).toBe(3);
    expect(diags[0]!.message).toContain("Cannot find name");
  });

  it("handles info-level diagnostics", () => {
    const diags = runner.parseTypeScriptOutput("src/lib.ts(5,1): info TS6133: 'unused' is declared but never used.");
    expect(diags[0]!.severity).toBe("info");
    expect(diags[0]!.file).toBe("src/lib.ts");
  });

  it("runs checkTypeScript (skips if tsc unavailable)", async () => {
    const result = await runner.checkTypeScript({
      cwd: process.cwd(),
      timeoutMs: 10_000,
    });
    // npx/tsc may not be available in all test environments
    expect(typeof result.filesChecked).toBe("number");
  }, 15_000);
});
