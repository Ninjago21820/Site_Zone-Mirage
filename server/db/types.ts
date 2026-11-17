/**
 * Storage contract shared by every driver (MySQL/MariaDB in production,
 * SQLite for local development and the automated test-suite). Every method is
 * asynchronous so that one implementation can serve a local file and a remote
 * server without leaking the engine into the rest of the code base.
 */

export type Param = string | number | boolean | bigint | null | Uint8Array | Date;

export interface RunResult {
  lastInsertRowid: number;
  changes: number;
}

export type Row = Record<string, unknown>;

export interface DB {
  readonly dialect: 'mysql' | 'sqlite';
  /** Single row or undefined. */
  get<T = Row>(sql: string, params?: Param[]): Promise<T | undefined>;
  /** Every matching row. */
  all<T = Row>(sql: string, params?: Param[]): Promise<T[]>;
  /** Executes a statement, returns the insert id (when relevant) and row count. */
  run(sql: string, params?: Param[]): Promise<RunResult>;
  /** Multi-statement script (migrations only). */
  exec(sql: string): Promise<void>;
  /** Runs `fn` inside a transaction; nested calls reuse the outer context. */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  /** INSERT ... ON CONFLICT / ON DUPLICATE KEY UPDATE. */
  upsert(table: string, row: Record<string, Param>, conflictColumns: string[]): Promise<void>;
  /** INSERT IGNORE. */
  insertIgnore(table: string, row: Record<string, Param>): Promise<void>;
  /** Table names of the current schema (logical backups). */
  tableNames(): Promise<string[]>;
  /** Full logical snapshot, used by encrypted backups. */
  snapshot(): Promise<Record<string, Row[]>>;
  /** Second-resolution server time, in milliseconds. */
  close(): Promise<void>;
}

/** A driver failure is reported with the dialect-agnostic SQL that failed. */
export class DbError extends Error {
  readonly code: string;
  readonly sql: string;
  constructor(message: string, code: string, sql: string) {
    super(message);
    this.name = 'DbError';
    this.code = code;
    this.sql = sql;
  }
}

export function normaliseParams(params: Param[] = []): Param[] {
  return params.map((value) => (value === undefined ? null : value));
}

export function buildInsert(table: string, row: Record<string, Param>): { sql: string; params: Param[] } {
  const columns = Object.keys(row);
  const sql = `INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`;
  return { sql, params: normaliseParams(columns.map((column) => row[column])) };
}
