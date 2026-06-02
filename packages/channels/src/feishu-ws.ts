/**
 * TASK-1136: Feishu WebSocket long-connection event subscription.
 *
 * Uses Feishu's Long Connection API (WebSocket) to receive events
 * without requiring a public-facing webhook URL. Ideal for self-hosted
 * and local development deployments behind NAT/firewall.
 *
 * Reference: https://open.feishu.cn/document/server-docs/event-subscription-guide/websocket-event-subscription
 */

import { randomUUID } from "node:crypto";

export interface FeishuWSConfig {
  appId: string;
  appSecret: string;
  /** Callback for each received event. Return true to ACK. */
  onEvent?: (event: FeishuWSEvent) => void;
  /** Reconnect delay in ms (default 3000). */
  reconnectDelay?: number;
}

export interface FeishuWSEvent {
  type: string;
  chatId?: string;
  peerId?: string;
  text?: string;
  timestamp?: string;
  raw: unknown;
}

export class FeishuWSClient {
  private ws: globalThis.WebSocket | null = null;
  private tenantToken: string | null = null;
  private tokenExpiry = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private retryCount = 0;
  private config: Required<FeishuWSConfig>;

  constructor(config: FeishuWSConfig) {
    this.config = {
      appId: config.appId,
      appSecret: config.appSecret,
      onEvent: config.onEvent ?? (() => {}),
      reconnectDelay: config.reconnectDelay ?? 3000,
    };
  }

  private async getTenantToken(): Promise<string> {
    if (this.tenantToken && Date.now() < this.tokenExpiry) {
      return this.tenantToken;
    }
    const res = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: this.config.appId, app_secret: this.config.appSecret }),
    });
    const json = (await res.json()) as { code: number; tenant_access_token: string; expire: number };
    if (json.code !== 0) throw new Error(`Feishu auth failed: code=${json.code}`);
    this.tenantToken = json.tenant_access_token;
    this.tokenExpiry = Date.now() + (json.expire - 300) * 1000; // 5min buffer
    return this.tenantToken;
  }

  async start(): Promise<void> {
    this.running = true;
    await this.connect();
  }

  private async connect(): Promise<void> {
    if (!this.running) return;
    try {
      const token = await this.getTenantToken();
      // Get WebSocket connection endpoint
      const subRes = await fetch("https://open.feishu.cn/open-apis/event/v1/ws/subscription", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      const subJson = (await subRes.json()) as { code: number; data?: { ws_url?: string }; msg?: string };
      if (subJson.code !== 0) {
        throw new Error(`WS subscription failed: ${subJson.msg ?? `code=${subJson.code}`}`);
      }
      const wsUrl = subJson.data?.ws_url;
      if (!wsUrl) throw new Error("No WS URL returned from subscription API");

      this.ws = new WebSocket(wsUrl);

      this.ws.addEventListener("open", () => {
        this.retryCount = 0; // reset backoff on successful connection
        console.log("[FeishuWS] Connected to event stream");
      });

      this.ws.addEventListener("message", (ev: MessageEvent) => {
        try {
          const msg = JSON.parse(ev.data as string);
          this.handleMessage(msg as Record<string, unknown>);
        } catch {
          // ignore parse errors
        }
      });

      this.ws.addEventListener("close", (ev: Event) => {
        console.log("[FeishuWS] Connection closed");
        void ev;
        this.scheduleReconnect();
      });

      this.ws.addEventListener("error", () => {
        // 'close' event follows, reconnect handled there
      });
    } catch (err) {
      console.log(`[FeishuWS] Connect failed: ${(err as Error).message}`);
      this.scheduleReconnect();
    }
  }

  private handleMessage(msg: Record<string, unknown>): void {
    // Feishu WS sends events with a type field
    const eventType = String(msg.type ?? "");
    const event = msg.event as Record<string, unknown> | undefined;
    const message = msg.message as Record<string, unknown> | undefined;
    const header = msg.header as Record<string, unknown> | undefined;
    const eventId = String(header?.event_id ?? randomUUID());

    if (eventType === "ping") {
      // Send pong
      this.ws?.send(JSON.stringify({ type: "pong" }));
      return;
    }

    // ACK all events with an event_id (not just messages)
    const ack = () => {
      if (eventId && this.ws) {
        this.ws.send(JSON.stringify({ type: "ack", event_id: eventId }));
      }
    };

    if (eventType === "message" || event?.type === "im.message.receive_v1") {
      const msgEvent = (event?.message ?? message ?? msg) as Record<string, unknown>;
      const content = String(msgEvent.content ?? "");
      let text = content;
      try {
        const parsed = JSON.parse(content) as { text?: string };
        text = parsed.text ?? content;
      } catch {
        // not JSON, use raw
      }

      const sender = (event?.sender ?? {}) as Record<string, unknown>;
      const senderId = (sender.sender_id ?? {}) as Record<string, unknown>;
      const wsEvent: FeishuWSEvent = {
        type: "message",
        chatId: String(msgEvent.chat_id ?? ""),
        peerId: String(senderId.open_id ?? msgEvent.open_id ?? msgEvent.user_id ?? ""),
        text,
        timestamp: new Date(Number(header?.create_time ?? Date.now()) * 1000).toISOString(),
        raw: msg,
      };

      this.config.onEvent(wsEvent);
      ack();
      return;
    }

    // Generic event — pass through, still ACK
    this.config.onEvent({
      type: eventType || "unknown",
      timestamp: new Date().toISOString(),
      raw: msg,
    });
    ack();
  }

  private scheduleReconnect(): void {
    if (!this.running) return;
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    this.retryCount++;
    // Exponential backoff: 3s, 6s, 12s, 24s, 48s, 60s (max)
    const base = this.config.reconnectDelay;
    const delay = Math.min(base * 2 ** (this.retryCount - 1), 60_000);
    console.log(`[FeishuWS] Reconnecting in ${Math.round(delay / 1000)}s (attempt ${this.retryCount})...`);
    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, delay);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
