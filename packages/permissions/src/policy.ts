/**
 * KCP-0302: Mandatory policy/permission middleware.
 *
 * ToolPolicy wraps any tool executor and enforces ABAC checks
 * before every tool call. All execution paths (CLI, Gateway,
 * channels, cron) must go through this middleware.
 */

import { PermissionEngine } from "./engine.js";
import type { Channel, Decision, PermissionRequest } from "./types.js";

export interface PolicyContext {
  channel: Channel;
  chatType?: "private" | "group";
  peerId?: string;
}

export interface ToolCall {
  tool: "read" | "write" | "edit" | "bash" | "grep" | "find" | string;
  args: Record<string, unknown>;
  target?: string;
}

export interface PolicyResult {
  allowed: boolean;
  decision: Decision;
  reason: string;
}

export class ToolPolicy {
  private engine: PermissionEngine;

  constructor() {
    this.engine = new PermissionEngine();
  }

  /** Evaluate a tool call against ABAC policy. */
  evaluate(call: ToolCall, ctx: PolicyContext): PolicyResult {
    const req: PermissionRequest = {
      subject: "system-task",
      tool: call.tool as PermissionRequest["tool"],
      channel: ctx.channel,
      chatType: ctx.chatType,
      target: call.target ?? (call.args.path as string) ?? (call.args.file as string),
    };
    const result = this.engine.evaluate(req);
    return { allowed: result.decision !== "deny", decision: result.decision, reason: result.reason ?? "" };
  }

  /** Mandatory check — throws if tool is denied. */
  guard(call: ToolCall, ctx: PolicyContext): void {
    const result = this.evaluate(call, ctx);
    if (!result.allowed) {
      throw new Error(`Tool "${call.tool}" denied by policy: ${result.reason}`);
    }
  }
}
