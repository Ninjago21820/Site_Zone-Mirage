import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { buildInsert, normaliseParams, type DB, type Param, type Row, type RunResult } from './types.js';
import { upsertSql, insertIgnoreSql } from './dialect.js';

/**
 * SQLite driver — used for local development, the automated test-suite and the
 * verified-restore step of the backup tooling. Same async contract as MySQL.
 */
export function createSqliteDb(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const handle = new Database(file);
  if (file !== ':memory:') handle.pragma('journal_mode = WAL');
  handle.pragma('foreign_keys = ON');

  const db: DB = {
    dialect: 'sqlite',

    async get<T = Row>(sql: string, params: Param[] = []): Promise<T | undefined> {
      return handle.prepare(sql).get(...normaliseParams(params)) as T | undefined;
    },

    async all<T = Row>(sql: string, params: Param[] = []): Promise<T[]> {
      return handle.prepare(sql).all(...normaliseParams(params)) as T[];
    },

    async run(sql: string, params: Param[] = []): Promise<RunResult> {
      const info = handle.prepare(sql).run(...normaliseParams(params));
      return { lastInsertRowid: Number(info.lastInsertRowid), changes: Number(info.changes) };
    },

    async exec(sql: string): Promise<void> {
      handle.exec(sql);
    },

    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      handle.exec('BEGIN');
      try {
        const result = await fn();
        handle.exec('COMMIT');
        return result;
      } catch (error) {
        try {
          handle.exec('ROLLBACK');
        } catch {
          /* the transaction may already be closed */
        }
        throw error;
      }
    },

    async upsert(table, row, conflictColumns) {
      const columns = Object.keys(row);
      const sql = upsertSql('sqlite', table, columns, conflictColumns);
      handle.prepare(sql).run(...normaliseParams(columns.map((column) => row[column])));
    },

    async insertIgnore(table, row) {
      const { sql, params } = buildInsert(table, row);
      handle.prepare(insertIgnoreSql('sqlite', table, Object.keys(row))).run(...normaliseParams(params));
      void sql;
    },

    async tableNames(): Promise<string[]> {
      const rows = handle
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all() as { name: string }[];
      return rows.map((row) => row.name);
    },

    async snapshot(): Promise<Record<string, Row[]>> {
      const tables = await db.tableNames();
      const dump: Record<string, Row[]> = {};
      for (const table of tables) dump[table] = handle.prepare(`SELECT * FROM ${table}`).all() as Row[];
      return dump;
    },

    async close(): Promise<void> {
      handle.close();
    },
  };

  return db;
}
