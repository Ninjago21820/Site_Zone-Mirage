import type { NextFunction, Request, Response } from 'express';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { CSRF_COOKIE, IS_PROD, COOKIE_PATH, TURNSTILE_SECRET, TURNSTILE_SITE_KEY } from '../config.js';
import { truncateIp } from '../lib/ids.js';

export function clientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const first = (raw ?? '').split(',')[0].trim();
  return first || req.socket.remoteAddress || '';
}

/**
 * Strict security headers (§6.13).
 * CSP is iframe-safe during development so the live preview can embed the app,
 * and locks down to `frame-ancestors 'none'` in production.
 */
export function securityHeaders() {
  return (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    res.setHeader('X-XSS-Protection', '0');
    if (IS_PROD) {
      res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    }
    const frameAncestors = IS_PROD
      ? "frame-ancestors 'none'"
      : "frame-ancestors 'self' https: http:";
    const scriptSrc = IS_PROD ? "'self'" : "'self' 'unsafe-inline' 'unsafe-eval'";
    const connectSrc = IS_PROD ? "'self'" : "'self' ws: wss: http: https:";
    const csp = [
      "default-src 'self'",
      `script-src ${scriptSrc}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      `connect-src ${connectSrc}`,
      "frame-src 'self' https://challenges.cloudflare.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      frameAncestors,
    ].join('; ');
    res.setHeader('Content-Security-Policy', csp);
    if (!IS_PROD) res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Cache-Control', req.path.startsWith('/api/') ? 'no-store' : 'no-cache');
    next();
  };
}

export function requestContext() {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.ipTrunc = truncateIp(clientIp(req));
    req.requestId = randomBytes(8).toString('hex');
    next();
  };
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const CSRF_EXEMPT = [/^\/api\/v1\//, /^\/api\/discord\/interactions$/, /^\/api\/auth\/oauth\/[^/]+\/callback$/];

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [rawKey, ...rest] = part.trim().split('=');
    if (rawKey === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

export { readCookie };

/**
 * Double-submit CSRF protection for every state-changing browser request (§6.13).
 * Game/API endpoints are exempt because they authenticate with signatures.
 */
export function csrfProtection() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(req.method) || CSRF_EXEMPT.some((r) => r.test(req.path))) return next();
    const cookieToken = readCookie(req, CSRF_COOKIE);
    const headerToken = req.get('x-csrf-token') ?? (req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>)._csrf : undefined);
    if (!cookieToken || !headerToken || typeof headerToken !== 'string') {
      return res.status(403).json({ error: 'csrf_invalid', message: 'Jeton CSRF manquant ou invalide.' });
    }
    const a = Buffer.from(cookieToken);
    const b = Buffer.from(headerToken);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return res.status(403).json({ error: 'csrf_invalid', message: 'Jeton CSRF manquant ou invalide.' });
    }
    next();
  };
}

export function ensureCsrfCookie() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!SAFE_METHODS.has(req.method)) return next();
    if (!readCookie(req, CSRF_COOKIE)) {
      const token = randomBytes(24).toString('base64url');
      res.cookie(CSRF_COOKIE, token, {
        httpOnly: false,
        sameSite: 'lax',
        secure: IS_PROD,
        path: COOKIE_PATH,
        maxAge: 8 * 60 * 60 * 1000,
      });
      req.csrfCookie = token;
    }
    next();
  };
}

const CHALLENGE_SECRET = process.env.CHALLENGE_SECRET ?? randomBytes(32).toString('hex');

export function issueChallengeToken(ttlMs = 10 * 60 * 1000): string {
  const exp = Date.now() + ttlMs;
  const nonce = randomBytes(8).toString('hex');
  const macro = `${exp}.${nonce}`;
  const sig = createHmac('sha256', CHALLENGE_SECRET).update(macro).digest('base64url');
  return Buffer.from(`${macro}.${sig}`).toString('base64url');
}

export function verifyChallengeToken(token: unknown): boolean {
  if (typeof token !== 'string' || !token) return false;
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const parts = decoded.split('.');
    if (parts.length !== 3) return false;
    const [exp, nonce, sig] = parts;
    if (Number(exp) < Date.now()) return false;
    const expected = createHmac('sha256', CHALLENGE_SECRET).update(`${exp}.${nonce}`).digest('base64url');
    return sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function challengeConfig() {
  return { siteKey: TURNSTILE_SITE_KEY || null, mode: TURNSTILE_SECRET ? 'turnstile' : 'local', requiredOn: 'progressive' };
}

/**
 * Turnstile-compatible challenge verification. When Cloudflare Turnstile is
 * configured the real siteverify endpoint is used; otherwise a signed local
 * token is accepted so the flow is identical end-to-end.
 */
export async function verifyChallenge(body: Record<string, unknown>, ip: string): Promise<boolean> {
  const token = body['cf-turnstile-response'] ?? body.challengeToken ?? body.challenge;
  if (TURNSTILE_SECRET) {
    if (typeof token !== 'string' || !token) return false;
    try {
      const form = new URLSearchParams({ secret: TURNSTILE_SECRET, response: token, remoteip: ip });
      const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body: form,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      const data = (await res.json()) as { success?: boolean };
      return data.success === true;
    } catch {
      return false;
    }
  }
  return verifyChallengeToken(token);
}

/** Reject requests whose Origin header does not match the serving origin. */
export function originCheck() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.get('origin');
    if (!origin) return next();
    const host = req.get('host');
    let originHost = '';
    try {
      originHost = new URL(origin).host;
    } catch {
      return res.status(403).json({ error: 'bad_origin' });
    }
    if (originHost !== host) return res.status(403).json({ error: 'bad_origin' });
    next();
  };
}

export function notFoundJson(_req: Request, res: Response) {
  res.status(404).json({ error: 'not_found' });
}
