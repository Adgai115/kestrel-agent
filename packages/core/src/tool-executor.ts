/**
 * Shared Tool Executor — extracted from @kestrel/cli (KCP-0301).
 *
 * Pure tool implementations with no UI dependency. CLI wraps this with
 * ABAC ConfirmDialog; Gateway/channel/cron wrap with ToolPolicy.guard().
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import * as path from "node:path";

export interface ToolExecutorContext {
  cwd: string;
  mcpClient?: {
    callTool(
      name: string,
      args: Record<string, unknown>,
    ): Promise<{
      content: { type: string; text?: string }[];
      isError?: boolean;
    }>;
  } | null;
}

export interface ToolResult {
  result: string;
  isError: boolean;
}

// rg probe cache
let _rgAvailable: boolean | null = null;

/** @returns true if ripgrep is available, false otherwise (cached). */
function rgAvailable(): boolean {
  if (_rgAvailable !== null) return _rgAvailable;
  try {
    execSync("rg --version", { stdio: ["pipe", "pipe", "pipe"], encoding: "utf-8", timeout: 3000 });
    _rgAvailable = true;
  } catch {
    _rgAvailable = false;
  }
  return _rgAvailable;
}

/**
 * Create a shared tool executor. All 18 built-in tools plus MCP delegation.
 * Callers must handle ABAC/permission checks BEFORE calling execute().
 */
