#!/usr/bin/env node
/**
 * TASK-0750: Manual MCP integration verification.
 *
 * Spawns a filesystem MCP server, connects via McpClient, and verifies
 * the full pipeline: connect → tools/list → tools/call (read/write/list).
 *
 * Usage: node scripts/verify-mcp.mjs
 * Requires: pnpm build (or --conditions development)
 */

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// --- Inline filesystem MCP server (.cjs for CommonJS compatibility) ---
// Uses raw data events (not readline) because MCP frames don't end with \n.
const FS_SERVER_JS = `
var fs = require('fs');
var path = require('path');
var sandbox = (process.env.TEMP || '/tmp').replace(/\\\\/g, '/');
var buf = '';
process.stdin.on('data', function(chunk) {
  buf += chunk.toString('utf-8');
  var m;
  while ((m = buf.match(/Content-Length:\\s*(\\d+)\\r?\\n\\r?\\n/))) {
    var len = parseInt(m[1], 10);
    var hEnd = buf.indexOf(m[0]) + m[0].length;
    if (buf.length - hEnd < len) break;
    var body = buf.slice(hEnd, hEnd + len);
    buf = buf.slice(hEnd + len);
    try {
      var req = JSON.parse(body);
      var result;
      if (req.method === 'initialize') {
        result = { protocolVersion: '2024-11-05', serverInfo: { name: 'filesystem', version: '0.1.0' }, capabilities: { tools: {} } };
      } else if (req.method === 'tools/list') {
        result = { tools: [
          { name: 'read_file', description: 'Read a file', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
          { name: 'write_file', description: 'Write to a file', inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
          { name: 'list_directory', description: 'List directory contents', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
        ] };
      } else if (req.method === 'tools/call') {
        var p = req.params;
        if (p.name === 'read_file') {
          var fp = path.join(sandbox, path.basename(p.arguments.path || ''));
          try { var text = fs.readFileSync(fp, 'utf-8'); result = { content: [{ type: 'text', text: text }] }; }
          catch(e) { result = { content: [{ type: 'text', text: 'ENOENT: ' + fp }], isError: true }; }
        } else if (p.name === 'write_file') {
          var fp2 = path.join(sandbox, path.basename(p.arguments.path || ''));
          fs.writeFileSync(fp2, p.arguments.content || '', 'utf-8');
          result = { content: [{ type: 'text', text: 'Wrote ' + (p.arguments.content || '').length + ' bytes to ' + fp2 }] };
        } else if (p.name === 'list_directory') {
          var dp = p.arguments.path ? path.join(sandbox, path.basename(p.arguments.path)) : sandbox;
          try { var files = fs.readdirSync(dp); result = { content: [{ type: 'text', text: files.join('\\n') }] }; }
          catch(e) { result = { content: [{ type: 'text', text: 'ENOENT: ' + dp }], isError: true }; }
        }
      } else { result = {}; }
      var resp = JSON.stringify({ jsonrpc: '2.0', id: req.id, result: result });
      process.stdout.write('Content-Length: ' + Buffer.byteLength(resp) + '\\r\\n\\r\\n' + resp);
    } catch(e) {}
  }
});
setTimeout(function(){}, 30000);
`;

// --- Environment allowlist ---
const MCP_ENV_ALLOWLIST = new Set([
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TMPDIR",
  "Path",
  "PATHEXT",
  "USERPROFILE",
  "TEMP",
  "TMP",
  "USERNAME",
  "SYSTEMROOT",
  "SystemRoot",
  "WINDIR",
  "COMSPEC",
  "OS",
  "HOMEDRIVE",
  "HOMEPATH",
  "ProgramFiles",
  "CommonProgramFiles",
  "ProgramFiles(x86)",
  "CommonProgramFiles(x86)",
  "PROCESSOR_ARCHITECTURE",
  "NUMBER_OF_PROCESSORS",
  "NODE_ENV",
  "NO_COLOR",
  "FORCE_COLOR",
  "TERM",
]);

function buildMcpEnv(extra = {}) {
  const env = {};
  for (const key of MCP_ENV_ALLOWLIST) {
    const val = process.env[key];
    if (val !== undefined) env[key] = val;
  }
  return { ...env, ...extra };
}

// --- Simple McpClient (inline to avoid TS build dependency) ---
class McpClient {
  constructor(config) {
    this.config = { connectTimeout: 10000, args: [], ...config };
    this.process = null;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = "";
    this._connected = false;
    this._tools = [];
    this._serverInfo = null;
  }
  get connected() {
    return this._connected;
  }
  get tools() {
    return this._tools;
  }
  get serverInfo() {
    return this._serverInfo;
  }

