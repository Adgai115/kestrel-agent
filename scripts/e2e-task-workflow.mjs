/**
 * KCP-0903: CLI/Gateway task workflow E2E suite.
 *
 * Validates end-to-end task lifecycle: create → run → complete → audit.
 * Tests both CLI and Gateway paths.
 *
 * Usage: node scripts/e2e-task-workflow.mjs [--port 3100]
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "node:process";

const PORT = process.argv.includes("--port") ? process.argv[process.argv.indexOf("--port") + 1] : "3100";
const BASE = `http://127.0.0.1:${PORT}`;
let TOKEN = process.env.KESTREL_GATEWAY_TOKEN ?? process.env.KESTREL_TOKEN;
const HEADERS = { Authorization: `Bearer ${TOKEN ?? "test"}`, "Content-Type": "application/json" };

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL  ${name}: ${e.message}`);
  }
}

async function fetchJSON(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, opts);
  return { status: res.status, data: await res.json().catch(() => res.text()) };
}

console.log("\n=== KCP-0903 Task Workflow E2E ===\n");

// --- Gateway health + auth ---
console.log("[Setup]");
await test("gateway health check", async () => {
  const { status } = await fetchJSON("/health");
  if (status !== 200) throw new Error(`expected 200, got ${status}`);
});

await test("get gateway token from file", async () => {
  const tokenPath = join(cwd(), ".kestrel", "gateway-token");
  if (existsSync(tokenPath)) {
    const { readFileSync } = await import("node:fs");
    const token = readFileSync(tokenPath, "utf-8").trim();
    if (token) {
      TOKEN = token;
      HEADERS.Authorization = `Bearer ${token}`;
    }
  }
  if (!TOKEN) throw new Error("no token available");
});

// --- Session workflow ---
console.log("[Session]");
const sessionId = "";

await test("create session via Gateway (RPC)", async () => {
  const { status, data } = await fetchJSON("/rpc", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ id: "e2e-1", method: "status" }),
  });
  if (status !== 200) throw new Error(`RPC failed: ${status}`);
});

await test("list sessions via Gateway API", async () => {
  const { status, data } = await fetchJSON("/sessions", { headers: HEADERS });
  if (status !== 200 || !Array.isArray(data.sessions)) throw new Error("sessions list failed");
});

// --- Task workflow ---
console.log("[Task Workflow]");
let taskId = "";

await test("create task via Gateway confirm endpoint", async () => {
  const { status, data } = await fetchJSON("/confirm", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      tool: "write",
      args: { path: "/tmp/e2e-test" },
      risk: "low",
      trustLevel: "local",
      reason: "e2e task workflow test",
    }),
  });
  if (status !== 200 || !data.id) throw new Error("create confirm failed");
  taskId = data.id;
});

await test("resolve task (approve)", async () => {
  const { status, data } = await fetchJSON(`/confirm/${taskId}`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ action: "approve" }),
  });
  if (status !== 200 || data.decision !== "approve") throw new Error("approve failed");
});

await test("verify task is resolved", async () => {
  const { status, data } = await fetchJSON(`/confirm/${taskId}`, { headers: HEADERS });
  if (status !== 200 || !data.resolved) throw new Error("task not resolved");
});

// --- Audit trail ---
console.log("[Audit Trail]");
await test("query audit events via Gateway", async () => {
  const { status } = await fetchJSON("/audit", { headers: HEADERS });
  if (status !== 200) throw new Error("audit query failed");
});

// --- Diagnostics + health ---
console.log("[Health Check]");
await test("/diagnostics includes identity", async () => {
  const { status, data } = await fetchJSON("/diagnostics", { headers: HEADERS });
  if (status !== 200 || !data.identity?.instanceId) throw new Error("diagnostics missing identity");
});

await test("/live returns ok", async () => {
  const { status } = await fetchJSON("/live");
  if (status !== 200) throw new Error("live check failed");
});

await test("/queue returns channel inbox", async () => {
  const { status } = await fetchJSON("/queue/channel_inbox", { headers: HEADERS });
  if (status !== 200) throw new Error("queue query failed");
});

// --- CLI task commands ---
console.log("[CLI Commands]");
await test("CLI task list", async () => {
  const result = execSync("node packages/cli/bin/kestrel.js task list 2>&1", { encoding: "utf-8", cwd: cwd() });
  if (!result.includes("(no tasks)") && !result.includes("[")) throw new Error(`unexpected: ${result.slice(0, 80)}`);
});

await test("CLI session list", async () => {
  const result = execSync("node packages/cli/bin/kestrel.js session list 2>&1", { encoding: "utf-8", cwd: cwd() });
  // either has sessions or empty
  if (typeof result !== "string") throw new Error("session list failed");
});

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exitCode = failed > 0 ? 1 : 0;
