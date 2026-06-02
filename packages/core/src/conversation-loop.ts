/**
 * ConversationLoop — replaces PiAdapter with direct API conversation management.
 *
 * Manages message array, tool execution loop, and emits the same event
 * interface as the old PiAdapter for backward compatibility.
 */

import { randomUUID } from "node:crypto";
import {
  type KestrelClientConfig,
  type KestrelClientMessage,
  type OpenAIToolDef,
  type ToolCallDelta,
  streamChat,
} from "./kestrel-client.js";

// ============================================================================
// Config
// ============================================================================

export interface ConversationLoopConfig {
  apiKey: string;
  model?: string;
  systemPrompt?: string;
  maxTurns?: number;
  tools?: OpenAIToolDef[];
  toolExecutor?: {
    execute(name: string, args: Record<string, unknown>): Promise<{ result: unknown; isError: boolean }>;
  };
  /** Called before each prompt — return extra context to inject into system prompt */
  onBeforePrompt?: (userText: string) => Promise<string | undefined>;
  /** Whether to retry once on API errors with exponential backoff */
  retryOnError?: boolean;
  /** Called after agent_end with the full message history — for memory learning, etc. */
  onAgentEnd?: (messages: KestrelClientMessage[]) => void;
}

// ============================================================================
// Events (same shape as old PiAdapterEvent)
// ============================================================================

export type ConversationLoopEvent =
  | { type: "started"; sessionId: string }
  | { type: "text_delta"; text: string }
  | { type: "text_end"; text: string }
  | { type: "tool_call"; toolName: string; args: unknown }
  | { type: "tool_result"; toolName: string; result: unknown; isError: boolean }
  | { type: "turn_end" }
  | { type: "agent_end"; messages: KestrelClientMessage[] }
  | { type: "error"; message: string }
  | { type: "disposed" };

export type ConversationLoopEventListener = (event: ConversationLoopEvent) => void;

// ============================================================================
// ConversationLoop
// ============================================================================

export class ConversationLoop {
  readonly config: ConversationLoopConfig;
  private _messages: KestrelClientMessage[] = [];
  private _listeners: ConversationLoopEventListener[] = [];
  private _isRunning = false;
  private _sessionId = "";
  private _turnCount = 0;
  private _fullText = "";

  constructor(config: ConversationLoopConfig) {
    this.config = { maxTurns: 50, model: "deepseek-v4-pro", ...config };
  }

  // ==========================================================================
  // Public API (PiAdapter-compatible)
  // ==========================================================================

  get isRunning(): boolean {
    return this._isRunning;
  }

  get sessionId(): string {
    return this._sessionId;
  }

  get messages(): KestrelClientMessage[] {
    return this._messages;
  }

  restoreMessages(msgs: KestrelClientMessage[]): void {
    this._messages = msgs;
  }

  async start(model?: string): Promise<void> {
    if (this._isRunning) return;
    if (model) this.config.model = model;
    this._sessionId = randomUUID();
    this._isRunning = true;
    this._turnCount = 0;
    this._fullText = "";
    this.emit({ type: "started", sessionId: this._sessionId });
  }

  async prompt(text: string): Promise<void> {
    // Self-heal: if adapter was disposed or never started, auto-start
    if (!this._isRunning) {
      await this.start();
    }

    // TASK-0400-1b/1c: Inject memory + skills context
    let extraContext = "";
    if (this.config.onBeforePrompt) {
      const ctx = await this.config.onBeforePrompt(text).catch(() => undefined);
      if (ctx) extraContext = `\n\n[Context]\n${ctx}`;
    }

    // Build user message — inject system prompt on first turn (DeepSeek has no system role)
    const isFirstTurn = this._messages.filter((m) => m.role === "user").length === 0;
    let content: string;
    if (isFirstTurn && this.config.systemPrompt) {
      content = `[System]\n${this.config.systemPrompt}${extraContext}\n\n---\n\n[User]\n${text}`;
    } else {
      content = extraContext ? `[Context]\n${extraContext}\n\n[User]\n${text}` : text;
    }
    this._messages.push({ role: "user", content });

    await this._runLoop();
  }

  switchModel(name: string): void {
    this.config.model = name;
  }

  dispose(): void {
    this._isRunning = false;
    this._sessionId = "";
    this._messages = [];
    this.emit({ type: "disposed" });
  }

