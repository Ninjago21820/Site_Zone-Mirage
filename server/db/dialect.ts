import type { Param } from './types.js';

export type Dialect = 'sqlite' | 'mysql';

/** Both engines accept `?` positional placeholders. */
export const PLACEHOLDER = '?';

/**
 * INSERT ... ON CONFLICT / ON DUPLICATE KEY UPDATE. Kept in one place so no
 * route ever depends on a dialect-specific clause.
 */
export function upsertSql(
  dialect: Dialect,
  table: string,
  columns: string[],
  conflictColumns: string[],
): string {
  const values = columns.map((column) => `?`).join(',');
  const updates = columns.filter((column) => !conflictColumns.includes(column));
  if (dialect === 'mysql') {
    if (updates.length === 0) return `INSERT INTO ${table} (${columns.join(',')}) VALUES (${values}) ON DUPLICATE KEY UPDATE ${conflictColumns[0]}=${conflictColumns[0]}`;
    return `INSERT INTO ${table} (${columns.join(',')}) VALUES (${values}) ON DUPLICATE KEY UPDATE ${updates
      .map((column) => `${column}=VALUES(${column})`)
      .join(',')}`;
  }
  if (updates.length === 0) return `INSERT OR IGNORE INTO ${table} (${columns.join(',')}) VALUES (${values})`;
  return `INSERT INTO ${table} (${columns.join(',')}) VALUES (${values}) ON CONFLICT(${conflictColumns.join(',')})
    DO UPDATE SET ${updates.map((column) => `${column}=excluded.${column}`).join(',')}`;
}

export function insertIgnoreSql(dialect: Dialect, table: string, columns: string[]): string {
  const values = columns.map(() => '?').join(',');
  const verb = dialect === 'mysql' ? 'INSERT IGNORE' : 'INSERT OR IGNORE';
  return `${verb} INTO ${table} (${columns.join(',')}) VALUES (${values})`;
}

/**
 * MySQL rejects `CREATE INDEX` when the index already exists (errno 1061)
 * while SQLite accepts `IF NOT EXISTS`. Migrations treat that single error as
 * a success so the same statement list can be replayed.
 */
export function isDuplicateIndexError(error: unknown): boolean {
  const errno = (error as { errno?: number; code?: string })?.errno;
  const code = (error as { code?: string })?.code;
  return errno === 1061 || code === 'ER_DUP_KEYNAME';
}

export function coerceParams(params: Param[]): Param[] {
  return params.map((value) => (value === undefined ? null : value));
}
