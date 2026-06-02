/**
 * KCP-0304: Shared tool executor context.
 *
 * Provides a common execution context that Gateway, channels,
 * and cron can use to execute tools with consistent identity,
 * audit logging, and policy enforcement.
 */

import { getRuntimeIdentity } from "./identity.js";

export interface ExecutorContextConfig {
  /** Which component is executing (gateway, channel, cron) */
  source: "gateway" | "channel" | "cron";
  /** Channel name for audit trail */
  channel?: string;
  /** Session ID for correlation */
  sessionId?: string;
  /** Peer/chat identifier */
  peerId?: string;
}

export interface ExecutorContext {
  readonly source: string;
  readonly channel: string;
  readonly sessionId: string;
  readonly peerId: string;
  readonly identity: ReturnType<typeof getRuntimeIdentity>;
  readonly createdAt: string;
}

export function createExecutorContext(config: ExecutorContextConfig): ExecutorContext {
  return {
    source: config.source,
    channel: config.channel ?? config.source,
    sessionId: config.sessionId ?? "",
    peerId: config.peerId ?? "",
    identity: getRuntimeIdentity(),
    createdAt: new Date().toISOString(),
  };
}
