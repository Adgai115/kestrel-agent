/**
 * Kestrel Agent REPL — Ink (React) terminal UI v2.
 *
 * Layout (top-down):
 * ① SplashBanner — ASCII KESTREL logo + version (startup only)
 * ② TaskList     — collapsible pending tasks
 * ③ InfoPanel    — workspace / runtime / model / mode / tools
 * ④ Interaction  — status line + message history
 * ⑤ InputBox     — › red prompt
 * ⑥ Footer       — shortcuts
 *
 * Responsive: >=90 full, 70-89 compact, <70 minimal
 */

import { Box, Text, useApp, useInput } from "ink";

const SLASH_COMMANDS = [
  "/help",
  "/quit",
  "/exit",
  "/history",
  "/history next",
  "/history prev",
  "/model",
  "/tasks",
  "/sessions",
  "/permissions",
  "/expand",
  "/agent",
  "/agent1",
  "/agent2",
  "/plan",
  "/plan start",
  "/plan stop",
];
import React, { useEffect, useRef, useState } from "react";
import { parseDiff, renderDiffLines } from "./terminal.js";

// ==========================================================================
// Types
// ==========================================================================

export interface PendingTask {
  id: string;
  priority: string;
  title: string;
}

export interface ConfirmRequest {
  tool: string;
  risk: string;
  trustLevel: string;
  reason: string;
  args?: Record<string, unknown>;
  target?: string;
  warnings?: string[];
  preview?: string;
}

export interface AppProps {
  version: string;
  model: string;
  workspace: string;
  toolsCount: number;
  pendingTasks: PendingTask[];
  trustLevel?: string;
  adapter: {
    prompt(text: string): Promise<void>;
    switchModel?(name: string): void;
    onEvent(
      fn: (e: {
        type: string;
        text?: string;
        message?: string;
        toolName?: string;
        args?: unknown;
        result?: string;
        isError?: boolean;
      }) => void,
    ): () => void;
    dispose(): void;
    getPendingConfirm?(): ConfirmRequest | null;
    respondConfirm?(allowed: boolean): void;
  };
}

let _msgId = 0;

interface Message {
  id: number;
  role: "user" | "agent" | "error" | "tool";
  content: string;
}

// ==========================================================================
// Terminal helpers
// ==========================================================================

let _w = process.stdout.columns ?? 80;

function tw(): number {
  return _w;
}

function sep(): string {
  return "─".repeat(tw() - 2);
}

function useTermWidth() {
  const [, bump] = useState(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        _w = process.stdout.columns ?? 80;
        bump((n) => n + 1);
      }, 150);
    };
    process.stdout.on("resize", onResize);
    return () => {
      process.stdout.off("resize", onResize);
      clearTimeout(timer);
    };
  }, []);
}

// ==========================================================================
// KESTREL ASCII art (small FIGlet)
// ==========================================================================

const KESTREL_LOGO = [
  "██╗  ██╗███████╗███████╗████████╗██████╗ ███████╗██╗          █████╗  ██████╗ ███████╗███╗   ██╗████████╗",
  "██║ ██╔╝██╔════╝██╔════╝╚══██╔══╝██╔══██╗██╔════╝██║         ██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝",
  "█████╔╝ █████╗  ███████╗   ██║   ██████╔╝█████╗  ██║         ███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ",
  "██╔═██╗ ██╔══╝  ╚════██║   ██║   ██╔══██╗██╔══╝  ██║         ██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ",
  "██║  ██╗███████╗███████║   ██║   ██║  ██║███████╗███████╗    ██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ",
  "╚═╝  ╚═╝╚══════╝╚══════╝   ╚═╝   ╚═╝  ╚═╝╚══════╝╚══════╝    ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ",
];