  onEvent(listener: ConversationLoopEventListener): () => void {
    this._listeners.push(listener);
    return () => {
      this._listeners = this._listeners.filter((l) => l !== listener);
    };
  }

  // ==========================================================================
  // Internal
  // ==========================================================================

  private emit(event: ConversationLoopEvent): void {
    if (event.type === "agent_end") {
      this.config.onAgentEnd?.(event.messages);
    }
    for (const listener of this._listeners) {
      listener(event);
    }
  }

  private async _runLoop(): Promise<void> {
    const clientConfig: KestrelClientConfig = {
      apiKey: this.config.apiKey,
      model: this.config.model ?? "deepseek-v4-pro",
    };

    while (this._turnCount < (this.config.maxTurns ?? 50)) {
      this._fullText = "";
      const pendingToolCalls: ToolCallDelta[] = [];

      let retryCount = 0;
      const maxRetries = this.config.retryOnError ? 3 : 0;

      while (retryCount <= maxRetries) {
        let hasError = false;
        try {
          for await (const event of streamChat(clientConfig, this._messages, this.config.tools)) {
            switch (event.type) {
              case "text_delta":
                this._fullText += event.text;
                this.emit({ type: "text_delta", text: event.text });
                break;
              case "text_end":
                this._fullText = event.text;
                break;
              case "tool_call_end":
                pendingToolCalls.push(event.call);
                break;
              case "error":
                hasError = true;
                if (retryCount < maxRetries) {
                  retryCount++;
                  await new Promise((r) => setTimeout(r, 2 ** retryCount * 1000));
                  pendingToolCalls.length = 0;
                  this._fullText = "";
                } else {
                  this.emit({ type: "error", message: event.message });
                  this.emit({ type: "agent_end", messages: this._messages });
                  return;
                }
                break;
              case "done":
                break;
            }
            if (hasError) break;
          }
          if (!hasError) break; // success — exit retry loop
        } catch (err) {
          if (retryCount < maxRetries) {
            retryCount++;
            await new Promise((r) => setTimeout(r, 2 ** retryCount * 1000));
            pendingToolCalls.length = 0;
            this._fullText = "";
          } else {
            this.emit({ type: "error", message: (err as Error).message });
            this.emit({ type: "agent_end", messages: this._messages });
            return;
          }
        }
      }

      // No tool calls — turn is complete
      if (pendingToolCalls.length === 0) {
        this._turnCount++;
        this._messages.push({ role: "assistant", content: this._fullText });
        this.emit({ type: "text_end", text: this._fullText });
        this.emit({ type: "turn_end" });
        this.emit({ type: "agent_end", messages: this._messages });
        return;
      }

      // Append assistant message with tool calls
      this._messages.push({
        role: "assistant",
        content: null,
        tool_calls: pendingToolCalls,
        reasoning_content: "", // DeepSeek quirk
      });

      // Execute each tool call
      let turnFailed = false;
      for (const tc of pendingToolCalls) {
        const toolName = tc.function.name;
        let args: Record<string, unknown>;
        try {
          args = JSON.parse(tc.function.arguments);
        } catch {
          args = { _raw: tc.function.arguments };
        }

        this.emit({ type: "tool_call", toolName, args });

        try {
          const exec = this.config.toolExecutor;
          const result = exec ? await exec.execute(toolName, args) : { result: `[stub] ${toolName}`, isError: false };

          if (result.isError) turnFailed = true;
          this.emit({ type: "tool_result", toolName, result: result.result, isError: result.isError });

          this._messages.push({
            role: "tool",
            tool_call_id: tc.id,
            name: toolName,
            content: JSON.stringify(result.result),
          });
        } catch (err) {
          turnFailed = true;
          this.emit({
            type: "tool_result",
            toolName,
            result: (err as Error).message,
            isError: true,
          });
          this._messages.push({
            role: "tool",
            tool_call_id: tc.id,
            name: toolName,
            content: JSON.stringify({ error: (err as Error).message }),
          });
        }
      }
      if (!turnFailed) this._turnCount++;
      // Loop: send tool results back to API for next turn
    }

    // Max turns exceeded
    this.emit({ type: "error", message: "Max tool calling turns exceeded" });
    this.emit({ type: "agent_end", messages: this._messages });
  }
}
