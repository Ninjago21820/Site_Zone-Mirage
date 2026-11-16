import argon2 from 'argon2';
import { sha1 } from './ids.js';

export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB (OWASP baseline)
  timeCost: 2,
  parallelism: 1,
} as const;

export const MIN_PASSWORD_PLAYER = 12;
export const MIN_PASSWORD_STAFF = 14;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string | null | undefined, password: string): Promise<boolean> {
  if (!hash) return false;
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/** Constant-ish work factor used to equalise timing on unknown accounts (§6.5). */
export const DUMMY_HASH = argon2.hash('dummy-password-value-for-timing', ARGON2_OPTIONS);

export type PasswordIssue =
  | 'too_short'
  | 'contains_identifier'
  | 'pwned'
  | 'too_weak'
  | 'repeated';

export interface PasswordPolicyResult {
  ok: boolean;
  issues: PasswordIssue[];
  strength: number; // 0..4
  minLength: number;
}

const COMMON_PATTERNS = [/^password/i, /^motdepasse/i, /^azerty/i, /^qwerty/i, /^123456/, /^admin/i, /^letmein/i, /^welcome/i, /^scp[-_]?mirage$/i];

export function estimateStrength(password: string): number {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 12) score++;
  if (password.length >= 16) score++;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  if (classes >= 3) score++;
  if (classes === 4) score++;
  if (/(.)\1{3,}/.test(password)) score--;
  if (COMMON_PATTERNS.some((r) => r.test(password))) score = Math.min(score, 1);
  return Math.max(0, Math.min(4, score));
}

/**
 * k-anonymity check against the Pwned Passwords range API (§6.3).
 * Only the first 5 hex chars of the SHA-1 hash ever leave the server.
 * Network failure is fail-open: an unreachable service never blocks registration.
 */
export async function pwnedCount(password: string, timeoutMs = 2500): Promise<number | null> {
  const digest = sha1(password).toUpperCase();
  const prefix = digest.slice(0, 5);
  const suffix = digest.slice(5);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      signal: controller.signal,
      headers: { 'Add-Padding': 'true', 'User-Agent': 'SCP-Mirage-Protocol-Site/1.3' },
    });
    if (!res.ok) return null;
    const body = await res.text();
    for (const line of body.split('\n')) {
      const [hashSuffix, countRaw] = line.trim().split(':');
      if (hashSuffix && hashSuffix.toUpperCase() === suffix) {
        const count = Number.parseInt(countRaw ?? '0', 10);
        return Number.isFinite(count) ? count : 0;
      }
    }
    return 0;
  } catch {
    return null; // fail-open
  } finally {
    clearTimeout(timer);
  }
}

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Reject passwords containing the username or the email local-part (§6.3). */
export function containsIdentifier(password: string, identifiers: (string | null | undefined)[]): boolean {
  const pass = normalise(password);
  for (const raw of identifiers) {
    if (!raw) continue;
    const candidate = normalise(raw.includes('@') ? raw.split('@')[0] : raw);
    if (candidate.length >= 3 && pass.includes(candidate)) return true;
    const full = normalise(raw);
    if (full.length >= 3 && pass.includes(full)) return true;
  }
  return false;
}

export async function evaluatePassword(
  password: string,
  opts: { staff?: boolean; identifiers?: (string | null | undefined)[]; skipPwned?: boolean },
): Promise<PasswordPolicyResult> {
  const minLength = opts.staff ? MIN_PASSWORD_STAFF : MIN_PASSWORD_PLAYER;
  const issues: PasswordIssue[] = [];
  if (typeof password !== 'string' || password.length < minLength) issues.push('too_short');
  if (containsIdentifier(password, opts.identifiers ?? [])) issues.push('contains_identifier');
  if (/(.)\1{5,}/.test(password)) issues.push('repeated');
  const strength = estimateStrength(password);
  if (strength < 2) issues.push('too_weak');
  if (!issues.includes('too_short') && !opts.skipPwned) {
    const count = await pwnedCount(password);
    if (count && count > 0) issues.push('pwned');
  }
  return { ok: issues.length === 0, issues, strength, minLength };
}
