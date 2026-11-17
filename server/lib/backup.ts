import fs from 'node:fs';
import path from 'node:path';
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import type { DB } from '../db.js';
import { BACKUP_DIR } from '../config.js';
import { newId } from './ids.js';
import { createSqliteDb } from '../db/sqlite.js';
import { schemaStatements } from '../db/schema.js';
import { insertSnapshot } from '../db/index.js';

/**
 * §6.11 — sauvegardes chiffrées avec restauration vérifiée (critère #10).
 *
 * La sauvegarde est un **instantané logique** (un SELECT * par table, encodé en
 * JSON puis chiffré en AES-256-GCM) : il fonctionne donc à l'identique sur
 * MySQL/MariaDB en production et sur SQLite en développement, sans dépendre
 * d'un utilitaire externe (mysqldump, VACUUM INTO…).
 *
 * La vérification restaure réellement l'instantané dans une base SQLite en
 * mémoire : si les lignes ne peuvent pas être réinsérées, la sauvegarde est
 * déclarée non restaurable et la commande sort en erreur.
 */

const MAGIC = Buffer.from('ZMBK1');

export function encryptionKey(): Buffer {
  const env = process.env.BACKUP_ENCRYPTION_KEY;
  if (env && env.length >= 32) return scryptSync(env, 'zm-backup-salt', 32);
  const keyFile = path.join(BACKUP_DIR, '.backup-key');
  if (fs.existsSync(keyFile)) {
    const raw = fs.readFileSync(keyFile, 'utf8').trim();
    if (raw.length >= 64) {
      const key = Buffer.from(raw, 'hex');
      if (key.length === 32) return key;
    }
  }
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const key = randomBytes(32);
  fs.writeFileSync(keyFile, key.toString('hex'), { mode: 0o600 });
  return key;
}

export interface BackupResult {
  id: string;
  file: string;
  metaFile: string;
  sizeBytes: number;
  sha256: string;
  createdAt: number;
  tables: Record<string, number>;
}

export async function createBackup(db: DB, dir = BACKUP_DIR, label = 'auto'): Promise<BackupResult> {
  fs.mkdirSync(dir, { recursive: true });
  const createdAt = Date.now();
  const stamp = new Date(createdAt).toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `mirage-${label}-${stamp}.zmbk1`);
  const metaFile = `${file}.meta.json`;

  const snapshot = await db.snapshot();
  const tables: Record<string, number> = {};
  for (const [table, rows] of Object.entries(snapshot)) tables[table] = rows.length;

  const payload = Buffer.from(JSON.stringify({ format: 'zmbk1', createdAt, dialect: db.dialect, tables: snapshot }), 'utf8');
  const key = encryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  const tag = cipher.getAuthTag();
  const encrypted = Buffer.concat([MAGIC, iv, tag, ciphertext]);
  fs.writeFileSync(file, encrypted, { mode: 0o600 });

  const sha256 = createHash('sha256').update(payload).digest('hex');
  const meta = {
    id: newId('bak'),
    label,
    createdAt,
    plaintextBytes: payload.length,
    encryptedBytes: encrypted.length,
    sha256,
    algorithm: 'aes-256-gcm',
    format: 'zmbk1',
    tables,
  };
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2), { mode: 0o600 });

  await db.run(
    'INSERT INTO backup_runs (id,at,size_bytes,sha256,status,verified_at) VALUES (?,?,?,?,?,NULL)',
    [meta.id, createdAt, encrypted.length, sha256, 'created'],
  );

  return { id: meta.id, file, metaFile, sizeBytes: encrypted.length, sha256, createdAt, tables };
}

export function readBackupPayload(file: string): { plaintext: Buffer; meta: Record<string, unknown> | null } {
  const raw = fs.readFileSync(file);
  if (!raw.subarray(0, 5).equals(MAGIC)) throw new Error('Format de sauvegarde inconnu (magic ZMBK1 attendu).');
  const iv = raw.subarray(5, 17);
  const tag = raw.subarray(17, 33);
  const ciphertext = raw.subarray(33);
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const metaFile = `${file}.meta.json`;
  const meta = fs.existsSync(metaFile) ? (JSON.parse(fs.readFileSync(metaFile, 'utf8')) as Record<string, unknown>) : null;
  return { plaintext, meta };
}

