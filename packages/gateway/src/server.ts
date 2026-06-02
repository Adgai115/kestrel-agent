/**
 * Kestrel Gateway — Fastify HTTP/WebSocket/SSE server.
 *
 * Provides a local daemon for agent communication.
 * Default: localhost only, token-auth required.
 */

import { randomUUID } from "node:crypto";
import fastifyCors from "@fastify/cors";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyWebsocket from "@fastify/websocket";
import type { RuntimeIdentity } from "@kestrel/core";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";

// ============================================================================
// Types
// ============================================================================

export type GatewayLogLevel = "silent" | "error" | "info" | "debug";

export interface GatewayConfig {
  /** Listen host. Default: "127.0.0.1" */
  host?: string;
  /** Listen port. Default: 3100 */
  port?: number;
  /** Auth token. If not set, auto-generates one. */
  token?: string;
  /** Log level. Default: "error". Set to "silent" to suppress all output. */
  logLevel?: GatewayLogLevel;
  /** Rate limit config. Default: 100 requests per minute per IP. Set to false to disable. */
  rateLimit?:
    | false
    | {
        max?: number;
        timeWindow?: number; // ms
      };
  /** Handler for chat RPC method. Receives prompt text, returns response. */
  onChat?: (prompt: string) => Promise<string>;
  /** Streaming chat handler. Receives prompt + send callback for each event. */
  onChatStream?: (prompt: string, send: (event: Record<string, unknown>) => void) => Promise<void>;
}

export interface GatewayStatus {
  status: "ok" | "degraded";
  uptime: number;
  sessions: number;
  tokenPrefix: string;
}

export interface GatewayDiagnostics {
  status: "ok" | "degraded";
  uptime: number;
  sessions: number;
  pendingConfirmations: number;
  identity: {
    machineId: string;
    instanceId: string;
    pid: number;
    host: string;
    startedAt: string;
    nodeVersion: string;
    platform: string;
  };
  memory: { rss: number; heapTotal: number; heapUsed: number; external: number };
}

interface StatusCache {
  data: GatewayStatus;
  fetchedAt: number;
  validUntil: number;
  lastError?: string;
}

export interface TrackedSession {
  id: string;
  type: "sse" | "ws";
  connectedAt: number;
}

export interface PendingConfirmation {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  risk: string;
  trustLevel: string;
  reason: string;
  target?: string;
  createdAt: number;
  resolved: boolean;
  decision?: "approve" | "deny";
  resolvedAt?: number;
}

// ============================================================================
// Server
// ============================================================================

export class KestrelGateway {
  readonly server: FastifyInstance;
  readonly config: Required<GatewayConfig>;
  private startedAt = 0;
  private sessions = 0;
  private sessionMap = new Map<string, TrackedSession>();
  readonly confirmations = new Map<string, PendingConfirmation>();
  private statusCache: StatusCache | null = null;
  private readonly STATUS_CACHE_TTL = 15_000; // 15s freshness
  private readonly STATUS_CACHE_STALE = 120_000; // 2min max age

  constructor(config: GatewayConfig = {}) {
    this.config = {
      host: config.host ?? "127.0.0.1",
      port: config.port ?? 3100,
      token: config.token ?? randomUUID(),
      logLevel: config.logLevel ?? "error",
      rateLimit: config.rateLimit ?? { max: 100, timeWindow: 60000 },
      onChat: config.onChat ?? (async () => "Chat handler not configured"),
      onChatStream:
        config.onChatStream ??
        (async (_prompt, send) => {
          send({ type: "error", message: "Streaming chat handler not configured" });
        }),
    };

    const logLevel = this.config.logLevel;
    this.server = Fastify({
      logger: logLevel === "silent" ? false : logLevel === "info" ? true : { level: logLevel },
    });
  }

