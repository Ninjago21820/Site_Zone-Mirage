import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { bind, buildInsert, normaliseParams, type DB, type Param, type Params, type Row, type RunResult } from './types.js';
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

  const api: DB = {
    dialect: 'sqlite',

    async get<T = Row>(sql: string, params: Params = []): Promise<T | undefined> {
      const bound = bind(sql, params);
      return handle.prepare(bound.sql).get(...bound.values) as T | undefined;
    },

    async all<T = Row>(sql: string, params: Params = []): Promise<T[]> {
      const bound = bind(sql, params);
      return handle.prepare(bound.sql).all(...bound.values) as T[];
    },

    async run(sql: string, params: Params = []): Promise<RunResult> {
      const bound = bind(sql, params);
      const info = handle.prepare(bound.sql).run(...bound.values);
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
          /* transaction already closed */
        }
        throw error;
      }
    },

    async upsert(table, row, conflictColumns) {
      const columns = Object.keys(row);
      const sql = upsertSql('sqlite', table, columns, conflictColumns);
      handle.prepare(sql).run(...normaliseParams(columns.map((column) => row[column] as Param)));
    },

    async insertIgnore(table, row) {
      const { params } = buildInsert(table, row);
      handle.prepare(insertIgnoreSql('sqlite', table, Object.keys(row))).run(...normaliseParams(params));
    },

    async tableNames(): Promise<string[]> {
      const rows = handle
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all() as { name: string }[];
      return rows.map((row) => row.name);
    },

    async snapshot(): Promise<Record<string, Row[]>> {
      const dump: Record<string, Row[]> = {};
      for (const table of api.tableNames ? await api.tableNames() : []) {
        dump[table] = handle.prepare(`SELECT * FROM ${table}`).all() as Row[];
      }
      return dump;
    },

    async close(): Promise<void> {
      handle.close();
    },
  };

  return api;
}