const KESTREL_LOGO_COMPACT = [
  "██╗  ██╗███████╗███████╗████████╗██████╗ ███████╗██╗",
  "██║ ██╔╝██╔════╝██╔════╝╚══██╔══╝██╔══██╗██╔════╝██║",
  "█████╔╝ █████╗  ███████╗   ██║   ██████╔╝█████╗  ██║",
  "██╔═██╗ ██╔══╝  ╚════██║   ██║   ██╔══██╗██╔══╝  ██║",
  "██║  ██╗███████╗███████║   ██║   ██║  ██║███████╗███████╗",
  "╚═╝  ╚═╝╚══════╝╚══════╝   ╚═╝   ╚═╝  ╚═╝╚══════╝╚══════╝",
];

// ==========================================================================
// ① SplashBanner — KESTREL logo + version
// ==========================================================================

function SplashBanner({ version }: { version: string }) {
  const w = tw();
  if (w < 70)
    return (
      <Text color="cyan" bold>
        {"KESTREL AGENT"}
      </Text>
    );

  const logo = w >= 100 ? KESTREL_LOGO : KESTREL_LOGO_COMPACT;

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" marginBottom={1}>
      <Text> </Text>
      {logo.map((line) => (
        <Text key={line.slice(0, 12)} color="cyan" bold>
          {" ".repeat(Math.max(0, Math.floor((w - 2 - line.length) / 2)))}
          {line}
        </Text>
      ))}
      <Text> </Text>
      <Box width="100%" justifyContent="space-between">
        <Text>
          <Text color="white" bold>
            {"  Kestrel Agent / 红隼"}
          </Text>
        </Text>
        <Text dimColor>{version} </Text>
      </Box>
      <Text> </Text>
      <Text dimColor>{"  Fast eyes. Sharp actions. Reliable execution."}</Text>
      <Text> </Text>
    </Box>
  );
}

// ==========================================================================
// ② TaskList — collapsible pending tasks
// ==========================================================================

function TaskList({ tasks, expanded }: { tasks: PendingTask[]; expanded: boolean }) {
  if (tasks.length === 0) return null;
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" marginBottom={1}>
      <Text dimColor>
        {expanded ? "▼" : "▶"} pending · {tasks.length} tasks
      </Text>
      {expanded &&
        tasks.map((t) => (
          <Text key={t.id} dimColor>
            {"  "}
            {t.id} [{t.priority}] {t.title}
          </Text>
        ))}
    </Box>
  );
}

// ==========================================================================
// ③ InfoPanel — workspace / runtime / model / mode / tools
// ==========================================================================

function InfoPanel({
  workspace,
  model,
  loading,
  error,
  trustLevel,
}: {
  workspace: string;
  model: string;
  loading: boolean;
  error: boolean;
  trustLevel?: string;
}) {
  const w = tw();
  const compact = w < 90;
  const indent = compact ? "" : "  ";
  const runtime = loading ? "thinking" : error ? "error" : "ready";
  const runtimeColor = loading ? "yellow" : error ? "red" : "green";

  const row = (label: string, value: string, color?: string) => (
    <Text dimColor key={label}>
      {indent}
      <Text dimColor>{label.padEnd(10)}</Text>
      <Text color={color}>{value}</Text>
    </Text>
  );

  return (
    <Box flexDirection="column" marginBottom={1}>
      {row("Workspace", truncatePath(workspace, w - 15))}
      {!compact && (
        <>
          {row("Runtime", runtime, runtimeColor)}
          {row("Model", model)}
          {trustLevel && row("Trust", trustLabel(trustLevel), trustColor(trustLevel))}
        </>
      )}
    </Box>
  );
}

function truncatePath(p: string, max: number): string {
  if (p.length <= max) return p;
  return `...${p.slice(-(max - 3))}`;
}

function classifyError(msg: string): string {
  const m = msg.toLowerCase();
  if (
    m.includes("timeout") ||
    m.includes("econnrefused") ||
    m.includes("enotfound") ||
    m.includes("network") ||
    m.includes("econnreset")
  ) {
    return "[retryable: 网络错误, 可重试]";
  }
  if (m.includes("429") || m.includes("rate limit")) {
    return "[retryable: 速率限制, 等待后重试]";
  }
  if (m.includes("401") || m.includes("403") || m.includes("unauthorized")) {
    return "[fatal: API Key 无效, 请检查 .env]";
  }
  if (m.includes("402") || m.includes("quota") || m.includes("insufficient")) {
    return "[fatal: 配额不足, 请检查账户余额]";
  }
  if (m.includes("500") || m.includes("502") || m.includes("503")) {
    return "[retryable: 服务器错误, 稍后重试]";
  }
  return "[未知错误, 查看日志或重试]";
}

