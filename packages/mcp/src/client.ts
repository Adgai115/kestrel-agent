/**
 * @kestrel/mcp — MCP (Model Context Protocol) stdio client.
 *
 * Implements JSON-RPC 2.0 over stdin/stdout for communicating with
 * MCP-compatible tool servers (e.g. filesystem, puppeteer, github).
 */

import { type ChildProcess, spawn } from "node:child_process";

// ============================================================================
// Environment allowlist — MCP servers must not inherit the full process.env
// to prevent credential leaks (API keys, tokens, etc.).
// ============================================================================

export const MCP_ENV_ALLOWLIST = new Set([
  // Unix/POSIX
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TMPDIR",
  // Windows
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
  // Node.js
  "NODE_ENV",
  "NO_COLOR",
  "FORCE_COLOR",
  "TERM",
]);

function buildMcpEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of MCP_ENV_ALLOWLIST) {
    const val = process.env[key];
    if (val !== undefined) env[key] = val;
  }
  return { ...env, ...extra };
}

// ============================================================================
// Types
// ============================================================================

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export interface McpToolCallResult {
  content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
  isError?: boolean;
}

export interface McpServerConfig {
  /** Command to launch the MCP server (e.g. "npx", "node") */
  command: string;
  /** Arguments for the server process */
  args?: string[];
  /** Environment variables for the server process */
  env?: Record<string, string>;
  /** Working directory */
  cwd?: string;
  /** Connection timeout in ms. Default: 10_000 */
  connectTimeout?: number;
  /** Per-request call timeout in ms. Default: 30_000 */
  callTimeout?: number;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
  id: number;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

// ============================================================================
// McpClient
// ============================================================================

export class McpClient {
  private process: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private buffer = "";
  private _connected = false;
  private _serverInfo: { name: string; version: string } | null = null;
  private _tools: McpTool[] = [];

  readonly config: McpServerConfig;

  constructor(config: McpServerConfig) {
    this.config = { connectTimeout: 10_000, callTimeout: 30_000, args: [], ...config };
  }

  get connected(): boolean {
    return this._connected;
  }

  get serverInfo(): { name: string; version: string } | null {
    return this._serverInfo;
  }

  get tools(): McpTool[] {
    return this._tools;
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  async connect(): Promise<void> {
    if (this._connected) return;

    this.process = spawn(this.config.command, this.config.args ?? [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: buildMcpEnv(this.config.env),
      cwd: this.config.cwd,
      windowsHide: true,
    });

    // Raw data-based MCP frame parsing (preserves \r\n for Content-Length header)
    // Q-0732: while loop processes all complete frames in buffer, not just the first.
    this.process.stdout?.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString("utf-8");

      let headerMatch = this.buffer.match(/Content-Length:\s*(\d+)\r?\n\r?\n/);
      while (headerMatch) {
        const contentLength = Number.parseInt(headerMatch[1]!, 10);
        const headerEnd = this.buffer.indexOf(headerMatch[0]) + headerMatch[0].length;

        if (this.buffer.length - headerEnd < contentLength) break; // incomplete frame

        const body = this.buffer.slice(headerEnd, headerEnd + contentLength);
        this.buffer = this.buffer.slice(headerEnd + contentLength);
        try {
          const msg = JSON.parse(body) as JsonRpcResponse;
          this._handleResponse(msg);
        } catch {
          /* skip unparseable messages */
        }

        headerMatch = this.buffer.match(/Content-Length:\s*(\d+)\r?\n\r?\n/);
      }
    });

    this.process.stderr?.on("data", () => {
      // stderr from MCP servers is for logging, not protocol
    });

    let exited = false;
    const exitHandler = () => {
      if (exited) return;
      exited = true;
      this._connected = false;
      this._rejectAllPending(new Error("MCP server process exited"));
    };
    this.process.on("exit", exitHandler);
    this.process.on("error", exitHandler);

    // MCP initialize handshake
    try {
      const result = (await this._send("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "kestrel-agent", version: "0.1.0" },
      })) as { protocolVersion: string; serverInfo: { name: string; version: string }; capabilities: unknown };

      this._serverInfo = result.serverInfo;
      this._connected = true;

      await this._send("notifications/initialized", {});

      // Discover tools
      const toolsResult = (await this._send("tools/list", {})) as { tools: McpTool[] };
      this._tools = toolsResult.tools ?? [];
    } catch (err) {
      this.process.kill();
      this.process = null;
      throw new Error(`MCP initialize failed: ${(err as Error).message}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.process) {
      this._connected = false;
      this._rejectAllPending(new Error("Client disconnected"));
      this.process.kill();
      this.process = null;
    }
  }

  // ==========================================================================
  // Tool Execution
  // ==========================================================================

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    if (!this._connected) throw new Error("MCP client not connected");
    return (await this._send("tools/call", { name, arguments: args })) as McpToolCallResult;
  }

  // ==========================================================================
  // Internal
  // ==========================================================================

  private _send(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const request: JsonRpcRequest = { jsonrpc: "2.0", method, params, id };

      const isConnect = method === "initialize" || method === "tools/list";
      const timeoutMs = isConnect ? (this.config.connectTimeout ?? 10_000) : (this.config.callTimeout ?? 30_000);
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timed out: ${method}`));
      }, timeoutMs);

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

      const body = JSON.stringify(request);
      const frame = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
      this.process?.stdin?.write(frame);
    });
  }

  private _handleResponse(msg: JsonRpcResponse): void {
    const handler = this.pending.get(msg.id);
    if (!handler) return;
    this.pending.delete(msg.id);

    if (msg.error) {
      handler.reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
    } else {
      handler.resolve(msg.result);
    }
  }

  private _rejectAllPending(err: Error): void {
    for (const handler of this.pending.values()) {
      handler.reject(err);
    }
    this.pending.clear();
  }
}

export const KESTREL_MCP_VERSION = "0.0.1";
