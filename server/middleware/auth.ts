import type { NextFunction, Request, Response } from 'express';
import type { DB } from '../db.js';
import type { Role } from '../db.js';
import { SESSION_COOKIE, CSRF_COOKIE, IS_PROD, COOKIE_PATH, REAUTH_WINDOW_MS } from '../config.js';
import { loadSession, touchSession, isStaffRole } from '../lib/sessions.js';
import { readCookie, clientIp } from './security.js';
import { appendAudit } from '../lib/audit.js';
import { canFunction, type FunctionKey } from '../lib/rbac.js';
import type { PublicUser } from '../types.js';
import { sha256 } from '../lib/ids.js';

export function sessionLoader(db: DB) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = readCookie(req, SESSION_COOKIE);
    req.session = null;
    req.user = null;
    if (!token) return next();
    const loaded = await loadSession(db, token, clientIp(req), req.get('user-agent') ?? '');
    if (!loaded) return next();
    if (loaded.expired) {
      res.clearCookie(SESSION_COOKIE, { path: COOKIE_PATH });
      return next();
    }
    const user = await db.get('SELECT * FROM users WHERE id = ?', [loaded.session.user_id]) as PublicUser | undefined;
    if (!user || user.status === 'banned' || user.status === 'suspended') {
      req.session = loaded.session;
      if (user && process.env.NODE_ENV !== 'test') {
        await appendAudit(db, {
          actorId: user.id,
          actorRole: user.role,
          action: 'session.blocked',
          targetType: 'user',
          targetId: user.id,
          ipTrunc: req.ipTrunc,
          meta: { status: user.status },
        });
      }
      return next();
    }
    if (loaded.contextChanged) {
      req.ctxChanged = true;
      if (process.env.NODE_ENV !== 'test') {
        await appendAudit(db, {
          actorId: user.id,
          actorRole: user.role,
          action: 'session.context_changed',
          targetType: 'session',
          targetId: loaded.session.id.slice(0, 12),
          ipTrunc: req.ipTrunc,
          meta: { device: loaded.session.device_label },
        });
      }
    }
    // Bind the CSRF token to this session as a second check on top of double submit.
    void sha256(loaded.session.csrf_token).slice(0, 8);
    req.user = user;
    req.session = loaded.session;
    req.sessionToken = token;
    await touchSession(db, loaded.session, user.role);
    next();
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user || !req.session) {
    return res.status(401).json({ error: 'auth_required', message: 'Authentification requise.' });
  }
  if (isStaffRole(req.user.role) && !req.session.mfa_verified) {
    return res.status(403).json({ error: 'mfa_required', message: 'Double authentification requise.' });
  }
  next();
}

export function requireStaff(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'auth_required' });
  if (!isStaffRole(req.user.role)) return res.status(403).json({ error: 'forbidden', message: 'Accès réservé au personnel.' });
  if (!req.session?.mfa_verified) return res.status(403).json({ error: 'mfa_required' });
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'auth_required' });
    if (!roles.includes(req.user.role as Role)) return res.status(403).json({ error: 'forbidden' });
    next();
  };
}

export function requireFunction(fn: FunctionKey) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'auth_required' });
    if (!canFunction(req.user.role as Role, fn)) {
      return res.status(403).json({ error: 'forbidden', message: 'Fonction non autorisée pour ce rôle.' });
    }
    next();
  };
}

/** §6.8 — sensitive actions require a reauthentication younger than 5 minutes. */
export function requireReauth(req: Request, res: Response, next: NextFunction) {
  const at = req.user?.reauth_at ?? 0;
  if (!at || Date.now() - at > REAUTH_WINDOW_MS) {
    return res.status(403).json({ error: 'reauth_required', message: 'Réauthentification requise (moins de 5 minutes).' });
  }
  next();
}

export function setSessionCookies(res: Response, token: string, csrf: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'lax',
    path: COOKIE_PATH,
    maxAge: 90 * 24 * 60 * 60 * 1000,
  });
  res.cookie(CSRF_COOKIE, csrf, {
    httpOnly: false,
    secure: IS_PROD,
    sameSite: 'lax',
    path: COOKIE_PATH,
    maxAge: 8 * 60 * 60 * 1000,
  });
}

export function clearSessionCookies(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: COOKIE_PATH });
  res.clearCookie(CSRF_COOKIE, { path: COOKIE_PATH });
}
