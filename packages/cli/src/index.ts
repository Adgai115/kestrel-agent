/**
 * @kestrel/cli — Kestrel Agent CLI entry point.
 *
 * Subcommands:
 *   kestrel chat           Start interactive session
 *   kestrel gateway start  Start the Gateway daemon
 *   kestrel gateway status Gateway health check
 *   kestrel task list      List pending tasks
 *   kestrel memory search  Search memories
 *   kestrel skill list     List loaded skills
 *   kestrel doctor         System health check
 */

export const KESTREL_CLI_VERSION = "0.4.0";

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Walk up from startDir to find workspace root (has pnpm-workspace.yaml). */
export function resolveProjectRoot(startDir?: string): string {
  let dir = resolve(startDir ?? process.cwd());
  const root = dirname(dir); // filesystem root guard
  while (dir !== root) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  return startDir ?? process.cwd();
}

export interface CliArgs {
  command: string;
  subcommand?: string;
  args: string[];
}

/** Parse CLI arguments into structured form. */
export function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  if (args.length === 0) {
    return { command: "chat", args: [] };
  }

  // --version / -V flag
  if (args[0] === "--version" || args[0] === "-V") {
    return { command: "version", args: [] };
  }

  const command = args[0]!;
  const rest = args.slice(1);

  if (
    ["gateway", "task", "memory", "skill", "cron", "queue", "session", "review", "timeline", "version"].includes(
      command,
    )
  ) {
    return { command, subcommand: rest[0], args: rest.slice(1) };
  }

  return { command, args: rest };
}

/** Print help text. */
export function printHelp(): string {
  return `Kestrel Agent CLI v${KESTREL_CLI_VERSION}

用法: kestrel <command> [options]

命令:
  chat              启动交互式会话 (默认)
  gateway start     启动 Gateway 服务
  gateway restart   重启 Gateway (--verify 等待就绪)
  gateway status    检查 Gateway 状态
  doctor --deep     深度系统健康检查
  task list         列出待处理任务
  task cancel <id>  取消任务
  memory search <q> 搜索记忆
  skill list        列出已加载技能
  cron start         启动定时任务
  cron list          列出定时任务
  cron add <名称> <时间> <命令>  添加定时任务
  cron remove <id>   移除定时任务
  session list       列出最近会话
  session create [名称] 创建新会话
  session load <id>  加载会话 (含消息)
  session archive <id> 归档会话
  queue inbox|outbox|dead [N]  查看通道队列
  timeline recent [N]  最近审计事件
  timeline session <id> 会话审计回放
  review list        列出待审记忆提案
  review accept <名称> <审核人>  接受提案
  review reject <名称> <审核人>  拒绝提案
  version            显示版本
  doctor             系统健康检查
  help               显示帮助
`;
}

/**
 * Start an interactive chat session via ConversationLoop.
 * Requires KESTREL_API_KEY in environment or .env file.
 */
