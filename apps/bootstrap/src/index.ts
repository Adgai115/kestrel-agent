#!/usr/bin/env node

/**
 * TASK-0094: Kestrel Agent Bootstrap — wires Gateway + ConversationLoop + Permissions.
 *
 * This is the main entry point that starts all subsystems together.
 *
 * Usage:
 *   node apps/bootstrap/dist/index.js
 *   pnpm start
 */

import { ConversationLoop, loadConfig } from "@kestrel/core";
import { KestrelGateway } from "@kestrel/gateway";

async function chatViaAdapter(adapter: ConversationLoop, prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "";
    const unsub = adapter.onEvent((event: { type: string; text?: string; message?: string }) => {
      if (event.type === "text_delta") output += event.text;
      else if (event.type === "error") output += `\nError: ${event.message}`;
      else if (event.type === "agent_end") {
        // agent_end signals the turn is fully complete
        unsub();
        clearTimeout(timeout);
        resolve(output || "(no response)");
      }
    });

    const timeout = setTimeout(() => {
      unsub();
      resolve(output || "(timeout)");
    }, 30_000);

    adapter.prompt(prompt).catch((err) => {
      clearTimeout(timeout);
      unsub();
      reject(err);
    });
  });
}

async function main() {
  console.log("Kestrel Agent v0.1.0 [API Server mode] — bootstrap starting...");

  // 1. Start ConversationLoop (direct API connection)
  const cfg = loadConfig();
  const adapter = new ConversationLoop({
    apiKey: cfg.apiKey,
    model: cfg.model,
  });

  try {
    await adapter.start();
    console.log(`ConversationLoop: ready (session ${adapter.sessionId})`);
  } catch (err) {
    console.warn("ConversationLoop: not available —", (err as Error).message);
  }

  // 2. Start Gateway
  const port = Number.parseInt(process.env.KESTREL_PORT ?? "3100", 10);
  const token = process.env.KESTREL_TOKEN;
  const gw = new KestrelGateway({
    port,
    token,
    onChat: async (prompt) => {
      if (adapter.isRunning) {
        return await chatViaAdapter(adapter, prompt);
      }
      return "ConversationLoop not connected.";
    },
  });

  await gw.start();
  console.log(`Gateway: http://127.0.0.1:${gw.config.port}`);
  console.log(`Token: ${gw.config.token.slice(0, 8)}...`);
  console.log("\nKestrel Agent running. Endpoints:");
  console.log(`  Health:  GET  http://127.0.0.1:${gw.config.port}/health`);
  console.log(`  Status:  GET  http://127.0.0.1:${gw.config.port}/status`);
  console.log(`  RPC:     POST http://127.0.0.1:${gw.config.port}/rpc`);
  console.log(`  SSE:     GET  http://127.0.0.1:${gw.config.port}/sse`);
  console.log(`  WS:      ws://127.0.0.1:${gw.config.port}/ws`);

  // 3. Interactive stdin loop — Gateway mode with terminal input
  const readline = await import("node:readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.setPrompt("kestrel> ");
  rl.prompt();

  const shutdown = async () => {
    console.log("\nShutting down...");
    adapter.dispose();
    await gw.stop();
    rl.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed === "/quit" || trimmed === "/exit") {
      await shutdown();
      break;
    }
    if (trimmed === "/help") {
      console.log("  /quit, /exit   Shutdown Gateway");
      console.log("  /status        Gateway status");
      console.log("  /health        Run health check");
      console.log("  <message>      Send to AI agent");
      rl.prompt();
      continue;
    }
    if (trimmed === "/status") {
      console.log(`  Uptime: ${Math.round((Date.now() - (gw as any).startedAt) / 1000)}s`);
      console.log(`  Port:   ${gw.config.port}`);
      rl.prompt();
      continue;
    }
    if (trimmed === "/health") {
      try {
        const res = await fetch(`http://127.0.0.1:${gw.config.port}/health`);
        const body = (await res.json()) as { status: string };
        console.log(`  Status: ${body.status}`);
      } catch {
        console.log("  Health check failed");
      }
      rl.prompt();
      continue;
    }
    if (!trimmed) {
      rl.prompt();
      continue;
    }

    // Send to ConversationLoop
    if (adapter.isRunning) {
      try {
        await adapter.prompt(trimmed);
      } catch (err) {
        console.error("Agent error:", (err as Error).message);
      }
    } else {
      console.log("  ConversationLoop not connected. AI prompts unavailable.");
    }
    rl.prompt();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
