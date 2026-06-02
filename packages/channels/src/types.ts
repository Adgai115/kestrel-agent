/**
 * Channel adapter types.
 *
 * Each channel (CLI, Feishu, WebChat, Telegram, Slack) implements
 * the ChannelAdapter interface for message normalization and sending.
 */

import type { TrustLevel } from "@kestrel/permissions";

export type ChannelName = "cli" | "feishu" | "webchat" | "telegram" | "slack";

export interface NormalizedMessage {
  id: string;
  channel: ChannelName;
  peerId: string;
  roomId?: string;
  text: string;
  attachments?: Array<{ type: string; data: unknown }>;
  timestamp: string;
  trustLevel: TrustLevel;
}

export interface ChannelTarget {
  channel: ChannelName;
  peerId: string;
  roomId?: string;
}

export interface AgentResponse {
  text: string;
  attachments?: Array<unknown>;
}

export interface ChannelAdapter {
  readonly name: ChannelName;

  /** Verify an incoming request (signature, token, etc). */
  verifyIncomingRequest(headers: Record<string, string>, body: unknown): Promise<boolean>;

  /** Normalize an incoming message into the standard format. */
  normalizeMessage(raw: unknown): Promise<NormalizedMessage>;

  /** Send a response back through the channel. */
  sendMessage(target: ChannelTarget, message: AgentResponse): Promise<void>;
}

export interface ChannelAdapterConfig {
  webchat?: { enabled?: boolean };
  feishu?: {
    enabled?: boolean;
    encryptKey?: string;
    allowlist?: string[];
  };
}
