/**
 * Slack channel adapter.
 *
 * Verifies Slack signing secret for webhook events.
 * Messages from private channels get "trusted", public channels get "limited".
 */

import { createHmac } from "node:crypto";
import type { AgentResponse, ChannelAdapter, ChannelTarget, NormalizedMessage } from "./types.js";

export interface SlackConfig {
  signingSecret?: string;
  botToken?: string;
  allowlist?: string[];
}

export class SlackAdapter implements ChannelAdapter {
  readonly name = "slack" as const;
  private allowlist: Set<string>;
  private allowlistEmpty: boolean;

  constructor(private config: SlackConfig = {}) {
    this.allowlist = new Set(config.allowlist ?? []);
    this.allowlistEmpty = !config.allowlist || config.allowlist.length === 0;
  }

  async verifyIncomingRequest(headers: Record<string, string>, body: unknown): Promise<boolean> {
    if (!this.config.signingSecret) return false;

    const timestamp = headers["x-slack-request-timestamp"];
    const signature = headers["x-slack-signature"];

    if (!timestamp || !signature) return false;

    // Slack's verification: v0=<HMAC-SHA256 of "v0:{ts}:{body}">
    const rawBody = typeof body === "string" ? body : JSON.stringify(body);
    const baseString = `v0:${timestamp}:${rawBody}`;
    const expected = `v0=${createHmac("sha256", this.config.signingSecret).update(baseString).digest("hex")}`;

    // Constant-time comparison
    return (
      signature.length === expected.length &&
      createHmac("sha256", this.config.signingSecret).update(signature).digest("hex") ===
        createHmac("sha256", this.config.signingSecret).update(expected).digest("hex")
    );
  }

  async normalizeMessage(raw: unknown): Promise<NormalizedMessage> {
    if (this.allowlistEmpty) {
      throw new Error("Slack allowlist is empty. All peers are denied by default.");
    }

    const msg = raw as SlackEvent;
    const event = msg?.event;
    const senderId = event?.user ?? "unknown";
    const channelType = event?.channel_type ?? "im"; // im = DM, channel = public
    const isGroup = channelType === "channel";

    if (!this.allowlist.has(senderId)) {
      throw new Error(`Peer ${senderId} not in Slack allowlist`);
    }

    return {
      id: event?.event_ts ?? crypto.randomUUID(),
      channel: "slack",
      peerId: senderId,
      roomId: event?.channel,
      text: event?.text ?? "",
      timestamp: new Date(
        Number(event?.event_ts ? event.event_ts.split(".")[0] : 0) * 1000 || Date.now(),
      ).toISOString(),
      trustLevel: isGroup ? "limited" : "trusted",
    };
  }

  async sendMessage(target: ChannelTarget, response: AgentResponse): Promise<void> {
    if (!this.config.botToken) {
      throw new Error("Slack sendMessage requires botToken configured in SlackConfig");
    }

    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.botToken}`,
      },
      body: JSON.stringify({
        channel: target.peerId,
        text: response.text,
      }),
    });

    if (!res.ok) {
      throw new Error(`Slack sendMessage failed: ${res.status}`);
    }
  }
}

interface SlackEvent {
  event?: {
    type?: string;
    user?: string;
    channel?: string;
    channel_type?: string;
    text?: string;
    event_ts?: string;
  };
}
