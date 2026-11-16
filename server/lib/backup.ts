import fs from 'node:fs';
import path from 'node:path';
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import Database from 'better-sqlite3';
import type { DB } from '../db.js';
import { BACKUP_DIR } from '../config.js';
import { newId } from './ids.js';

/**
 * §6.11 — encrypted backups with a mandatory verified restore (criterion #10).
 * AES-256-GCM over a consistent SQLite snapshot. The key comes from
 * BACKUP_ENCRYPTION_KEY, otherwise a local key file is generated with 0600.
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
}

export function createBackup(db: DB, dir = BACKUP_DIR, label = 'auto'): BackupResult {
  fs.mkdirSync(dir, { recursive: true });
  const createdAt = Date.now();
  const stamp = new Date(createdAt).toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `mirage-${label}-${stamp}.db.enc`);
  const metaFile = `${file}.meta.json`;

  // Consistent snapshot, even with WAL enabled.
  const snapshot = path.join(dir, `.snapshot-${randomBytes(6).toString('hex')}.db`);
  db.exec(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`);
  const plaintext = fs.readFileSync(snapshot);
  fs.unlinkSync(snapshot);

  const key = encryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([MAGIC, iv, tag, ciphertext]);
  fs.writeFileSync(file, payload, { mode: 0o600 });

  const sha256 = createHash('sha256').update(plaintext).digest('hex');
  const meta = {
    id: newId('bak'),
    label,
    createdAt,
    plaintextBytes: plaintext.length,
    encryptedBytes: payload.length,
    sha256,
    algorithm: 'aes-256-gcm',
    format: 'zmbk1',
  };
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2), { mode: 0o600 });

  db.prepare('INSERT INTO backup_runs (id,at,size_bytes,sha256,status,verified_at) VALUES (?,?,?,?,?,NULL)')
    .run(meta.id, createdAt, payload.length, sha256, 'created');

  return { id: meta.id, file, metaFile, sizeBytes: payload.length, sha256, createdAt };
}

export function readBackupPayload(file: string): { plaintext: Buffer; meta: Record<string, unknown> | null } {
  const payload = fs.readFileSync(file);
  if (!payload.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('BACKUP_FORMAT_INVALID');
  const iv = payload.subarray(MAGIC.length, MAGIC.length + 12);
  const tag = payload.subarray(MAGIC.length + 12, MAGIC.length + 28);
  const ciphertext = payload.subarray(MAGIC.length + 28);
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const metaPath = `${file}.meta.json`;
  const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : null;
  return { plaintext, meta };
}

export interface RestoreVerification {
  ok: boolean;
  file: string;
  checks: { name: string; ok: boolean; detail?: string }[];
  tables?: Record<string, number>;
}

/**
 * Full restore verification: decrypt, checksum, open the snapshot as a real
 * SQLite database, run integrity_check and count rows in every table.
 */
export function verifyBackup(file: string): RestoreVerification {
  const checks: { name: string; ok: boolean; detail?: string }[] = [];
  let plaintext: Buffer;
  let meta: Record<string, any> | null = null;
  try {
    const read = readBackupPayload(file);
    plaintext = read.plaintext;
    meta = read.meta as Record<string, any> | null;
    checks.push({ name: 'decryption', ok: true, detail: 'AES-256-GCM authentic tag verified' });
  } catch (error) {
    return { ok: false, file, checks: [{ name: 'decryption', ok: false, detail: String((error as Error).message) }] };
  }

  const digest = createHash('sha256').update(plaintext).digest('hex');
  const expected = meta?.sha256;
  checks.push({
    name: 'checksum',
    ok: !expected || expected === digest,
    detail: expected ? `sha256 ${digest.slice(0, 16)}…` : 'no recorded checksum',
  });

  const tmp = path.join(path.dirname(file), `.restore-check-${randomBytes(5).toString('hex')}.db`);
  fs.writeFileSync(tmp, plaintext, { mode: 0o600 });
  const tables: Record<string, number> = {};
  try {
    const restored = new Database(tmp, { readonly: true });
    const integrity = restored.pragma('integrity_check') as { integrity_check: string }[];
    checks.push({ name: 'sqlite_integrity', ok: integrity[0]?.integrity_check === 'ok', detail: integrity[0]?.integrity_check });
    const list = restored.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
    for (const table of list) {
      const row = restored.prepare(`SELECT COUNT(*) AS c FROM "${table.name}"`).get() as { c: number };
      tables[table.name] = row.c;
    }
    const critical = ['users', 'sessions', 'content', 'audit_log', 'servers', 'stat_entries'];
    checks.push({
      name: 'critical_tables',
      ok: critical.every((t) => t in tables),
      detail: `${Object.keys(tables).length} tables`,
    });
    restored.close();
  } catch (error) {
    checks.push({ name: 'sqlite_open', ok: false, detail: String((error as Error).message) });
  } finally {
    fs.rmSync(tmp, { force: true });
  }

  const ok = checks.every((c) => c.ok);
  return { ok, file, checks, tables };
}

export function listBackups(dir = BACKUP_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.db.enc'))
    .map((f) => {
      const full = path.join(dir, f);
      const stat = fs.statSync(full);
      return { file: f, path: full, sizeBytes: stat.size, createdAt: stat.mtimeMs };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function latestBackup(dir = BACKUP_DIR): string | null {
  const list = listBackups(dir);
  return list.length ? list[0].path : null;
}
