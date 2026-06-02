/**
 * @kestrel/channels - Channel adapters and message normalization.
 */

export { FeishuAdapter, type FeishuConfig } from "./feishu.js";
export { FeishuWSClient, type FeishuWSConfig, type FeishuWSEvent } from "./feishu-ws.js";
export { SlackAdapter, type SlackConfig } from "./slack.js";
export { TelegramAdapter, type TelegramConfig } from "./telegram.js";
export type {
  AgentResponse,
  ChannelAdapter,
  ChannelAdapterConfig,
  ChannelName,
  ChannelTarget,
  NormalizedMessage,
} from "./types.js";
export { WebChatAdapter } from "./webchat.js";

export const KESTREL_CHANNELS_VERSION = "0.0.1";