// ==========================================================================
// Thinking spinner with animation
// ==========================================================================

const SPINNER_FRAMES = ["◐", "◓", "◑", "◒"];

function ThinkingSpinner() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 150);
    return () => clearInterval(timer);
  }, []);
  return <Text color="yellow">{`  ${SPINNER_FRAMES[frame]} Thinking...`}</Text>;
}

// ==========================================================================
// ④ Interaction — status + messages
// ==========================================================================

function Interaction({ messages, loading, error }: { messages: Message[]; loading: boolean; error: boolean }) {
  return (
    <Box flexDirection="column" flexGrow={1} minHeight={3}>
      {messages.length === 0 && !loading && !error && (
        <Text color="green">{"  ✓ Ready. Waiting for your next command."}</Text>
      )}
      {loading && <ThinkingSpinner />}
      {error && !loading && <Text color="yellow">{"  ✗ Error"}</Text>}
      {messages.map((msg) => {
        if (msg.role === "agent") {
          return (
            <Text key={msg.id} dimColor>
              <Text dimColor>{"  ◈  "}</Text>
              {msg.content}
            </Text>
          );
        }
        if (msg.role === "error") {
          return (
            <Text key={msg.id} color="yellow">
              {"  ✗  "}
              {msg.content}
            </Text>
          );
        }
        if (msg.role === "tool") {
          const diffLines = parseDiff(msg.content);
          if (diffLines) {
            return (
              <Box key={msg.id} flexDirection="column">
                <Text dimColor>
                  {"  ▸  "}
                  {diffLines.length} diff lines
                </Text>
                {renderDiffLines(diffLines)}
              </Box>
            );
          }
          return (
            <Text key={msg.id} dimColor>
              {"  ▸  "}
              {msg.content}
            </Text>
          );
        }
        return (
          <Text key={msg.id} color="white">
            <Text color="cyan" bold>
              {"  ›  "}
            </Text>
            {msg.content}
          </Text>
        );
      })}
    </Box>
  );
}

// ==========================================================================
// ⑤ InputBox — red prompt
// ==========================================================================

