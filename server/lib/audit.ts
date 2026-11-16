import { createHash } from 'node:crypto';
import type { DB } from '../db.js';
import { newId } from './ids.js';

export interface AuditEntry {
  actorId?: string | null;
  actorRole?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  ipTrunc?: string | null;
  meta?: Record<string, unknown>;
}

/**
 * Append-only audit log (§6.12) with a SHA-256 hash chain: each row commits to
 * the previous one, so a deleted or edited row breaks verification.
 * Retention: 12 months, IP truncated after 30 days (see purgeAudit).
 */
export function appendAudit(db: DB, entry: AuditEntry): { id: number; hash: string } {
  const last = db.prepare('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1').get() as { hash: string } | undefined;
  const prevHash = last?.hash ?? 'GENESIS';
  const at = Date.now();
  const meta = JSON.stringify(entry.meta ?? {});
  const payload = [
    at,
    entry.actorId ?? '',
    entry.actorRole ?? '',
    entry.action,
    entry.targetType ?? '',
    entry.targetId ?? '',
    entry.ipTrunc ?? '',
    meta,
    prevHash,
  ].join('|');
  const hash = createHash('sha256').update(payload).digest('hex');
  const info = db.prepare(
    `INSERT INTO audit_log (at,actor_id,actor_role,action,target_type,target_id,ip_trunc,meta_json,prev_hash,hash)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(at, entry.actorId ?? null, entry.actorRole ?? null, entry.action, entry.targetType ?? null,
    entry.targetId ?? null, entry.ipTrunc ?? null, meta, prevHash, hash);
  return { id: Number(info.lastInsertRowid), hash };
}

/** Verify the integrity of the whole chain. Returns the first broken row, if any. */
export function verifyAuditChain(db: DB): { ok: boolean; brokenAt?: number; checked: number } {
  const rows = db.prepare('SELECT * FROM audit_log ORDER BY id ASC').all() as {
    id: number; at: number; actor_id: string | null; actor_role: string | null; action: string;
    target_type: string | null; target_id: string | null; ip_trunc: string | null; meta_json: string;
    prev_hash: string; hash: string;
  }[];
  let prev = 'GENESIS';
  let checked = 0;
  for (const row of rows) {
    const payload = [
      row.at, row.actor_id ?? '', row.actor_role ?? '', row.action, row.target_type ?? '',
      row.target_id ?? '', row.ip_trunc ?? '', row.meta_json, prev,
    ].join('|');
    const expected = createHash('sha256').update(payload).digest('hex');
    if (row.prev_hash !== prev || row.hash !== expected) return { ok: false, brokenAt: row.id, checked };
    prev = row.hash;
    checked++;
  }
  return { ok: true, checked };
}

/** Retention: drop rows older than 12 months, truncate IPs after 30 days. */
export function purgeAudit(db: DB, now = Date.now()) {
  const twelveMonths = 365 * 24 * 60 * 60 * 1000;
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  db.prepare('DELETE FROM audit_log WHERE at < ?').run(now - twelveMonths);
  db.prepare(`UPDATE audit_log SET ip_trunc = 'anonymisé'
              WHERE at < ? AND ip_trunc IS NOT NULL AND ip_trunc NOT IN ('anonymisé','')`)
    .run(now - thirtyDays);
}

export function auditId(prefix = 'aud') {
  return newId(prefix);
}
