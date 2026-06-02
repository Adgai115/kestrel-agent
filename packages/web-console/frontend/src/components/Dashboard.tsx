import { useEffect, useState } from "react";
import type { GatewayHealth, PendingConfirmation, TrackedSession } from "../lib/api";
import {
  createTestConfirmation,
  fetchHealth,
  fetchPendingConfirmations,
  fetchSessions,
  resolveConfirmation,
} from "../lib/api";

export function Dashboard() {
  const [token, setToken] = useState<string>(() => localStorage.getItem("kestrel_token") ?? "");
  const [tokenInput, setTokenInput] = useState("");
  const [showToken, setShowToken] = useState(false);

  const handleSetToken = () => {
    const t = tokenInput.trim();
    if (!t) return;
    localStorage.setItem("kestrel_token", t);
    setToken(t);
    setTokenInput("");
  };

  const handleClearToken = () => {
    localStorage.removeItem("kestrel_token");
    setToken("");
    setShowToken(false);
  };

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-cyan-400 tracking-tight">Kestrel Agent</h1>
          <p className="text-zinc-500 text-sm mt-1">Web Console</p>
        </div>

        <div className="min-w-0">
          {token ? (
            <div className="flex flex-col flex-wrap items-start gap-2 sm:flex-row sm:items-center sm:justify-end">
              <span className="text-xs text-zinc-500 whitespace-nowrap">Token:</span>
              <span className="text-xs font-mono text-zinc-300 bg-zinc-900 px-2 py-1 rounded">
                {showToken ? token : `${token.slice(0, 6)}...${token.slice(-4)}`}
              </span>
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="text-xs px-2 py-1 rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors whitespace-nowrap"
              >
                {showToken ? "隐藏" : "显示"}
              </button>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(token)}
                className="text-xs px-2 py-1 rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors whitespace-nowrap"
              >
                复制
              </button>
              <button
                type="button"
                onClick={handleClearToken}
                className="text-xs px-2 py-1 rounded border border-red-900 text-red-400 hover:bg-red-950 transition-colors whitespace-nowrap"
              >
                清除
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <span className="text-xs text-amber-400">未设置 Token — 需要授权才能调用 API</span>
              <input
                type="text"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="粘贴 网关 token..."
                className="text-xs px-3 py-1.5 rounded bg-zinc-900 border border-zinc-700 text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-cyan-700 w-full sm:w-56"
              />
              <button
                type="button"
                onClick={handleSetToken}
                disabled={!tokenInput.trim()}
                className="text-xs px-3 py-1.5 rounded bg-cyan-900 border border-cyan-700 text-cyan-300 hover:bg-cyan-800 disabled:opacity-40 transition-colors whitespace-nowrap"
              >
                设置
              </button>
            </div>
          )}
        </div>
      </div>

      {!token && (
        <div className="rounded-md bg-amber-950 border border-amber-900 p-3 text-amber-300 text-xs mb-6">
          网关 token 在启动 <code className="text-amber-200 bg-amber-900/50 px-1 rounded">kestrel gateway start</code>{" "}
          时打印，也保存在 <code className="text-amber-200 bg-amber-900/50 px-1 rounded">.kestrel/gateway-token</code>。
          粘贴到上方以启用会话、权限审批等功能。
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <HealthPanel />
        <SessionPanel token={token} />
      </div>

      <div className="mt-6">
        <PermissionPanel token={token} />
      </div>

      <div className="mt-6">
        <ObservabilityPanel token={token} />
      </div>

      <div className="mt-6">
        <DiagnosticsPanel token={token} />
      </div>

      <div className="mt-6">
        <TimelinePanel token={token} />
      </div>
    </div>
  );
}

// ============================================================================
// 网关 Health
// ============================================================================

function HealthPanel() {
  const [health, setHealth] = useState<GatewayHealth | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const h = await fetchHealth();
        if (!cancelled) {
          setHealth(h);
          setError(null);
        }
      } catch {
        if (!cancelled) setError("网关不可达");
      }
    };
    poll();
    const iv = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, []);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
      <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-4">网关</h2>
      {error && (
        <div className="rounded-md bg-red-950 border border-red-900 p-3 text-red-400 text-sm mb-4">{error}</div>
      )}
      {health ? (
        <div className="grid grid-cols-2 gap-4">
          <Badge label="状态" value={health.status} ok={health.status === "ok"} />
          <Badge label="版本" value={health.version} />
          <Badge label="运行时间" value={formatUptime(health.uptime)} />
          <Badge label="活跃会话" value={String(health.sessions)} />
        </div>
      ) : (
        <p className="text-zinc-600 text-sm">连接中...</p>
      )}
    </div>
  );
}

