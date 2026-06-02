/**
 * Database connection and lifecycle management.
 *
 * Uses sql.js (SQLite compiled to WASM) — zero native dependencies.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import { runMigrations } from "./schema.js";

export interface StorageConfig {
  dbPath?: string;
  cwd?: string;
  memory?: boolean;
}

export class KestrelDatabase {
  db: SqlJsDatabase;
  readonly dbPath: string;
  private _closed = false;
  private static _instances = new Map<string, KestrelDatabase>();

  private constructor(db: SqlJsDatabase, dbPath: string) {
    this.db = db;
    this.dbPath = dbPath;
  }

  /** Reuse a shared database instance (singleton per path). */
  static async getInstance(config: StorageConfig = {}): Promise<KestrelDatabase> {
    const cwd = config.cwd ?? process.cwd();
    const rawPath = config.dbPath ?? ".kestrel/kestrel.db";
    const fullPath = rawPath.startsWith(".") ? `${cwd}/${rawPath}` : rawPath;
    const key = config.memory ? ":memory:" : fullPath;

    const existing = KestrelDatabase._instances.get(key);
    if (existing && !existing._closed) return existing;

    const instance = await KestrelDatabase.create(config);
    if (!config.memory) KestrelDatabase._instances.set(key, instance);
    return instance;
  }

  /** Clear instance cache (useful for tests). */
  static clearCache(): void {
    KestrelDatabase._instances.clear();
  }

  static async create(config: StorageConfig = {}): Promise<KestrelDatabase> {
    const SQL = await initSqlJs();
    const cwd = config.cwd ?? process.cwd();

    if (config.memory) {
      const db = new SQL.Database();
      const instance = new KestrelDatabase(db, ":memory:");
      instance.configure();
      return instance;
    }

    const rawPath = config.dbPath ?? ".kestrel/kestrel.db";
    const fullPath = rawPath.startsWith(".") ? `${cwd}/${rawPath}` : rawPath;
    const dir = dirname(fullPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    let db: SqlJsDatabase;
    if (existsSync(fullPath)) {
      const buffer = readFileSync(fullPath);
      db = new SQL.Database(buffer);
    } else {
      db = new SQL.Database();
    }

    const instance = new KestrelDatabase(db, fullPath);
    instance.configure();
    return instance;
  }

  private configure(): void {
    this.db.run("PRAGMA foreign_keys = ON");
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run("PRAGMA synchronous = NORMAL");
    runMigrations(this.db);
    this.createFtsIndex();
  }

  private createFtsIndex(): void {
    try {
      this.db.run(`
        CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
          content,
          session_id,
          role,
          tokenize='porter unicode61'
        )
      `);
    } catch {
      /* FTS5 may not be available in all sql.js builds */
    }
  }

  save(): void {
    if (this._closed || this.dbPath === ":memory:") return;
    const data = this.db.export();
    const buffer = Buffer.from(data);

    // Backup existing database before overwriting
    const bakPath = `${this.dbPath}.bak`;
    if (existsSync(this.dbPath)) {
      try {
        copyFileSync(this.dbPath, bakPath);
      } catch {
        // Backup failure is non-fatal
      }
    }

    writeFileSync(this.dbPath, buffer);
  }

  close(): void {
    if (this._closed) return;
    this.save();
    this.db.close();
    this._closed = true;
  }

  transaction<T>(fn: () => T): T {
    try {
      this.db.run("BEGIN");
      const result = fn();
      this.db.run("COMMIT");
      this.save();
      return result;
    } catch (e) {
      this.db.run("ROLLBACK");
      throw e;
    }
  }
}
