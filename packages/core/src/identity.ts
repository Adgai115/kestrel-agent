/**
 * Shared runtime identity provider.
 *
 * Generates a stable machine ID from hostname + cwd and a unique
 * instance ID on each process start. Exposed via Gateway /diagnostics
 * for consistent identity across CLI, Gateway, sub-agents, and tools.
 */

import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

export interface RuntimeIdentity {
  /** Machine-level identity — stable across restarts, same host + project */
  machineId: string;
  /** Instance-level identity — unique per process */
  instanceId: string;
  /** PID for diagnostics */
  pid: number;
  /** Hostname for diagnostics */
  host: string;
  /** Current working directory */
  cwd: string;
  /** ISO timestamp of instance start */
  startedAt: string;
  /** Node.js version */
  nodeVersion: string;
  /** Platform */
  platform: string;
}

function buildMachineId(): string {
  const h = hostname();
  const c = process.cwd();
  // Stable per host + project, not cryptographically sensitive
  let hash = 0;
  for (const ch of `${h}:${c}`) {
    hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
  }
  return `${h}-${Math.abs(hash).toString(36).slice(0, 8)}`;
}

let cached: RuntimeIdentity | null = null;

export function getRuntimeIdentity(): RuntimeIdentity {
  if (!cached) {
    cached = {
      machineId: buildMachineId(),
      instanceId: randomUUID(),
      pid: process.pid,
      host: hostname(),
      cwd: process.cwd(),
      startedAt: new Date().toISOString(),
      nodeVersion: process.version,
      platform: `${process.platform} ${process.arch}`,
    };
  }
  return cached;
}
