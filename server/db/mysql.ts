import { AsyncLocalStorage } from 'node:async_hooks';
import mysql, { type Pool, type PoolConnection, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';
import { buildInsert, normaliseParams, type DB, type Param, type Row, type RunResult } from './types.js';
import { upsertSql, insertIgnoreSql } from './dialect.js';

export interface MysqlOptions {
  url?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  ssl?: boolean | { rejectUnauthorized?: boolean };
  connectionLimit?: number;
}

/**
 * MySQL / MariaDB driver — production storage. Every statement is awaited and
 * transactions are bound to their own connection through AsyncLocalStorage so
 * concurrent requests never share a connection state.
 */
export function createMysqlDb(options: MysqlOptions): DB {
  const connectionLimit = options.connectionLimit ?? Number(process.env.DB_POOL_SIZE ?? 10);
  const pool: Pool = options.url
    ? mysql.createPool({
        uri: options.url,
        waitForConnections: true,
        connectionLimit,
        timezone: 'Z',
        dateStrings: false,
        charset: 'utf8mb4',
      })
    : mysql.createPool({
        host: options.host ?? '127.0.0.1',
        port: options.port ?? 3306,
        user: options.user,
        password: options.password,
        database: options.database,
        ssl: options.ssl,
        waitForConnections: true,
        connectionLimit,
        timezone: 'Z',
        charset: 'utf8mb4',
      });

  const binding = new AsyncLocalStorage<PoolConnection>();

  async function query<T>(sql: string, params: Param[] = []): Promise<T> {
    const connection = binding.getStore();
    const executor = connection ?? pool;
    const [result] = await executor.query(sql, normaliseParams(params));
    return result as T;
  }

  const db: DB = {
    dialect: 'mysql',

    async get<T = Row>(sql: string, params: Param[] = []): Promise<T | undefined> {
      const rows = await query<RowDataPacket[]>(sql, params);
      return (rows[0] as T | undefined) ?? undefined;
    },

    async all<T = Row>(sql: string, params: Param[] = []): Promise<T[]> {
      return (await query<RowDataPacket[]>(sql, params)) as unknown as T[];
    },

    async run(sql: string, params: Param[] = []): Promise<RunResult> {
      const result = await query<ResultSetHeader>(sql, params);
      return {
        lastInsertRowid: Number((result as ResultSetHeader)?.insertId ?? 0),
        changes: Number((result as ResultSetHeader)?.affectedRows ?? 0),
      };
    },

    async exec(sql: string): Promise<void> {
      const connection = binding.getStore();
      const statements = sql
        .split(';')
        .map((statement) => statement.trim())
        .filter(Boolean);
      for (const statement of statements) {
        if (connection) await connection.query(statement);
        else await pool.query(statement);
      }
    },

    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      if (binding.getStore()) return fn(); // déjà dans une transaction
      const connection = await pool.getConnection();
      await connection.beginTransaction();
      try {
        const result = await binding.run(connection, fn);
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },

    async upsert(table, row, conflictColumns) {
      const columns = Object.keys(row);
      await db.run(upsertSql('mysql', table, columns, conflictColumns), columns.map((column) => row[column]));
    },

    async insertIgnore(table, row) {
      const { params } = buildInsert(table, row);
      await db.run(insertIgnoreSql('mysql', table, Object.keys(row)), params);
    },

    async tableNames(): Promise<string[]> {
      const rows = await db.all<{ name: string }>(
        'SELECT TABLE_NAME AS name FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY TABLE_NAME',
      );
      return rows.map((row) => row.name);
    },

    async snapshot(): Promise<Record<string, Row[]>> {
      const tables = await db.tableNames();
      const dump: Record<string, Row[]> = {};
      for (const table of tables) dump[table] = await db.all<Row>(`SELECT * FROM ${table}`);
      return dump;
    },

    async close(): Promise<void> {
      await pool.end();
    },
  };

  return db;
}
