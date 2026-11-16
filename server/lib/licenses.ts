import { createHmac, generateKeyPairSync, randomBytes, sign, verify, createPublicKey } from 'node:crypto';
import type { DB } from '../db.js';

/**
 * §5.4 — asymmetric licence tokens.
 * The private key never leaves the API process; the game verifies with the
 * published public key and a `kid` that supports rotation.
 */

export interface SigningKey {
  kid: string;
  publicKey: string; // PEM
  privateKey: string; // PEM
  algorithm: string;
}

export function ensureSigningKey(db: DB): SigningKey {
  const existing = db.prepare("SELECT * FROM api_keys WHERE revoked_at IS NULL ORDER BY created_at DESC LIMIT 1")
    .get() as SigningKey | undefined;
  if (existing) return existing;
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const kid = `zm-${new Date().toISOString().slice(0, 7).replace('-', '')}-${randomBytes(3).toString('hex')}`;
  const row: SigningKey = {
    kid,
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    algorithm: 'Ed25519',
  };
  db.prepare('INSERT INTO api_keys (kid,algorithm,public_key,private_key,created_at) VALUES (?,?,?,?,?)')
    .run(row.kid, row.algorithm, row.publicKey, row.privateKey, Date.now());
  return row;
}

export function publicSigningKeys(db: DB) {
  return (db.prepare('SELECT kid,algorithm,public_key,created_at,revoked_at FROM api_keys ORDER BY created_at DESC').all() as {
    kid: string; algorithm: string; public_key: string; created_at: number; revoked_at: number | null;
  }[]).map((k) => ({
    kid: k.kid,
    algorithm: k.algorithm,
    publicKey: k.public_key,
    jwk: createPublicKey(k.public_key).export({ format: 'jwk' }),
    createdAt: k.created_at,
    revoked: !!k.revoked_at,
  }));
}

export interface LicenseClaims {
  sub: string; // internal user id
  mid: string; // Mirage ID
  provider: 'steam' | 'epic';
  appId: string;
  ownership: 'self' | 'shared';
  scope: ('story' | 'online')[];
  iat: number;
  exp: number;
  kid?: string;
  jti?: string;
}

export function signLicenseToken(db: DB, claims: Omit<LicenseClaims, 'kid'>): { token: string; claims: LicenseClaims } {
  const key = ensureSigningKey(db);
  const full: LicenseClaims = { ...claims, kid: key.kid, jti: claims.jti ?? randomBytes(9).toString('base64url') };
  const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT', kid: key.kid })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(full)).toString('base64url');
  const signature = sign(null, Buffer.from(`${header}.${payload}`), key.privateKey).toString('base64url');
  return { token: `${header}.${payload}.${signature}`, claims: full };
}

export function verifyLicenseToken(db: DB, token: string): { valid: boolean; claims?: LicenseClaims; reason?: string } {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) return { valid: false, reason: 'malformed' };
  const [header, payload, signature] = parts;
  let parsedHeader: { kid?: string; alg?: string };
  let claims: LicenseClaims;
  try {
    parsedHeader = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { valid: false, reason: 'malformed' };
  }
  const row = db.prepare('SELECT public_key, revoked_at FROM api_keys WHERE kid = ?').get(parsedHeader.kid) as
    | { public_key: string; revoked_at: number | null }
    | undefined;
  if (!row || row.revoked_at) return { valid: false, reason: 'unknown_kid' };
  const ok = verify(null, Buffer.from(`${header}.${payload}`), row.public_key, Buffer.from(signature, 'base64url'));
  if (!ok) return { valid: false, reason: 'bad_signature' };
  if (claims.exp * 1000 < Date.now()) return { valid: false, reason: 'expired' };
  return { valid: true, claims };
}

/** §5.5 — single-use, short-lived, server-bound session ticket. */
export function issueSessionTicket(db: DB, userId: string, serverId: string, ttlMs = 60_000) {
  const jti = randomBytes(24).toString('base64url');
  const now = Date.now();
  db.prepare('INSERT INTO game_session_tickets (jti,user_id,server_id,issued_at,expires_at) VALUES (?,?,?,?,?)')
    .run(jti, userId, serverId, now, now + ttlMs);
  return { ticket: jti, expiresAt: now + ttlMs, serverId };
}

export function consumeSessionTicket(db: DB, jti: string, serverId: string) {
  const row = db.prepare('SELECT * FROM game_session_tickets WHERE jti = ?').get(jti) as
    | { jti: string; user_id: string; server_id: string; expires_at: number; used_at: number | null }
    | undefined;
  if (!row) return { ok: false as const, reason: 'unknown_ticket' };
  if (row.server_id !== serverId) return { ok: false as const, reason: 'wrong_server' };
  if (row.used_at) return { ok: false as const, reason: 'already_used' };
  if (row.expires_at < Date.now()) return { ok: false as const, reason: 'expired' };
  db.prepare('UPDATE game_session_tickets SET used_at = ? WHERE jti = ?').run(Date.now(), jti);
  return { ok: true as const, userId: row.user_id };
}

/** Deterministic per-server secret used to sign stats payloads. */
export function serverSecret(serverId: string): string {
  const master = process.env.STATS_MASTER_SECRET ?? 'dev-stats-master-secret-not-for-production';
  return createHmac('sha256', master).update(serverId).digest('base64url');
}

export function signStatsPayload(serverId: string, payload: unknown): string {
  return createHmac('sha256', serverSecret(serverId)).update(stableStringify(payload)).digest('hex');
}

export function verifyStatsSignature(serverId: string, payload: unknown, signature: string): boolean {
  const expected = signStatsPayload(serverId, payload);
  return typeof signature === 'string' && signature.length === expected.length &&
    Buffer.from(signature).equals(Buffer.from(expected));
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}
