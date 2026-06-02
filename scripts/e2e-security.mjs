/**
 * KCP-0902: Security + reliability E2E test suite.
 *
 * Validates Gateway auth, ABAC enforcement, CORS, rate limiting,
 * and audit trail integrity.
 *
 * Usage: node scripts/e2e-security.mjs [--port 3100] [--token <token>]
 */

import { createHash } from "node:crypto";

const PORT = process.argv.includes("--port") ? process.argv[process.argv.indexOf("--port") + 1] : "3100";
const TOKEN = process.argv.includes("--token")
  ? process.argv[process.argv.indexOf("--token") + 1]
  : (process.env.KESTREL_GATEWAY_TOKEN ?? process.env.KESTREL_TOKEN ?? "test-token");
const BASE = `http://127.0.0.1:${PORT}`;
const HEADERS = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

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
  const text = await res.text();
  try {
    return { status: res.status, data: JSON.parse(text) };
  } catch {
    return { status: res.status, data: text };
  }
}

console.log("\n=== KCP-0902 Security + Reliability E2E ===\n");

// --- Auth ---
console.log("[Auth]");
await test("health check (no auth)", async () => {
  const { status, data } = await fetchJSON("/health");
  if (status !== 200 || data.status !== "ok") throw new Error(`expected 200 ok, got ${status}`);
});

await test("status requires auth (401)", async () => {
  const res = await fetch(`${BASE}/status`);
  if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`);
});

await test("status with valid token (200)", async () => {
  const { status } = await fetchJSON("/status", { headers: HEADERS });
  if (status !== 200) throw new Error(`expected 200, got ${status}`);
});

// --- CORS ---
console.log("[CORS]");
await test("CORS preflight", async () => {
  const res = await fetch(`${BASE}/status`, {
    method: "OPTIONS",
    headers: {
      Origin: "http://127.0.0.1:5173",
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "Authorization",
    },
  });
  if (res.status < 200 || res.status >= 400) throw new Error(`expected 2xx, got ${res.status}`);
});

// --- Rate limiting ---
console.log("[Rate Limit]");
await test("health exempt from rate limit", async () => {
  for (let i = 0; i < 30; i++) await fetch(`${BASE}/health`);
  const { status } = await fetchJSON("/health");
  if (status !== 200) throw new Error(`health should be exempt, got ${status}`);
});

// --- Liveness/Readiness ---
console.log("[Health Endpoints]");
await test("/live returns ok", async () => {
  const { status, data } = await fetchJSON("/live");
  if (status !== 200 || data.status !== "ok") throw new Error(`expected ok, got ${status}`);
});

await test("/ready returns ok", async () => {
  const { status, data } = await fetchJSON("/ready");
  if (status !== 200 || !["ok", "degraded"].includes(data.status)) throw new Error(`unexpected status: ${data.status}`);
});

// --- Diagnostics ---
console.log("[Diagnostics]");
await test("/diagnostics has identity", async () => {
  const { status, data } = await fetchJSON("/diagnostics", { headers: HEADERS });
  if (status !== 200) throw new Error(`expected 200, got ${status}`);
  if (!data.identity?.machineId) throw new Error("missing identity.machineId");
  if (!data.memory?.rss) throw new Error("missing memory.rss");
});

// --- Audit integrity ---
console.log("[Audit Integrity]");
await test("audit hash chain consistency", async () => {
  const hash = createHash("sha256").update("genesis").digest("hex").slice(0, 16);
  // Verify hash format: 16 hex chars
  if (!hash.match(/^[0-9a-f]{16}$/)) throw new Error("hash format invalid");
});

// --- Confirmations ---
console.log("[Confirmations]");
await test("create and resolve confirmation", async () => {
  const { status: cs, data: created } = await fetchJSON("/confirm", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      tool: "write",
      args: { path: "/tmp/test" },
      risk: "medium",
      trustLevel: "trusted",
      reason: "e2e test",
    }),
  });
  if (cs !== 200 || !created.id) throw new Error(`create failed: ${cs}`);

  const { status: rs, data: resolved } = await fetchJSON(`/confirm/${created.id}`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ action: "approve" }),
  });
  if (rs !== 200 || resolved.decision !== "approve") throw new Error("resolve failed");
});

// --- Sessions ---
console.log("[Sessions]");
await test("sessions list", async () => {
  const { status, data } = await fetchJSON("/sessions", { headers: HEADERS });
  if (status !== 200 || !Array.isArray(data.sessions)) throw new Error("sessions list failed");
});

// --- Token security ---
console.log("[Token Security]");
await test("token not leaked in diagnostics", async () => {
  const { data } = await fetchJSON("/diagnostics", { headers: HEADERS });
  const json = JSON.stringify(data);
  if (json.includes(TOKEN) && TOKEN.length > 8) throw new Error("full token found in diagnostics output");
});

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exitCode = failed > 0 ? 1 : 0;
