/**
 * @kestrel/core - Conversation Engine + Plan Mode + AskUserQuestion
 */

export {
  type AskUserQuestion,
  type QuestionOption,
  type UserAnswer,
  validateAnswer,
  validateQuestion,
} from "./ask-question.js";
export { type KestrelConfig, loadConfig } from "./config.js";
export { type RuntimeIdentity, getRuntimeIdentity } from "./identity.js";
export { redact, containsSecrets, redactShallow } from "./redact.js";
export { type ExecutorContext, type ExecutorContextConfig, createExecutorContext } from "./executor-context.js";
export { type ToolExecutorContext, type ToolResult, createSharedToolExecutor } from "./tool-executor.js";
export {
  ConversationLoop,
  type ConversationLoopConfig,
  type ConversationLoopEvent,
  type ConversationLoopEventListener,
} from "./conversation-loop.js";
export {
  type KestrelClientConfig,
  type KestrelClientEvent,
  type KestrelClientMessage,
  streamChat,
} from "./kestrel-client.js";
export { PlanMode, type PlanModeResult, type PlanModeState } from "./plan-mode.js";
export {
  type SubAgentConfig,
  type SubAgentResult,
  SubAgentScheduler,
  type SubAgentSummary,
  type SubAgentType,
} from "./sub-agent.js";

/** @deprecated Use ConversationLoopEvent instead */
export type PiAdapterEvent = import("./conversation-loop.js").ConversationLoopEvent;
/** @deprecated Use ConversationLoopEventListener instead */
export type PiAdapterEventListener = import("./conversation-loop.js").ConversationLoopEventListener;

export {
  type CronEventHandler,
  type CronJob,
  CronScheduler,
  parseCronExpression,
} from "./cron.js";

export const KESTREL_CORE_VERSION = "0.0.1";
