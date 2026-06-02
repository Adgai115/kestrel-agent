/**
 * Docker sandbox executor.
 *
 * Runs commands inside ephemeral Docker containers with:
 * - Read-only root filesystem
 * - Workspace volume mount
 * - Resource limits (memory, CPU)
 * - Timeout enforcement
 * - Env allowlist
 *
 * Requires Docker to be available on the host.
 */

import { spawn } from "node:child_process";
import type { SandboxConfig, SandboxExecutor, SandboxResult } from "./executor.js";

export interface DockerExecutorConfig {
  /** Docker image to use. Default: "ubuntu:22.04" */
  image?: string;
  /** Host workspace path to mount into the container */
  workspacePath?: string;
  /** Container workspace path. Default: "/workspace" */
  containerWorkspace?: string;
  /** Memory limit (e.g. "256m"). Default: "512m" */
  memory?: string;
}

export class DockerExecutor implements SandboxExecutor {
  readonly name = "docker";
  readonly isSandbox = true;

  private image: string;
  private workspacePath: string;
  private containerWorkspace: string;
  private memory: string;

  constructor(config: DockerExecutorConfig = {}) {
    this.image = config.image ?? "ubuntu:22.04";
    this.workspacePath = config.workspacePath ?? process.cwd();
    this.containerWorkspace = config.containerWorkspace ?? "/workspace";
    this.memory = config.memory ?? "512m";
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.docker(["version"], { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  async execute(config: SandboxConfig): Promise<SandboxResult> {
    const timeoutMs = config.timeoutMs ?? 30_000;
    const startTime = Date.now();

    // Build docker run arguments
    const args = [
      "run",
      "--rm",
      "--read-only",
      "--network=none",
      `--memory=${this.memory}`,
      "--cpus=1",
      "-v",
      `${this.workspacePath}:${this.containerWorkspace}`,
      "-w",
      config.cwd ?? this.containerWorkspace,
    ];

    // Mount read-only paths
    for (const rp of config.readOnlyPaths ?? []) {
      args.push("-v", `${rp}:${rp}:ro`);
    }

    // Mount writable paths
    for (const wp of config.writablePaths ?? []) {
      args.push("-v", `${wp}:${wp}`);
    }

    // Environment variables (allowlist only)
    if (config.env) {
      for (const [k, v] of Object.entries(config.env)) {
        args.push("-e", `${k}=${v}`);
      }
    }

    // Image and command
    args.push(this.image);
    args.push("/bin/sh", "-c", config.command);

    return new Promise((resolve, reject) => {
      const child = spawn("docker", args, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
        spawn("docker", ["kill", child.pid?.toString() ?? ""]);
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
        reject(new Error(`Docker not available: ${err.message}`));
      });

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ exitCode: code, stdout, stderr, timedOut, durationMs: Date.now() - startTime });
      });
    });
  }

  private docker(args: string[], opts?: { timeout?: number }): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";

      const timer = opts?.timeout
        ? setTimeout(() => {
            child.kill();
            reject(new Error("docker timeout"));
          }, opts.timeout)
        : null;

      child.stdout?.on("data", (c: Buffer) => {
        stdout += c.toString();
      });
      child.stderr?.on("data", (c: Buffer) => {
        stderr += c.toString();
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (timer) clearTimeout(timer);
        if (code === 0) resolve({ stdout, stderr });
        else reject(new Error(`docker exited ${code}: ${stderr}`));
      });
    });
  }
}
