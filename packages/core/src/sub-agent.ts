/**
 * Sub-Agent Scheduler — spawns specialized sub-agents for code exploration,
 * planning, bash execution, and general tasks.
 *
 * Each sub-agent runs in its own ConversationLoop with a scoped tool set.
 */

import { ConversationLoop } from "./conversation-loop.js";

export type SubAgentType = "explore" | "plan" | "bash" | "general";

export interface SubAgentConfig {
  type: SubAgentType;
  task: string;
  apiKey: string;
  model?: string;
  cwd?: string;
  maxTurns?: number;
  timeoutMs?: number;
}

export interface SubAgentResult {
  type: SubAgentType;
  task: string;
  output: string;
  turns: number;
  error?: string;
}

export interface SubAgentSummary {
  total: number;
  succeeded: number;
  failed: number;
  totalTurns: number;
  byType: Record<string, { count: number; succeeded: number; files?: string[] }>;
  findings: string[];
  errors: string[];
}

/** Tool whitelists per sub-agent type */
const SUB_AGENT_TOOLS: Record<SubAgentType, string[]> = {
  explore: ["read", "grep", "find", "lsp_diagnostics"],
  plan: ["read", "grep", "find", "lsp_diagnostics"],
  bash: ["bash"],
  general: ["read", "write", "edit", "grep", "find", "bash", "lsp_diagnostics", "memory_search", "task_create"],
};

/** Return a real parameter schema for a tool name (KCP-0902 audit #20). */
function getToolSchema(name: string): Record<string, unknown> {
  const str = { type: "string" as const };
  const schemas: Record<string, Record<string, unknown>> = {
    read: { type: "object", properties: { path: str, file: str }, required: [] },
    write: { type: "object", properties: { path: str, file: str, content: str }, required: ["content"] },
    edit: {
      type: "object",
      properties: { path: str, file: str, old_string: str, new_string: str },
      required: ["old_string", "new_string"],
    },
    grep: { type: "object", properties: { pattern: str, path: str }, required: ["pattern"] },
    find: { type: "object", properties: { pattern: str, path: str }, required: ["pattern"] },
    bash: { type: "object", properties: { command: str, cmd: str }, required: ["command"] },
    lsp_diagnostics: { type: "object", properties: { target: str }, required: [] },
    memory_search: { type: "object", properties: { query: str, q: str }, required: ["query"] },
    task_create: { type: "object", properties: { title: str, kind: str, input: str }, required: ["title"] },
    git_status: { type: "object", properties: {}, required: [] },
    git_diff: { type: "object", properties: { staged: { type: "boolean" } }, required: [] },
    git_log: { type: "object", properties: { count: { type: "number" } }, required: [] },
    git_blame: { type: "object", properties: { path: str }, required: ["path"] },
    git_commit: { type: "object", properties: { message: str, files: str }, required: ["message"] },
    web_fetch: { type: "object", properties: { url: str }, required: ["url"] },
  };
  return schemas[name] ?? { type: "object", properties: {}, required: [] };
}

const SYSTEM_PROMPTS: Record<SubAgentType, string> = {
  explore:
    "You are a code exploration sub-agent. Your job is to search, read, and analyze code. " +
    "Be thorough — find all relevant files and patterns. " +
    "Return a structured summary of your findings. Do NOT modify any files.",
  plan:
    "You are a planning sub-agent. Your job is to analyze the codebase and produce a detailed implementation plan. " +
    "Read relevant files, understand the architecture, and propose a step-by-step approach. " +
    "Return a structured plan with file paths and specific changes. Do NOT modify any files.",
  bash: "You are a shell execution sub-agent. Execute the requested command and report the output. Be concise.",
  general:
    "You are a general-purpose sub-agent. Complete the assigned task using available tools. " +
    "Return a clear summary of what you did and what you found.",
};

export class SubAgentScheduler {
  private concurrency: number;

  constructor(concurrency = 4) {
    this.concurrency = concurrency;
  }

  /** Spawn a single sub-agent and return its result. */
  async spawn(
    config: SubAgentConfig,
    toolExecutor: {
      execute(name: string, args: Record<string, unknown>): Promise<{ result: unknown; isError: boolean }>;
    },
  ): Promise<SubAgentResult> {
    const allowedTools = SUB_AGENT_TOOLS[config.type];
    const sysPrompt = SYSTEM_PROMPTS[config.type];
    const taskPrompt = `Task: ${config.task}\n\nRespond with your findings. Be thorough and direct.`;

    const adapter = new ConversationLoop({
      apiKey: config.apiKey,
      model: config.model ?? "deepseek-v4-pro",
      systemPrompt: `${sysPrompt}\n\nYou are running in a sub-agent with limited tools: ${allowedTools.join(", ")}.\nWorking directory: ${config.cwd ?? process.cwd()}`,
      maxTurns: config.maxTurns ?? 15,
      tools: allowedTools.map((name) => ({
        type: "function" as const,
        function: {
          name,
          description: `Built-in tool: ${name}`,
          parameters: getToolSchema(name) as {
            type: "object";
            properties: Record<string, unknown>;
            required: string[];
          },
        },
      })),
      toolExecutor: {
        execute: async (name: string, args: Record<string, unknown>) => {
          if (!allowedTools.includes(name)) {
            return { result: `Tool "${name}" not allowed for sub-agent type "${config.type}"`, isError: true };
          }
          return toolExecutor.execute(name, args);
        },
      },
    });

    let output = "";
    let turns = 0;

    try {
      await adapter.start();

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          unsub();
          adapter.dispose();
          resolve(); // timeout is not an error for sub-agents
        }, config.timeoutMs ?? 60_000);

