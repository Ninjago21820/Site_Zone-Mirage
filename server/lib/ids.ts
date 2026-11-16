import { randomBytes, randomInt, createHash, timingSafeEqual } from 'node:crypto';
import type { DB } from '../db.js';

const MIRAGE_RE = /^MIRAGE:[0-9]\.[0-9]{2}\.[0-9]{18}$/;

/**
 * Mirage ID — §5.2
 * Format: MIRAGE:A.BB.CCCCCCCCCCCCCCCCCC
 *   A  = millennia digit of the creation year (2026 -> 2)
 *   BB = last two digits of the creation year (26)
 *   C  = 18 cryptographically random digits
 * Immutable, unique, and reserved forever (also after account deletion).
 */
export function buildMirageId(createdAtMs: number, digits: string): string {
  const year = new Date(createdAtMs).getUTCFullYear();
  const millennium = Math.floor(year / 1000);
  const yy = String(year % 100).padStart(2, '0');
  return `MIRAGE:${millennium}.${yy}.${digits}`;
}

export function randomDigits(n: number): string {
  let out = '';
  for (let i = 0; i < n; i++) out += String(randomInt(0, 10));
  return out;
}

export function isValidMirageId(id: string): boolean {
  return MIRAGE_RE.test(id);
}

/**
 * Generate a guaranteed-unused Mirage ID and reserve it permanently.
 * Reserved IDs are never handed out again, even if the account is deleted.
 */
export function mirageIdFor(db: DB, createdAtMs = Date.now()): string {
  const check = db.prepare('SELECT 1 AS hit FROM reserved_mirage_ids WHERE mirage_id = ?');
  const userCheck = db.prepare('SELECT 1 AS hit FROM users WHERE mirage_id = ?');
  for (let attempt = 0; attempt < 64; attempt++) {
    const candidate = buildMirageId(createdAtMs, randomDigits(18));
    if (check.get(candidate) || userCheck.get(candidate)) continue;
    db.prepare('INSERT INTO reserved_mirage_ids (mirage_id, reason, created_at) VALUES (?,?,?)')
      .run(candidate, 'issued', Date.now());
    return candidate;
  }
  throw new Error('MIRAGE_ID_EXHAUSTED');
}

export function reserveMirageId(db: DB, id: string, reason: string) {
  if (!isValidMirageId(id)) throw new Error('INVALID_MIRAGE_ID');
  db.prepare('INSERT OR IGNORE INTO reserved_mirage_ids (mirage_id, reason, created_at) VALUES (?,?,?)')
    .run(id, reason, Date.now());
}

export const newId = (prefix: string) => `${prefix}_${randomBytes(16).toString('base64url')}`;
export const newToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
export const sha1 = (value: string) => createHash('sha1').update(value, 'utf8').digest('hex');

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Truncate an IP for audit retention (§6.12: full IP kept 30 days, then truncated). */
export function truncateIp(ip: string): string {
  if (!ip) return '';
  if (ip.includes(':')) {
    const parts = ip.split(':').filter(Boolean);
    return `${parts.slice(0, 3).join(':')}::/48`;
  }
  const parts = ip.split('.');
  if (parts.length !== 4) return 'hidden';
  return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
}
