/**
 * Permission engine types.
 *
 * ABAC-style: Subject × TrustLevel × Channel × ChatType × Tool × Target → Decision
 */

export type Subject = "local-user" | "feishu-user" | "web-user" | "system-task";
export type Channel = "cli" | "feishu" | "webchat" | "telegram" | "slack" | "cron";
export type ChatType = "private" | "group" | undefined;
export type Tool =
  | "read"
  | "write"
  | "edit"
  | "bash"
  | "browser"
  | "web"
  | "lsp"
  | "memory"
  | "task"
  | "grep"
  | "find"
  | "lsp_diagnostics"
  | "memory_search"
  | "task_create"
  | "agent"
  | "pr_create"
  | "skill_create"
  | "git_status"
  | "git_diff"
  | "git_log"
  | "git_blame"
  | "git_commit"
  | "channel_send";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type Decision = "allow" | "ask" | "deny";
export type TrustLevel = "local" | "trusted" | "limited" | "unknown";

/**
 * Compute effective trust level from channel and chat type.
 *
 * - CLI and cron are always "local" (full trust).
 * - Feishu group gets "limited" trust; Feishu private gets "trusted".
 * - WebChat, Slack, Telegram default to "trusted" (can be overridden by caller).
 * - Any channel with an explicit trustLevel override takes precedence.
 */
export function getTrustLevel(channel: Channel, chatType?: ChatType): TrustLevel {
  switch (channel) {
    case "cli":
    case "cron":
      return "local";
    case "feishu":
      return chatType === "group" ? "limited" : "trusted";
    case "webchat":
    case "slack":
    case "telegram":
      return "trusted";
    default:
      return "unknown";
  }
}

export function getToolRisk(tool: Tool): RiskLevel {
  switch (tool) {
    case "read":
    case "lsp":
    case "lsp_diagnostics":
    case "grep":
    case "find":
    case "git_status":
    case "git_diff":
    case "git_log":
    case "git_blame":
      return "low";
    case "web":
    case "task":
    case "task_create":
    case "memory":
    case "memory_search":
      return "medium";
    case "write":
    case "edit":
    case "bash":
    case "browser":
    case "agent":
    case "git_commit":
    case "pr_create":
      return "high";
    case "channel_send":
      return "medium";
    default:
      return "critical";
  }
}

export interface PermissionRequest {
  subject: Subject;
  channel: Channel;
  tool: Tool;
  target?: string;
  /** Explicit trust level override. When set, bypasses auto-detection. */
  trustLevel?: TrustLevel;
  /** Feishu chat type for private/group distinction. */
  chatType?: ChatType;
  /** True when the client hasn't been authenticated or paired. */
  isUnknownPeer?: boolean;
  sessionId?: string;
  workspaceId?: string;
}

export interface PermissionResult {
  decision: Decision;
  risk: RiskLevel;
  reason: string;
  subject: Subject;
  channel: Channel;
  tool: Tool;
  target?: string;
  trustLevel: TrustLevel;
}

/** Callback for audit event emission. */
export type AuditSink = (event: {
  event: string;
  sessionId?: string;
  workspaceId?: string;
  tool?: string;
  channel?: string;
  subject?: string;
  risk?: string;
  decision?: string;
  reason?: string;
}) => void;
