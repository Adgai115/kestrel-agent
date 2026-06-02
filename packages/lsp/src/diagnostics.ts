/**
 * LSP diagnostics runner.
 *
 * Runs TypeScript type-checking and captures diagnostics.
 * Supports TypeScript, JSON, and Python file types (extensible).
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export interface Diagnostic {
  file: string;
  line: number;
  column: number;
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
}

export interface DiagnosticsResult {
  diagnostics: Diagnostic[];
  errorCount: number;
  warningCount: number;
  /** Total files checked */
  filesChecked: number;
  /** Whether the diagnostics runner succeeded */
  success: boolean;
}

export interface DiagnosticsConfig {
  /** Project root directory */
  cwd?: string;
  /** File or directory to check */
  target?: string;
  /** Timeout in ms */
  timeoutMs?: number;
}

export class DiagnosticsRunner {
  /** Run TypeScript type-checking diagnostics. */
  async checkTypeScript(config: DiagnosticsConfig = {}): Promise<DiagnosticsResult> {
    const cwd = config.cwd ?? process.cwd();

    if (!existsSync(resolve(cwd, "tsconfig.json"))) {
      return { diagnostics: [], errorCount: 0, warningCount: 0, filesChecked: 0, success: false };
    }

    return this.runCommand("npx", ["tsc", "--noEmit", "--pretty", "false"], cwd, config.timeoutMs ?? 60_000);
  }

  /** Run Python diagnostics using ruff or pylint. */
  async checkPython(config: DiagnosticsConfig = {}): Promise<DiagnosticsResult> {
    const cwd = config.cwd ?? process.cwd();
    const hasRuff = existsSync(resolve(cwd, "pyproject.toml")) || existsSync(resolve(cwd, "ruff.toml"));
    const hasPylint = existsSync(resolve(cwd, ".pylintrc"));

    if (!hasRuff && !hasPylint && !existsSync(resolve(cwd, "*.py"))) {
      return { diagnostics: [], errorCount: 0, warningCount: 0, filesChecked: 0, success: false };
    }

    if (hasRuff) {
      return this.runCommand(
        "ruff",
        ["check", "--output-format", "text", config.target ?? "."],
        cwd,
        config.timeoutMs ?? 60_000,
      );
    }
    return this.runCommand(
      "pylint",
      ["--output-format", "text", config.target ?? "."],
      cwd,
      config.timeoutMs ?? 60_000,
    );
  }

  /** Run Go diagnostics using go vet. */
  async checkGo(config: DiagnosticsConfig = {}): Promise<DiagnosticsResult> {
    const cwd = config.cwd ?? process.cwd();

    if (!existsSync(resolve(cwd, "go.mod"))) {
      return { diagnostics: [], errorCount: 0, warningCount: 0, filesChecked: 0, success: false };
    }

    return this.runCommand("go", ["vet", config.target ?? "./..."], cwd, config.timeoutMs ?? 60_000);
  }

  /** Parse generic line-based diagnostics (pylint/ruff/go vet format). */
  parseLineDiagnostics(output: string): Diagnostic[] {
    const diags: Diagnostic[] = [];
    for (const line of output.split("\n")) {
      // pylint: file:line:column: code: message
      const pylintRe = /^(.+?):(\d+):(\d+):\s*(\w+\d+):\s*(.+)$/;
      let match = pylintRe.exec(line);
      if (match) {
        diags.push({
          file: match[1]!,
          line: Number(match[2]),
          column: Number(match[3]),
          severity: match[4]!.startsWith("E") || match[4]!.startsWith("F") ? "error" : "warning",
          code: match[4]!,
          message: match[5]!,
        });
        continue;
      }
      // go vet: file:line: message
      const goRe = /^(.+?):(\d+):(\d*):?\s*(.+)$/;
      match = goRe.exec(line);
      if (match && !match[1]!.startsWith("#")) {
        diags.push({
          file: match[1]!,
          line: Number(match[2]),
          column: Number(match[3]) || 1,
          severity: "error",
          code: "go-vet",
          message: match[4]!,
        });
      }
    }
    return diags;
  }

  /** Parse tsc output into structured diagnostics. */
  parseTypeScriptOutput(output: string): Diagnostic[] {
    const diags: Diagnostic[] = [];
    const re = /^(.+?)\((\d+),(\d+)\):\s+(error|warning|info)\s+(TS\d+):\s+(.+)$/gm;
    let match = re.exec(output);
    while (match !== null) {
      diags.push({
        file: match[1]!,
        line: Number(match[2]),
        column: Number(match[3]),
        severity: match[4]! as "error" | "warning" | "info",
        code: match[5]!,
        message: match[6]!,
      });
      match = re.exec(output);
    }
    return diags;
  }

  private async runCommand(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<DiagnosticsResult> {
    return new Promise((resolve) => {
      const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      let stdout = "";
      let stderr = "";

      const timer = setTimeout(() => {
        child.kill();
        resolve({ diagnostics: [], errorCount: 0, warningCount: 0, filesChecked: 0, success: false });
      }, timeoutMs);

      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on("error", () => {
        clearTimeout(timer);
        resolve({ diagnostics: [], errorCount: 0, warningCount: 0, filesChecked: 0, success: false });
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        const diags = this.parseTypeScriptOutput(stdout + stderr);
        resolve({
          diagnostics: diags,
          errorCount: diags.filter((d) => d.severity === "error").length,
          warningCount: diags.filter((d) => d.severity === "warning").length,
          filesChecked: diags.length > 0 ? new Set(diags.map((d) => d.file)).size : 0,
          success: code === 0 || diags.every((d) => d.severity !== "error"),
        });
      });
    });
  }
}