// ============================================================================
// Session Observation
// ============================================================================

function SessionPanel({ token }: { token: string }) {
  const [sessions, setSessions] = useState<TrackedSession[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const data = await fetchSessions();
        if (!cancelled) {
          setSessions(data.sessions);
          setError(null);
        }
      } catch {
        if (!cancelled) setError("无法获取会话");
      }
    };
    poll();
    const iv = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [token]);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
      <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-4">
        会话
        {sessions.length > 0 && <span className="ml-2 text-xs text-zinc-500">({sessions.length} 活跃)</span>}
      </h2>

      {error && <div className="text-red-400 text-xs mb-3">{error}</div>}

      {!token ? (
        <p className="text-zinc-600 text-sm">设置 网关 Token 以查看活跃会话</p>
      ) : sessions.length === 0 ? (
        <p className="text-zinc-600 text-sm">无活跃会话</p>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {sessions.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between rounded bg-zinc-950 px-3 py-2 text-sm flex-wrap gap-1"
            >
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${s.type === "ws" ? "bg-violet-500" : "bg-emerald-500"}`} />
                <span className="text-zinc-300 font-mono text-xs">{s.id.slice(0, 12)}...</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-zinc-500">
                <span className="uppercase text-zinc-600">{s.type}</span>
                <span>{formatAgo(s.connectedAt)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Permission Approval
// ============================================================================

function PermissionPanel({ token }: { token: string }) {
  const [confirmations, setConfirmations] = useState<PendingConfirmation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const data = await fetchPendingConfirmations();
        if (!cancelled) {
          setConfirmations(data.confirmations);
          setError(null);
        }
      } catch {
        if (!cancelled) setError("无法获取审批列表");
      }
    };
    poll();
    const iv = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [token]);

  const load = async () => {
    try {
      const data = await fetchPendingConfirmations();
      setConfirmations(data.confirmations);
      setError(null);
    } catch {
      setError("无法获取审批列表");
    }
  };

  const handleAction = async (id: string, action: "approve" | "deny") => {
    setActionError(null);
    try {
      await resolveConfirmation(id, action);
      await load();
    } catch (e) {
      setActionError(`${action === "approve" ? "批准" : "拒绝"}失败: ${(e as Error).message}`);
    }
  };

  const handleTest = async () => {
    setActionError(null);
    try {
      await createTestConfirmation();
      await load();
    } catch (e) {
      setActionError(`创建测试请求失败: ${(e as Error).message}`);
    }
  };

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
          权限审批
          {confirmations.length > 0 && (
            <span className="ml-2 text-xs text-amber-500">({confirmations.length} 待处理)</span>
          )}
        </h2>
        <button
          type="button"
          onClick={handleTest}
          className="text-xs px-3 py-1 rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors whitespace-nowrap"
        >
          + 测试请求
        </button>
      </div>

      {error && (
        <div className="rounded-md bg-red-950 border border-red-900 p-3 text-red-400 text-sm mb-4">{error}</div>
      )}
      {actionError && (
        <div className="rounded-md bg-red-950 border border-red-900 p-3 text-red-400 text-sm mb-4">{actionError}</div>
      )}

      {!token ? (
        <p className="text-zinc-600 text-sm">设置 网关 Token 以查看和管理权限审批</p>
      ) : confirmations.length === 0 ? (
        <p className="text-zinc-600 text-sm">无待处理审批。使用"测试请求"按钮或从 CLI 触发工具。</p>
      ) : (
        <div className="space-y-4">
          {confirmations.map((c) => (
            <div key={c.id} className="rounded bg-zinc-950 border border-amber-900/50 p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <span className="font-mono text-sm text-amber-400 font-semibold">{c.tool}</span>
                  {c.target && <span className="ml-2 text-xs text-red-400 font-mono">⚡ {c.target}</span>}
                </div>
                <span className={`text-xs px-2 py-0.5 rounded ${riskColor(c.risk)}`}>{c.risk}</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3 text-xs">
                <div>
                  <span className="text-zinc-500">信任:</span>
                  <span className="text-zinc-300 font-mono">{c.trustLevel}</span>
                </div>
                <div>
                  <span className="text-zinc-500">原因:</span>
                  <span className="text-zinc-300">{c.reason}</span>
                </div>
              </div>

              {Object.keys(c.args).length > 0 && (
                <div className="mb-3 rounded bg-zinc-900 p-2 text-xs font-mono text-zinc-400 max-h-20 overflow-y-auto">
                  {Object.entries(c.args).map(([k, v]) => (
                    <div key={k} className="flex gap-2">
                      <span className="text-zinc-500">{k}:</span>
                      <span className="text-zinc-300 truncate">{JSON.stringify(v)}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => handleAction(c.id, "approve")}
                  className="flex-1 px-3 py-1.5 rounded text-sm font-medium bg-emerald-900 border border-emerald-700 text-emerald-300 hover:bg-emerald-800 transition-colors"
                >
                  批准
                </button>
                <button
                  type="button"
                  onClick={() => handleAction(c.id, "deny")}
                  className="flex-1 px-3 py-1.5 rounded text-sm font-medium bg-red-950 border border-red-900 text-red-400 hover:bg-red-900 transition-colors"
                >
                  拒绝
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 可观测性
// ============================================================================

function ObservabilityPanel({ token }: { token: string }) {
  const [metrics, setMetrics] = useState<{
    requests: number;
    errors: number;
    avgLatency: number;
    sessions: number;
    uptime: number;
  } | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch("http://127.0.0.1:3100/status", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        setMetrics((prev) => ({
          requests: (prev?.requests ?? 0) + 1,
          errors: data.status === "degraded" ? (prev?.errors ?? 0) + 1 : (prev?.errors ?? 0),
          avgLatency: data.uptime > 0 ? Math.round(data.uptime / 1000) : 0,
          sessions: data.sessions ?? 0,
          uptime: data.uptime ?? 0,
        }));
      } catch {
        setMetrics((prev) =>
          prev
            ? { ...prev, requests: prev.requests + 1, errors: prev.errors + 1 }
            : { requests: 1, errors: 1, avgLatency: 0, sessions: 0, uptime: 0 },
        );
      }
    };
    poll();
    const iv = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [token]);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
      <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-4">可观测性</h2>

      {!token ? (
        <p className="text-zinc-600 text-sm">设置 网关 Token 以查看指标</p>
      ) : !metrics ? (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 animate-pulse">
          {["请求", "错误", "运行时间", "会话", "成功率"].map((label) => (
            <div key={label} className="text-center">
              <div className="h-8 w-12 mx-auto rounded bg-zinc-800" />
              <div className="h-3 w-10 mx-auto mt-1 rounded bg-zinc-800" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          <div className="text-center">
            <div className="text-2xl font-mono text-cyan-400">{metrics.requests}</div>
            <div className="text-xs text-zinc-500 mt-1 whitespace-nowrap">请求</div>
          </div>
          <div className="text-center">
            <div className={`text-2xl font-mono ${metrics.errors > 0 ? "text-red-400" : "text-emerald-400"}`}>
              {metrics.errors}
            </div>
            <div className="text-xs text-zinc-500 mt-1 whitespace-nowrap">错误</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-mono text-zinc-300">{formatUptime(metrics.uptime)}</div>
            <div className="text-xs text-zinc-500 mt-1 whitespace-nowrap">运行时间</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-mono text-zinc-300">{metrics.sessions}</div>
            <div className="text-xs text-zinc-500 mt-1 whitespace-nowrap">会话</div>
          </div>
          <div className="text-center">
            <div
              className={`text-2xl font-mono ${
                metrics.errors === 0 ? "text-emerald-400" : metrics.errors < 3 ? "text-amber-400" : "text-red-400"
              }`}
            >
              {metrics.requests > 0 ? Math.max(0, Math.round((1 - metrics.errors / metrics.requests) * 100)) : 100}%
            </div>
            <div className="text-xs text-zinc-500 mt-1 whitespace-nowrap">成功率</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// KCP-0803/0804: Diagnostics — runtime health + identity
// ============================================================================

function DiagnosticsPanel({ token }: { token: string }) {
  const [diag, setDiag] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch("http://127.0.0.1:3100/diagnostics", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!cancelled && res.ok) setDiag(await res.json());
      } catch {
        /* retry next poll */
      }
    };
    poll();
    const iv = setInterval(poll, 10000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [token]);

  if (!token) return null;
  if (!diag) return null;

  const id = diag.identity as Record<string, string> | undefined;
  const mem = diag.memory as Record<string, number> | undefined;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
      <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-4">诊断</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
        {id && (
          <div className="space-y-1">
            <div>
              <span className="text-zinc-500">主机: </span>
              <span className="text-zinc-300 font-mono">{id.host}</span>
            </div>
            <div>
              <span className="text-zinc-500">实例: </span>
              <span className="text-zinc-300 font-mono">{id.instanceId.slice(0, 12)}...</span>
            </div>
            <div>
              <span className="text-zinc-500">PID: </span>
              <span className="text-zinc-300 font-mono">{id.pid}</span>
            </div>
            <div>
              <span className="text-zinc-500">平台: </span>
              <span className="text-zinc-300">{id.platform}</span>
            </div>
            <div>
              <span className="text-zinc-500">Node: </span>
              <span className="text-zinc-300">{id.nodeVersion}</span>
            </div>
          </div>
        )}
        {mem && (
          <div className="space-y-1">
            <div>
              <span className="text-zinc-500">RSS: </span>
              <span className="text-zinc-300 font-mono">{formatBytes(mem.rss)}</span>
            </div>
            <div>
              <span className="text-zinc-500">堆总计: </span>
              <span className="text-zinc-300 font-mono">{formatBytes(mem.heapTotal)}</span>
            </div>
            <div>
              <span className="text-zinc-500">堆已用: </span>
              <span className="text-zinc-300 font-mono">{formatBytes(mem.heapUsed)}</span>
            </div>
            <div>
              <span className="text-zinc-500">外部: </span>
              <span className="text-zinc-300 font-mono">{formatBytes(mem.external)}</span>
            </div>
          </div>
        )}
        <div className="space-y-1">
          <div>
            <span className="text-zinc-500">待处理审批: </span>
            <span className="text-zinc-300 font-mono">{String(diag.pendingConfirmations ?? 0)}</span>
          </div>
          <div>
            <span className="text-zinc-500">活跃会话: </span>
            <span className="text-zinc-300 font-mono">{String(diag.sessions ?? 0)}</span>
          </div>
          <div>
            <span className="text-zinc-500">运行时间: </span>
            <span className="text-zinc-300">{formatUptime(Number(diag.uptime ?? 0))}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// KCP-0802: Task + Audit Timeline
// ============================================================================

function TimelinePanel({ token }: { token: string }) {
  const [events, setEvents] = useState<Array<Record<string, unknown>>>([]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch("http://127.0.0.1:3100/audit?limit=10", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!cancelled && res.ok) {
          const data = await res.json();
          setEvents((data.audit ?? []).slice(0, 10));
        }
      } catch {
        /* retry */
      }
    };
    poll();
    const iv = setInterval(poll, 15000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [token]);

  if (!token || events.length === 0) return null;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
      <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-4">时间线</h2>
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {events.map((e) => (
          <div key={String(e.id ?? e.ts)} className="flex items-center gap-3 text-xs rounded bg-zinc-950 px-3 py-2">
            <span className={`w-1.5 h-1.5 rounded-full ${e.level === "warn" ? "bg-amber-500" : "bg-zinc-600"}`} />
            <span className="text-zinc-500 font-mono w-16">{String(e.ts ?? "").slice(11, 19)}</span>
            <span className="text-zinc-400 w-28 truncate">{String(e.event ?? "")}</span>
            <span className="text-zinc-600 flex-1 truncate">{String(e.subject ?? e.tool ?? "")}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ============================================================================
// Shared
// ============================================================================

function Badge({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div>
      <div className="text-xs text-zinc-500 mb-1">{label}</div>
      <div className={`text-sm font-mono ${ok === false ? "text-red-400" : "text-zinc-200"}`}>{value}</div>
    </div>
  );
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function formatAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}秒前`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}分钟前`;
  return `${Math.floor(m / 60)}小时前`;
}

function riskColor(risk: string): string {
  switch (risk) {
    case "critical":
      return "bg-red-950 text-red-400 border border-red-900";
    case "high":
      return "bg-orange-950 text-orange-400 border border-orange-900";
    case "medium":
      return "bg-yellow-950 text-yellow-400 border border-yellow-900";
    default:
      return "bg-zinc-800 text-zinc-400 border border-zinc-700";
  }
}
