/**
 * Unified error types for Kestrel Agent.
 * Every subsystem should use these instead of raw Error.
 */

export class KestrelError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "KestrelError";
  }
}

export class PermissionError extends KestrelError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "PERMISSION_DENIED", details);
    this.name = "PermissionError";
  }
}

export class StorageError extends KestrelError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "STORAGE_ERROR", details);
    this.name = "StorageError";
  }
}

export class ValidationError extends KestrelError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "VALIDATION_ERROR", details);
    this.name = "ValidationError";
  }
}

export class TimeoutError extends KestrelError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "TIMEOUT", details);
    this.name = "TimeoutError";
  }
}

export class NotFoundError extends KestrelError {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`, "NOT_FOUND", { resource, id });
    this.name = "NotFoundError";
  }
}

/** Format any error to a safe loggable object (no secrets). */
export function formatError(err: unknown): Record<string, unknown> {
  if (err instanceof KestrelError) {
    return { name: err.name, code: err.code, message: err.message, details: err.details };
  }
  if (err instanceof Error) {
    return { name: err.name, message: err.message };
  }
  return { message: String(err) };
}
