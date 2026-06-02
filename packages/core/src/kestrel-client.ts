/**
 * KestrelClient — direct DeepSeek API HTTP client with SSE streaming.
 *
 * Zero Kestrel-internal dependencies. Only uses Node native fetch (22+).
 */

export interface KestrelClientConfig {
  apiKey: string;
  model: string;
  provider?: string; // "deepseek" | "openai" | "anthropic" | "google" — default "deepseek"
  baseUrl?: string; // override the provider's default base URL
}

export interface KestrelClientMessage {
  role: "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCallDelta[];
  tool_call_id?: string;
  name?: string;
  reasoning_content?: string; // DeepSeek: required on assistant messages with tool_calls
}

export interface ToolCallDelta {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface OpenAIToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export type KestrelClientEvent =
  | { type: "text_delta"; text: string }
  | { type: "text_end"; text: string }
  | { type: "tool_call_delta"; index: number; id?: string; name?: string; arguments?: string }
  | { type: "tool_call_end"; call: ToolCallDelta }
  | { type: "error"; message: string }
  | { type: "done"; finishReason: string };

// ============================================================================
// Multi-provider support
// ============================================================================

function resolveProvider(model: string): string {
  if (model.includes("deepseek")) return "deepseek";
  if (model.includes("gpt") || model.includes("o1") || model.includes("o3")) return "openai";
  if (model.includes("claude")) return "anthropic";
  if (model.includes("gemini")) return "google";
  return "deepseek";
}

function getProviderConfig(
  provider: string,
  config: KestrelClientConfig,
): {
  baseUrl: string;
  endpoint: string;
  headers: Record<string, string>;
} {
  switch (provider) {
    case "openai":
      return {
        baseUrl: config.baseUrl ?? "https://api.openai.com/v1",
        endpoint: "/chat/completions",
        headers: { Authorization: `Bearer ${config.apiKey}` },
      };
    case "anthropic":
      return {
        baseUrl: config.baseUrl ?? "https://api.anthropic.com/v1",
        endpoint: "/messages",
        headers: { "x-api-key": config.apiKey, "anthropic-version": "2023-06-01" },
      };
    case "google":
      return {
        baseUrl: config.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta",
        endpoint: `/models/${config.model}:generateContent?key=${encodeURIComponent(config.apiKey)}`,
        headers: {},
      };
    default:
      return {
        baseUrl: config.baseUrl ?? "https://api.deepseek.com/v1",
        endpoint: "/chat/completions",
        headers: { Authorization: `Bearer ${config.apiKey}` },
      };
  }
}

// ============================================================================
// SSE streaming
// ============================================================================

interface ToolAccumulator {
  id: string;
  name: string;
  arguments: string;
}

export async function* streamChat(
  config: KestrelClientConfig,
  messages: KestrelClientMessage[],
  tools?: OpenAIToolDef[],
): AsyncGenerator<KestrelClientEvent> {
  const provider = config.provider ?? resolveProvider(config.model);
  const { baseUrl, endpoint, headers: providerHeaders } = getProviderConfig(provider, config);

  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    stream: true,
  };
  if (tools?.length) body.tools = tools;

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...providerHeaders },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    yield { type: "error", message: `Request failed: ${(err as Error).message}` };
    return;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    yield { type: "error", message: `API ${response.status}: ${text.slice(0, 200)}` };
    return;
  }

  if (!response.body) {
    yield { type: "error", message: "No response body" };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  const toolAccums: Map<number, ToolAccumulator> = new Map();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);
        if (data === "[DONE]") continue;

        let chunk: Record<string, unknown>;
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }

        const choices = chunk.choices as Array<Record<string, unknown>> | undefined;
        if (!choices?.length) continue;

        const delta = choices[0]!.delta as Record<string, unknown> | undefined;
        const finishReason = choices[0]!.finish_reason as string | undefined;

        if (delta?.content) {
          const text = String(delta.content);
          fullText += text;
          yield { type: "text_delta", text };
        }

        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls as Array<Record<string, unknown>>) {
            const idx = tc.index as number;
            let acc = toolAccums.get(idx);
            if (!acc) {
              acc = { id: "", name: "", arguments: "" };
              toolAccums.set(idx, acc);
            }
            if (tc.id) acc.id = String(tc.id);
            const fn = tc.function as Record<string, unknown> | undefined;
            if (fn?.name) acc.name = String(fn.name);
            if (fn?.arguments) acc.arguments += String(fn.arguments);

            yield {
              type: "tool_call_delta",
              index: idx,
              id: tc.id ? String(tc.id) : undefined,
              name: fn?.name ? String(fn.name) : undefined,
              arguments: fn?.arguments ? String(fn.arguments) : undefined,
            };
          }
        }

        if (finishReason) {
          if (fullText) yield { type: "text_end", text: fullText };
          for (const [, acc] of toolAccums) {
            yield {
              type: "tool_call_end",
              call: {
                id: acc.id,
                type: "function",
                function: { name: acc.name, arguments: acc.arguments },
              },
            };
          }
          yield { type: "done", finishReason };
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