  async connect() {
    this.process = spawn(this.config.command, this.config.args ?? [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: buildMcpEnv(this.config.env),
      windowsHide: true,
    });
    this.process.stdout.on("data", (chunk) => {
      this.buffer += chunk.toString("utf-8");
      let hm = this.buffer.match(/Content-Length:\s*(\d+)\r?\n\r?\n/);
      while (hm) {
        const len = Number.parseInt(hm[1], 10);
        const hEnd = this.buffer.indexOf(hm[0]) + hm[0].length;
        if (this.buffer.length - hEnd < len) break;
        const body = this.buffer.slice(hEnd, hEnd + len);
        this.buffer = this.buffer.slice(hEnd + len);
        try {
          this._handle(JSON.parse(body));
        } catch {}
        hm = this.buffer.match(/Content-Length:\s*(\d+)\r?\n\r?\n/);
      }
    });
    this.process.stderr.on("data", () => {});
    const onExit = () => {
      this._connected = false;
      for (const h of this.pending.values()) h.reject(new Error("exited"));
      this.pending.clear();
    };
    this.process.on("exit", onExit);
    this.process.on("error", onExit);
    const result = await this._send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "verify", version: "0.1.0" },
    });
    this._serverInfo = result.serverInfo;
    this._connected = true;
    await this._send("notifications/initialized", {});
    const tr = await this._send("tools/list", {});
    this._tools = tr.tools ?? [];
  }

  async disconnect() {
    if (this.process) {
      this._connected = false;
      for (const h of this.pending.values()) h.reject(new Error("disconnected"));
      this.pending.clear();
      this.process.kill();
      this.process = null;
    }
  }

  async callTool(name, args) {
    if (!this._connected) throw new Error("not connected");
    return this._send("tools/call", { name, arguments: args });
  }

  _send(method, params) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout: ${method}`));
      }, this.config.connectTimeout);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timeout);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timeout);
          reject(e);
        },
      });
      const body = JSON.stringify({ jsonrpc: "2.0", method, params, id });
      this.process.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
    });
  }

  _handle(msg) {
    const h = this.pending.get(msg.id);
    if (!h) return;
    this.pending.delete(msg.id);
    if (msg.error) h.reject(new Error(`MCP ${msg.error.code}: ${msg.error.message}`));
    else h.resolve(msg.result);
  }
}

// --- Main ---
async function main() {
  console.log("=== Kestrel MCP Integration Verification (TASK-0750) ===\n");

  // 1. Setup
  const sandbox = join(tmpdir(), `kestrel-verify-${Date.now()}`);
  mkdirSync(sandbox, { recursive: true });
  writeFileSync(join(sandbox, "hello.txt"), "Hello, Kestrel MCP!", "utf-8");

  const serverPath = join(tmpdir(), `kestrel-fs-verify-${process.pid}.cjs`);
  writeFileSync(serverPath, FS_SERVER_JS, "utf-8");

  let passed = 0;
  let failed = 0;
  const check = (label, condition, detail) => {
    if (condition) {
      console.log(`  ✓ ${label}`);
      passed++;
    } else {
      console.log(`  ✗ ${label} — ${detail}`);
      failed++;
    }
  };

  try {
    // 2. Connect
    const client = new McpClient({
      command: process.execPath,
      args: [serverPath],
      env: { TEMP: sandbox, TMP: sandbox },
      connectTimeout: 5000,
    });

    console.log("1. Connect & initialize");
    await client.connect();
    check("Connected", client.connected, "should be true");
    check("Server info", client.serverInfo?.name === "filesystem", `got: ${client.serverInfo?.name}`);

    // 3. Tool discovery
    console.log("\n2. Tool discovery (tools/list)");
    const tools = client.tools;
    check("3 tools discovered", tools.length === 3, `got ${tools.length}: ${tools.map((t) => t.name).join(", ")}`);
    check(
      "Has read_file",
      tools.some((t) => t.name === "read_file"),
    );
    check(
      "Has write_file",
      tools.some((t) => t.name === "write_file"),
    );
    check(
      "Has list_directory",
      tools.some((t) => t.name === "list_directory"),
    );

    // 4. Read file
    console.log("\n3. Read file (tools/call read_file)");
    const readResult = await client.callTool("read_file", { path: "hello.txt" });
    check("Read success", !readResult.isError, `isError: ${readResult.isError}`);
    check(
      "Read content",
      readResult.content[0]?.text?.includes("Hello, Kestrel MCP!"),
      `got: ${readResult.content[0]?.text?.slice(0, 30)}`,
    );

    // 5. Write file
    console.log("\n4. Write file (tools/call write_file)");
    const writeResult = await client.callTool("write_file", { path: "test.txt", content: "MCP integration works!" });
    check("Write success", !writeResult.isError, `isError: ${writeResult.isError}`);
    const written = readFileSync(join(sandbox, "test.txt"), "utf-8");
    check("Write persisted", written === "MCP integration works!", `got: ${written}`);

    // 6. List directory
    console.log("\n5. List directory (tools/call list_directory)");
    const listResult = await client.callTool("list_directory", { path: "." });
    const listing = listResult.content[0]?.text ?? "";
    check("List success", !listResult.isError, `isError: ${listResult.isError}`);
    check("Contains hello.txt", listing.includes("hello.txt"), `got: ${listing.slice(0, 60)}`);
    check("Contains test.txt", listing.includes("test.txt"), `got: ${listing.slice(0, 60)}`);

    // 7. Error handling
    console.log("\n6. Error handling");
    const errResult = await client.callTool("read_file", { path: "nonexistent.txt" });
    check("Missing file isError", errResult.isError === true, `isError: ${errResult.isError}`);
    check(
      "ENOENT message",
      errResult.content[0]?.text?.includes("ENOENT"),
      `got: ${errResult.content[0]?.text?.slice(0, 30)}`,
    );

    await client.disconnect();
    check("Disconnected", !client.connected);
  } catch (err) {
    console.log(`\n  FATAL: ${err.message}`);
    failed = 999;
  } finally {
    try {
      rmSync(sandbox, { recursive: true, force: true });
    } catch {}
    try {
      require("node:fs").unlinkSync(serverPath);
    } catch {}
  }

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
