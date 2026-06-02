/**
 * Telegram channel adapter.
 *
 * Verifies bot token from webhook requests.
 * Messages from private chats get "trusted", group chats get "limited".
 */

import { createHash } from "node:crypto";
import type { AgentResponse, ChannelAdapter, ChannelTarget, NormalizedMessage } from "./types.js";

export interface TelegramConfig {
  botToken?: string;
  allowlist?: string[];
}

export class TelegramAdapter implements ChannelAdapter {
  readonly name = "telegram" as const;
  private allowlist: Set<string>;
  private allowlistEmpty: boolean;

  constructor(private config: TelegramConfig = {}) {
    this.allowlist = new Set(config.allowlist ?? []);
    this.allowlistEmpty = !config.allowlist || config.allowlist.length === 0;
  }

  async verifyIncomingRequest(headers: Record<string, string>, _body: unknown): Promise<boolean> {
    // Telegram doesn't sign webhooks; we verify via bot token in the URL path
    // or check the X-Telegram-Bot-Api-Secret-Token header (Telegram's recommended approach)
    const secret = headers["x-telegram-bot-api-secret-token"];
    if (secret && this.config.botToken) {
      // SHA256 comparison of the secret token
      const expected = createHash("sha256").update(this.config.botToken).digest("hex");
      return secret === expected;
    }
    return !!secret; // If no bot token configured, accept any valid secret header
  }

  async normalizeMessage(raw: unknown): Promise<NormalizedMessage> {
    if (this.allowlistEmpty) {
      throw new Error("Telegram allowlist is empty. All peers are denied by default.");
    }

    const msg = raw as TelegramMessage;
    const senderId = msg?.message?.from?.id?.toString() ?? "unknown";
    // group vs private: chat.id < 0 indicates group/supergroup
    const isGroup = (msg?.message?.chat?.id ?? 0) < 0;
    const chatId = msg?.message?.chat?.id?.toString();

    if (!this.allowlist.has(senderId)) {
      throw new Error(`Peer ${senderId} not in Telegram allowlist`);
    }

    return {
      id: msg?.update_id?.toString() ?? crypto.randomUUID(),
      channel: "telegram",
      peerId: senderId,
      roomId: chatId,
      text: msg?.message?.text ?? "",
      timestamp: new Date(msg?.message?.date ? msg.message.date * 1000 : Date.now()).toISOString(),
      trustLevel: isGroup ? "limited" : "trusted",
    };
  }

  async sendMessage(target: ChannelTarget, response: AgentResponse): Promise<void> {
    if (!this.config.botToken) {
      throw new Error("Telegram sendMessage requires botToken configured in TelegramConfig");
    }

    const url = `https://api.telegram.org/bot${this.config.botToken}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: target.peerId,
        text: response.text,
      }),
    });

    if (!res.ok) {
      throw new Error(`Telegram sendMessage failed: ${res.status}`);
    }
  }
}

interface TelegramMessage {
  update_id?: number;
  message?: {
    message_id?: number;
    from?: { id?: number; first_name?: string };
    chat?: { id?: number; type?: string };
    date?: number;
    text?: string;
  };
}