export function createSharedToolExecutor(ctx: ToolExecutorContext) {
  const { cwd } = ctx;

  async function execute(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    switch (name) {
      case "read": {
        const filePath = String(args.path ?? args.file ?? "");
        const resolved = path.resolve(cwd, filePath);
        if (!existsSync(resolved)) return { result: `File not found: ${filePath}`, isError: true };
        return { result: readFileSync(resolved, "utf-8").slice(0, 50_000), isError: false };
      }
      case "write": {
        const filePath = String(args.path ?? args.file ?? "");
        const content = String(args.content ?? "");
        const resolved = path.resolve(cwd, filePath);
        const norm = resolved.toLowerCase();
        const blocked = [
          "/etc",
          "/usr",
          "/boot",
          "/sys",
          "/proc",
          "/dev",
          "/bin",
          "/sbin",
          "/lib",
          "c:\\windows",
          "c:\\program files",
          "c:\\program files (x86)",
          "c:\\programdata",
        ];
        const root = path.parse(resolved).root;
        if (
          resolved === root ||
          blocked.some((p) => norm === p || norm.startsWith(`${p}\\`) || norm.startsWith(`${p}/`))
        ) {
          return { result: `write: path "${filePath}" is in a protected system directory`, isError: true };
        }
        const dir = path.dirname(resolved);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(resolved, content, "utf-8");
        return { result: `Wrote ${content.length} bytes to ${filePath}`, isError: false };
      }
      case "edit": {
        const filePath = String(args.path ?? args.file ?? "");
        const oldStr = String(args.old_string ?? args.find ?? "");
        const newStr = String(args.new_string ?? args.replace ?? "");
        const replaceAll = args.replace_all === true;
        const resolved = path.resolve(cwd, filePath);
        if (!existsSync(resolved)) return { result: `File not found: ${filePath}`, isError: true };
        const orig = readFileSync(resolved, "utf-8");
        if (!orig.includes(oldStr)) return { result: "old_string not found in file", isError: true };
        const count = orig.split(oldStr).length - 1;
        if (count > 1 && !replaceAll) {
          return {
            result: `Found ${count} matches for old_string. Use replace_all: true to replace all.`,
            isError: true,
          };
        }
        const replaced = replaceAll ? orig.replaceAll(oldStr, newStr) : orig.replace(oldStr, newStr);
        writeFileSync(resolved, replaced, "utf-8");
        return { result: `Replaced ${replaceAll ? count : 1} occurrence(s) in ${filePath}`, isError: false };
      }
      case "bash": {
        const cmd = String(args.command ?? args.cmd ?? "");
        if (!cmd.trim()) return { result: "bash: empty command", isError: true };
        if (cmd.length > 10_000) return { result: "bash: command too long (max 10k chars)", isError: true };
        const dangers = detectBashDangers(cmd);
        if (dangers.length > 0) {
          return { result: `bash: dangerous command blocked: ${dangers.join("; ")}`, isError: true };
        }
        try {
          const output = execSync(cmd, {
            cwd,
            timeout: 30_000,
            encoding: "utf-8",
            maxBuffer: 1024 * 1024,
            stdio: ["pipe", "pipe", "pipe"],
            shell: process.platform === "win32" ? (process.env.ComSpec ?? "powershell.exe") : "/bin/bash",
          });
          return { result: output.slice(0, 10_000), isError: false };
        } catch (err: unknown) {
          return {
            result: (err as { stderr?: string; message?: string }).stderr ?? (err as Error).message,
            isError: true,
          };
        }
      }
      case "grep": {
        const pattern = String(args.pattern ?? "");
        if (!pattern.trim()) return { result: "grep: empty pattern", isError: true };
        const rawDir = String(args.path ?? cwd);
        const resolvedDir = path.resolve(cwd, rawDir);
        if (!resolvedDir.startsWith(cwd + path.sep) && resolvedDir !== cwd) {
          return { result: "grep: path outside project directory", isError: true };
        }
        if (rgAvailable()) {
          try {
            const out = execSync(`rg --no-heading -n ${JSON.stringify(pattern)} ${JSON.stringify(resolvedDir)}`, {
              cwd,
              timeout: 10_000,
              encoding: "utf-8",
              maxBuffer: 1024 * 1024,
            });
            return { result: out.slice(0, 10_000) || "(no matches)", isError: false };
          } catch {
            return { result: "(no matches)", isError: false };
          }
        }
        // JS-native fallback
        const results: string[] = [];
        const MAX = 500;
        const lower = pattern.toLowerCase();
        const walk = (dir: string, parentIgnores: RegExp[]) => {
          if (results.length >= MAX) return;
          let entries: string[];
          try {
            entries = readdirSync(dir);
          } catch {
            return;
          }
          const gitignorePath = path.join(dir, ".gitignore");
          const localIgnores = parseGitignore(gitignorePath);
          const ignores = parentIgnores.concat(localIgnores);
          for (const entry of entries) {
            if (results.length >= MAX) return;
            if (ignores.some((r) => r.test(entry))) continue;
            const fp = path.join(dir, entry);
            let st: ReturnType<typeof statSync>;
            try {
              st = statSync(fp);
            } catch {
              continue;
            }
            if (st.isDirectory()) {
              if (!entry.startsWith(".") && entry !== "node_modules" && entry !== ".git") walk(fp, ignores);
            } else if (st.isFile() && st.size < 512 * 1024) {
              const ext = path.extname(entry).toLowerCase();
              if ([".exe", ".dll", ".png", ".jpg", ".zip", ".gz", ".woff", ".ico"].includes(ext)) continue;
              try {
                const content = readFileSync(fp, "utf-8");
                const lines = content.split("\n");
                for (let i = 0; i < lines.length && results.length < MAX; i++) {
                  if (lines[i]!.toLowerCase().includes(lower)) {
                    results.push(`${path.relative(cwd, fp)}:${i + 1}:${lines[i]!.trim().slice(0, 200)}`);
                  }
                }
              } catch {
                /* skip unreadable */
              }
            }
          }
        };
        try {
          walk(resolvedDir, []);
        } catch {
          /* walk failed */
        }
        return { result: results.length > 0 ? results.join("\n").slice(0, 10_000) : "(no matches)", isError: false };
      }
      case "find": {
        const pattern = String(args.pattern ?? "*");
        const dir = String(args.path ?? cwd);
        const results: string[] = [];
        const walkDir = (d: string, depth: number) => {
          if (depth > 8) return;
          try {
            for (const entry of readdirSync(d, { withFileTypes: true })) {
              const full = path.join(d, entry.name);
              if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules")
                walkDir(full, depth + 1);
              else if (entry.isFile() && entry.name.includes(pattern.replace(/\*/g, ""))) {
                results.push(full);
                if (results.length >= 200) return;
              }
            }
          } catch {
            /* skip */
          }
        };
        walkDir(path.resolve(cwd, dir), 0);
        return { result: results.join("\n") || "(no files)", isError: false };
      }
      case "lsp_diagnostics": {
        try {
          // @ts-ignore — optional workspace dep
          const { DiagnosticsRunner } = await import("@kestrel/lsp");
          const runner = new DiagnosticsRunner();
          const diagResult = await runner.checkTypeScript({ cwd });
          const lines = [
            `TypeScript diagnostics: ${diagResult.errorCount} errors, ${diagResult.warningCount} warnings in ${diagResult.filesChecked} files`,
            ...diagResult.diagnostics
              .slice(0, 50)
              .map(
                (d: { file: string; line: number; column: number; severity: string; code: string; message: string }) =>
                  `${d.file}:${d.line}:${d.column}: ${d.severity} ${d.code}: ${d.message}`,
              ),
          ];
          return { result: lines.join("\n"), isError: false };
        } catch (err: unknown) {
          return { result: `lsp_diagnostics: ${(err as Error).message}`, isError: true };
        }
      }
      case "memory_search": {
        const query = String(args.query ?? args.q ?? "");
        if (!query.trim()) return { result: "memory_search: empty query", isError: true };
        try {
          // @ts-ignore — optional workspace dep
          const { MemoryEngine } = await import("@kestrel/memory");
          const engine = new MemoryEngine(cwd);
          const results = engine.search(query);
          if (results.length === 0) return { result: "(no memories found)", isError: false };
          return { result: results.map((r: any) => `[${r.type}] ${r.name}: ${r.snippet}`).join("\n"), isError: false };
        } catch (err: unknown) {
          return { result: `memory_search: ${(err as Error).message}`, isError: true };
        }
      }
      case "task_create": {
        const title = String(args.title ?? "");
        if (!title.trim()) return { result: "task_create: title required", isError: true };
        try {
          // @ts-ignore — optional workspace dep
          const { KestrelDatabase, TaskRepo, TaskTimeline } = await import("@kestrel/storage");
          const db = await KestrelDatabase.create({ memory: false });
          const repo = new TaskRepo(db.db);
          const task = repo.create({
            title,
            kind: String(args.kind ?? "general"),
            workspaceId: cwd,
            input: args.input,
          });
          // KCP-0402: Emit task_events timeline
          try {
            const timeline = new TaskTimeline(db.db);
            timeline.record({ taskId: task.id, toStatus: task.status, detail: `title=${title}` });
          } catch {
            /* non-blocking */
          }
          return { result: `Task created: ${task.id} [${task.status}] ${task.title}`, isError: false };
        } catch (err: unknown) {
          return { result: `task_create: ${(err as Error).message}`, isError: true };
        }
      }
      case "git_status": {
        try {
          const out = execSync("git status --short", {
            cwd,
            encoding: "utf-8",
            timeout: 10_000,
            stdio: ["pipe", "pipe", "pipe"],
          });
          return { result: out.trim() || "(clean working tree)", isError: false };
        } catch (err: unknown) {
          return { result: `git_status: ${(err as Error).message}`, isError: true };
        }
      }
      case "git_diff": {
        const staged = args.staged ?? args.cached ?? false;
        try {
          const cmd = staged ? "git diff --staged" : "git diff";
          const out = execSync(cmd, {
            cwd,
            encoding: "utf-8",
            timeout: 15_000,
            maxBuffer: 1024 * 1024,
            stdio: ["pipe", "pipe", "pipe"],
          });
          return { result: out.slice(0, 12_000) || "(no changes)", isError: false };
        } catch (err: unknown) {
          return { result: `git_diff: ${(err as Error).message}`, isError: true };
        }
      }
      case "git_log": {
        const count = Number(args.count ?? args.n ?? 10);
        try {
          const out = execSync(`git log --oneline -n ${count}`, {
            cwd,
            encoding: "utf-8",
            timeout: 10_000,
            stdio: ["pipe", "pipe", "pipe"],
          });
          return { result: out.trim() || "(no commits)", isError: false };
        } catch (err: unknown) {
          return { result: `git_log: ${(err as Error).message}`, isError: true };
        }
      }
      case "git_blame": {
        const filePath = String(args.path ?? args.file ?? "");
        if (!filePath.trim()) return { result: "git_blame: file path required", isError: true };
        try {
          const out = execSync(`git blame -- ${JSON.stringify(filePath)}`, {
            cwd,
            encoding: "utf-8",
            timeout: 10_000,
            stdio: ["pipe", "pipe", "pipe"],
          });
          return { result: out.slice(0, 8_000), isError: false };
        } catch (err: unknown) {
          return { result: `git_blame: ${(err as Error).message}`, isError: true };
        }
      }
      case "git_commit": {
        const message = String(args.message ?? "");
        const files = String(args.files ?? ".");
        if (!message.trim()) return { result: "git_commit: message required", isError: true };
        try {
          execSync(`git add ${files}`, { cwd, encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] });
          const out = execSync(`git commit -m ${JSON.stringify(message)}`, {
            cwd,
            encoding: "utf-8",
            timeout: 15_000,
            stdio: ["pipe", "pipe", "pipe"],
          });
          return { result: out.trim() || "Commit created successfully.", isError: false };
        } catch (err: unknown) {
          return { result: `git_commit: ${(err as Error).message}`, isError: true };
        }
      }
      case "pr_create": {
        const title = String(args.title ?? "");
        const body = String(args.body ?? "");
        const base = String(args.base ?? "main");
        if (!title.trim()) return { result: "pr_create: title required", isError: true };
        try {
          const branchSlug = title
            .slice(0, 40)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
          const branch = `kestrel/${branchSlug}`;
          execSync(`git checkout -b ${branch}`, {
            cwd,
            encoding: "utf-8",
            timeout: 10_000,
            stdio: ["pipe", "pipe", "pipe"],
          });
          execSync("git add .", { cwd, encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] });
          execSync(`git commit -m ${JSON.stringify(title)}${body ? ` -m ${JSON.stringify(body)}` : ""}`, {
            cwd,
            encoding: "utf-8",
            timeout: 15_000,
            stdio: ["pipe", "pipe", "pipe"],
          });
          execSync(`git push -u origin ${branch}`, {
            cwd,
            encoding: "utf-8",
            timeout: 30_000,
            stdio: ["pipe", "pipe", "pipe"],
          });
          const prCmd = `gh pr create --title ${JSON.stringify(title)} --base ${base} --head ${branch}${body ? ` --body ${JSON.stringify(body)}` : ""}`;
          const out = execSync(prCmd, { cwd, encoding: "utf-8", timeout: 15_000, stdio: ["pipe", "pipe", "pipe"] });
          return { result: out.trim() || "PR created successfully.", isError: false };
        } catch (err: unknown) {
          return { result: `pr_create: ${(err as Error).message}`, isError: true };
        }
      }
      case "skill_create": {
        const name = String(args.name ?? "").trim();
        if (!name.match(/^[a-z0-9-]+$/))
          return { result: "skill_create: name must be kebab-case (a-z, 0-9, -)", isError: true };
        const desc = String(args.description ?? "").slice(0, 200);
        const skillDir = path.join(cwd, ".kestrel", "skills", name);
        if (existsSync(skillDir)) return { result: `skill_create: "${name}" already exists`, isError: true };
        try {
          mkdirSync(skillDir, { recursive: true });
          const manifest = {
            name,
            version: "0.0.1",
            description: desc || `Auto-created skill: ${name}`,
            permissions: ["read"],
            tools: [],
            riskLevel: "low",
            createdBy: "agent",
            reviewStatus: "pending",
          };
          writeFileSync(path.join(skillDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");
          writeFileSync(
            path.join(skillDir, "SKILL.md"),
            `# ${name}\n\n${desc || "Skill description"}\n\n## Usage\n\nTBD\n`,
            "utf-8",
          );
          return {
            result: `Skill "${name}" created at .kestrel/skills/${name}/ (manifest.json + SKILL.md)`,
            isError: false,
          };
        } catch (err: unknown) {
          return { result: `skill_create: ${(err as Error).message}`, isError: true };
        }
      }
      case "web_fetch": {
        const url = String(args.url ?? "");
        if (!url.trim()) return { result: "web_fetch: url required", isError: true };
        if (!/^https?:\/\//i.test(url)) return { result: "web_fetch: only http/https urls supported", isError: true };
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
          const text = await res.text();
          return { result: text.slice(0, 50_000), isError: false };
        } catch (err: unknown) {
          return { result: `web_fetch: ${(err as Error).message}`, isError: true };
        }
      }
      default: {
        // MCP tool delegation
        if (ctx.mcpClient && name.startsWith("mcp_")) {
          try {
            const mcpResult = await ctx.mcpClient.callTool(name.slice(4), args);
            const text = mcpResult.content
              .filter((c) => c.type === "text")
              .map((c) => c.text ?? "")
              .join("\n");
            return { result: text || JSON.stringify(mcpResult.content), isError: mcpResult.isError === true };
          } catch (err: unknown) {
            return { result: `MCP error: ${(err as Error).message}`, isError: true };
          }
        }
        return { result: `Tool not implemented: ${name}`, isError: true };
      }
    }
  }

  return { execute };
}