export async function chat(prompt?: string, providedAdapter?: any): Promise<string> {
  try {
    const { ConversationLoop, loadConfig } = await import("@kestrel/core");
    const cfg = loadConfig();
    const adapter =
      providedAdapter ??
      new ConversationLoop({
        apiKey: cfg.apiKey,
        model: cfg.model,
        maxTurns: cfg.maxTurns,
      });
    const shouldDispose = !providedAdapter;

    if (!providedAdapter) {
      await adapter.start();
    }

    let output = "";
    const unsub = adapter.onEvent((event: { type: string; text?: string; message?: string }) => {
      if (event.type === "text_delta") output += event.text;
      else if (event.type === "error") output += `\nError: ${event.message}`;
    });

    if (prompt) {
      await adapter.prompt(prompt);
    }

    unsub();
    if (shouldDispose) adapter.dispose();
    return output || "Chat session started (no prompt provided)";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Chat error: ${msg}`;
  }
}

/**
 * Main CLI entry point (synchronous shell).
 * For interactive chat, use chat() function.
 */
export async function main(argv: string[]): Promise<{ code: number; output: string }> {
  // TASK-0360: Load .env from project root before reading config
  try {
    process.loadEnvFile?.(resolve(resolveProjectRoot(), ".env"));
  } catch {
    /* optional */
  }

  const args = parseArgs(argv);

  // TASK-1083: --no-tty pipe mode for scripting
  if (args.command === "chat" && (argv.includes("--no-tty") || !process.stdout.isTTY)) {
    const input = args.command === "chat" ? args.args.join(" ") : "";
    const result = await chat(input || undefined);
    return { code: 0, output: result };
  }

  switch (args.command) {
    case "chat":
      return {
        code: 0,
        output: "Starting Kestrel chat...\nRun chat() from programmatic API for interactive sessions.",
      };

    case "gateway": {
      if (args.subcommand === "start") {
        try {
          const { KestrelGateway } = await import("@kestrel/gateway");
          const projectRoot = resolveProjectRoot();
          try {
            process.loadEnvFile?.(join(projectRoot, ".env"));
          } catch {
            /* optional */
          }
          const port = Number.parseInt(process.env.KESTREL_GATEWAY_PORT ?? process.env.KESTREL_PORT ?? "3100", 10);
          const token = process.env.KESTREL_GATEWAY_TOKEN ?? process.env.KESTREL_TOKEN ?? undefined;
          const host = process.env.KESTREL_GATEWAY_HOST ?? "127.0.0.1";
          const gateway = new KestrelGateway({ port, token, host });
          await gateway.start();
          // Write token to .kestrel/gateway-token for Web Console
          const tokenDir = join(projectRoot, ".kestrel");
          mkdirSync(tokenDir, { recursive: true });
          writeFileSync(join(tokenDir, "gateway-token"), gateway.config.token, "utf-8");
          console.log(`Token: ${gateway.config.token.slice(0, 8)}... (完整 token 已保存到 .kestrel/gateway-token)`);
          return { code: 0, output: "" };
        } catch (err) {
          return { code: 1, output: `Gateway start failed: ${(err as Error).message}` };
        }
      }
      if (args.subcommand === "restart") {
        const verify = args.args.includes("--verify");
        try {
          const { KestrelGateway } = await import("@kestrel/gateway");
          const projectRoot = resolveProjectRoot();
          try {
            process.loadEnvFile?.(join(projectRoot, ".env"));
          } catch {
            /* optional */
          }
          const port = Number.parseInt(process.env.KESTREL_GATEWAY_PORT ?? process.env.KESTREL_PORT ?? "3100", 10);
          const token = process.env.KESTREL_GATEWAY_TOKEN ?? process.env.KESTREL_TOKEN ?? undefined;
          const host = process.env.KESTREL_GATEWAY_HOST ?? "127.0.0.1";
          const gateway = new KestrelGateway({ port, token, host });
          await gateway.restart();
          const tokenDir = join(projectRoot, ".kestrel");
          mkdirSync(tokenDir, { recursive: true });
          writeFileSync(join(tokenDir, "gateway-token"), gateway.config.token, "utf-8");

          if (verify) {
            // Poll /ready until ok (max 10s)
            const deadline = Date.now() + 10_000;
            let ok = false;
            while (Date.now() < deadline) {
              try {
                const res = await fetch(`http://${host}:${port}/ready`);
                if (res.ok && ((await res.json()) as { status: string }).status === "ok") {
                  ok = true;
                  break;
                }
              } catch {
                /* retry */
              }
              await new Promise((r) => setTimeout(r, 300));
            }
            if (!ok) return { code: 1, output: "Gateway restarted but /ready check timed out (10s)" };
            return { code: 0, output: "Gateway restarted and verified OK" };
          }
          return { code: 0, output: "Gateway restarted" };
        } catch (err) {
          return { code: 1, output: `Gateway restart failed: ${(err as Error).message}` };
        }
      }
      // gateway status (default)
      try {
        const res = await fetch("http://127.0.0.1:3100/health");
        const body = (await res.json()) as { status: string; uptime: number; sessions: number; version: string };
        const uptimeS = Math.floor(body.uptime / 1000);
        const m = Math.floor(uptimeS / 60);
        const h = Math.floor(m / 60);
        const uptimeStr = h > 0 ? `${h}h ${m % 60}m` : m > 0 ? `${m}m ${uptimeS % 60}s` : `${uptimeS}s`;
        const lines = [
          "Kestrel Gateway",
          "───────────────",
          `  Status:   ${body.status}`,
          `  Version:  ${body.version}`,
          `  Uptime:   ${uptimeStr}`,
          `  Sessions: ${body.sessions}`,
        ];
        return { code: 0, output: lines.join("\n") };
      } catch {
        return { code: 1, output: "Gateway not running (http://127.0.0.1:3100)" };
      }
    }

    case "task": {
      try {
        const { KestrelDatabase, TaskRepo } = await import("@kestrel/storage");
        const db = await KestrelDatabase.create({ memory: false });
        const repo = new TaskRepo(db.db);
        try {
          if (args.subcommand === "cancel") {
            const taskId = args.args[0];
            if (!taskId) return { code: 1, output: "Usage: kestrel task cancel <id>" };
            repo.updateStatus(taskId, "cancelled");
            return { code: 0, output: `Task ${taskId} cancelled.` };
          }
          // list (default)
          const tasks = repo.listPending(20);
          if (tasks.length === 0) return { code: 0, output: "(no tasks)" };
          return {
            code: 0,
            output: tasks.map((t: { status: string; title: string }) => `[${t.status}] ${t.title}`).join("\n"),
          };
        } finally {
          db.close();
        }
      } catch (err) {
        return { code: 1, output: `Task error: ${(err as Error).message}` };
      }
    }

    case "memory": {
      try {
        const { MemoryEngine } = await import("@kestrel/memory");
        const engine = new MemoryEngine(resolveProjectRoot());
        const results = await engine.search(args.args.join(" ") || ".*");
        if (results.length === 0) return { code: 0, output: "(no results)" };
        return {
          code: 0,
          output: results.map((m) => `[${m.type}] ${m.name}: ${m.snippet.slice(0, 120)}`).join("\n"),
        };
      } catch (err) {
        return { code: 1, output: `Memory search failed: ${(err as Error).message}` };
      }
    }

    case "cron": {
      try {
        const { CronScheduler } = await import("@kestrel/core");
        const scheduler = new CronScheduler();

        if (args.subcommand === "start") {
          scheduler.start();
          return { code: 0, output: "Cron daemon started. Press Ctrl+C to stop." };
        }
        if (args.subcommand === "add") {
          const [name, schedule, ...cmdParts] = args.args;
          if (!name || !schedule || cmdParts.length === 0) {
            return { code: 1, output: "Usage: kestrel cron add <name> <schedule> <command>" };
          }
          const id = scheduler.add(name, schedule, cmdParts.join(" "));
          const job = scheduler.get(id)!;
          return {
            code: 0,
            output: `Job added: ${job.id}\n  Name: ${name}\n  Schedule: ${schedule} → ${job.cronExpression}\n  Command: ${job.command}`,
          };
        }
        if (args.subcommand === "remove") {
          const id = args.args[0];
          if (!id) return { code: 1, output: "Usage: kestrel cron remove <id>" };
          const removed = scheduler.remove(id);
          return removed ? { code: 0, output: `Removed: ${id}` } : { code: 1, output: `Not found: ${id}` };
        }
        // KCP-0603: show job details
        if (args.subcommand === "show") {
          const id = args.args[0];
          if (!id) return { code: 1, output: "Usage: kestrel cron show <id>" };
          const job = scheduler.get(id);
          if (!job) return { code: 1, output: `Not found: ${id}` };
          return {
            code: 0,
            output: `[${job.id}] ${job.name}\n  Schedule: ${job.schedule}\n  Command: ${job.command}\n  Runs: ${job.runCount}`,
          };
        }
        // KCP-0603: run job immediately
        if (args.subcommand === "run") {
          const id = args.args[0];
          if (!id) return { code: 1, output: "Usage: kestrel cron run <id>" };
          const job = scheduler.get(id);
          if (!job) return { code: 1, output: `Not found: ${id}` };
          return {
            code: 0,
            output: `Job: ${job.name} (${id})\n  Command: ${job.command}\n  Next run: ${job.nextRun ?? "not scheduled"}\n  Run the command manually or wait for next scheduled run.`,
          };
        }
        // KCP-0603: list missed runs
        if (args.subcommand === "missed") {
          try {
            const { KestrelDatabase } = await import("@kestrel/storage");
            const db = await KestrelDatabase.create({ memory: false });
            try {
              const rows = db.db.exec(
                "SELECT * FROM cron_missed_runs WHERE handled=0 ORDER BY scheduled_at DESC LIMIT 50",
              );
              if (!rows.length) return { code: 0, output: "(no missed runs)" };
              const vals = rows[0]!.values;
              return { code: 0, output: vals.map((r) => `job=${r[1]} scheduled=${r[2]} detected=${r[3]}`).join("\n") };
            } finally {
              db.close();
            }
          } catch (err) {
            return { code: 1, output: `Missed query failed: ${(err as Error).message}` };
          }
        }
        // list (default)
        const jobs = scheduler.list();
        if (jobs.length === 0) return { code: 0, output: "(no cron jobs)" };
        return {
          code: 0,
          output: jobs
            .map((j) => `[${j.id}] ${j.name}: ${j.schedule} → ${j.cronExpression} | runs: ${j.runCount}`)
            .join("\n"),
        };
      } catch (err) {
        return { code: 1, output: `Cron error: ${(err as Error).message}` };
      }
    }

    // KCP-0505: Channel queue inspection
    case "queue": {
      try {
        const { KestrelDatabase } = await import("@kestrel/storage");
        const db = await KestrelDatabase.create({ memory: false });
        try {
          const rawSub = args.subcommand ?? "inbox";
          const sub = rawSub === "list" ? "inbox" : rawSub;
          const limit = Number.parseInt(args.args[0] ?? "20", 10);
          if (!["inbox", "outbox", "dead"].includes(sub)) {
            return { code: 1, output: "Usage: kestrel queue <inbox|outbox|dead> [limit]" };
          }
          const table = sub === "inbox" ? "channel_inbox" : sub === "outbox" ? "channel_outbox" : "channel_dead_letter";
          const rows = db.db.exec(`SELECT * FROM ${table} ORDER BY created_at DESC LIMIT ${limit}`);
          if (!rows.length) return { code: 0, output: `(no ${sub} messages)` };
          return {
            code: 0,
            output: rows[0]!.values
              .map((r) => `[${r[0]}] ${r[1] ?? r[2]}: ${String(r[3] ?? r[4] ?? "").slice(0, 80)}`)
              .join("\n"),
          };
        } finally {
          db.close();
        }
      } catch (err) {
        return { code: 1, output: `Queue error: ${(err as Error).message}` };
      }
    }

    case "skill": {
      try {
        const { SkillRegistry } = await import("@kestrel/skills");
        const root = resolveProjectRoot();
        const reg = new SkillRegistry({ skillsDir: `${root}/.kestrel/skills` });
        reg.load();
        const skills = reg.list();
        if (skills.length === 0) return { code: 0, output: "(no skills loaded)" };
        return {
          code: 0,
          output: skills
            .map(
              (s: { manifest: { name: string; version: string; description: string } }) =>
                `${s.manifest.name} v${s.manifest.version} — ${s.manifest.description}`,
            )
            .join("\n"),
        };
      } catch (err) {
        return { code: 1, output: `Skill error: ${(err as Error).message}` };
      }
    }

    case "doctor": {
      const deep = args.args.includes("--deep");
      const root = resolveProjectRoot();
      const checks: string[] = [];
      const errors: string[] = [];

      // ---- basic checks ----
      checks.push(`Node: ${process.version}`);
      checks.push(`Platform: ${process.platform} ${process.arch}`);
      checks.push(`Project root: ${root}`);
      checks.push(`Workspace: ${existsSync(resolve(root, "pnpm-workspace.yaml")) ? "OK" : "MISSING"}`);

      const envPath = resolve(root, ".env");
      const hasEnv = existsSync(envPath);
      checks.push(`.env: ${hasEnv ? "present" : "missing (copy .env.example)"}`);

      const provider = process.env.KESTREL_PROVIDER ?? "deepseek";
      const model = process.env.KESTREL_MODEL ?? "deepseek-v4-pro";
      const apiKey = process.env.KESTREL_API_KEY ?? "";
      const hasKey = apiKey.length > 10 && !apiKey.includes("your-key");
      checks.push(`API: ${provider}/${model} ${hasKey ? "key=OK" : "key=missing/invalid"}`);

      const corePkg = resolve(root, "packages", "core", "package.json");
      checks.push(`Core package: ${existsSync(corePkg) ? "OK" : "MISSING"}`);

      // ---- deep checks ----
      if (deep) {
        // Runtime identity
        try {
          const { getRuntimeIdentity } = await import("@kestrel/core");
          const id = getRuntimeIdentity();
          checks.push(`Identity: machine=${id.machineId} instance=${id.instanceId} host=${id.host}`);
        } catch {
          errors.push("Identity: unavailable");
        }

        // Package integrity — check all workspace packages
        const pkgDirs = [
          "core",
          "cli",
          "gateway",
          "storage",
          "permissions",
          "sandbox",
          "channels",
          "memory",
          "tasks",
          "skills",
          "tools",
          "lsp",
          "mcp",
          "observability",
          "web-console",
        ];
        const missingPkgs: string[] = [];
        for (const d of pkgDirs) {
          if (!existsSync(resolve(root, "packages", d, "package.json"))) {
            missingPkgs.push(d);
          }
        }
        checks.push(
          `Packages: ${missingPkgs.length === 0 ? `${pkgDirs.length}/OK` : `MISSING: ${missingPkgs.join(", ")}`}`,
        );
        if (missingPkgs.length) errors.push(`Missing packages: ${missingPkgs.join(", ")}`);

        // Disk space
        try {
          const { execSync } = await import("node:child_process");
          const isWin = process.platform === "win32";
          if (isWin) {
            const drive = root.slice(0, 1);
            const out = execSync(`wmic logicaldisk where "DeviceID='${drive}:'" get FreeSpace,Size /format:csv`, {
              encoding: "utf8",
              timeout: 5000,
            });
            const lines = out.trim().split("\n").filter(Boolean);
            if (lines.length > 1) {
              const parts = lines[1]!.split(",");
              const free = Number(parts[parts.length - 2]) / 1024 ** 3;
              const total = Number(parts[parts.length - 1]) / 1024 ** 3;
              checks.push(`Disk: ${free.toFixed(1)}G free / ${total.toFixed(1)}G total`);
            }
          } else {
            const out = execSync("df -h .", { encoding: "utf8", timeout: 5000 });
            const lines = out.trim().split("\n");
            if (lines.length > 1) checks.push(`Disk: ${lines[1]!.split(/\s+/).slice(2, 4).join(" ")}`);
          }
        } catch (e) {
          checks.push("Disk: check failed");
        }
      }

      const exitCode = errors.length > 0 ? 1 : 0;
      const result = checks.join("\n") + (errors.length > 0 ? `\n\nErrors:\n${errors.join("\n")}` : "");
      return { code: exitCode, output: result };
    }

    // KCP-0403: Session manager CLI
    case "session": {
      try {
        const { KestrelDatabase, SessionRepo, MessageRepo } = await import("@kestrel/storage");
        const db = await KestrelDatabase.create({ memory: false });
        try {
          const sessionRepo = new SessionRepo(db.db);
          const messageRepo = new MessageRepo(db.db);
          const workspaceId = resolveProjectRoot();

          if (args.subcommand === "create") {
            const name = args.args[0];
            const s = sessionRepo.create({ workspaceId, name });
            return {
              code: 0,
              output: `Session created: ${s.id}\n  Name: ${s.name ?? "(unnamed)"}\n  Status: ${s.status}`,
            };
          }
          if (args.subcommand === "load") {
            const id = args.args[0];
            if (!id) return { code: 1, output: "Usage: kestrel session load <id>" };
            const s = sessionRepo.getById(id);
            if (!s) return { code: 1, output: `Session not found: ${id}` };
            const msgs = messageRepo.getBySession(id, 100);
            const lines = [
              `Session: ${s.id}`,
              `  Name: ${s.name ?? "(unnamed)"}`,
              `  Status: ${s.status}`,
              `  Workspace: ${s.workspace_id}`,
              `  Messages: ${msgs.length}`,
              `  Created: ${s.created_at}`,
              `  Updated: ${s.updated_at}`,
            ];
            if (msgs.length > 0) {
              lines.push("", "Messages:");
              for (const m of msgs) {
                const role = m.role === "user" ? "User" : m.role === "assistant" ? "Agent" : m.role;
                const content = String(m.content ?? "").slice(0, 120);
                if (content) lines.push(`  [${role}] ${content}`);
              }
            }
            return { code: 0, output: lines.join("\n") };
          }
          if (args.subcommand === "archive") {
            const id = args.args[0];
            if (!id) return { code: 1, output: "Usage: kestrel session archive <id>" };
            sessionRepo.update(id, { status: "archived" });
            return { code: 0, output: `Session archived: ${id}` };
          }
          // list (default)
          const sessions = sessionRepo.list(workspaceId, 20);
          if (sessions.length === 0) return { code: 0, output: "(no sessions)" };
          return {
            code: 0,
            output: sessions
              .map(
                (s) =>
                  `[${s.id.slice(0, 8)}] ${s.name ?? "(unnamed)"}  status=${s.status}  msgs=${s.message_count}  updated=${s.updated_at}`,
              )
              .join("\n"),
          };
        } finally {
          db.close();
        }
      } catch (err) {
        return { code: 1, output: `Session error: ${(err as Error).message}` };
      }
    }

    // KCP-0801: Timeline CLI
    case "timeline": {
      try {
        const { KestrelDatabase, AuditRepo } = await import("@kestrel/storage");
        const db = await KestrelDatabase.create({ memory: false });
        try {
          const auditRepo = new AuditRepo(db.db);

          if (args.subcommand === "session") {
            const id = args.args[0];
            if (!id) return { code: 1, output: "Usage: kestrel timeline session <id>" };
            const events = auditRepo.replay(id, 100);
            if (events.length === 0) return { code: 0, output: "(no events for this session)" };
            return {
              code: 0,
              output: events
                .map(
                  (e) =>
                    `[${e.ts}] ${e.level} ${e.event}${e.tool ? ` tool=${e.tool}` : ""}${e.detail ? ` ${e.detail.slice(0, 80)}` : ""}`,
                )
                .join("\n"),
            };
          }
          // recent (default)
          const limit = Number.parseInt(args.args[0] ?? "20", 10);
          const events = auditRepo.query({ limit });
          if (events.length === 0) return { code: 0, output: "(no audit events)" };
          return {
            code: 0,
            output: events
              .map(
                (e) =>
                  `[${e.ts}] ${e.level} ${e.event}${e.session_id ? ` session=${e.session_id.slice(0, 8)}` : ""}${e.tool ? ` tool=${e.tool}` : ""}`,
              )
              .join("\n"),
          };
        } finally {
          db.close();
        }
      } catch (err) {
        return { code: 1, output: `Timeline error: ${(err as Error).message}` };
      }
    }

    // KCP-0705: Review queue CLI
    case "review": {
      try {
        const { MemoryEngine } = await import("@kestrel/memory");
        const engine = new MemoryEngine(resolveProjectRoot());

        if (args.subcommand === "accept" || args.subcommand === "reject") {
          const name = args.args[0];
          const reviewer = args.args[1];
          if (!name || !reviewer) {
            return { code: 1, output: `Usage: kestrel review ${args.subcommand} <name> <reviewer> [reason]` };
          }
          const reason = args.args.slice(2).join(" ");
          const decision = args.subcommand === "accept" ? ("accepted" as const) : ("rejected" as const);
          engine.review({ name, decision, reviewer, reason: reason || undefined });
          const verb = args.subcommand === "accept" ? "Accepted" : "Rejected";
          return { code: 0, output: `${verb}: ${name} (reviewer: ${reviewer})` };
        }
        // list (default)
        const proposals = engine.listPending();
        if (proposals.length === 0) return { code: 0, output: "(no pending proposals)" };
        return {
          code: 0,
          output: proposals
            .map(
              (p) => `[${p.entry.type}] ${p.entry.name} status=${p.status} — ${(p.entry.content ?? "").slice(0, 100)}`,
            )
            .join("\n"),
        };
      } catch (err) {
        return { code: 1, output: `Review error: ${(err as Error).message}` };
      }
    }

    case "version":
      return { code: 0, output: `Kestrel Agent v${KESTREL_CLI_VERSION}` };

    case "help":
      return { code: 0, output: printHelp() };

    default:
      return { code: 1, output: `Unknown command: ${args.command}\n${printHelp()}` };
  }
}

