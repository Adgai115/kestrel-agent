/**
 * Local child-process executor — NOT a security sandbox.
 *
 * This is a development fallback. It runs commands on the host through
 * a shell subprocess. It does NOT provide filesystem isolation, seccomp,
 * or container boundaries.
 *
 * High-risk tool execution MUST use a real sandbox backend (Docker, gVisor).
 */

import { spawn } from "node:child_process";
import type { SandboxConfig, SandboxExecutor, SandboxResult } from "./executor.js";

/** Minimal safe baseline env vars required for subprocess operation. */
function minimalEnv(allowed: Record<string, string> | undefined): Record<string, string> {
  const baseline: Record<string, string> = {};
  // Pass only essential system paths, not secrets
  for (const key of ["PATH", "SystemRoot", "HOME", "USERPROFILE", "TEMP", "TMP"]) {
    if (process.env[key]) baseline[key] = process.env[key]!;
  }
  // Merge explicit allowlist
  if (allowed) Object.assign(baseline, allowed);
  return baseline;
}

export class NodeSandbox implements SandboxExecutor {
  readonly name = "local-process";
  readonly isSandbox = false;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async execute(config: SandboxConfig): Promise<SandboxResult> {
    // Reject unimplemented isolation features
    if (config.readOnlyPaths?.length || config.writablePaths?.length) {
      throw new Error(
        "NodeSandbox does not support readOnlyPaths/writablePaths. " +
          "Use a real sandbox backend (Docker, gVisor) for path isolation.",
      );
    }

    const timeoutMs = config.timeoutMs ?? 30_000;
    const startTime = Date.now();
    const shell = config.shell ?? (process.platform === "win32" ? "cmd.exe" : "/bin/sh");
    const shellArgs = process.platform === "win32" ? ["/c", config.command] : ["-c", config.command];
    const env = minimalEnv(config.env);

    return new Promise((resolve, reject) => {
      const child = spawn(shell, shellArgs, {
        cwd: config.cwd ?? process.cwd(),
        env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;

      const timer = setTimeout(() => {
        timedOut = true;
        if (process.platform === "win32" && child.pid) {
          // On Windows, SIGKILL is a no-op. Use taskkill /T to kill the
          // entire process tree (shell + its children like ping.exe).
          spawn("taskkill", ["/F", "/T", "/PID", String(child.pid)], {
            stdio: "ignore",
            windowsHide: true,
          });
        } else {
          child.kill("SIGKILL");
        }
      }, timeoutMs);

      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ exitCode: code, stdout, stderr, timedOut, durationMs: Date.now() - startTime });
      });
    });
  }
}
