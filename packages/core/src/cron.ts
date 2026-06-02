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

/** Parse a cron field like "1-5", "0,6", "15" into a Set of allowed values. */
function parseField(field: string, _min: number, _max: number): Set<number> | null {
  if (field === "*") return null;
  const values = new Set<number>();
  for (const part of field.split(",")) {
    if (part.includes("-")) {
      const [lo, hi] = part.split("-").map(Number);
      for (let i = lo!; i <= hi!; i++) values.add(i);
    } else {
      values.add(Number(part));
    }
  }
  return values;
}

/** Check if a cron field matches a value. */
function matchField(field: string, value: number): boolean {
  if (field === "*") return true;
  return field.split(",").some((p) => {
    if (p.includes("-")) {
      const [lo, hi] = p.split("-").map(Number);
      return value >= lo! && value <= hi!;
    }
    return Number(p) === value;
  });
}

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

  private fireJob(job: CronJob): void {
    job.lastRun = Date.now();
    job.runCount++;
    job.nextRun = this.computeNextRun(job.cronExpression);

    // Async spawn — non-blocking, avoids stalling the scheduler loop
    import("node:child_process")
      .then(({ exec }) => {
        exec(
          job.command,
          {
            timeout: 120_000,
            maxBuffer: 1024 * 1024,
            cwd: process.cwd(),
            shell: process.platform === "win32" ? (process.env.ComSpec ?? "powershell.exe") : "/bin/bash",
          },
          (err: Error | null, stdout, stderr) => {
            if (err) {
              this.onEvent?.(job, { ok: false, output: stderr || err.message });
            } else {
              this.onEvent?.(job, { ok: true, output: stdout.slice(0, 5000) });
            }
          },
        );
      })
      .catch((err: Error) => {
        this.onEvent?.(job, { ok: false, output: err.message });
      });
  }

  /** Compute next run time from a cron expression. Handles DOW and DOM fields. */
  private computeNextRun(cronExpr: string): number {
    const fields = cronExpr.split(/\s+/);
    const now = new Date();

    if (fields.length === 6) {
      const sec = Number.parseInt(fields[0]!, 10);
      return now.getTime() + (Number.isNaN(sec) ? 60 : Math.max(1, sec)) * 1000;
    }

    if (fields.length !== 5) return now.getTime() + 60_000;

    const minuteField = fields[0]!;
    const hourField = fields[1]!;
    const domField = fields[2]!;
    const monthField = fields[3]!;
    const dowField = fields[4]!;

    // Every N minutes: */N * * * *
    if (minuteField.startsWith("*/")) {
      const n = Number.parseInt(minuteField.slice(2), 10) || 1;
      return now.getTime() + n * 60_000;
    }

    const minute = Number.parseInt(minuteField, 10);
    const hour = Number.parseInt(hourField, 10);

    // Fixed time: M H ... → find next matching time considering DOW
    if (!Number.isNaN(hour) && !Number.isNaN(minute)) {
      // Parse DOW: "1-5" (weekdays), "0,6" (weekends), "*" (any), or single number
      const dowSet = parseField(dowField, 0, 6);
      const domSet = parseField(domField, 1, 31);

      const next = new Date(now);
      next.setHours(hour, minute, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);

      // Advance until we find a matching DOW and DOM
      for (let i = 0; i < 366; i++) {
        const dow = next.getDay(); // 0=Sun, 6=Sat
        const dom = next.getDate();
        const month = next.getMonth() + 1;
        const monthOk = monthField === "*" || matchField(monthField, month);
        const dowOk = dowField === "*" || dowSet?.has(dow);
        const domOk = domField === "*" || domSet?.has(dom);
        if (dowOk && domOk && monthOk) return next.getTime();
        next.setDate(next.getDate() + 1);
      }
      return now.getTime() + 60_000; // fallback
    }

    return now.getTime() + 60_000;
  }
}
