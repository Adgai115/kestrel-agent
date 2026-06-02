/**
 * @kestrel/tools — Tool registry and built-in tool definitions.
 */

import type { PermissionRequest, PermissionResult, RiskLevel, Tool } from "@kestrel/permissions";

export type { PermissionRequest, PermissionResult, RiskLevel, Tool };

export interface ToolDefinition {
  name: string;
  description: string;
  riskLevel: RiskLevel;
  requiredPermissions: string[];
  /** The permission tool type this maps to */
  toolType: Tool;
}

export interface ToolRegistry {
  list(): ToolDefinition[];
  get(name: string): ToolDefinition | undefined;
  getByToolType(type: Tool): ToolDefinition[];
}

/** Built-in tool definitions aligned with permission engine. */
const BUILTIN_TOOLS: ToolDefinition[] = [
  {
    name: "read",
    description: "Read file contents",
    riskLevel: "low",
    requiredPermissions: ["read"],
    toolType: "read",
  },
  {
    name: "write",
    description: "Write files (creates/overwrites)",
    riskLevel: "high",
    requiredPermissions: ["write"],
    toolType: "write",
  },
  {
    name: "edit",
    description: "Edit files with find/replace",
    riskLevel: "high",
    requiredPermissions: ["edit"],
    toolType: "edit",
  },
  {
    name: "grep",
    description: "Search file contents with regex",
    riskLevel: "low",
    requiredPermissions: ["read"],
    toolType: "read",
  },
  {
    name: "find",
    description: "Find files by glob pattern",
    riskLevel: "low",
    requiredPermissions: ["read"],
    toolType: "read",
  },
  {
    name: "bash",
    description: "Execute shell commands (sandboxed)",
    riskLevel: "high",
    requiredPermissions: ["bash"],
    toolType: "bash",
  },
  {
    name: "web_fetch",
    description: "Fetch content from a URL",
    riskLevel: "medium",
    requiredPermissions: ["web"],
    toolType: "web",
  },
  {
    name: "lsp_diagnostics",
    description: "Run LSP diagnostics on code",
    riskLevel: "low",
    requiredPermissions: ["lsp"],
    toolType: "lsp",
  },
  {
    name: "memory_search",
    description: "Search long-term memories",
    riskLevel: "medium",
    requiredPermissions: ["memory"],
    toolType: "memory",
  },
  {
    name: "task_create",
    description: "Create a background task",
    riskLevel: "medium",
    requiredPermissions: ["task"],
    toolType: "task",
  },
  {
    name: "agent",
    description: "Spawn a sub-agent (explore/plan/bash/general) to handle complex tasks",
    riskLevel: "high",
    requiredPermissions: ["agent"],
    toolType: "agent",
  },
  {
    name: "git_status",
    description: "Run git status to see changed files",
    riskLevel: "low",
    requiredPermissions: ["read"],
    toolType: "git_status",
  },
  {
    name: "git_diff",
    description: "Run git diff to see unstaged changes",
    riskLevel: "low",
    requiredPermissions: ["read"],
    toolType: "git_diff",
  },
  {
    name: "git_log",
    description: "Run git log to see commit history",
    riskLevel: "low",
    requiredPermissions: ["read"],
    toolType: "git_log",
  },
  {
    name: "git_blame",
    description: "Run git blame to see who last changed each line",
    riskLevel: "low",
    requiredPermissions: ["read"],
    toolType: "git_blame",
  },
  {
    name: "git_commit",
    description: "Stage and commit changes with auto-generated message",
    riskLevel: "high",
    requiredPermissions: ["write"],
    toolType: "git_commit",
  },
  {
    name: "pr_create",
    description: "Create a GitHub PR: branch → commit → push → gh pr create",
    riskLevel: "high",
    requiredPermissions: ["write"],
    toolType: "pr_create",
  },
  {
    name: "skill_create",
    description: "Create a new skill on demand (manifest + SKILL.md boilerplate)",
    riskLevel: "medium",
    requiredPermissions: ["write"],
    toolType: "task_create",
  },
];

export function createToolRegistry(customTools?: ToolDefinition[]): ToolRegistry {
  const all = [...BUILTIN_TOOLS, ...(customTools ?? [])];
  const byName = new Map(all.map((t) => [t.name, t]));

  return {
    list: () => all,
    get: (name) => byName.get(name),
    getByToolType: (type) => all.filter((t) => t.toolType === type),
  };
}

export const KESTREL_TOOLS_VERSION = "0.1.0";