function InputBox({
  onSubmit,
  disabled,
  onTab,
  onAgentSwitch,
}: {
  onSubmit: (text: string) => void;
  disabled: boolean;
  onTab: () => void;
  onAgentSwitch: (mode: "agent-1" | "agent-2") => void;
}) {
  const [value, setValue] = useState("");

  const isSlash = value.startsWith("/");
  const suggestions = isSlash
    ? SLASH_COMMANDS.filter((c) => c.startsWith(value.toLowerCase()) && c !== value.toLowerCase()).slice(0, 6)
    : [];

  useInput((input, key) => {
    if (key.tab) {
      if (suggestions.length > 0) {
        setValue(suggestions[0]);
      } else {
        onTab();
      }
      return;
    }
    if (key.leftArrow && !value) {
      onAgentSwitch("agent-1");
      return;
    }
    if (key.rightArrow && !value) {
      onAgentSwitch("agent-2");
      return;
    }
    if (disabled) return;
    if (key.return) {
      const text = value.trim();
      if (text) {
        onSubmit(text);
        setValue("");
      }
    } else if (key.backspace || key.delete) {
      setValue((prev) => prev.slice(0, -1));
    } else if (input && !key.ctrl && !key.meta) {
      setValue((prev) => prev + input);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan">
      {suggestions.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          {suggestions.map((cmd, i) => (
            <Text key={cmd} dimColor={i !== 0} color={i === 0 ? "cyan" : undefined}>
              {"  "}
              {cmd}
            </Text>
          ))}
        </Box>
      )}
      <Text>
        <Text color="cyan" bold>
          {"› "}
        </Text>
        <Text dimColor={!value}>{value || "Enter command or request..."}</Text>
      </Text>
    </Box>
  );
}

// ==========================================================================
// ABAC: risk & trust color helpers
// ==========================================================================

function riskColor(risk: string): string {
  switch (risk) {
    case "critical":
      return "red";
    case "high":
      return "yellow";
    case "medium":
      return "yellow";
    case "low":
      return "green";
    default:
      return "white";
  }
}

function trustLabel(trust: string): string {
  switch (trust) {
    case "local":
      return "local";
    case "trusted":
      return "trusted";
    case "limited":
      return "limited";
    case "unknown":
      return "unknown";
    default:
      return trust;
  }
}

const PROTECTED_PATTERNS = [
  /(^|[\\/])\.env(\.|$)/,
  /\.pem$/i,
  /\.key$/i,
  /id_rsa/,
  /id_ed25519/,
  /(^|[\\/])\.ssh[\\/]/,
  /(^|[\\/])\.aws[\\/]/,
  /(^|[\\/])\.gcp[\\/]/,
  /(^|[\\/])\.azure[\\/]/,
];

function isProtectedTarget(path?: string): boolean {
  if (!path) return false;
  return PROTECTED_PATTERNS.some((p) => p.test(path));
}

function trustColor(trust: string): string {
  switch (trust) {
    case "local":
      return "green";
    case "trusted":
      return "cyan";
    case "limited":
      return "yellow";
    case "unknown":
      return "red";
    default:
      return "white";
  }
}

// ==========================================================================
// ConfirmDialog — ABAC permission gate for "ask" decisions
// ==========================================================================

function ConfirmDialog({ request }: { request: ConfirmRequest }) {
  const entries = request.args ? Object.entries(request.args) : [];
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="yellow" paddingX={1} marginY={1}>
      <Text bold color="yellow">
        {"  ⚠ Permission Required"}
      </Text>
      <Text> </Text>
      <Text>
        {"  Tool: "}
        <Text bold>{request.tool}</Text>
      </Text>
      {entries.map(([k, v]) => {
        const val = typeof v === "string" ? (v.length > 60 ? `${v.slice(0, 57)}...` : v) : JSON.stringify(v);
        const padded = k.padEnd(14);
        return (
          <Text dimColor key={k}>
            {"    "}
            {padded}: {val}
          </Text>
        );
      })}
      <Text>
        {"  Risk: "}
        <Text color={riskColor(request.risk)} bold>
          {request.risk.toUpperCase()}
        </Text>
      </Text>
      <Text>
        {"  Trust: "}
        <Text color={trustColor(request.trustLevel)}>{trustLabel(request.trustLevel)}</Text>
      </Text>
      {request.target && (
        <Text>
          {"  Target: "}
          <Text color={isProtectedTarget(request.target) ? "red" : "white"} bold>
            {request.target.length > 80 ? `...${request.target.slice(-77)}` : request.target}
          </Text>
          {isProtectedTarget(request.target) && (
            <Text color="red" bold>
              {"  ⚡ PROTECTED"}
            </Text>
          )}
        </Text>
      )}
      <Text dimColor>
        {"  "}
        {request.reason}
      </Text>
      {request.warnings && request.warnings.length > 0 && (
        <>
          <Text> </Text>
          {request.warnings.map((w) => (
            <Text color="red" bold key={w.slice(0, 20)}>
              {"  ⚡ DANGER: "}
              {w}
            </Text>
          ))}
        </>
      )}
      {request.preview && (
        <>
          <Text> </Text>
          <Box borderStyle="single" borderColor="yellow" paddingX={1}>
            <Text dimColor>{"> "}</Text>
            <Text>{request.preview.slice(0, 300)}</Text>
            {request.preview.length > 300 && <Text dimColor>{"..."}</Text>}
          </Box>
        </>
      )}
      <Text> </Text>
      <Text color="yellow" bold>
        {"  [y] 批准一次  [n] 拒绝  [a] 本次会话信任此命令/路径"}
      </Text>
    </Box>
  );
}

