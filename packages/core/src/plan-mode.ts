/**
 * Plan Mode — readonly exploration before implementation.
 *
 * When Plan Mode is active, only read-only tools are allowed:
 * - Allow: read, grep, find, ls, lsp diagnostics
 * - Deny: write, edit, bash, memory write, skill install
 */

export type PlanModeState = "inactive" | "active";

export interface PlanModeResult {
  /** The plan produced during plan mode */
  plan: string;
  /** Files examined during plan mode */
  filesExamined: string[];
  /** When plan mode was entered */
  enteredAt: string;
}

export class PlanMode {
  private state: PlanModeState = "inactive";
  private examinedFiles: string[] = [];
  private enteredAt = "";

  /** Allowed tools in plan mode (read-only) */
  static readonly ALLOWED_TOOLS = new Set([
    "read",
    "grep",
    "find",
    "ls",
    "lsp_diagnostics",
    "session_search",
    "memory_search",
  ]);

  get isActive(): boolean {
    return this.state === "active";
  }

  /** Enter plan mode. */
  enter(): void {
    if (this.state === "active") throw new Error("Already in plan mode");
    this.state = "active";
    this.examinedFiles = [];
    this.enteredAt = new Date().toISOString();
  }

  /** Record a file as examined during plan mode. */
  recordFile(file: string): void {
    if (this.state !== "active") return;
    if (!this.examinedFiles.includes(file)) {
      this.examinedFiles.push(file);
    }
  }

  /** Check if a tool is allowed in plan mode. Deny-by-default when active. */
  isToolAllowed(toolName: string): boolean {
    if (this.state !== "active") return true;
    return PlanMode.ALLOWED_TOOLS.has(toolName);
  }

  /** Exit plan mode and return the result. */
  exit(plan: string): PlanModeResult {
    if (this.state !== "active") throw new Error("Not in plan mode");
    this.state = "inactive";
    return {
      plan,
      filesExamined: [...this.examinedFiles],
      enteredAt: this.enteredAt,
    };
  }
}
