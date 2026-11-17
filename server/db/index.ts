import path from 'node:path';
import { schemaStatements } from './schema.js';
import { createSqliteDb } from './sqlite.js';
import { createMysqlDb } from './mysql.js';
import { isDuplicateIndexError } from './dialect.js';
import type { DB } from './types.js';

export type { DB } from './types.js';
export type { RunResult, Param, Row } from './types.js';
export { DbError } from './types.js';

export interface OpenOptions {
  /** SQLite file (ignored when a MySQL DSN is configured). `:memory:` for tests. */
  file?: string;
}

/**
 * Builds the connection described by the environment:
 *
 *   DATABASE_URL=mysql://user:password@host:3306/database
 *   ou MYSQL_HOST / MYSQL_PORT / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE
 *
 * Without a DSN the site falls back to the SQLite file in DB_PATH (local
 * development and tests only) — the production server refuses this mode.
 */
export async function openDb(options: OpenOptions | string = {}): Promise<DB> {
  const file = typeof options === 'string' ? options : options.file;
  const dsn = (process.env.DATABASE_URL ?? '').trim();
  // Un fichier explicitement demandé (tests, vérification de sauvegarde) force
  // SQLite : la configuration MySQL de l'environnement ne s'applique jamais à
  // une base de test ou à une restauration vérifiée.
  const useMysql = !file && (/^(mysql|mariadb):\/\//i.test(dsn) || Boolean(process.env.MYSQL_HOST));

  if (useMysql) {
    const db = createMysqlDb(
      /^(mysql|mariadb):\/\//i.test(dsn)
        ? { url: dsn.replace(/^mariadb:\/\//i, 'mysql://'), ssl: process.env.DB_SSL === 'true' || process.env.DB_SSL === '1' }
        : {
            host: process.env.MYSQL_HOST,
            port: Number(process.env.MYSQL_PORT ?? 3306),
            user: process.env.MYSQL_USER,
            password: process.env.MYSQL_PASSWORD,
            database: process.env.MYSQL_DATABASE,
            ssl: process.env.DB_SSL === 'true' || process.env.DB_SSL === '1',
          },
    );
    try {
      await db.get('SELECT 1 AS ok');
    } catch (error) {
      await db.close().catch(() => undefined);
      throw new Error(`Connexion MySQL impossible : ${(error as Error).message}`);
    }
    await migrate(db);
    return db;
  }

  const target = file ?? process.env.DB_PATH ?? path.join(process.cwd(), 'data', 'mirage.db');
  const db = createSqliteDb(target);
  await migrate(db);
  return db;
}

/** Applies the shared schema. Idempotent: safe on every boot and on every deploy. */
export async function migrate(db: DB): Promise<void> {
  for (const statement of schemaStatements(db.dialect)) {
    try {
      await db.exec(statement);
    } catch (error) {
      // MySQL refuse de recréer un index existant : ce n'est pas une erreur de migration.
      if (db.dialect === 'mysql' && isDuplicateIndexError(error)) continue;
      throw new Error(`Migration échouée sur "${statement.slice(0, 80)}…" : ${(error as Error).message}`);
    }
  }
}

/** Restaure un instantané logique dans une base vide (vérification de sauvegarde). */
/**
 * Réinsère un instantané logique (sauvegarde / restauration).
 *
 * L'ordre des tables d'un instantané n'est pas garanti : on insère donc par
 * passes successives et on reporte les tables dont une clé étrangère n'est pas
 * encore satisfaite. Une passe sans progrès signifie que l'instantané est
 * réellement incohérent : l'erreur est alors propagée (la transaction annule
 * tout, aucune restauration partielle).
 */
export async function insertSnapshot(db: DB, snapshot: Record<string, Record<string, unknown>[]>): Promise<number> {
  const queues = new Map<string, Record<string, unknown>[]>();
  for (const [table, entries] of Object.entries(snapshot)) {
    if (entries.length > 0) queues.set(table, [...entries]);
  }

  const isForeignKeyViolation = (error: unknown): boolean => {
    const code = (error as { code?: string }).code ?? '';
    const message = String((error as Error).message ?? '');
    return (
      code === 'ER_NO_REFERENCED_ROW_2' ||
      code === 'ER_ROW_IS_REFERENCED_2' ||
      code === 'SQLITE_CONSTRAINT_FOREIGNKEY' ||
      /foreign key/i.test(message)
    );
  };

  let rows = 0;
  await db.transaction(async () => {
    let remaining = [...queues.keys()];
    let lastError: unknown;
    while (remaining.length > 0) {
      const deferred: string[] = [];
      let progress = 0;
      for (const table of remaining) {
        const queue = queues.get(table)!;
        while (queue.length > 0) {
          const entry = queue[0];
          const columns = Object.keys(entry);
          if (columns.length === 0) {
            queue.shift();
            continue;
          }
          const sql = `INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`;
          try {
            await db.run(sql, columns.map((column) => entry[column] as never));
          } catch (error) {
            lastError = error;
            if (isForeignKeyViolation(error)) break;
            throw error;
          }
          queue.shift();
          rows += 1;
          progress += 1;
        }
        if (queue.length > 0) deferred.push(table);
      }
      if (deferred.length === 0) break;
      if (progress === 0) throw lastError;
      remaining = deferred;
    }
  });
  return rows;
}
