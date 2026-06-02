/**
 * Feishu (Lark) channel adapter.
 *
 * Signature verification follows the official Lark/Feishu event callback spec:
 *   SHA256(timestamp + nonce + encrypt_key + rawBody) → hex
 *
 * For message card callbacks using Verification Token:
 *   SHA256(timestamp + nonce + verificationToken + rawBody) → hex
 *
 * Refs:
 * - https://open.feishu.cn/document/event-subscription-guide/callback-subscription
 * - https://open.larksuite.com/document/common-capabilities/message-card
 */

import { createHash } from "node:crypto";
import type { AgentResponse, ChannelAdapter, ChannelTarget, NormalizedMessage } from "./types.js";

export interface FeishuConfig {
  /** Feishu event subscription encrypt key. REQUIRED for signature verification. */
  encryptKey?: string;
  /** Peer allowlist (open_id). REQUIRED — empty list denies all peers. */
  allowlist?: string[];
  /** Feishu app ID (for sendMessage tenant token). */
  appId?: string;
  /** Feishu app secret (for sendMessage tenant token). */
  appSecret?: string;
}

export class FeishuAdapter implements ChannelAdapter {
  readonly name = "feishu" as const;
  private allowlist: Set<string>;
  private allowlistEmpty: boolean;

  constructor(private config: FeishuConfig = {}) {
    this.allowlist = new Set(config.allowlist ?? []);
    this.allowlistEmpty = !config.allowlist || config.allowlist.length === 0;
  }

  async verifyIncomingRequest(headers: Record<string, string>, body: unknown): Promise<boolean> {
    const timestamp = headers["x-lark-request-timestamp"] ?? headers["x-feishu-request-timestamp"];
    const nonce = headers["x-lark-request-nonce"] ?? headers["x-feishu-request-nonce"];
    const signature = headers["x-lark-signature"] ?? headers["x-feishu-signature"];

    if (!timestamp || !nonce || !signature) return false;

    const rawBody = typeof body === "string" ? body : JSON.stringify(body);
    const key = this.config.encryptKey;
    if (!key) return false;

    // Official event callback algorithm: SHA256(timestamp + nonce + encryptKey + rawBody) → hex
    const signStr = `${timestamp}${nonce}${key}${rawBody}`;
    const expected = createHash("sha256").update(signStr, "utf-8").digest("hex");

    return signature === expected;
  }

  async normalizeMessage(raw: unknown): Promise<NormalizedMessage> {
    // AUDIT-009-002: empty allowlist → deny all
    if (this.allowlistEmpty) {
      throw new Error("Feishu allowlist is empty. All peers are denied by default.");
    }

    const event = raw as FeishuEvent;
    const senderId = event?.event?.sender?.sender_id?.open_id ?? "unknown";
    const chatType = event?.event?.message?.chat_type ?? "private";
    const chatId = event?.event?.message?.chat_id;

    if (!this.allowlist.has(senderId)) {
      throw new Error(`Peer ${senderId} not in Feishu allowlist`);
    }

    let text = "";
    const content = event?.event?.message?.content;
    if (typeof content === "string") {
      try {
        const parsed = JSON.parse(content);
        text = parsed.text ?? "";
      } catch {
        text = content;
      }
    }

    return {
      id: event?.event?.message?.message_id ?? crypto.randomUUID(),
      channel: "feishu",
      peerId: senderId,
      roomId: chatId,
      text,
      timestamp: new Date(Number(event?.event?.message?.create_time ?? 0) * 1000).toISOString(),
      trustLevel: chatType === "group" ? "limited" : "trusted",
    };
  }

  private tenantToken: string | null = null;
  private tokenExpiry = 0;

  private async getTenantToken(): Promise<string> {
    if (this.tenantToken && Date.now() < this.tokenExpiry) {
      return this.tenantToken;
    }
    if (!this.config.appId || !this.config.appSecret) {
      throw new Error("Feishu sendMessage requires appId and appSecret configured in FeishuConfig");
    }

    const res = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: this.config.appId, app_secret: this.config.appSecret }),
    });

    if (!res.ok) {
      throw new Error(`Feishu tenant token request failed: ${res.status}`);
    }

    const data = (await res.json()) as { tenant_access_token: string; expire: number };
    this.tenantToken = data.tenant_access_token;
    this.tokenExpiry = Date.now() + (data.expire - 300) * 1000; // refresh 5 min before expiry
    return this.tenantToken!;
  }

  async sendMessage(target: ChannelTarget, response: AgentResponse): Promise<void> {
    const token = await this.getTenantToken();

    const content = JSON.stringify({ text: response.text });
    const body = JSON.stringify({
      receive_id: target.peerId,
      msg_type: "text",
      content,
    });

    const res = await fetch("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body,
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Feishu sendMessage failed: ${res.status} ${errBody.slice(0, 200)}`);
    }
  }
}

interface FeishuEvent {
  event?: {
    sender?: { sender_id?: { open_id?: string } };
    message?: {
      message_id?: string;
      create_time?: string;
      chat_id?: string;
      chat_type?: string;
      content?: string;
    };
  };
}
