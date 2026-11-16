import { createHmac, randomBytes } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/g, '').toUpperCase().replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const idx = ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

/** RFC 6238 TOTP, 6 digits, 30 s period, HMAC-SHA1. */
export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secret).update(buf).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export const PERIOD_SECONDS = 30;
export const currentStep = (atMs = Date.now()) => Math.floor(atMs / 1000 / PERIOD_SECONDS);

export function totpAt(secretBase32: string, atMs = Date.now()): string {
  return hotp(base32Decode(secretBase32), currentStep(atMs));
}

export function buildOtpAuthUrl(secret: string, account: string, issuer = 'SCP: Mirage Protocol'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${label}?${params.toString()}`;
}

export interface TotpVerifyResult {
  ok: boolean;
  /** Step that was accepted — must be stored to prevent replay inside the window. */
  step?: number;
  reason?: 'code_mismatch' | 'replay' | 'no_secret';
}

/**
 * Verify a TOTP code with a ±1 step window and enforce anti-replay:
 * a step already consumed for this account can never be accepted again.
 */
export function verifyTotp(
  secretBase32: string | null | undefined,
  code: string,
  lastUsedStep: number | null | undefined,
  atMs = Date.now(),
  window = 1,
): TotpVerifyResult {
  if (!secretBase32) return { ok: false, reason: 'no_secret' };
  const cleaned = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(cleaned)) return { ok: false, reason: 'code_mismatch' };
  const secret = base32Decode(secretBase32);
  const step = currentStep(atMs);
  let matched: number | undefined;
  for (let offset = -window; offset <= window; offset++) {
    const candidateStep = step + offset;
    if (candidateStep < 0) continue;
    if (hotp(secret, candidateStep) === cleaned) {
      matched = candidateStep;
      break;
    }
  }
  if (matched === undefined) return { ok: false, reason: 'code_mismatch' };
  if (lastUsedStep != null && matched <= lastUsedStep) return { ok: false, reason: 'replay' };
  return { ok: true, step: matched };
}
