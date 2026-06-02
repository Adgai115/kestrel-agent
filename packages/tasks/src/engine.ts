/**
 * Task engine — worker loop, concurrency control, task lifecycle.
 *
 * Wraps TaskRepo from @kestrel/storage and adds:
 * - Worker pool with p-limit concurrency
 * - AbortController per task
 * - Status transitions enforced by TaskRepo
 * - Audit event emission
 */

import type { TaskRepo, TaskRow } from "@kestrel/storage";

export type TaskHandler = (task: TaskRow, signal: AbortSignal) => Promise<unknown>;

export interface TaskEngineConfig {
  taskRepo: TaskRepo;
  /** Maximum concurrent tasks. Default: 4 */
  concurrency?: number;
  /** Audit event callback */
  auditSink?: (event: { event: string; taskId: string; kind: string; status: string }) => void;
}

export class TaskEngine {
  private repo: TaskRepo;
  private concurrency: number;
  private auditSink?: TaskEngineConfig["auditSink"];
  private controllers = new Map<string, AbortController>();
  private resolvers = new Map<string, { resolve: (t: TaskRow) => void; reject: (e: Error) => void }>();
  private running = 0;
  private queue: Array<{ task: TaskRow; handler: TaskHandler }> = [];
  private handlers = new Map<string, TaskHandler>();

  constructor(config: TaskEngineConfig) {
    this.repo = config.taskRepo;
    this.concurrency = config.concurrency ?? 4;
    this.auditSink = config.auditSink;
  }

  /** Register a handler for a specific task kind. */
  register(kind: string, handler: TaskHandler): void {
    this.handlers.set(kind, handler);
  }

  /** Create a task and optionally enqueue it. */
  create(params: {
    title: string;
    kind: string;
    workspaceId: string;
    sessionId?: string;
    createdBy?: string;
    channel?: string;
    input?: unknown;
  }): TaskRow {
    const task = this.repo.create({
      title: params.title,
      kind: params.kind,
      workspaceId: params.workspaceId,
      sessionId: params.sessionId,
      createdBy: params.createdBy,
      channel: params.channel,
      input: params.input,
    });
    this.auditSink?.({ event: "task.created", taskId: task.id, kind: task.kind, status: task.status });
    return task;
  }

  /** Enqueue and start running a task. Returns when task completes. */
  async run(taskId: string, handler?: TaskHandler): Promise<TaskRow> {
    const task = this.repo.getById(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    const h = handler ?? this.handlers.get(task.kind);
    if (!h) throw new Error(`No handler registered for kind: ${task.kind}`);

    this.queue.push({ task, handler: h });
    this.processQueue();

    return new Promise((resolve, reject) => {
      this.resolvers.set(taskId, { resolve, reject });
    });
  }

  /** Cancel a running or pending task. */
  cancel(taskId: string): void {
    const ctrl = this.controllers.get(taskId);
    if (ctrl) {
      ctrl.abort();
      this.controllers.delete(taskId);
    }
    try {
      this.repo.updateStatus(taskId, "cancelled");
    } catch {
      // Already in terminal state
    }
    this.auditSink?.({ event: "task.cancelled", taskId, kind: "", status: "cancelled" });
  }

  /** Get task by ID. */
  get(taskId: string): TaskRow | undefined {
    return this.repo.getById(taskId);
  }

  /** List tasks by status. */
  listByStatus(status: string, limit?: number): TaskRow[] {
    return this.repo.listByStatus(status, limit);
  }

  /** List pending tasks. */
  listPending(limit?: number): TaskRow[] {
    return this.repo.listPending(limit);
  }

  private async processQueue(): Promise<void> {
    while (this.queue.length > 0 && this.running < this.concurrency) {
      const item = this.queue.shift()!;
      this.running++;
      this.executeTask(item.task, item.handler).finally(() => {
        this.running--;
        this.processQueue();
      });
    }
  }

  private async executeTask(task: TaskRow, handler: TaskHandler): Promise<void> {
    const controller = new AbortController();
    this.controllers.set(task.id, controller);

    try {
      // pending → running
      if (task.status === "pending") {
        this.repo.updateStatus(task.id, "running");
        this.auditSink?.({ event: "task.started", taskId: task.id, kind: task.kind, status: "running" });
      }

      const result = await handler(task, controller.signal);

      this.repo.recordResult(task.id, result);
      this.repo.updateStatus(task.id, "succeeded");
      this.auditSink?.({ event: "task.finished", taskId: task.id, kind: task.kind, status: "succeeded" });
      this.resolveTask(task.id);
    } catch (error) {
      if (controller.signal.aborted) {
        this.resolveTask(task.id);
        return; // cancellation handled by cancel()
      }
      const errMsg = error instanceof Error ? error.message : String(error);
      this.repo.recordResult(task.id, undefined, errMsg);
      this.repo.updateStatus(task.id, "failed");
      this.auditSink?.({ event: "task.failed", taskId: task.id, kind: task.kind, status: "failed" });
      this.resolveTask(task.id);
    } finally {
      this.controllers.delete(task.id);
    }
  }

  private resolveTask(taskId: string): void {
    const resolver = this.resolvers.get(taskId);
    if (!resolver) return;
    this.resolvers.delete(taskId);
    const updated = this.repo.getById(taskId);
    if (updated) {
      resolver.resolve(updated);
    } else {
      resolver.reject(new Error(`Task ${taskId} disappeared`));
    }
  }
}
