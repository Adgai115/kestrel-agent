/**
 * Cron scheduler — natural language → cron expression parser
 * and a lightweight in-process job scheduler.
 *
 * Uses setInterval-based polling; no native cron dependency.
 */

type CronResolver = string | ((...args: string[]) => string);

/** Map natural language phrases to standard 5-field cron expressions. */
const NL_PATTERNS: [RegExp, CronResolver][] = [
  [/every\s+(\d+)\s*min/, (_, n) => `*/${n} * * * *`],
  [/every\s+hour/, () => "0 * * * *"],
  [/every\s+(\d+)\s*hours?/, (_, n) => `0 */${n} * * *`],
  [
    /every\s+day\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i,
    (_, h, m, ampm) => {
      let hour = Number.parseInt(h, 10);
      if (ampm?.toLowerCase() === "pm" && hour < 12) hour += 12;
      if (ampm?.toLowerCase() === "am" && hour === 12) hour = 0;
      return `${m ?? "0"} ${hour} * * *`;
    },
  ],
  [/every\s+day/, () => "0 9 * * *"],
  [
    /daily\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i,
    (_, h, m, ampm) => {
      let hour = Number.parseInt(h, 10);
      if (ampm?.toLowerCase() === "pm" && hour < 12) hour += 12;
      if (ampm?.toLowerCase() === "am" && hour === 12) hour = 0;
      return `${m ?? "0"} ${hour} * * *`;
    },
  ],
  [
    /weekdays?\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i,
    (_, h, m, ampm) => {
      let hour = Number.parseInt(h, 10);
      if (ampm?.toLowerCase() === "pm" && hour < 12) hour += 12;
      if (ampm?.toLowerCase() === "am" && hour === 12) hour = 0;
      return `${m ?? "0"} ${hour} * * 1-5`;
    },
  ],
  [/every\s+(\d+)\s*seconds?/, (_, n) => `*/${n} * * * * *`],
  [
    /once\s+at\s+(\d{1,2})(?::(\d{2}))\s*(am|pm)?/i,
    (_, h, m, ampm) => {
      let hour = Number.parseInt(h, 10);
      if (ampm?.toLowerCase() === "pm" && hour < 12) hour += 12;
      if (ampm?.toLowerCase() === "am" && hour === 12) hour = 0;
      return `${m ?? "0"} ${hour} * * *`;
    },
  ],
  [
    /at\s+(\d{1,2})(?::(\d{2}))\s*(am|pm)?/i,
    (_, h, m, ampm) => {
      let hour = Number.parseInt(h, 10);
      if (ampm?.toLowerCase() === "pm" && hour < 12) hour += 12;
      if (ampm?.toLowerCase() === "am" && hour === 12) hour = 0;
      return `${m ?? "0"} ${hour} * * *`;
    },
  ],
];

/** Parse natural language timing description into a 5 or 6 field cron expression. */
export function parseCronExpression(natural: string): string | null {
  const input = natural.trim().toLowerCase();
  for (const [pattern, fn] of NL_PATTERNS) {
    const match = pattern.exec(input);
    if (match) {
      if (typeof fn === "string") return fn;
      const result = fn(...match);
      return result;
    }
  }
  // Accept raw cron expressions
  const fields = input.split(/\s+/);
  if (fields.length === 5 || fields.length === 6) return input;
  return null;
}

export interface CronJob {
  id: string;
  name: string;
  schedule: string; // natural language input
  cronExpression: string; // parsed cron expression
  command: string; // kestrel CLI command to run
  createdAt: number;
  nextRun: number;
  lastRun?: number;
  runCount: number;
}

export type CronEventHandler = (job: CronJob, result: { ok: boolean; output: string }) => void;

/**
 * In-process cron scheduler.
 * Manages jobs and fires them on schedule via interval polling.
 */
export class CronScheduler {
  private jobs = new Map<string, CronJob>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private tickMs: number;
  private onEvent?: CronEventHandler;

  constructor(tickMs = 15_000) {
    this.tickMs = tickMs;
  }

  /** Set event handler for job execution results. */
  onJobEvent(handler: CronEventHandler): void {
    this.onEvent = handler;
  }

  /** Add a cron job. Returns the job id. */
  add(name: string, schedule: string, command: string): string {
    const cronExpr = parseCronExpression(schedule);
    if (!cronExpr) throw new Error(`Cannot parse schedule: "${schedule}"`);

    const id = `cron_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const job: CronJob = {
      id,
      name,
      schedule,
      cronExpression: cronExpr,
      command,
      createdAt: Date.now(),
      nextRun: this.computeNextRun(cronExpr),
      runCount: 0,
    };
    this.jobs.set(id, job);
    return id;
  }

  /** Remove a cron job by id. */
  remove(id: string): boolean {
    return this.jobs.delete(id);
  }

  /** List all jobs. */
  list(): CronJob[] {
    return [...this.jobs.values()];
  }

  /** Get a single job. */
  get(id: string): CronJob | undefined {
    return this.jobs.get(id);
  }

  /** Start the scheduler loop. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.tickMs);
    this.tick(); // immediate check
  }

  /** Stop the scheduler loop. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Check and fire due jobs. */
  private tick(): void {
    const now = Date.now();
    for (const job of this.jobs.values()) {
      if (now >= job.nextRun) {
        this.fireJob(job);
      }
    }
  }

  private async fireJob(job: CronJob): Promise<void> {
    job.lastRun = Date.now();
    job.runCount++;
    job.nextRun = this.computeNextRun(job.cronExpression);

    // Execute command via execSync as a simple approach
    const { execSync } = await import("node:child_process");
    try {
      const output = execSync(job.command, {
        encoding: "utf-8",
        timeout: 120_000,
        maxBuffer: 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"],
        cwd: process.cwd(),
      });
      this.onEvent?.(job, { ok: true, output: output.slice(0, 5000) });
    } catch (err: unknown) {
      this.onEvent?.(job, { ok: false, output: (err as Error).message });
    }
  }

  /** Compute next run time from a cron expression (approximate). */
  private computeNextRun(cronExpr: string): number {
    const fields = cronExpr.split(/\s+/);
    const now = new Date();

    if (fields.length === 6) {
      // Seconds-level cron
      const sec = Number.parseInt(fields[0]!, 10);
      now.setSeconds(now.getSeconds() + (Number.isNaN(sec) ? 60 : Math.max(1, sec)));
    } else if (fields.length === 5) {
      const minute = Number.parseInt(fields[0]!, 10);
      const hour = Number.parseInt(fields[1]!, 10);

      if (!Number.isNaN(hour) && !Number.isNaN(minute)) {
        // Fixed time
        const next = new Date(now);
        next.setHours(hour, minute, 0, 0);
        if (next <= now) next.setDate(next.getDate() + 1);
        return next.getTime();
      }

      if (fields[0]!.startsWith("*/")) {
        // Every N minutes
        const n = Number.parseInt(fields[0]!.slice(2), 10);
        return now.getTime() + n * 60_000;
      }

      // Default: next minute
      return now.getTime() + 60_000;
    }

    return now.getTime() + 60_000;
  }
}
