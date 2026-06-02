const BASE = "http://127.0.0.1:3100";

function headers(): HeadersInit {
  const token = localStorage.getItem("kestrel_token") ?? "";
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ============================================================================
// Types
// ============================================================================

export interface GatewayHealth {
  status: string;
  uptime: number;
  sessions: number;
  version: string;
}

export interface TrackedSession {
  id: string;
  type: "sse" | "ws";
  connectedAt: number;
}

export interface PendingConfirmation {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  risk: string;
  trustLevel: string;
  reason: string;
  target?: string;
  createdAt: number;
  resolved: boolean;
  decision?: "approve" | "deny";
  resolvedAt?: number;
}

// ============================================================================
// API
// ============================================================================

export async function fetchHealth(): Promise<GatewayHealth> {
  const res = await fetch(`${BASE}/health`);
  return res.json();
}

export async function fetchSessions(): Promise<{ sessions: TrackedSession[]; count: number }> {
  const res = await fetch(`${BASE}/sessions`, { headers: headers() });
  if (!res.ok) return { sessions: [], count: 0 };
  return res.json();
}

export async function fetchPendingConfirmations(): Promise<{
  confirmations: PendingConfirmation[];
  count: number;
}> {
  const res = await fetch(`${BASE}/confirm/pending`, { headers: headers() });
  if (!res.ok) return { confirmations: [], count: 0 };
  return res.json();
}

export async function resolveConfirmation(
  id: string,
  action: "approve" | "deny",
): Promise<{ id: string; decision: string }> {
  const res = await fetch(`${BASE}/confirm/${id}`, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  if (!res.ok) throw new Error(`Failed to ${action} confirmation`);
  return res.json();
}

export async function createTestConfirmation(): Promise<{ id: string }> {
  const res = await fetch(`${BASE}/confirm`, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({
      tool: "write",
      args: { path: "src/config.ts", content: "// test" },
      risk: "high",
      trustLevel: "local",
      reason: "Test confirmation from Web Console",
      target: "src/config.ts",
    }),
  });
  return res.json();
}