  private async setup(): Promise<void> {
    await this.server.register(fastifyWebsocket);
    await this.server.register(fastifyCors, {
      origin: [
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:5174",
        "http://localhost:5174",
        "http://127.0.0.1:4173",
        "http://localhost:4173",
        "http://127.0.0.1:4174",
        "http://localhost:4174",
      ],
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Authorization", "Content-Type"],
      credentials: true,
    });

    // Rate limiting (default: 100 req/min per IP)
    if (this.config.rateLimit !== false) {
      const rl = this.config.rateLimit ?? {};
      await this.server.register(fastifyRateLimit, {
        max: rl.max ?? 100,
        timeWindow: rl.timeWindow ?? 60_000,
        keyGenerator: (req) => req.ip,
        allowList: (req) => req.url === "/health",
      });
    }

    // TASK-0028: GitHub token cache — validate once, reuse for session
    const githubTokenCache = new Map<string, { user: string; login: string; expires: number }>();

    // Auth hook — Gateway token OR validated GitHub token
    this.server.addHook("onRequest", async (request, reply) => {
      if (request.url === "/health" || request.url.startsWith("/health?")) return;
      if (request.url === "/live" || request.url === "/ready") return;
      // CORS preflight — OPTIONS requests with Access-Control-Request-Method bypass auth
      if (request.method === "OPTIONS" && request.headers["access-control-request-method"]) return;

      const auth = request.headers.authorization;
      if (!auth?.startsWith("Bearer ")) {
        reply.status(401).send({ error: "Unauthorized" });
        return;
      }
      const token = auth.slice(7);

      // Primary: Gateway token
      if (token === this.config.token) return;

      // TASK-0028: GitHub OAuth as secondary auth
      if (token.startsWith("ghp_") || token.startsWith("github_pat_")) {
        const cached = githubTokenCache.get(token);
        if (cached && cached.expires > Date.now()) return;
        try {
          const ghRes = await fetch("https://api.github.com/user", {
            headers: { Authorization: `Bearer ${token}`, "User-Agent": "kestrel-agent" },
          });
          if (ghRes.ok) {
            const ghUser = (await ghRes.json()) as { login: string; name?: string };
            githubTokenCache.set(token, {
              user: ghUser.name ?? ghUser.login,
              login: ghUser.login,
              expires: Date.now() + 300_000,
            });
            return;
          }
        } catch {
          /* fall through */
        }
      }

      // TASK-0028: Google OAuth as secondary auth (tokens start with ya29.)
      if (token.startsWith("ya29.")) {
        const cached = githubTokenCache.get(token);
        if (cached && cached.expires > Date.now()) return;
        try {
          const gRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (gRes.ok) {
            const gUser = (await gRes.json()) as { email: string; name?: string; picture?: string };
            githubTokenCache.set(token, {
              user: gUser.name ?? gUser.email,
              login: gUser.email,
              expires: Date.now() + 300_000,
            });
            return;
          }
        } catch {
          /* fall through */
        }
      }

      reply.status(401).send({ error: "Unauthorized" });
    });

    // KCP-0102: Liveness (no auth) — process is alive
    this.server.get("/live", async () => ({ status: "ok" as const, pid: process.pid }));

    // KCP-0102: Readiness (no auth) — server can accept traffic
    this.server.get("/ready", async () => {
      const degraded = this.sessions < 0; // future: check deps
      return { status: degraded ? ("degraded" as const) : ("ok" as const), uptime: Date.now() - this.startedAt };
    });

    // Health check (no auth) — backwards compatible
    this.server.get("/health", async () => ({
      status: "ok" as const,
      uptime: Date.now() - this.startedAt,
      sessions: this.sessions,
      version: "0.0.1",
    }));

    // KCP-0104: Cached status (auth required) with stale marker
    this.server.get("/status", async (): Promise<GatewayStatus & { stale?: boolean; cacheAge?: number }> => {
      const now = Date.now();
      const cached = this.statusCache;
      const age = cached ? now - cached.fetchedAt : Number.POSITIVE_INFINITY;
      if (cached && age < this.STATUS_CACHE_TTL) {
        return { ...cached.data, stale: false, cacheAge: age };
      }
      const data: GatewayStatus = {
        status: "ok",
        uptime: now - this.startedAt,
        sessions: this.sessions,
        tokenPrefix: this.config.token.slice(0, 8),
      };
      this.statusCache = { data, fetchedAt: now, validUntil: now + this.STATUS_CACHE_TTL };
      // Mark stale if cache is old but still usable
      if (cached && age < this.STATUS_CACHE_STALE) {
        return { ...cached.data, stale: true, cacheAge: age };
      }
      return { ...data, stale: false, cacheAge: 0 };
    });

    // KCP-0102: Diagnostics (auth required) — runtime identity + memory
    this.server.get("/diagnostics", async (): Promise<GatewayDiagnostics> => {
      let id: RuntimeIdentity;
      try {
        const { getRuntimeIdentity } = await import("@kestrel/core");
        id = getRuntimeIdentity();
      } catch {
        id = {
          machineId: "unknown",
          instanceId: "unknown",
          pid: process.pid,
          host: "unknown",
          startedAt: "",
          nodeVersion: process.version,
          platform: `${process.platform} ${process.arch}`,
          cwd: process.cwd(),
        };
      }
      const mem = process.memoryUsage();
      return {
        status: "ok",
        uptime: Date.now() - this.startedAt,
        sessions: this.sessions,
        pendingConfirmations: [...this.confirmations.values()].filter((c) => !c.resolved).length,
        identity: {
          machineId: id.machineId,
          instanceId: id.instanceId,
          pid: id.pid,
          host: id.host,
          startedAt: id.startedAt,
          nodeVersion: id.nodeVersion,
          platform: id.platform,
        },
        memory: { rss: mem.rss, heapTotal: mem.heapTotal, heapUsed: mem.heapUsed, external: mem.external },
      };
    });

    // Sessions list
    this.server.get("/sessions", async () => {
      const list: TrackedSession[] = [];
      for (const s of this.sessionMap.values()) list.push(s);
      return { sessions: list, count: list.length };
    });

    // KCP-0204: Audit query (auth required)
    this.server.get("/audit", async (request) => {
      const q = request.query as Record<string, string>;
      try {
        const { KestrelDatabase, AuditRepo } = await import("@kestrel/storage");
        const db = await KestrelDatabase.create({ memory: false });
        try {
          const repo = new AuditRepo(db.db);
          const rows = repo.query({
            sessionId: q.sessionId,
            event: q.event,
            limit: q.limit ? Number.parseInt(q.limit, 10) : 100,
            offset: q.offset ? Number.parseInt(q.offset, 10) : undefined,
            since: q.since,
            until: q.until,
          });
          return { audit: rows, count: rows.length };
        } finally {
          db.close();
        }
      } catch (err) {
        return { error: (err as Error).message, audit: [] };
      }
    });

    // KCP-0204: Audit replay for a session (auth required)
    this.server.get("/audit/:sessionId", async (request) => {
      const params = request.params as { sessionId: string };
      try {
        const { KestrelDatabase, AuditRepo } = await import("@kestrel/storage");
        const db = await KestrelDatabase.create({ memory: false });
        try {
          const repo = new AuditRepo(db.db);
          const rows = repo.replay(params.sessionId);
          return { sessionId: params.sessionId, events: rows, count: rows.length };
        } finally {
          db.close();
        }
      } catch (err) {
        return { error: (err as Error).message, events: [] };
      }
    });

    // KCP-0505: Queue inspection endpoints (auth required)
    this.server.get("/queue/:table", async (request) => {
      const params = request.params as { table: string };
      const q = request.query as Record<string, string>;
      if (!["channel_inbox", "channel_outbox", "channel_dead_letter"].includes(params.table)) {
        return { error: `Unknown table: ${params.table}. Use channel_inbox, channel_outbox, or channel_dead_letter.` };
      }
      try {
        const { KestrelDatabase } = await import("@kestrel/storage");
        const db = await KestrelDatabase.create({ memory: false });
        try {
          const limit = q.limit ? Number.parseInt(q.limit, 10) : 20;
          const status = q.status ?? "";
          let sql = `SELECT * FROM ${params.table}`;
          if (status) sql += " WHERE status=?";
          sql += " ORDER BY created_at DESC LIMIT ?";
          const rows = status ? db.db.exec(sql, [status, limit]) : db.db.exec(sql, [limit]);
          return {
            table: params.table,
            rows: rows.length > 0 ? rows[0]!.values : [],
            count: rows.length > 0 ? rows[0]!.values.length : 0,
          };
        } finally {
          db.close();
        }
      } catch (err) {
        return { error: (err as Error).message };
      }
    });

    // Pending confirmations
    this.server.get("/confirm/pending", async () => {
      const list: PendingConfirmation[] = [];
      for (const c of this.confirmations.values()) {
        if (!c.resolved) list.push(c);
      }
      return { confirmations: list, count: list.length };
    });

    // Create a pending confirmation
    this.server.post(
      "/confirm",
      async (
        request: FastifyRequest<{
          Body: {
            tool: string;
            args?: Record<string, unknown>;
            risk: string;
            trustLevel: string;
            reason: string;
            target?: string;
          };
        }>,
        reply,
      ) => {
        const b = request.body;
        if (!b?.tool) {
          return reply.status(400).send({ error: "tool required" });
        }
        // KCP-0506: Idempotency — dedup by tool+target within 30s
        const now = Date.now();
        for (const c of this.confirmations.values()) {
          if (!c.resolved && c.tool === b.tool && c.target === b.target && now - c.createdAt < 30_000) {
            return { id: c.id, status: "duplicate", message: "Duplicate confirmation within 30s — existing pending" };
          }
        }
        const id = randomUUID();
        const c: PendingConfirmation = {
          id,
          tool: b.tool,
          args: b.args ?? {},
          risk: b.risk ?? "unknown",
          trustLevel: b.trustLevel ?? "unknown",
          reason: b.reason ?? "",
          target: b.target,
          createdAt: Date.now(),
          resolved: false,
        };
        this.confirmations.set(id, c);
        // Cleanup old confirmations (>5min)
        for (const [_cid, existing] of this.confirmations) {
          if (!existing.resolved && Date.now() - existing.createdAt > 300_000) {
            existing.resolved = true;
            existing.decision = "deny";
          }
        }
        return { id, status: "pending" };
      },
    );

    // Resolve a pending confirmation
    this.server.post("/confirm/:id", async (request, reply) => {
      const params = request.params as { id: string };
      const body = request.body as { action?: string };
      const c = this.confirmations.get(params.id);
      if (!c) return reply.status(404).send({ error: "not found" });
      if (c.resolved) return reply.status(409).send({ error: "already resolved", decision: c.decision });
      const action = body?.action;
      if (action !== "approve" && action !== "deny") {
        return reply.status(400).send({ error: "action must be approve or deny" });
      }
      c.resolved = true;
      c.decision = action;
      c.resolvedAt = Date.now();
      return { id: c.id, decision: c.decision };
    });

    // Get a specific confirmation status
    this.server.get("/confirm/:id", async (request, reply) => {
      const params = request.params as { id: string };
      const c = this.confirmations.get(params.id);
      if (!c) return reply.status(404).send({ error: "not found" });
      return c;
    });

    // JSON-RPC endpoint
    this.server.post("/rpc", async (request: FastifyRequest<{ Body: RpcRequest }>) => {
      const body = request.body as RpcRequest;
      return this.handleRpc(body);
    });

    // Channel webhook — multi-channel message routing (Feishu/Telegram/WebChat)
    this.server.post("/webhook/:channel", async (request, reply) => {
      const params = request.params as { channel: string };
      const body = request.body as Record<string, unknown>;
      const channel = params.channel;

      const validChannels = ["feishu", "telegram", "webchat"];
      if (!validChannels.includes(channel)) {
        return reply.status(400).send({ error: `Unknown channel: ${channel}. Supported: ${validChannels.join(", ")}` });
      }

      // Lazy-load channel adapter
      let adapter: { normalizeMessage(raw: unknown): Promise<{ text: string; peerId: string }>; name: string };
      try {
        const { FeishuAdapter, TelegramAdapter, WebChatAdapter } = await import("@kestrel/channels");
        if (channel === "feishu") adapter = new FeishuAdapter();
        else if (channel === "telegram") adapter = new TelegramAdapter();
        else adapter = new WebChatAdapter();
      } catch {
        return reply.status(500).send({ error: "Channels package not available" });
      }

      try {
        const msg = await adapter.normalizeMessage(body);
        let response = "";
        const send = (event: Record<string, unknown>) => {
          if (event.type === "text_delta") response += (event.text as string) ?? "";
        };
        await this.config.onChatStream(msg.text, send);
        return { channel, peerId: msg.peerId, response: response.trim() || "(no response)" };
      } catch (err) {
        return { channel, error: (err as Error).message };
      }
    });

    // SSE status stream (connection status + keepalive)
    this.server.get("/sse", async (request, reply) => {
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const send = (data: unknown) => {
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      const sessionId = randomUUID();
      this.sessionMap.set(sessionId, { id: sessionId, type: "sse", connectedAt: Date.now() });
      this.sessions++;
      send({ type: "connected", sessionId });

      const keepAlive = setInterval(() => {
        reply.raw.write(": keepalive\n\n");
      }, 15_000);

      request.raw.on("close", () => {
        this.sessions--;
        this.sessionMap.delete(sessionId);
        clearInterval(keepAlive);
      });
    });

    // SSE chat streaming endpoint (POST)
    this.server.post("/sse/chat", async (request: FastifyRequest<{ Body: { prompt?: string } }>, reply) => {
      const body = request.body as { prompt?: string };
      const prompt = body?.prompt;
      if (!prompt || typeof prompt !== "string") {
        reply.status(400).send({ error: "prompt required" });
        return;
      }

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const send = (event: Record<string, unknown>) => {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      const sessionId = randomUUID();
      this.sessionMap.set(sessionId, { id: sessionId, type: "sse", connectedAt: Date.now() });
      this.sessions++;
      send({ type: "connected", sessionId });

      try {
        await this.config.onChatStream(prompt, send);
        send({ type: "agent_end" });
      } catch (err) {
        send({ type: "error", message: (err as Error).message });
      } finally {
        this.sessions--;
        this.sessionMap.delete(sessionId);
        reply.raw.end();
      }
    });

    // WebSocket endpoint
    const serverToken = this.config.token;
    const onChatStream = this.config.onChatStream;

    this.server.register(async (fastify) => {
      fastify.get("/ws", { websocket: true }, (socket, req) => {
        // TASK-1092: Allow token via ?token= query param on localhost connections
        const remoteIp = req.socket.remoteAddress ?? "";
        const isLocalhost = remoteIp === "127.0.0.1" || remoteIp === "::1" || remoteIp === "::ffff:127.0.0.1";
        // Parse query string from raw URL (req is IncomingMessage, no .query)
        let queryToken = "";
        if (isLocalhost && req.url) {
          const qIdx = req.url.indexOf("?");
          if (qIdx !== -1) {
            const qs = req.url.slice(qIdx + 1);
            const m = qs.match(/(?:^|&)token=([^&]*)/);
            if (m) queryToken = decodeURIComponent(m[1]!);
          }
        }
        const headerAuth = req.headers.authorization;
        const headerToken = headerAuth?.startsWith("Bearer ") ? headerAuth.slice(7) : "";
        const effectiveToken = headerToken || queryToken;
        if (effectiveToken !== serverToken) {
          socket.close(4001, "Unauthorized");
          return;
        }

        const sessionId = randomUUID();
        this.sessionMap.set(sessionId, { id: sessionId, type: "ws", connectedAt: Date.now() });
        this.sessions++;

        const send = (event: Record<string, unknown>) => {
          socket.send(JSON.stringify(event));
        };

        socket.on("message", (data: Buffer) => {
          let msg: { id?: string; method?: string; params?: { prompt?: string } };
          try {
            msg = JSON.parse(data.toString());
          } catch {
            send({ type: "error", message: "Invalid JSON" });
            return;
          }

          if (msg.method === "chat") {
            const prompt = msg.params?.prompt;
            if (!prompt || typeof prompt !== "string") {
              send({ type: "error", id: msg.id, message: "prompt required" });
              return;
            }
            send({ type: "ack", id: msg.id });

            onChatStream(prompt, send)
              .then(() => send({ type: "agent_end", id: msg.id }))
              .catch((err: Error) => send({ type: "error", id: msg.id, message: err.message }));
          } else {
            send({ type: "ack", id: msg.id });
          }
        });

        socket.on("close", () => {
          this.sessions--;
          this.sessionMap.delete(sessionId);
        });

        send({ type: "connected", sessionId });
      });
    });
  }

  async start(): Promise<void> {
    await this.setup();
    this.startedAt = Date.now();

    await this.server.listen({
      host: this.config.host,
      port: this.config.port,
    });

    console.log(`[API Server mode] Kestrel Gateway listening on http://${this.config.host}:${this.config.port}`);
    if (this.config.logLevel !== "silent") {
      console.log(`Token: ${this.config.token.slice(0, 8)}...`);
    }
  }

  async stop(): Promise<void> {
    await this.server.close();
  }

  async restart(): Promise<void> {
    await this.stop();
    await new Promise((r) => setTimeout(r, 300));
    // Fastify close() terminates the internal server — must recreate
    const logLevel = this.config.logLevel;
    (this as { server: FastifyInstance }).server = Fastify({
      logger: logLevel === "silent" ? false : logLevel === "info" ? true : { level: logLevel },
    });
    await this.setup();
    this.startedAt = Date.now();
    await this.server.listen({ host: this.config.host, port: this.config.port });
    console.log(`[API Server mode] Kestrel Gateway listening on http://${this.config.host}:${this.config.port}`);
    if (this.config.logLevel !== "silent") {
      console.log(`Token: ${this.config.token.slice(0, 8)}...`);
    }
  }

  private async handleRpc(request: RpcRequest): Promise<RpcResponse> {
    switch (request.method) {
      case "ping":
        return { id: request.id, result: "pong" };
      case "status":
        return {
          id: request.id,
          result: {
            uptime: Date.now() - this.startedAt,
            sessions: this.sessions,
          },
        };
      case "chat": {
        const params = request.params as { prompt?: string } | undefined;
        const prompt = params?.prompt;
        if (!prompt || typeof prompt !== "string") {
          return { id: request.id, error: { code: -32602, message: "Invalid params: prompt required" } };
        }
        try {
          const response = await this.config.onChat(prompt);
          return { id: request.id, result: { response } };
        } catch (err) {
          return { id: request.id, error: { code: -32603, message: (err as Error).message } };
        }
      }
      default:
        return { id: request.id, error: { code: -32601, message: `Unknown method: ${request.method}` } };
    }
  }
}

// ============================================================================
// JSON-RPC Types
// ============================================================================

export interface RpcRequest {
  id?: string;
  method: string;
  params?: unknown;
}

export interface RpcResponse {
  id?: string;
  result?: unknown;
  error?: { code: number; message: string };
}