        const unsub = adapter.onEvent((event: { type: string; text?: string; message?: string; name?: string }) => {
          if (event.type === "text_delta") output += event.text ?? "";
          else if (event.type === "turn_end") turns++;
          else if (event.type === "error") {
            output += `\nError: ${event.message}`;
          } else if (event.type === "agent_end") {
            clearTimeout(timeout);
            unsub();
            adapter.dispose();
            resolve();
          }
        });

        adapter.prompt(taskPrompt).catch((err: Error) => {
          clearTimeout(timeout);
          unsub();
          adapter.dispose();
          reject(err);
        });
      });

      return {
        type: config.type,
        task: config.task,
        output: output.trim() || "(no output)",
        turns,
      };
    } catch (err) {
      return {
        type: config.type,
        task: config.task,
        output: output.trim() || "",
        turns,
        error: (err as Error).message,
      };
    }
  }

  /** Spawn multiple sub-agents with concurrency control and deduplication. */
  async spawnAll(
    configs: SubAgentConfig[],
    toolExecutor: {
      execute(name: string, args: Record<string, unknown>): Promise<{ result: unknown; isError: boolean }>;
    },
  ): Promise<SubAgentResult[]> {
    const results: SubAgentResult[] = [];
    const queue = [...configs];
    const running = { count: 0 };

    const worker = async () => {
      while (queue.length > 0) {
        const config = queue.shift()!;
        running.count++;
        try {
          const result = await this.spawn(config, toolExecutor);
          results.push(result);
        } catch {
          results.push({
            type: config.type,
            task: config.task,
            output: "",
            turns: 0,
            error: "sub-agent crashed",
          });
        }
        running.count--;
      }
    };

    const workers = Array.from({ length: Math.min(this.concurrency, configs.length) }, () => worker());
    await Promise.all(workers);

    return this.deduplicate(results);
  }

  /** Remove near-duplicate results, keeping the more detailed one. */
  deduplicate(results: SubAgentResult[]): SubAgentResult[] {
    const kept: SubAgentResult[] = [];
    const seen = new Set<string>();

    for (const r of results) {
      // Fingerprint: first 200 chars normalized
      const fp = r.output.slice(0, 200).replace(/\s+/g, " ").trim();
      if (fp.length < 20) {
        kept.push(r);
        continue;
      }

      let isDuplicate = false;
      for (const s of seen) {
        const overlap = this.lineOverlap(fp, s);
        if (overlap > 0.6) {
          isDuplicate = true;
          break;
        }
      }

      if (isDuplicate) continue;

      seen.add(fp);
      kept.push(r);
    }

    return kept;
  }

  /** Compute line-level overlap ratio between two text snippets. */
  private lineOverlap(a: string, b: string): number {
    const aLines = new Set(a.split(" ").filter((w) => w.length > 2));
    const bLines = new Set(b.split(" ").filter((w) => w.length > 2));
    if (aLines.size === 0 || bLines.size === 0) return 0;
    let intersect = 0;
    for (const w of aLines) {
      if (bLines.has(w)) intersect++;
    }
    return intersect / Math.min(aLines.size, bLines.size);
  }

  /** Build a structured summary from sub-agent results. */
  summarize(results: SubAgentResult[]): SubAgentSummary {
    const summary: SubAgentSummary = {
      total: results.length,
      succeeded: 0,
      failed: 0,
      totalTurns: 0,
      byType: {},
      findings: [],
      errors: [],
    };

    for (const r of results) {
      summary.totalTurns += r.turns;
      const byType = summary.byType[r.type] ?? { count: 0, succeeded: 0, files: [] };
      byType.count++;

      if (r.error) {
        summary.failed++;
        summary.errors.push(`[${r.type}] ${r.task}: ${r.error}`);
      } else {
        summary.succeeded++;
        byType.succeeded++;
        // Extract file paths mentioned in output
        const files = r.output.match(/(?:^|\s)([./]?[\w/-]+\.\w{1,6})(?:$|[\s:,])/gm);
        if (files) {
          for (const f of files) {
            const clean = f.trim();
            if (!byType.files!.includes(clean)) byType.files!.push(clean);
          }
        }
        if (r.output && r.output.length > 10) {
          const firstLine = r.output.split("\n")[0]!.slice(0, 120);
          summary.findings.push(`[${r.type}] ${r.task}: ${firstLine}`);
        }
      }

      summary.byType[r.type] = byType;
    }

    return summary;
  }

  /** Format a summary into a human-readable string. */
  formatSummary(summary: SubAgentSummary): string {
    const lines = [
      `Sub-agents: ${summary.total} total, ${summary.succeeded} succeeded, ${summary.failed} failed (${summary.totalTurns} turns)`,
      "",
    ];

    for (const [type, info] of Object.entries(summary.byType)) {
      lines.push(`${type}: ${info.succeeded}/${info.count} succeeded`);
      if (info.files && info.files.length > 0) {
        lines.push(`  files: ${info.files.slice(0, 10).join(", ")}`);
      }
    }

    if (summary.errors.length > 0) {
      lines.push("");
      lines.push("Errors:");
      for (const e of summary.errors) {
        lines.push(`  ${e}`);
      }
    }

    if (summary.findings.length > 0) {
      lines.push("");
      lines.push("Findings:");
      for (const f of summary.findings.slice(0, 20)) {
        lines.push(`  ${f}`);
      }
      if (summary.findings.length > 20) {
        lines.push(`  ... and ${summary.findings.length - 20} more`);
      }
    }

    return lines.join("\n");
  }
}