export interface RestoreVerification {
  ok: boolean;
  file: string;
  checks: { name: string; ok: boolean; detail?: string }[];
  tables?: Record<string, number>;
}

/**
 * Vérification complète : déchiffrement, empreinte, validation de la
 * structure, puis **restauration réelle** dans une base SQLite en mémoire.
 */
export async function verifyBackup(file: string): Promise<RestoreVerification> {
  const checks: { name: string; ok: boolean; detail?: string }[] = [];
  let plaintext: Buffer;
  let meta: Record<string, any> | null = null;
  try {
    const read = readBackupPayload(file);
    plaintext = read.plaintext;
    meta = read.meta;
    checks.push({ name: 'decryption', ok: true, detail: 'tag AES-256-GCM vérifié' });
  } catch (error) {
    return { ok: false, file, checks: [{ name: 'decryption', ok: false, detail: String((error as Error).message) }] };
  }

  const digest = createHash('sha256').update(plaintext).digest('hex');
  const expected = meta?.sha256 as string | undefined;
  checks.push({
    name: 'checksum',
    ok: !expected || expected === digest,
    detail: expected ? `sha256 ${digest.slice(0, 16)}…` : 'aucune empreinte enregistrée',
  });

  let parsed: { tables?: Record<string, Record<string, unknown>[]> };
  try {
    parsed = JSON.parse(plaintext.toString('utf8'));
    checks.push({ name: 'structure', ok: !!parsed.tables, detail: `${Object.keys(parsed.tables ?? {}).length} tables` });
  } catch (error) {
    checks.push({ name: 'structure', ok: false, detail: String((error as Error).message) });
    return { ok: false, file, checks };
  }

  // Restauration réelle dans une base SQLite en mémoire.
  const restored = createSqliteDb(':memory:');
  const tables: Record<string, number> = {};
  try {
    for (const statement of schemaStatements('sqlite')) await restored.exec(statement);
    await insertSnapshot(restored, parsed.tables ?? {});
    for (const [table, rows] of Object.entries(parsed.tables ?? {})) tables[table] = rows.length;
    checks.push({ name: 'restore', ok: true, detail: `${Object.values(tables).reduce((a, b) => a + b, 0)} lignes réinsérées` });

    const critical = ['users', 'sessions', 'content', 'audit_log', 'servers', 'stat_entries'];
    const missing = critical.filter((table) => !(table in tables));
    checks.push({
      name: 'critical_tables',
      ok: missing.length === 0,
      detail: missing.length ? `manquantes : ${missing.join(', ')}` : `${Object.keys(tables).length} tables`,
    });

    let mismatched = 0;
    for (const [table, rows] of Object.entries(parsed.tables ?? {})) {
      const row = (await restored.get(`SELECT COUNT(*) AS c FROM ${table}`)) as { c: number } | undefined;
      if (!row || Number(row.c) !== rows.length) mismatched += 1;
    }
    checks.push({ name: 'row_counts', ok: mismatched === 0, detail: mismatched ? `${mismatched} table(s) incohérente(s)` : 'comptages identiques' });
  } catch (error) {
    checks.push({ name: 'restore', ok: false, detail: String((error as Error).message) });
  } finally {
    await restored.close().catch(() => undefined);
  }

  return { ok: checks.every((check) => check.ok), file, checks, tables };
}

/** Restauration d'une sauvegarde dans la base courante (opération explicite). */
export async function restoreInto(db: DB, file: string): Promise<number> {
  const { plaintext } = readBackupPayload(file);
  const parsed = JSON.parse(plaintext.toString('utf8')) as { tables?: Record<string, Record<string, unknown>[]> };
  if (!parsed.tables) throw new Error('Sauvegarde sans données.');
  return insertSnapshot(db, parsed.tables);
}

export function listBackups(dir = BACKUP_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.zmbk1'))
    .map((name) => {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      const metaFile = `${full}.meta.json`;
      const meta = fs.existsSync(metaFile) ? (JSON.parse(fs.readFileSync(metaFile, 'utf8')) as Record<string, unknown>) : null;
      return { file: full, name, sizeBytes: stat.size, createdAt: stat.mtimeMs, meta };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function latestBackup(dir = BACKUP_DIR): string | null {
  return listBackups(dir)[0]?.file ?? null;
}