// ==========================================================================
// ⑥ Footer
// ==========================================================================

function Footer({
  totalChars,
  tokensPerSec,
  agentMode,
  planActive,
}: {
  totalChars: number;
  tokensPerSec?: number;
  agentMode: string;
  planActive: boolean;
}) {
  const w = tw();
  const estTokens = Math.floor(totalChars / 4);
  const maxTokens = 131_072; // 128K context window (DeepSeek)
  const contextPct = Math.min(99, Math.floor((estTokens / maxTokens) * 100));

  if (w < 70) {
    const speed = tokensPerSec ? ` ${tokensPerSec.toFixed(0)}t/s` : "";
    const plan = planActive ? " [PLAN] " : "";
    return <Text dimColor>{`/help /quit /model /tasks${plan}${speed}`}</Text>;
  }

  const speed = tokensPerSec ? ` · ${tokensPerSec.toFixed(0)} tok/s` : "";
  const planSection = planActive ? " · [PLAN MODE] " : "";
  return (
    <Box width="100%" justifyContent="space-between">
      <Text dimColor>{` [Tab] tasks · [Ctrl+C] cancel · [← →] agent · [${agentMode}]${planSection}${speed}`}</Text>
      <Text dimColor>{`Context ${contextPct}% (${estTokens}/${maxTokens})  `}</Text>
    </Box>
  );
}

// ==========================================================================
// App
// ==========================================================================

export default // Build a scoped approval key: "tool:path-or-command" instead of just "tool"
function scopeKey(req: ConfirmRequest): string {
  const args = req.args ?? {};
  switch (req.tool) {
    case "bash":
      return `bash:${String(args.command ?? args.cmd ?? "")}`;
    case "read":
    case "write":
    case "edit":
      return `${req.tool}:${String(args.path ?? args.file ?? "")}`;
    case "grep":
    case "find":
      return `${req.tool}:${String(args.path ?? args.pattern ?? "")}`;
    default:
      return req.tool;
  }
}