// ---- helpers ----

function parseGitignore(gitignorePath: string): RegExp[] {
  const patterns: RegExp[] = [];
  try {
    const raw = readFileSync(gitignorePath, "utf-8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      let re = trimmed
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "«GLOBSTAR»")
        .replace(/\*/g, "[^/\\\\]*")
        .replace(/«GLOBSTAR»/g, ".*")
        .replace(/\?/g, ".");
      if (re.startsWith("/")) re = `^${re.slice(1)}`;
      else re = `(^|/)${re}`;
      try {
        patterns.push(new RegExp(re));
      } catch {
        /* invalid regex */
      }
    }
  } catch {
    /* no .gitignore */
  }
  return patterns;
}

function detectBashDangers(cmd: string): string[] {
  const dangers: string[] = [];
  const lower = cmd.toLowerCase();
  if (lower.includes("rm -rf /")) dangers.push("rm -rf / blocked");
  if (lower.includes("mkfs.")) dangers.push("mkfs blocked");
  if (lower.includes(":(){ ")) dangers.push("fork bomb pattern blocked");
  if (lower.includes("dd if=") && lower.includes("of=/dev/")) dangers.push("dd to device blocked");
  if (lower.includes("> /dev/sd")) dangers.push("write to block device blocked");
  return dangers;
}