// rg availability cache (probed once to avoid 3s timeout on every grep)
let _rgAvailable: boolean | null = null;

// TASK-1011: Bash dangerous pattern detection for ABAC confirm warnings
function detectBashDangers(cmd: string): string[] {
  const warnings: string[] = [];
  const c = cmd.trim();
  if (!c) return warnings;
  if (/\brm\s+(?:-rf?\s+|--recursive\s+(?:--force\s+)?)\/(?:\*|\s|$)/.test(c))
    warnings.push("rm -rf on filesystem root");
  if (/\bdd\s+if=/.test(c)) warnings.push("dd may overwrite disks");
  if (/:\(\)\s*\{/.test(c) || /\bfork\s+bomb\b/i.test(c)) warnings.push("fork bomb pattern");
  if (/(?:curl|wget)\s+.+\s*\|\s*(?:ba)?sh/.test(c)) warnings.push("curl/wget piped to shell — RCE risk");
  if (/chmod\s+(?:-R\s+)?777\s+\//.test(c)) warnings.push("chmod 777 on root path");
  if (/\bmkfs\./.test(c)) warnings.push("filesystem format (mkfs)");
  if (/\/dev\/sd[a-z]/.test(c) && (/\bdd\b/.test(c) || />\s*\/dev\//.test(c)))
    warnings.push("direct block device access");
  return warnings;
}

/**
 * Interactive REPL — reads stdin line by line, sends to ConversationLoop.
 * Usage: node -e "import { repl } from '@kestrel/cli'; repl()"
 */
export async function repl(): Promise<void> {
  // TASK-0360: Load .env from project root before reading config
  try {
    process.loadEnvFile?.(resolve(resolveProjectRoot(), ".env"));
  } catch {
    /* optional */
  }

  const { style } = await import("./terminal.js");

  const workspace = resolveProjectRoot();
  const model = process.env.KESTREL_MODEL ?? "deepseek-v4-pro";

  // TASK-0101: Create one shared adapter for the whole session
  let adapter: any = null;
  try {
    const { ConversationLoop, loadConfig } = await import("@kestrel/core");
    const { createToolRegistry } = await import("@kestrel/tools");
    const cfg = loadConfig();
    const cwd = resolveProjectRoot();
    const registry = createToolRegistry();

    // ABAC Permission Gate — bridges PermissionEngine to REPL UI for "ask" decisions
    const trustLevel = "local";
    let pendingConfirm: {
      resolve: (v: boolean) => void;
      tool: string;
      risk: string;
      trustLevel: string;
      reason: string;
      args: Record<string, unknown>;
      target?: string;
      warnings?: string[];
      preview?: string;
    } | null = null;
    let PermissionEngineModule: typeof import("@kestrel/permissions") | null = null;
    try {
      PermissionEngineModule = await import("@kestrel/permissions");
    } catch {
      /* permissions not available */
    }

    function getPendingConfirm() {
      if (!pendingConfirm) return null;
      return {
        tool: pendingConfirm.tool,
        risk: pendingConfirm.risk,
        trustLevel: pendingConfirm.trustLevel,
        reason: pendingConfirm.reason,
        target: pendingConfirm.target,
        args: pendingConfirm.args,
        warnings: pendingConfirm.warnings,
        preview: pendingConfirm.preview,
      };
    }
    function respondConfirm(allowed: boolean) {
      pendingConfirm?.resolve(allowed);
      pendingConfirm = null;
    }

    // Tool executor — bridges ConversationLoop to Kestrel's built-in tools
    // KCP-0203: Wire structured audit — create AuditService for tool/conversation auditing
    let auditSvc: any = null;
    const auditSessionId = `cli-${Date.now()}`;
    try {
      const { KestrelDatabase } = await import("@kestrel/storage");
      const db = await KestrelDatabase.create({ memory: true });
      const auditRepo = new (await import("@kestrel/storage")).AuditRepo(db.db);
      const { AuditService } = await import("@kestrel/observability");
      auditSvc = new AuditService({ auditRepo, workspaceId: cwd });
      auditSvc.log("cli.started", `pid=${process.pid} cwd=${cwd}`, auditSessionId);
    } catch {
      /* audit unavailable — non-blocking */
    }

    const toolExecutor = {
      async execute(name: string, args: Record<string, unknown>) {
        // KCP-0203: Audit tool invocation
        if (auditSvc) {
          try {
            const { redactShallow } = await import("@kestrel/core");
            const safeArgs = redactShallow(args);
            auditSvc.log("tool.executed", JSON.stringify({ tool: name, args: safeArgs }).slice(0, 800), auditSessionId);
          } catch {
            /* non-blocking */
          }
        }

        // ABAC permission check for dangerous tools + MCP tools
        const abacTools = [
          "read",
          "write",
          "edit",
          "bash",
          "grep",
          "find",
          "browser",
          "lsp_diagnostics",
          "memory_search",
          "task_create",
          "agent",
          "git_status",
          "git_diff",
          "git_log",
          "git_blame",
          "git_commit",
          "pr_create",
          "skill_create",
          "channel_send",
        ];
        const isMcp = name.startsWith("mcp_");
        if (PermissionEngineModule && (abacTools.includes(name) || isMcp)) {
          const engine = new PermissionEngineModule.PermissionEngine();
          // MCP tools use "bash" risk level since their actual risk is unknown at registration time
          const evalTool = isMcp ? "bash" : name;
          // Extract target path/command for protected-path detection and ConfirmDialog display
          const target = (() => {
            switch (name) {
              case "read":
              case "write":
              case "edit":
                return String(args.path ?? args.file ?? "");
              case "bash":
                return String(args.command ?? args.cmd ?? "");
              case "grep":
              case "find":
                return String(args.path ?? args.pattern ?? "");
              default:
                return undefined;
            }
          })();
          const result = engine.evaluate({
            subject: "local-user",
            channel: "cli",
            tool: evalTool as any,
            target,
          });
          if (result.decision === "deny") {
            return { result: `Tool "${name}" denied: ${result.reason}`, isError: true };
          }
          if (result.decision === "ask") {
            const allowed = await new Promise<boolean>((resolve) => {
              const bashWarnings = name === "bash" ? detectBashDangers(String(args.command ?? args.cmd ?? "")) : [];
              // Build content preview for write/edit/bash tools
              let preview: string | undefined;
              if (name === "write") {
                preview = String(args.content ?? "").slice(0, 300);
              } else if (name === "edit") {
                const oldContent = String(args.old ?? args.oldText ?? "");
                const newContent = String(args.new ?? args.newText ?? args.content ?? "");
                if (oldContent && newContent) {
                  preview = `Replace:\n---\n${oldContent.slice(0, 120)}\n+++\n${newContent.slice(0, 120)}`;
                } else if (newContent) {
                  preview = newContent.slice(0, 300);
                }
              } else if (name === "bash") {
                preview = String(args.command ?? args.cmd ?? "").slice(0, 300);
              }
              pendingConfirm = {
                resolve,
                tool: name,
                risk: result.risk,
                trustLevel: result.trustLevel,
                reason: result.reason,
                args,
                target: result.target,
                warnings: bashWarnings.length > 0 ? bashWarnings : undefined,
                preview,
              };
            });
            if (!allowed) {
              return { result: `Tool "${name}" denied by user`, isError: true };
            }
          }
        }
        // Delegate to shared tool executor for built-in tools (KCP-0303, audit #9)
        if (!["agent", "channel_send"].includes(name) && !name.startsWith("mcp_")) {
          try {
            const { createSharedToolExecutor } = await import("@kestrel/core");
            const sharedExec = createSharedToolExecutor({ cwd, mcpClient: mcpClient ?? undefined });
            return sharedExec.execute(name, args);
          } catch {
            /* fall through to inline switch for fallback */
          }
        }

        // Proceed with tool execution (CLI-specific: agent, channel_send, mcp_*)
        const { readFileSync, writeFileSync, existsSync } = await import("node:fs");
        const { execSync } = await import("node:child_process");
        const path = await import("node:path");

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
            writeFileSync(resolved, content, "utf-8");
            return { result: `Wrote ${content.length} bytes to ${filePath}`, isError: false };
          }
          case "edit": {
            const filePath = String(args.path ?? args.file ?? "");
            const oldStr = String(args.old_string ?? args.find ?? "");
            const newStr = String(args.new_string ?? args.replace ?? "");
            const resolved = path.resolve(cwd, filePath);
            if (!existsSync(resolved)) return { result: `File not found: ${filePath}`, isError: true };
            const orig = readFileSync(resolved, "utf-8");
            if (!orig.includes(oldStr)) return { result: "old_string not found in file", isError: true };
            writeFileSync(resolved, orig.replace(oldStr, newStr), "utf-8");
            return { result: `Replaced 1 occurrence in ${filePath}`, isError: false };
          }
          case "bash": {
            const cmd = String(args.command ?? args.cmd ?? "");
            if (!cmd.trim()) return { result: "bash: empty command", isError: true };
            if (cmd.length > 10_000) return { result: "bash: command too long (max 10k chars)", isError: true };
            // Block critically dangerous commands (rm -rf /, dd, fork bombs)
            const dangers = detectBashDangers(cmd);
            if (dangers.length > 0 && (cmd.includes("rm -rf /") || cmd.includes("mkfs.") || cmd.includes(":(){ "))) {
              return { result: `bash: dangerous command blocked: ${dangers.join("; ")}`, isError: true };
            }
            // Other danger patterns get warned in ConfirmDialog but not blocked
            try {
              const output = execSync(cmd, {
                cwd,
                timeout: 30_000,
                encoding: "utf-8",
                maxBuffer: 1024 * 1024,
                stdio: ["pipe", "pipe", "pipe"],
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
            const { execSync: es } = await import("node:child_process");
            // Probe: try rg first (cached result)
            if (_rgAvailable === null) {
              try {
                es("rg --version", { stdio: ["pipe", "pipe", "pipe"], encoding: "utf-8", timeout: 3000 });
                _rgAvailable = true;
              } catch {
                _rgAvailable = false;
              }
            }
            if (_rgAvailable) {
              try {
                const out = es(`rg --no-heading -n ${JSON.stringify(pattern)} ${JSON.stringify(resolvedDir)}`, {
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
            // Fallback: JS-native recursive grep (no PowerShell dependency)
            const { readFileSync, readdirSync, statSync } = await import("node:fs");
            const results: string[] = [];
            const MAX_RESULTS = 500;
            const lowerPattern = pattern.toLowerCase();

            // TASK-1012: Parse .gitignore for file filtering
            function parseGitignore(gitignorePath: string): RegExp[] {
              const patterns: RegExp[] = [];
              try {
                const raw = readFileSync(gitignorePath, "utf-8");
                for (const line of raw.split("\n")) {
                  const trimmed = line.trim();
                  if (!trimmed || trimmed.startsWith("#")) continue;
                  // Convert simple glob to regex: * → .*, ? → ., ** captures
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
                    /* invalid */
                  }
                }
              } catch {
                /* no .gitignore */
              }
              return patterns;
            }

            try {
              const walk = (dir: string, parentIgnores: RegExp[]) => {
                if (results.length >= MAX_RESULTS) return;
                let entries: string[];
                try {
                  entries = readdirSync(dir);
                } catch {
                  return;
                }
                // Merge parent ignores with this directory's .gitignore
                const gitignorePath = path.join(dir, ".gitignore");
                const localIgnores = parseGitignore(gitignorePath);
                const ignores = parentIgnores.concat(localIgnores);
                for (const entry of entries) {
                  if (results.length >= MAX_RESULTS) return;
                  // Check .gitignore match
                  if (ignores.some((r) => r.test(entry))) continue;
                  const fp = path.join(dir, entry);
                  let st: ReturnType<typeof statSync>;
                  try {
                    st = statSync(fp);
                  } catch {
                    continue;
                  }
                  if (st.isDirectory()) {
                    if (!entry.startsWith(".") && entry !== "node_modules" && entry !== ".git") {
                      walk(fp, ignores);
                    }
                  } else if (st.isFile() && st.size < 512 * 1024) {
                    const ext = path.extname(entry).toLowerCase();
                    if ([".exe", ".dll", ".png", ".jpg", ".zip", ".gz", ".woff", ".ico"].includes(ext)) continue;
                    try {
                      const content = readFileSync(fp, "utf-8");
                      const lines = content.split("\n");
                      for (let i = 0; i < lines.length && results.length < MAX_RESULTS; i++) {
                        if (lines[i]!.toLowerCase().includes(lowerPattern)) {
                          const rel = path.relative(cwd, fp);
                          results.push(`${rel}:${i + 1}:${lines[i]!.trim().slice(0, 200)}`);
                        }
                      }
                    } catch {
                      /* skip unreadable */
                    }
                  }
                }
              };
              walk(resolvedDir, []);
            } catch {
              /* directory walk failed */
            }
            return {
              result: results.length > 0 ? results.join("\n").slice(0, 10_000) : "(no matches)",
              isError: false,
            };
          }
          case "find": {
            const pattern = String(args.pattern ?? "*");
            const dir = String(args.path ?? cwd);
            const { readdirSync } = await import("node:fs");
            const results: string[] = [];
            function walk(d: string, depth: number) {
              if (depth > 8) return;
              try {
                for (const entry of readdirSync(d, { withFileTypes: true })) {
                  const full = path.join(d, entry.name);
                  if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
                    walk(full, depth + 1);
                  } else if (entry.isFile() && entry.name.includes(pattern.replace(/\*/g, ""))) {
                    results.push(full);
                    if (results.length >= 200) return;
                  }
                }
              } catch {
                /* skip unreadable */
              }
            }
            walk(path.resolve(cwd, dir), 0);
            return { result: results.join("\n") || "(no files)", isError: false };
          }
          case "lsp_diagnostics": {
            try {
              const { DiagnosticsRunner } = await import("@kestrel/lsp");
              const runner = new DiagnosticsRunner();
              const diagResult = await runner.checkTypeScript({ cwd });
              const lines = [
                `TypeScript diagnostics: ${diagResult.errorCount} errors, ${diagResult.warningCount} warnings in ${diagResult.filesChecked} files`,
                ...diagResult.diagnostics.slice(0, 50).map(
                  (d: {
                    file: string;
                    line: number;
                    column: number;
                    severity: string;
                    code: string;
                    message: string;
                  }) => `${d.file}:${d.line}:${d.column}: ${d.severity} ${d.code}: ${d.message}`,
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
              const { MemoryEngine } = await import("@kestrel/memory");
              const engine = new MemoryEngine(cwd);
              const results = engine.search(query);
              if (results.length === 0) return { result: "(no memories found)", isError: false };
              return {
                result: results.map((r) => `[${r.type}] ${r.name}: ${r.snippet}`).join("\n"),
                isError: false,
              };
            } catch (err: unknown) {
              return { result: `memory_search: ${(err as Error).message}`, isError: true };
            }
          }
          case "task_create": {
            const title = String(args.title ?? "");
            if (!title.trim()) return { result: "task_create: title required", isError: true };
            try {
              const { KestrelDatabase, TaskRepo } = await import("@kestrel/storage");
              const db = await KestrelDatabase.create({ memory: true });
              const repo = new TaskRepo(db.db);
              const task = repo.create({
                title,
                kind: String(args.kind ?? "general"),
                workspaceId: cwd,
                input: args.input,
              });
              return { result: `Task created: ${task.id} [${task.status}] ${task.title}`, isError: false };
            } catch (err: unknown) {
              return { result: `task_create: ${(err as Error).message}`, isError: true };
            }
          }
          case "agent": {
            const agentType = String(args.type ?? "general");
            const task = String(args.task ?? args.prompt ?? "");
            if (!task.trim()) return { result: "agent: task required", isError: true };
            if (!["explore", "plan", "bash", "general"].includes(agentType)) {
              return { result: `agent: unknown type "${agentType}" (use explore/plan/bash/general)`, isError: true };
            }
            try {
              const { SubAgentScheduler } = await import("@kestrel/core");
              const { loadConfig } = await import("@kestrel/core");
              const cfg = loadConfig();
              const scheduler = new SubAgentScheduler();
              const toolExec = {
                execute: async (subName: string, subArgs: Record<string, unknown>) =>
                  toolExecutor.execute(subName, subArgs),
              };
              const result = await scheduler.spawn(
                {
                  type: agentType as "explore" | "plan" | "bash" | "general",
                  task,
                  apiKey: cfg.apiKey,
                  model: cfg.model,
                  cwd,
                },
                toolExec,
              );
              const summary = [
                `Sub-agent [${result.type}] completed in ${result.turns} turns.`,
                result.output.slice(0, 5000),
              ];
              if (result.error) summary.push(`\nError: ${result.error}`);
              return { result: summary.join("\n"), isError: !!result.error };
            } catch (err: unknown) {
              return { result: `agent: ${(err as Error).message}`, isError: true };
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
              execSync(`git add ${files}`, {
                cwd,
                encoding: "utf-8",
                timeout: 10_000,
                stdio: ["pipe", "pipe", "pipe"],
              });
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
              // 1. Create and switch branch
              execSync(`git checkout -b ${branch}`, {
                cwd,
                encoding: "utf-8",
                timeout: 10_000,
                stdio: ["pipe", "pipe", "pipe"],
              });
              // 2. Stage and commit
              execSync("git add .", {
                cwd,
                encoding: "utf-8",
                timeout: 10_000,
                stdio: ["pipe", "pipe", "pipe"],
              });
              execSync(`git commit -m ${JSON.stringify(title)}${body ? ` -m ${JSON.stringify(body)}` : ""}`, {
                cwd,
                encoding: "utf-8",
                timeout: 15_000,
                stdio: ["pipe", "pipe", "pipe"],
              });
              // 3. Push
              execSync(`git push -u origin ${branch}`, {
                cwd,
                encoding: "utf-8",
                timeout: 30_000,
                stdio: ["pipe", "pipe", "pipe"],
              });
              // 4. Create PR via gh CLI
              const prCmd = `gh pr create --title ${JSON.stringify(title)} --base ${base} --head ${branch}${body ? ` --body ${JSON.stringify(body)}` : ""}`;
              const out = execSync(prCmd, {
                cwd,
                encoding: "utf-8",
                timeout: 15_000,
                stdio: ["pipe", "pipe", "pipe"],
              });
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
              const { mkdirSync } = await import("node:fs");
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
          case "channel_send": {
            const ch = String(args.channel ?? "").trim();
            const peerId = String(args.peerId ?? "").trim();
            const text = String(args.text ?? "").trim();
            if (!ch || !peerId || !text) {
              return { result: "channel_send: channel, peerId, and text are required", isError: true };
            }
            if (!["feishu", "telegram", "slack", "webchat"].includes(ch)) {
              return {
                result: `channel_send: unsupported channel "${ch}" (use feishu/telegram/slack/webchat)`,
                isError: true,
              };
            }
            try {
              const { KestrelDatabase, OutboxRepo } = await import("@kestrel/storage");
              const db = await KestrelDatabase.create({ memory: false });
              try {
                const outbox = new OutboxRepo(db.db);
                const row = outbox.enqueue({ channel: ch, peerId, content: text });
                return { result: `Message enqueued for ${ch} → ${peerId} (outbox id: ${row.id})`, isError: false };
              } finally {
                db.close();
              }
            } catch (err) {
              return { result: `channel_send: ${(err as Error).message}`, isError: true };
            }
          }
          case "web_fetch": {
            return { result: "web_fetch: not yet implemented (v0.2 planned)", isError: true };
          }
          default: {
            // MCP tool call
            if (mcpClient && name.startsWith("mcp_")) {
              try {
                const mcpResult = await mcpClient.callTool(name.slice(4), args);
                const text = mcpResult.content
                  .filter((c: { type: string }) => c.type === "text")
                  .map((c: { text: string }) => c.text)
                  .join("\n");
                return { result: text || JSON.stringify(mcpResult.content), isError: mcpResult.isError === true };
              } catch (err: unknown) {
                return { result: `MCP error: ${(err as Error).message}`, isError: true };
              }
            }
            return { result: `Tool not implemented: ${name}`, isError: true };
          }
        }
      },
    };

    function toolParams(name: string) {
      const str = { type: "string" as const };
      switch (name) {
        case "read":
          return { type: "object", properties: { path: str, file: str }, required: [] };
        case "write":
          return { type: "object", properties: { path: str, file: str, content: str }, required: ["content"] };
        case "edit":
          return {
            type: "object",
            properties: { path: str, file: str, old_string: str, new_string: str },
            required: ["old_string", "new_string"],
          };
        case "grep":
          return { type: "object", properties: { pattern: str, path: str }, required: ["pattern"] };
        case "find":
          return { type: "object", properties: { pattern: str, path: str }, required: ["pattern"] };
        case "bash":
          return { type: "object", properties: { command: str, cmd: str }, required: ["command"] };
        case "lsp_diagnostics":
          return { type: "object", properties: { target: str }, required: [] };
        case "memory_search":
          return { type: "object", properties: { query: str, q: str }, required: ["query"] };
        case "task_create":
          return {
            type: "object",
            properties: { title: str, kind: str, input: str },
            required: ["title"],
          };
        case "agent":
          return {
            type: "object",
            properties: { type: str, task: str, prompt: str },
            required: ["task"],
          };
        case "git_status":
          return { type: "object", properties: {}, required: [] };
        case "git_diff":
          return {
            type: "object",
            properties: { staged: { type: "boolean" }, cached: { type: "boolean" } },
            required: [],
          };
        case "git_log":
          return { type: "object", properties: { count: { type: "number" }, n: { type: "number" } }, required: [] };
        case "git_blame":
          return { type: "object", properties: { path: str, file: str }, required: ["path"] };
        case "git_commit":
          return {
            type: "object",
            properties: { message: str, files: str },
            required: ["message"],
          };
        case "pr_create":
          return {
            type: "object",
            properties: { title: str, body: str, base: str },
            required: ["title"],
          };
        case "skill_create":
          return { type: "object", properties: { name: str, description: str }, required: ["name"] };
        case "channel_send":
          return {
            type: "object",
            properties: {
              channel: { type: "string", enum: ["feishu", "telegram", "slack", "webchat"] },
              peerId: { type: "string", description: "Target user or chat ID" },
              text: { type: "string", description: "Message content" },
            },
            required: ["channel", "peerId", "text"],
          };
        case "web_fetch":
          return { type: "object", properties: { url: str }, required: ["url"] };
        default:
          return { type: "object", properties: {}, required: [] };
      }
    }
    const toolDefs = registry.list().map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: toolParams(t.name),
      },
    }));

    // TASK-0330: Load skills and register as tools
    try {
      const { SkillRegistry } = await import("@kestrel/skills");
      const skillsReg = new SkillRegistry({ skillsDir: `${cwd}/.kestrel/skills` });
      skillsReg.load();
      for (const skill of skillsReg.list()) {
        toolDefs.push({
          type: "function" as const,
          function: {
            name: `skill_${skill.manifest.name.replace(/-/g, "_")}`,
            description: `[Skill] ${skill.manifest.description}`,
            parameters: { type: "object", properties: {}, required: [] },
          },
        });
      }
    } catch {
      // Skills not available — gracefully skip
    }

    // TASK-0730: MCP tools — connect to external MCP server if KESTREL_MCP_COMMAND is configured
    let mcpClient: any = null;
    const mcpCommand = process.env.KESTREL_MCP_COMMAND;
    if (mcpCommand) {
      try {
        const { McpClient: Mcp } = await import("@kestrel/mcp");
        const mcpArgs = (process.env.KESTREL_MCP_ARGS ?? "").split(",").filter(Boolean);
        mcpClient = new Mcp({ command: mcpCommand, args: mcpArgs, connectTimeout: 10_000 });
        await mcpClient.connect();
        for (const tool of mcpClient.tools) {
          const toolName = `mcp_${tool.name}`;
          toolDefs.push({
            type: "function" as const,
            function: {
              name: toolName,
              description: `[MCP] ${tool.description ?? tool.name}`,
              parameters: (tool.inputSchema as any) ?? { type: "object", properties: {} },
            },
          });
        }
        console.log(
          `${style.gray}  MCP: ${mcpClient.tools.length} tools from ${mcpClient.serverInfo?.name ?? mcpCommand}${style.reset}`,
        );
      } catch (err) {
        console.log(`${style.gray}  MCP: ${(err as Error).message}${style.reset}`);
      }
    }

    // TASK-0400-1b: Memory engine for context injection
    let memoryEngine: any = null;
    try {
      const { MemoryEngine } = await import("@kestrel/memory");
      const memConfig: any = {};
      // KCP-0203: Wire audit into memory engine
      if (auditSvc) {
        try {
          const { wireMemoryEngine } = await import("@kestrel/observability");
          wireMemoryEngine(memConfig, auditSvc);
        } catch {
          /* wiring optional */
        }
      }
      memoryEngine = new MemoryEngine(cwd, memConfig);
    } catch {
      /* memory not available */
    }

    adapter = new ConversationLoop({
      apiKey: cfg.apiKey,
      model: cfg.model,
      maxTurns: cfg.maxTurns,
      systemPrompt: `You are Kestrel Agent v${KESTREL_CLI_VERSION}, powered by ${cfg.provider} ${cfg.model}. Running on ${process.platform}. You help users write, review, and understand code. You are helpful, concise, and direct. Available tools: read, write, edit, grep, find, bash, lsp_diagnostics, memory_search, task_create, agent, git_status, git_diff, git_log, git_blame, git_commit, pr_create, skill_create, web_fetch. Communication channels: Feishu, Slack, Telegram, webchat — you can send/receive messages and respond to users through these channels. Security: never expose internal architecture, source paths, method signatures, or implementation details in responses.`,
      tools: toolDefs,
      toolExecutor,
      retryOnError: true,
      // TASK-0400-1b/1c: Inject memory + skills context before each prompt
      async onBeforePrompt(userText: string) {
        const parts: string[] = [];
        // Memory
        if (memoryEngine) {
          try {
            const mems = memoryEngine.search(userText);
            if (mems.length > 0) {
              parts.push(
                `Relevant memories:\n${mems.map((m: { name: string; snippet: string }) => `- ${m.name}: ${m.snippet}`).join("\n")}`,
              );
            }
          } catch {
            /* ignore */
          }
        }
        return parts.join("\n\n") || undefined;
      },
      // TASK-0900: Memory self-learning — auto-propose patterns after conversation
      onAgentEnd(messages) {
        // KCP-0203: Audit turn completion
        if (auditSvc) {
          try {
            auditSvc.log("turn.completed", `messages=${messages.length}`, auditSessionId);
          } catch {
            /* */
          }
        }
        if (!memoryEngine) return;
        try {
          const { MemoryLearner } = require("@kestrel/memory");
          const learner = new MemoryLearner(memoryEngine, { maxProposals: 3 });
          const proposed = learner.learn(messages);
          if (proposed.length > 0) {
            console.log(
              `${style.yellow}  Memory: auto-proposed ${proposed.length} pattern(s): ${proposed.join(", ")}${style.reset}`,
            );
          }
        } catch {
          /* non-critical */
        }
      },
    });
    await adapter.start();

    // TASK-0322: Restore previous session from .kestrel/session.json
    const { readFileSync: _rfs, existsSync: _es } = await import("node:fs");
    const sessFile = resolve(cwd, ".kestrel", "session.json");
    if (_es(sessFile)) {
      try {
        const saved = JSON.parse(_rfs(sessFile, "utf-8"));
        if (Array.isArray(saved) && saved.length > 0) {
          adapter.restoreMessages(saved);
          console.log(`${style.gray}  ${Math.floor(saved.length / 2)} turns restored from session${style.reset}`);
        }
      } catch {
        /* ignore corrupt file */
      }
    }

    // TASK-0570: Parse pending tasks from TASK_BOARD.md
    const pendingTasks: { id: string; priority: string; title: string }[] = [];
    const boardPath = resolve(cwd, "TASK_BOARD.md");
    if (existsSync(boardPath)) {
      try {
        const boardText = readFileSync(boardPath, "utf-8");
        for (const line of boardText.split("\n")) {
          // Match: | **TASK-XXXX** | **PX** | ... | TODO |
          // Or:    | TASK-XXXX | PX | ... | TODO |
          const m = line.match(
            /^\|\s+\*{0,2}(TASK-\d[\w~]*)\*{0,2}\s+\|\s+\*{0,2}(P\d)\*{0,2}\s+\|\s+(.+?)\s+\|\s+(TODO|⚠.+)/,
          );
          if (m) {
            pendingTasks.push({ id: m[1]!, priority: m[2]!, title: m[3]! });
          }
        }
      } catch {
        /* ignore parse errors */
      }
    }

    // TASK-0500/0700: Ink (React) terminal UI with ABAC permission gate
    const { runInkRepl } = await import("./app.js");
    const adaptConfirm = { getPendingConfirm, respondConfirm };
    await runInkRepl({
      version: `v${KESTREL_CLI_VERSION}`,
      model,
      workspace,
      toolsCount: registry.list().length,
      pendingTasks,
      trustLevel,
      adapter: Object.assign(adapter, adaptConfirm),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`${style.gray}  ${msg}${style.reset}\n`);
  }

  // TASK-0322: Save session on exit
  if (adapter?.messages?.length) {
    try {
      const { writeFileSync: _wfs, mkdirSync: _mds } = await import("node:fs");
      const sessDir = resolve(resolveProjectRoot(), ".kestrel");
      if (!existsSync(sessDir)) _mds(sessDir, { recursive: true });
      _wfs(resolve(sessDir, "session.json"), JSON.stringify(adapter.messages), "utf-8");
    } catch {
      /* ignore save errors */
    }
  }
  adapter?.dispose();
}
