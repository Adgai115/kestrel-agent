/**
 * Sandbox executor interface.
 *
 * Abstracts command execution behind a sandbox boundary.
 * Supports Docker, gVisor, and local (process isolation) backends.
 */

export interface SandboxConfig {
  /** Command to execute */
  command: string;
  /** Working directory inside the sandbox */
  cwd?: string;
  /** Environment variable allowlist */
  env?: Record<string, string>;
  /** Timeout in milliseconds. Default: 30_000 */
  timeoutMs?: number;
  /** Read-only paths inside the sandbox */
  readOnlyPaths?: string[];
  /** Writable paths (typically the workspace mount) */
  writablePaths?: string[];
  /** Shell to use. Default: /bin/sh on Unix, cmd.exe on Windows */
  shell?: string;
}

export interface SandboxResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** Whether the execution was terminated by timeout */
  timedOut: boolean;
  /** Wall clock duration in ms */
  durationMs: number;
}

export interface SandboxExecutor {
  /** Human-readable name for this executor backend */
  readonly name: string;

  /** Check if the sandbox backend is available */
  isAvailable(): Promise<boolean>;

  /** Execute a command inside the sandbox */
  execute(config: SandboxConfig): Promise<SandboxResult>;
}
