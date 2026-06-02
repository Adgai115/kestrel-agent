/**
 * Configuration loader for Kestrel Agent.
 *
 * Reads from environment variables with sensible defaults.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";

export interface KestrelConfig {
  provider: string;
  model: string;
  apiKey: string;
  gateway: {
    host: string;
    port: number;
    token: string;
  };
  dbPath: string;
  /** Root data directory. Default: KESTREL_HOME ?? .kestrel */
  dataDir: string;
}

/** Resolve the data directory from KESTREL_HOME env var, project-local .kestrel, or ~/.kestrel. */
export function resolveDataDir(): string {
  const fromEnv = process.env.KESTREL_HOME;
  if (fromEnv) return fromEnv;
  // Use project-local .kestrel if pnpm-workspace.yaml exists in cwd
  if (existsSync("pnpm-workspace.yaml")) return ".kestrel";
  return `${homedir()}/.kestrel`;
}

/** Load configuration from environment variables. */
export function loadConfig(overrides?: Partial<KestrelConfig>): KestrelConfig {
  return {
    provider: process.env.KESTREL_PROVIDER ?? "deepseek",
    model: process.env.KESTREL_MODEL ?? "deepseek-v4-pro",
    apiKey: process.env.KESTREL_API_KEY ?? "",
    gateway: {
      host: process.env.KESTREL_GATEWAY_HOST ?? "127.0.0.1",
      port: Number(process.env.KESTREL_GATEWAY_PORT) || 3100,
      token: process.env.KESTREL_GATEWAY_TOKEN ?? "",
    },
    dbPath: process.env.KESTREL_DB_PATH ?? `${resolveDataDir()}/kestrel.db`,
    dataDir: resolveDataDir(),
    ...overrides,
  };
}
