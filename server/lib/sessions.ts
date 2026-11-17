import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '../db.js';
import { newId, newToken, sha256, truncateIp } from './ids.js';
import { SESSION_POLICY } from '../config.js';

export interface SessionRow {
  id: string;
  user_id: string;
  csrf_token: string;
  created_at: number;
  last_seen: number;
  expires_at: number;
  absolute_expires_at: number;
  ip_trunc: string;
  ip_hash: string;
  user_agent: string;
  device_label: string;
  mfa_verified: number;
  revoked_at: number | null;
  revoked_reason: string | null;
}

export function isStaffRole(role: string): boolean {
  return role !== 'player';
}

export function policyFor(role: string) {
  return isStaffRole(role) ? SESSION_POLICY.staff : SESSION_POLICY.player;
}

export function deviceLabel(ua: string): string {
  const value = ua || '';
  const browser =
    /Edg\//.test(value) ? 'Edge' :
    /OPR\//.test(value) ? 'Opera' :
    /Firefox\//.test(value) ? 'Firefox' :
    /Chrome\//.test(value) ? 'Chrome' :
    /Safari\//.test(value) ? 'Safari' : 'Navigateur inconnu';
  const os =
    /Windows/.test(value) ? 'Windows' :
    /Mac OS X|Macintosh/.test(value) ? 'macOS' :
    /Android/.test(value) ? 'Android' :
    /iPhone|iPad|iOS/.test(value) ? 'iOS' :
    /Linux/.test(value) ? 'Linux' : 'Système inconnu';
  return `${browser} · ${os}`;
}

export function contextHash(ip: string, ua: string): string {
  return sha256(`${truncateIp(ip)}|${ua}`).slice(0, 32);
}

export async function createSession(
  db: DB,
  params: { userId: string; role: string; ip: string; userAgent: string; mfaVerified: boolean },
): Promise<{ token: string; session: SessionRow }> {
  const token = newToken(32);
  const id = sha256(token);
  const policy = policyFor(params.role);
  const now = Date.now();
  const csrf = newToken(24);
  await db.run(`INSERT INTO sessions
    (id,user_id,csrf_token,created_at,last_seen,expires_at,absolute_expires_at,ip_trunc,ip_hash,user_agent,device_label,mfa_verified,revoked_at,revoked_reason)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL)`, [id, params.userId, csrf, now, now, now + policy.idleMs, now + policy.absoluteMs, truncateIp(params.ip), sha256(params.ip || 'unknown'), params.userAgent ?? '', deviceLabel(params.userAgent ?? ''), params.mfaVerified ? 1 : 0]);
  const session = await db.get('SELECT * FROM sessions WHERE id = ?', [id]) as SessionRow;
  return { token, session };
}

export interface LoadedSession {
  session: SessionRow;
  token: string;
  expired: boolean;
  contextChanged: boolean;
}

export async function loadSession(db: DB, token: string | undefined, ip: string, ua: string): Promise<LoadedSession | null> {
  if (!token) return null;
  const id = sha256(token);
  const session = await db.get('SELECT * FROM sessions WHERE id = ?', [id]) as SessionRow | undefined;
  if (!session) return null;
  if (session.revoked_at) return { session, token, expired: true, contextChanged: false };
  const now = Date.now();
  if (now > session.expires_at || now > session.absolute_expires_at) {
    return { session, token, expired: true, contextChanged: false };
  }
  const changed = session.ip_trunc !== truncateIp(ip) || session.user_agent !== (ua ?? '');
  return { session, token, expired: false, contextChanged: changed };
}

/** Sliding idle expiry, capped by the absolute lifetime. */
export async function touchSession(db: DB, session: SessionRow, role: string) {
  const now = Date.now();
  if (now - session.last_seen < 60_000) return;
  const policy = policyFor(role);
  const expiresAt = Math.min(now + policy.idleMs, session.absolute_expires_at);
  await db.run('UPDATE sessions SET last_seen = ?, expires_at = ? WHERE id = ?', [now, expiresAt, session.id]);
}

export async function markMfaVerified(db: DB, sessionId: string) {
  await db.run('UPDATE sessions SET mfa_verified = 1 WHERE id = ?', [sessionId]);
}

export async function rotateSession(db: DB, session: SessionRow, role: string, ip: string, ua: string, mfa: boolean) {
  await db.run('UPDATE sessions SET revoked_at = ?, revoked_reason = ? WHERE id = ?', [Date.now(), 'rotated', session.id]);
  const userId = session.user_id;
  return await createSession(db, { userId, role, ip, userAgent: ua, mfaVerified: mfa });
}

export async function revokeSession(db: DB, sessionId: string, reason = 'user') {
  await db.run('UPDATE sessions SET revoked_at = ?, revoked_reason = ? WHERE id = ? AND revoked_at IS NULL', [Date.now(), reason, sessionId]);
}

/** §6.8 criterion #6 — revoke every other session after a password / 2FA change. */
export async function revokeAllForUser(db: DB, userId: string, exceptSessionId: string | null, reason: string): Promise<number> {
  const info = await db.run(`UPDATE sessions SET revoked_at = ?, revoked_reason = ?
     WHERE user_id = ? AND revoked_at IS NULL AND id IS NOT ?`, [Date.now(), reason, userId, exceptSessionId]);
  return info.changes;
}

export async function listSessions(db: DB, userId: string) {
  return await db.all(`SELECT id, created_at, last_seen, expires_at, absolute_expires_at, ip_trunc, device_label, user_agent, mfa_verified, revoked_at
     FROM sessions WHERE user_id = ? ORDER BY last_seen DESC LIMIT 50`, [userId]);
}

export async function setReauth(db: DB, userId: string) {
  await db.run('UPDATE users SET reauth_at = ? WHERE id = ?', [Date.now(), userId]);
}

export function describeSession(session: SessionRow) {
  return {
    id: session.id.slice(0, 12),
    device: session.device_label,
    ip: session.ip_trunc,
    createdAt: session.created_at,
    lastSeen: session.last_seen,
    expiresAt: session.expires_at,
    absoluteExpiresAt: session.absolute_expires_at,
    mfa: !!session.mfa_verified,
    revoked: !!session.revoked_at,
  };
}

export function writeSessionMeta(dir: string, payload: Record<string, unknown>) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'session-meta.json'), JSON.stringify(payload, null, 2));
}

export const sessionIdForToken = (token: string) => sha256(token);
export const newTicketId = () => newId('tkt');
