/**
 * WebChat channel adapter.
 *
 * Returns "trusted" trust level. Local trust escalation is handled
 * by the Gateway/permission engine based on verified source address,
 * not by an unvalidated boolean on the adapter.
 */

import type { AgentResponse, ChannelAdapter, ChannelTarget, NormalizedMessage } from "./types.js";

export class WebChatAdapter implements ChannelAdapter {
  readonly name = "webchat" as const;

  async verifyIncomingRequest(_headers: Record<string, string>, _body: unknown): Promise<boolean> {
    return true;
  }

  async normalizeMessage(raw: unknown): Promise<NormalizedMessage> {
    const msg = raw as { id?: string; text?: string; peerId?: string };
    return {
      id: msg.id ?? crypto.randomUUID(),
      channel: "webchat",
      peerId: msg.peerId ?? "webchat-user",
      text: msg.text ?? "",
      timestamp: new Date().toISOString(),
      trustLevel: "trusted",
    };
  }

  async sendMessage(_target: ChannelTarget, _response: AgentResponse): Promise<void> {
    // WebChat responses go through the Gateway SSE/WS connection.
  }
}