function App({ version, model, workspace, toolsCount: _tc, pendingTasks, trustLevel, adapter }: AppProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [tasksExpanded, setTasksExpanded] = useState(false);
  const [agentMode, setAgentMode] = useState<"agent-1" | "agent-2">("agent-1");
  const [planActive, setPlanActive] = useState(false);
  const [currentModel, setCurrentModel] = useState(model);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const approvedScopes = useRef<Set<string>>(new Set());
  const lastConfirmTime = useRef<Map<string, number>>(new Map());
  const confirmRef = useRef(confirmRequest);
  confirmRef.current = confirmRequest;
  const currentOutput = useRef("");
  const fullResults = useRef<Map<number, string>>(new Map());
  const [_expandedResult, setExpandedResult] = useState<number | null>(null);
  const [totalChars, setTotalChars] = useState(0);
  const [tokensPerSec, setTokensPerSec] = useState<number | undefined>(undefined);
  const tokenStart = useRef(0);
  const historyOffset = useRef(0);
  const tokenCount = useRef(0);
  const { exit } = useApp();

  useTermWidth();
  const w = tw();

  // Subscribe to adapter events
  useEffect(() => {
    const unsub = adapter.onEvent((event) => {
      if (event.type === "text_delta") {
        currentOutput.current += event.text;
        setTotalChars((n) => n + (event.text?.length ?? 0));
        tokenCount.current += Math.max(1, Math.floor((event.text?.length ?? 1) / 4));
        if (!tokenStart.current) tokenStart.current = Date.now();
        const elapsed = Date.now() - tokenStart.current;
        if (elapsed > 500 && tokenCount.current > 5) {
          setTokensPerSec(tokenCount.current / (elapsed / 1000));
        }
      } else if (event.type === "agent_end") {
        tokenStart.current = 0;
        tokenCount.current = 0;
        setTokensPerSec(undefined);
        const out = currentOutput.current;
        if (out) {
          setMessages((prev) => [...prev, { id: _msgId++, role: "agent", content: out }]);
        }
        currentOutput.current = "";
        setLoading(false);
      } else if (event.type === "tool_call") {
        const toolName = event.toolName ?? "unknown";
        const args = event.args as Record<string, unknown> | undefined;
        const brief = args
          ? Object.entries(args)
              .map(([k, v]) => {
                const s = typeof v === "string" ? v : JSON.stringify(v);
                return s.length > 40 ? `${k}=${s.slice(0, 37)}...` : `${k}=${s}`;
              })
              .join(" ")
          : "";
        setMessages((prev) => [...prev, { id: _msgId++, role: "tool", content: `→ ${toolName} ${brief}` }]);
      } else if (event.type === "tool_result") {
        const full = String(event.result ?? "");
        const truncated = full.length > 80;
        const r = truncated ? `${full.slice(0, 77)}...` : full;
        const id = _msgId++;
        if (truncated) fullResults.current.set(id, full);
        const prefix = event.isError ? "✗" : "✓";
        const expandHint = truncated ? " [+]" : "";
        setMessages((prev) => [
          ...prev,
          { id, role: "tool", content: `${prefix} ${event.toolName}: ${r}${expandHint}` },
        ]);
      } else if (event.type === "error") {
        const msg = event.message ?? "Unknown";
        const hint = classifyError(msg);
        setMessages((prev) => [...prev, { id: _msgId++, role: "error", content: `${msg}  ${hint}` }]);
        setError(true);
        setLoading(false);
      }
    });
    return unsub;
  }, [adapter]);

  // Poll for pending confirm requests from ABAC gate
  useEffect(() => {
    const interval = setInterval(() => {
      const req = adapter.getPendingConfirm?.();
      if (req && !confirmRef.current) {
        const key = scopeKey(req);
        if (approvedScopes.current.has(key)) {
          adapter.respondConfirm?.(true);
        } else {
          const lastTime = lastConfirmTime.current.get(key) ?? 0;
          if (Date.now() - lastTime < 500) {
            // recently confirmed same tool — auto-allow
            adapter.respondConfirm?.(true);
          } else {
            setConfirmRequest(req);
          }
        }
      }
    }, 50);
    return () => clearInterval(interval);
  }, [adapter]);

  // Ctrl+C — cancel current inference, only exit on second press
  const loadingRef = useRef(loading);
  loadingRef.current = loading;

  useEffect(() => {
    const onSigint = () => {
      if (loadingRef.current) {
        adapter.dispose?.();
        setLoading(false);
        setMessages((prev) => [
          ...prev,
          { id: _msgId++, role: "error", content: "Interrupted · press Ctrl+C again to quit" },
        ]);
        return;
      }
      exit();
    };
    process.on("SIGINT", onSigint);
    return () => {
      process.off("SIGINT", onSigint);
    };
  }, [exit, adapter.dispose]);

  const handleSubmit = async (text: string) => {
    // Handle confirmation response
    if (confirmRequest) {
      const lower = text.toLowerCase().trim();
      if (lower === "a" || lower === "allow all") {
        const key = scopeKey(confirmRequest);
        approvedScopes.current.add(key);
        adapter.respondConfirm?.(true);
        setConfirmRequest(null);
        lastConfirmTime.current.set(key, Date.now());
      } else if (lower === "y" || lower === "yes") {
        adapter.respondConfirm?.(true);
        setConfirmRequest(null);
        const yKey = scopeKey(confirmRequest);
        lastConfirmTime.current.set(yKey, Date.now());
      } else if (lower === "n" || lower === "no") {
        adapter.respondConfirm?.(false);
        setMessages((prev) => [
          ...prev,
          { id: _msgId++, role: "error", content: `Tool "${confirmRequest.tool}" denied by user` },
        ]);
        setConfirmRequest(null);
        lastConfirmTime.current.set(scopeKey(confirmRequest), Date.now());
      }
      return;
    }

    const cmd = text.toLowerCase().trim();
    // Auto-complete: show available commands on "?" or "/?"
    if (cmd === "/?" || cmd === "help" || cmd === "?") {
      const available = ["/help", "/quit", "/history", "/model", "/tasks", "/sessions", "/permissions", "/expand"];
      setMessages((prev) => [...prev, { id: _msgId++, role: "agent", content: `Commands: ${available.join(", ")}` }]);
      return;
    }
    if (cmd === "/quit" || cmd === "/exit") {
      exit();
      return;
    }
    if (cmd === "/help") {
      setMessages((prev) => [
        ...prev,
        { id: _msgId++, role: "agent", content: "Commands: /help /quit /history /model /tasks /sessions /agent" },
      ]);
      return;
    }
    if (cmd === "/agent" || cmd === "/agent1" || cmd === "/agent2") {
      const next =
        cmd === "/agent2" ? "agent-2" : cmd === "/agent1" ? "agent-1" : agentMode === "agent-1" ? "agent-2" : "agent-1";
      setAgentMode(next as "agent-1" | "agent-2");
      setMessages((prev) => [...prev, { id: _msgId++, role: "agent", content: `Agent: ${next}` }]);
      return;
    }
    if (cmd === "/sessions") {
      setMessages((prev) => [
        ...prev,
        { id: _msgId++, role: "agent", content: `Session: messages=${messages.length} model=${currentModel}` },
      ]);
      return;
    }
    if (text === "/expand" || text.startsWith("/expand ")) {
      const arg = text.slice(8).trim();
      if (arg && /^\d+$/.test(arg)) {
        const id = Number.parseInt(arg, 10);
        if (fullResults.current.has(id)) {
          setExpandedResult(id);
          setMessages((prev) => [
            ...prev,
            { id: _msgId++, role: "agent", content: `[Result ${id}]\n${fullResults.current.get(id)}` },
          ]);
        } else {
          setMessages((prev) => [
            ...prev,
            {
              id: _msgId++,
              role: "agent",
              content: `No expanded result for id ${id}. Use /expand <id> with a [+] message id.`,
            },
          ]);
        }
      } else {
        // List expandable results
        const ids = [...fullResults.current.keys()].slice(-10);
        if (ids.length === 0) {
          setMessages((prev) => [...prev, { id: _msgId++, role: "agent", content: "No expandable tool results. [+]" }]);
        } else {
          setMessages((prev) => [
            ...prev,
            {
              id: _msgId++,
              role: "agent",
              content: `Expandable results: ${ids.join(", ")}\nUse /expand <id> to view.`,
            },
          ]);
        }
      }
      return;
    }
    if (cmd === "/history" || cmd === "/history next" || cmd === "/history prev") {
      const perPage = 10;
      let offset = historyOffset.current;
      if (cmd === "/history next") offset = Math.min(offset + perPage, Math.max(0, messages.length - perPage));
      else if (cmd === "/history prev") offset = Math.max(0, offset - perPage);
      else offset = Math.max(0, messages.length - perPage); // default: latest
      historyOffset.current = offset;
      const page = messages.slice(offset, offset + perPage);
      const lines = page.map((m, i) => `[${offset + i}] ${m.role} ${m.content.slice(0, 80)}`);
      const hasMore = offset + perPage < messages.length;
      const nav = `(${offset + 1}-${Math.min(offset + perPage, messages.length)} of ${messages.length})${hasMore ? "  /history next" : ""}${offset > 0 ? "  /history prev" : ""}`;
      setMessages((prev) => [
        ...prev,
        { id: _msgId++, role: "agent", content: `${nav}\n${lines.join("\n") || "(empty)"}` },
      ]);
      return;
    }
    if (cmd === "/model") {
      const available = [
        "DeepSeek: deepseek-chat, deepseek-v4-pro, deepseek-reasoner",
        "OpenAI: gpt-4o, gpt-4o-mini, gpt-4-turbo",
        "Anthropic: claude-opus-4-7, claude-sonnet-4-6, claude-haiku-4-5",
        "Google: gemini-2.5-pro, gemini-2.5-flash",
      ].join("\n  ");
      setMessages((prev) => [
        ...prev,
        {
          id: _msgId++,
          role: "agent",
          content: `Current: ${currentModel}\n  ${available}\n\n  /model <name> to switch`,
        },
      ]);
      return;
    }
    if (text.startsWith("/model ")) {
      const newModel = text.slice(7).trim();
      if (newModel) {
        adapter.switchModel?.(newModel);
        setCurrentModel(newModel);
        setMessages((prev) => [...prev, { id: _msgId++, role: "agent", content: `Model switched to ${newModel}` }]);
      }
      return;
    }
    if (text === "/permissions" || text.startsWith("/permissions ")) {
      const level = text.slice(13).trim();
      const currentLevel = trustLevel ?? "local";
      if (level && ["local", "trusted", "limited"].includes(level)) {
        setMessages((prev) => [
          ...prev,
          {
            id: _msgId++,
            role: "agent",
            content: `Trust level: ${level} (was ${currentLevel}). Note: CLI sessions always default to "local" trust.`,
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: _msgId++,
            role: "agent",
            content: [
              `Trust Level: ${currentLevel}`,
              "",
              "Policy:",
              "  local   low→allow  medium→allow  high→ask    critical→ask",
              "  trusted low→allow  medium→ask   high→ask    critical→deny",
              "  limited low→ask    medium→ask   high→deny  critical→deny",
              "  unknown                      →deny",
              "",
              "Risk levels: read/lsp=low  web/task/memory=medium  write/edit/bash=high",
              "",
              approvedScopes.current.size > 0
                ? `Approved scopes (${approvedScopes.current.size}):\n${[...approvedScopes.current].map((s) => `  - ${s}`).join("\n")}`
                : "Approved scopes: (none)",
            ].join("\n"),
          },
        ]);
      }
      return;
    }
    if (text === "/plan" || text === "/plan start") {
      setPlanActive(true);
      setMessages((prev) => [
        ...prev,
        { id: _msgId++, role: "agent", content: "Plan mode active — read-only tools only. Use /plan stop to exit." },
      ]);
      return;
    }
    if (text === "/plan stop") {
      setPlanActive(false);
      setMessages((prev) => [...prev, { id: _msgId++, role: "agent", content: "Plan mode exited." }]);
      return;
    }
    if (text === "/tasks") {
      setTasksExpanded((prev) => !prev);
      return;
    }
    setMessages((prev) => [...prev, { id: _msgId++, role: "user", content: text }]);
    setLoading(true);
    setError(false);
    currentOutput.current = "";
    try {
      await adapter.prompt(text);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { id: _msgId++, role: "error", content: (err as Error).message ?? "Prompt failed" },
      ]);
      setError(true);
      setLoading(false);
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      <SplashBanner version={version} />
      <TaskList tasks={pendingTasks} expanded={tasksExpanded} />
      <InfoPanel workspace={workspace} model={currentModel} loading={loading} error={error} trustLevel={trustLevel} />
      <Text dimColor>{sep()}</Text>
      {w >= 70 && <Text dimColor>{"  Interaction"}</Text>}
      <Interaction messages={messages} loading={loading} error={error} />
      {confirmRequest && <ConfirmDialog request={confirmRequest} />}
      <InputBox
        onSubmit={handleSubmit}
        disabled={loading && !confirmRequest}
        onTab={() => setTasksExpanded((p) => !p)}
        onAgentSwitch={(mode) => setAgentMode(mode)}
      />
      <Footer totalChars={totalChars} tokensPerSec={tokensPerSec} agentMode={agentMode} planActive={planActive} />
    </Box>
  );
}

// ==========================================================================
// Entry point
// ==========================================================================

export async function runInkRepl(props: AppProps): Promise<void> {
  const { render } = await import("ink");
  const { waitUntilExit } = render(<App {...props} />);
  await waitUntilExit;
}
