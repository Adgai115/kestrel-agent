#!/usr/bin/env node
/**
 * TASK-0093: Kestrel Gateway CLI entry point.
 *
 * Usage:
 *   node packages/gateway/dist/bin.js
 *   node packages/gateway/dist/bin.js --port 3100
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { KestrelGateway } from "./server.js";

// Walk up to find project root (has pnpm-workspace.yaml)
function findProjectRoot(startDir: string): string {
  let dir = resolve(startDir);
  const root = dirname(dir);
  while (dir !== root) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  return startDir;
}

const projectRoot = findProjectRoot(process.cwd());

// TASK-1043: Load .env from project root
try {
  process.loadEnvFile?.(join(projectRoot, ".env"));
} catch {
  /* optional */
}

// Parse --port=N or --port N from argv
function parsePortArg(args: string[]): number | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port" && i + 1 < args.length) return Number.parseInt(args[i + 1]!, 10);
    const m = args[i]?.match(/^--port=(.+)$/);
    if (m) return Number.parseInt(m[1]!, 10);
  }
  return undefined;
}

const port =
  parsePortArg(process.argv) ??
  Number.parseInt(process.env.KESTREL_GATEWAY_PORT ?? process.env.KESTREL_PORT ?? "3100", 10);
const host = process.env.KESTREL_GATEWAY_HOST ?? "127.0.0.1";
// TASK-1043: Unified token env var — KESTREL_GATEWAY_TOKEN, fallback to KESTREL_TOKEN
const token = process.env.KESTREL_GATEWAY_TOKEN ?? process.env.KESTREL_TOKEN ?? undefined;

// Wire chat RPC to ConversationLoop when available.
// Q-0516: Create a fresh adapter per request for session isolation.
// Q-0515: Use agent_end event instead of setTimeout for completion detection.
let onChat: ((prompt: string) => Promise<string>) | undefined;
let onChatStream: ((prompt: string, send: (event: Record<string, unknown>) => void) => Promise<void>) | undefined;
try {
  const { ConversationLoop, loadConfig } = await import("@kestrel/core");
  const cfg = loadConfig();

  // Synchronous chat — collects all text_delta into one response
  onChat = async (prompt: string) => {
    const adapter = new ConversationLoop({ apiKey: cfg.apiKey, model: cfg.model });
    try {
      await adapter.start();
    } catch {
      return "ConversationLoop failed to start.";
    }
    return new Promise((resolve) => {
      let output = "";
      const unsub = adapter.onEvent((event: { type: string; text?: string; message?: string }) => {
        if (event.type === "text_delta") output += event.text;
        else if (event.type === "error") output += `\nError: ${event.message}`;
        else if (event.type === "agent_end") {
          unsub();
          adapter.dispose();
          resolve(output || "(no response)");
        }
      });
      const timeout = setTimeout(() => {
        unsub();
        adapter.dispose();
        resolve(output || "(timeout)");
      }, 30_000);
      adapter.prompt(prompt).catch((err: Error) => {
        clearTimeout(timeout);
        unsub();
        adapter.dispose();
        resolve(`Chat error: ${err.message}`);
      });
    });
  };

  // Streaming chat — relays each event through the send callback
  onChatStream = async (prompt: string, send: (event: Record<string, unknown>) => void) => {
    const adapter = new ConversationLoop({ apiKey: cfg.apiKey, model: cfg.model });
    try {
      await adapter.start();
    } catch {
      send({ type: "error", message: "ConversationLoop failed to start." });
      return;
    }
    return new Promise<void>((resolve) => {
      const unsub = adapter.onEvent(
        (event: {
          type: string;
          text?: string;
          message?: string;
          name?: string;
          args?: unknown;
          result?: unknown;
          isError?: boolean;
        }) => {
          send(event);
          if (event.type === "agent_end" || event.type === "error") {
            unsub();
            adapter.dispose();
            resolve();
          }
        },
      );
      const timeout = setTimeout(() => {
        unsub();
        adapter.dispose();
        resolve();
      }, 30_000);
      adapter.prompt(prompt).catch((err: Error) => {
        clearTimeout(timeout);
        unsub();
        adapter.dispose();
        send({ type: "error", message: err.message });
        resolve();
      });
    });
  };
} catch {
  // @kestrel/core not available — /chat RPC returns stub response
}

const gw = new KestrelGateway({ host, port, token, onChat, onChatStream });

async function main() {
  await gw.start();
  // TASK-1044: Print full token + write to .kestrel/gateway-token for Web Console
  const tokenDir = join(process.cwd(), ".kestrel");
  mkdirSync(tokenDir, { recursive: true });
  writeFileSync(join(tokenDir, "gateway-token"), gw.config.token, "utf-8");
  console.log(`Token: ${gw.config.token.slice(0, 8)}... (full token saved to .kestrel/gateway-token)`);
}

process.on("SIGINT", async () => {
  await gw.stop();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await gw.stop();
  process.exit(0);
});

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
