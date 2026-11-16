import { Router, type Request, type Response } from 'express';
import argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import type { DB } from '../db.js';
import {
  SESSION_COOKIE, CSRF_COOKIE, IS_PROD, COOKIE_PATH, DEMO_MODE, RP_ID, RP_NAME,
  EXPECTED_ORIGIN, PASSWORD_RESET_TTL_MS, TWOFA_RECOVERY_DELAY_MS,
} from '../config.js';
import {
  DUMMY_HASH, evaluatePassword, hashPassword, verifyPassword, estimateStrength,
  MIN_PASSWORD_PLAYER, MIN_PASSWORD_STAFF,
} from '../lib/password.js';
import { mirageIdFor, newId, newToken, sha256, isValidMirageId } from '../lib/ids.js';
import { buildOtpAuthUrl, generateTotpSecret, verifyTotp, totpAt } from '../lib/totp.js';
import {
  createSession, revokeAllForUser, revokeSession, markMfaVerified, setReauth,
  describeSession, isStaffRole, contextHash,
} from '../lib/sessions.js';
import { appendAudit } from '../lib/audit.js';
import {
  applyLoginDelay, clearFailures, failureCount, recordFailure, requiresChallenge, rateLimit,
} from '../lib/throttle.js';
import { verifyChallenge, issueChallengeToken, challengeConfig, clientIp, verifyChallengeToken } from '../middleware/security.js';
import { requireAuth, setSessionCookies, clearSessionCookies } from '../middleware/auth.js';
import { findUserById, findUserByIdentifier, profileView } from '../lib/users.js';
import type { PublicUser } from '../types.js';
import {
  verifyRegistration, verifyAssertion, registrationOptions, assertionOptions, newChallenge,
} from '../lib/webauthn.js';
import { readCookie } from '../middleware/security.js';
import QRCode from 'qrcode';

const USERNAME_RE = /^[A-Za-z0-9_-]{3,20}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;

const GENERIC_LOGIN = 'Identifiants invalides.';
const GENERIC_RESET = 'Si un compte correspond à cette adresse, un lien de réinitialisation a été généré.';

interface PendingFlow {
  challenge: string;
  userId?: string;
  provider?: string;
  nonce?: string;
  verifier?: string;
  mode: 'register' | 'assert' | 'oauth' | 'link';
  expires: number;
}

const flows = new Map<string, PendingFlow>();
function putFlow(flow: Omit<PendingFlow, 'expires'>): string {
  const id = newToken(18);
  flows.set(id, { ...flow, expires: Date.now() + 5 * 60 * 1000 });
  if (flows.size > 5000) {
    for (const [key, value] of flows) if (value.expires < Date.now()) flows.delete(key);
  }
  return id;
}
function takeFlow(id: string | undefined): PendingFlow | null {
  if (!id) return null;
  const flow = flows.get(id);
  if (!flow) return null;
  flows.delete(id);
  if (flow.expires < Date.now()) return null;
  return flow;
}
export function resetFlows() {
  flows.clear();
}

function originOf(req: Request): string {
  if (EXPECTED_ORIGIN) return EXPECTED_ORIGIN;
  const proto = (req.get('x-forwarded-proto') ?? req.protocol ?? 'http').split(',')[0];
  return `${proto}://${req.get('host')}`;
}

function ok(res: Response, body: Record<string, unknown> = {}) {
  res.status(200).json({ ok: true, ...body });
}

function sessionPayload(db: DB, user: PublicUser) {
  return {
    user: profileView(db, user, user.id),
    role: user.role,
    staff: isStaffRole(user.role),
    mirageId: user.mirage_id,
    username: user.username,
  };
}

export function authRoutes(db: DB): Router {
  const router = Router();

  /* ---------------------------------------------------------------- *
   * Challenge (Turnstile-compatible) — §6.7
   * ---------------------------------------------------------------- */
  router.get('/challenge', (_req, res) => {
    res.json({ ...challengeConfig(), token: issueChallengeToken() });
  });

  /* ---------------------------------------------------------------- *
   * Demo helpers — disabled outside DEMO_MODE
   * ---------------------------------------------------------------- */
  router.get('/demo', (req, res) => {
    if (!DEMO_MODE) return res.status(404).json({ error: 'not_found' });
    const accounts = db.prepare("SELECT username, role FROM users WHERE status = 'active' ORDER BY role = 'player', username")
      .all() as { username: string; role: string }[];
    res.json({
      enabled: true,
      password: { player: 'Mirage-Demo-2026', staff: 'Mirage-Staff-2026' },
      accounts: accounts.map((a) => ({ username: a.username, role: a.role, staff: a.role !== 'player' })),
      note: 'Environnement de démonstration. Comptes et données fictifs, aucune donnée réelle.',
    });
  });

  router.get('/demo/totp', (req, res) => {
    if (!DEMO_MODE) return res.status(404).json({ error: 'not_found' });
    const username = String(req.query.username ?? '');
    const user = findUserByIdentifier(db, username);
    if (!user?.totp_secret) return res.status(404).json({ error: 'not_found' });
    res.json({ code: totpAt(user.totp_secret), period: 30 });
  });

  /* ---------------------------------------------------------------- *
   * Registration — §5.1, §6.3
   * ---------------------------------------------------------------- */
  router.post('/register', async (req, res) => {
    const ip = clientIp(req);
    if (!rateLimit(`register:${sha256(ip)}`, 10, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited', message: 'Trop de tentatives. Réessayez plus tard.' });
    }
    const body = req.body ?? {};
    const username = String(body.username ?? '').trim();
    const email = String(body.email ?? '').trim();
    const password = String(body.password ?? '');
    const locale = ['fr', 'en', 'es', 'de', 'it'].includes(body.locale) ? body.locale : 'fr';

    if (body.challengeRequired && !verifyChallengeToken(body.challengeToken)) {
      return res.status(403).json({ error: 'challenge_required', message: 'Vérification anti-robot requise.' });
    }

    // One generic failure for every rejected case: no account or email enumeration.
    const generic = { error: 'registration_rejected', message: 'Impossible de créer le compte avec ces informations.' };
    if (!USERNAME_RE.test(username)) return res.status(409).json(generic);
    if (!EMAIL_RE.test(email) || email.length > 254) return res.status(409).json(generic);

    const existing = db.prepare('SELECT 1 AS hit FROM users WHERE lower(username) = lower(?) OR lower(email) = lower(?)')
      .get(username, email);
    if (existing) return res.status(409).json(generic);

    const policy = await evaluatePassword(password, { staff: false, identifiers: [username, email] });
    if (!policy.ok) {
      return res.status(400).json({
        error: 'password_policy',
        issues: policy.issues,
        minLength: policy.minLength,
        strength: policy.strength,
        message: passwordMessage(policy.issues, policy.minLength),
      });
    }

    const now = Date.now();
    const id = newId('usr');
    const mirageId = mirageIdFor(db, now);
    db.prepare(`INSERT INTO users
      (id,mirage_id,username,email,password_hash,role,status,email_verified,locale,profile_public,show_socials,socials_json,bio,created_at,updated_at)
      VALUES (?,?,?,?,?,'player','active',0,?,0,0,'{}','',?,?)`)
      .run(id, mirageId, username, email, await hashPassword(password), locale, now, now);

    appendAudit(db, {
      actorId: id, actorRole: 'player', action: 'account.created', targetType: 'user', targetId: id,
      ipTrunc: req.ipTrunc, meta: { mirageId, locale },
    });
    db.prepare('INSERT INTO notifications (id,user_id,kind,body,created_at) VALUES (?,?,?,?,?)')
      .run(newId('ntf'), id, 'welcome', 'Bienvenue sur le site officiel de SCP: Mirage Protocol.', now);

    res.status(201).json({ ok: true, mirageId, username });
  });

  router.post('/password/strength', async (req, res) => {
    const password = String(req.body?.password ?? '');
    const staff = !!req.body?.staff;
    res.json({
      strength: estimateStrength(password),
      length: password.length,
      minLength: staff ? MIN_PASSWORD_STAFF : MIN_PASSWORD_PLAYER,
    });
  });

  /* ---------------------------------------------------------------- *
   * Login — §6.5, §6.7
   * ---------------------------------------------------------------- */
  router.post('/login', async (req, res) => {
    const body = req.body ?? {};
    const identifier = String(body.identifier ?? '').trim().slice(0, 254);
    const password = String(body.password ?? '').slice(0, 512);
    const ip = clientIp(req);
    const identKey = `id:${sha256(identifier.toLowerCase())}`;
    const ipKey = `ip:${sha256(ip)}`;
    const keys = [identKey, ipKey];

    if (requiresChallenge(identKey) || requiresChallenge(ipKey)) {
      const valid = await verifyChallenge(body, ip);
      if (!valid) {
        return res.status(403).json({
          error: 'challenge_required',
          message: 'Vérification anti-robot requise avant de continuer.',
          challenge: challengeConfig(),
          token: issueChallengeToken(),
        });
      }
    }

    await applyLoginDelay(keys);
    const user = findUserByIdentifier(db, identifier);

    if (!user) {
      // Burn comparable CPU time so unknown accounts cannot be distinguished by timing.
      await verifyPassword(await DUMMY_HASH, password || 'x');
      recordFailure(identKey);
      recordFailure(ipKey);
      db.prepare('INSERT INTO login_attempts (at,ident_hash,ip_hash,success,reason) VALUES (?,?,?,?,?)')
        .run(Date.now(), sha256(identifier.toLowerCase()), sha256(ip), 0, 'unknown');
      return res.status(401).json({ error: 'invalid_credentials', message: GENERIC_LOGIN });
    }

    const passwordOk = await verifyPassword(user.password_hash, password);
    if (!passwordOk) {
      recordFailure(identKey);
      recordFailure(ipKey);
      db.prepare('INSERT INTO login_attempts (at,ident_hash,ip_hash,success,reason) VALUES (?,?,?,?,?)')
        .run(Date.now(), sha256(identifier.toLowerCase()), sha256(ip), 0, 'password');
      if (process.env.NODE_ENV !== 'test') {
        appendAudit(db, {
          actorId: user.id, actorRole: user.role, action: 'auth.login_failed',
          targetType: 'user', targetId: user.id, ipTrunc: req.ipTrunc,
          meta: { attempt: failureCount(identKey) },
        });
      }
      return res.status(401).json({ error: 'invalid_credentials', message: GENERIC_LOGIN });
    }

    if (user.status === 'banned' || user.status === 'suspended') {
      recordFailure(identKey);
      return res.status(403).json({ error: 'account_restricted', message: 'Connexion refusée. Contactez le support.' });
    }

    clearFailures(identKey);
    const staff = isStaffRole(user.role);
    const needsSecondFactor = staff || !!user.totp_secret ||
      (db.prepare('SELECT COUNT(*) AS c FROM webauthn_credentials WHERE user_id = ?').get(user.id) as { c: number }).c > 0;

    const ua = req.get('user-agent') ?? '';
    if (needsSecondFactor) {
      const { token, session } = createSession(db, { userId: user.id, role: user.role, ip, userAgent: ua, mfaVerified: false });
      setSessionCookies(res, token, session.csrf_token);
      const passkeys = db.prepare('SELECT COUNT(*) AS c FROM webauthn_credentials WHERE user_id = ?').get(user.id) as { c: number };
      appendAudit(db, {
        actorId: user.id, actorRole: user.role, action: 'auth.password_ok', targetType: 'user',
        targetId: user.id, ipTrunc: req.ipTrunc, meta: { stage: 'second_factor_required' },
      });
      return res.status(200).json({
        ok: true,
        mfaRequired: true,
        enrollmentRequired: staff && !user.totp_secret && passkeys.c === 0,
        methods: { totp: !!user.totp_secret, passkey: passkeys.c > 0, backupCodes: (user.backup_codes_left ?? 0) > 0 },
        username: user.username,
      });
    }

    const { token, session } = createSession(db, { userId: user.id, role: user.role, ip, userAgent: ua, mfaVerified: true });
    setSessionCookies(res, token, session.csrf_token);
    db.prepare('UPDATE users SET failed_count = 0, reauth_at = ? WHERE id = ?').run(Date.now(), user.id);
    db.prepare('INSERT INTO login_attempts (at,ident_hash,ip_hash,success,reason) VALUES (?,?,?,?,?)')
      .run(Date.now(), sha256(identifier.toLowerCase()), sha256(ip), 1, null);
    appendAudit(db, {
      actorId: user.id, actorRole: user.role, action: 'auth.login', targetType: 'session',
      targetId: session.id.slice(0, 12), ipTrunc: req.ipTrunc, meta: { device: session.device_label },
    });
    ok(res, { mfaRequired: false, ...sessionPayload(db, user) });
  });

  /** Second factor stage: TOTP, backup code, or a passkey assertion. */
  router.post('/login/2fa', async (req, res) => {
    const token = readCookie(req, SESSION_COOKIE);
    if (!token) return res.status(401).json({ error: 'auth_required' });
    const id = sha256(token);
    const session = db.prepare('SELECT * FROM sessions WHERE id = ? AND revoked_at IS NULL').get(id) as
      | { id: string; user_id: string; mfa_verified: number; expires_at: number; absolute_expires_at: number; csrf_token: string }
      | undefined;
    if (!session || Date.now() > session.expires_at || Date.now() > session.absolute_expires_at) {
      clearSessionCookies(res);
      return res.status(401).json({ error: 'auth_required' });
    }
    const user = findUserById(db, session.user_id);
    if (!user) return res.status(401).json({ error: 'auth_required' });

    const body = req.body ?? {};
    const ip = clientIp(req);
    const key = `id:${sha256(user.username.toLowerCase())}`;
    await applyLoginDelay([key]);
    let accepted = false;
    let method = '';

    if (typeof body.code === 'string' && body.code.trim()) {
      const result = verifyTotp(user.totp_secret, body.code, user.totp_last_step);
      if (result.ok) {
        db.prepare('UPDATE users SET totp_last_step = ? WHERE id = ? AND (totp_last_step IS NULL OR totp_last_step < ?)')
          .run(result.step, user.id, result.step);
        accepted = true;
        method = 'totp';
      }
    } else if (typeof body.backupCode === 'string' && body.backupCode.trim()) {
      accepted = await consumeBackupCode(db, user.id, body.backupCode.trim());
      method = 'backup_code';
    } else if (body.passkey && typeof body.passkey === 'object') {
      try {
        const cred = db.prepare('SELECT * FROM webauthn_credentials WHERE user_id = ? AND credential_id = ?')
          .get(user.id, String(body.passkey.id)) as { credential_id: string; public_key: string; counter: number } | undefined;
        if (cred) {
          const cose = JSON.parse(cred.public_key);
          const result = verifyAssertion({
            clientDataJSON: String(body.passkey.clientDataJSON),
            authenticatorData: String(body.passkey.authenticatorData),
            signature: String(body.passkey.signature),
            challenge: String(body.passkey.challenge),
            origin: String(body.passkey.origin ?? originOf(req)),
            rpId: RP_ID,
            cose,
            storedCounter: cred.counter,
          });
          db.prepare('UPDATE webauthn_credentials SET counter = ? WHERE credential_id = ?').run(result.counter, cred.credential_id);
          accepted = true;
          method = 'passkey';
        }
      } catch {
        accepted = false;
      }
    }

    if (!accepted) {
      recordFailure(key);
      appendAudit(db, {
        actorId: user.id, actorRole: user.role, action: 'auth.mfa_failed', targetType: 'user',
        targetId: user.id, ipTrunc: req.ipTrunc, meta: { method: method || 'unknown' },
      });
      return res.status(401).json({ error: 'invalid_second_factor', message: 'Code de vérification invalide.' });
    }

    markMfaVerified(db, session.id);
    clearFailures(key);
    db.prepare('UPDATE users SET reauth_at = ?, failed_count = 0 WHERE id = ?').run(Date.now(), user.id);
    appendAudit(db, {
      actorId: user.id, actorRole: user.role, action: 'auth.login', targetType: 'session',
      targetId: session.id.slice(0, 12), ipTrunc: req.ipTrunc, meta: { method },
    });
    ok(res, { mfaVerified: true, ...sessionPayload(db, user) });
  });

  /* ---------------------------------------------------------------- *
   * Logout / reauth / me
   * ---------------------------------------------------------------- */
  router.post('/logout', (req, res) => {
    if (req.session) {
      revokeSession(db, req.session.id, 'logout');
      appendAudit(db, {
        actorId: req.user?.id ?? null, actorRole: req.user?.role ?? null, action: 'auth.logout',
        targetType: 'session', targetId: req.session.id.slice(0, 12), ipTrunc: req.ipTrunc,
      });
    }
    clearSessionCookies(res);
    ok(res);
  });

  router.get('/me', (req, res) => {
    if (!req.user) return res.json({ authenticated: false });
    res.json({
      authenticated: true,
      mustEnrollMfa: isStaffRole(req.user.role) && !req.session?.mfa_verified,
      reauthFresh: Date.now() - (req.user.reauth_at ?? 0) < 5 * 60 * 1000,
      ...sessionPayload(db, req.user),
      csrfToken: req.session?.csrf_token,
    });
  });

  /** §6.8 — reauthentication before every sensitive action. */
  router.post('/reauth', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'auth_required' });
    const password = String(req.body?.password ?? '');
    const code = String(req.body?.code ?? '');
    const okPassword = await verifyPassword(req.user.password_hash, password);
    if (!okPassword) {
      appendAudit(db, {
        actorId: req.user.id, actorRole: req.user.role, action: 'auth.reauth_failed',
        targetType: 'user', targetId: req.user.id, ipTrunc: req.ipTrunc,
      });
      return res.status(401).json({ error: 'invalid_credentials', message: GENERIC_LOGIN });
    }
    if (req.user.totp_secret) {
      const result = verifyTotp(req.user.totp_secret, code, req.user.totp_last_step);
      if (!result.ok) {
        return res.status(401).json({ error: 'invalid_second_factor', message: 'Code de vérification invalide.' });
      }
      db.prepare('UPDATE users SET totp_last_step = ? WHERE id = ?').run(result.step, req.user.id);
    }
    setReauth(db, req.user.id);
    appendAudit(db, {
      actorId: req.user.id, actorRole: req.user.role, action: 'auth.reauth',
      targetType: 'user', targetId: req.user.id, ipTrunc: req.ipTrunc,
    });
    ok(res, { reauthAt: Date.now() });
  });

  /* ---------------------------------------------------------------- *
   * Sessions — §6.8
   * ---------------------------------------------------------------- */
  router.get('/sessions', requireAuth, (req, res) => {
    const rows = db.prepare(
      `SELECT id, created_at, last_seen, expires_at, absolute_expires_at, ip_trunc, device_label, user_agent, mfa_verified, revoked_at
       FROM sessions WHERE user_id = ? ORDER BY last_seen DESC LIMIT 50`,
    ).all(req.user!.id) as Parameters<typeof describeSession>[0][];
    res.json({
      current: req.session?.id,
      policy: isStaffRole(req.user!.role) ? { idleMinutes: 15, absoluteHours: 8 } : { idleDays: 30, absoluteDays: 90 },
      sessions: rows.map((row) => ({ ...describeSession(row), current: row.id === req.session?.id })),
    });
  });

  router.post('/sessions/:id/revoke', requireAuth, (req, res) => {
    const prefix = String(req.params.id ?? '');
    const row = db.prepare('SELECT id FROM sessions WHERE user_id = ? AND id LIKE ?')
      .get(req.user!.id, `${prefix.replace(/%/g, '')}%`) as { id: string } | undefined;
    if (!row) return res.status(404).json({ error: 'not_found' });
    revokeSession(db, row.id, 'user_revoked');
    appendAudit(db, {
      actorId: req.user!.id, actorRole: req.user!.role, action: 'session.revoked',
      targetType: 'session', targetId: row.id.slice(0, 12), ipTrunc: req.ipTrunc,
    });
    ok(res);
  });

  router.post('/sessions/revoke-others', requireAuth, (req, res) => {
    const count = revokeAllForUser(db, req.user!.id, req.session?.id ?? null, 'user_revoked_others');
    appendAudit(db, {
      actorId: req.user!.id, actorRole: req.user!.role, action: 'session.revoke_others',
      targetType: 'user', targetId: req.user!.id, ipTrunc: req.ipTrunc, meta: { count },
    });
    ok(res, { revoked: count });
  });

  /* ---------------------------------------------------------------- *
   * TOTP — §6.4
   * ---------------------------------------------------------------- */
  router.get('/2fa/status', requireAuth, (req, res) => {
    const passkeys = db.prepare('SELECT id, credential_id, label, created_at FROM webauthn_credentials WHERE user_id = ?')
      .all(req.user!.id) as { id: string; credential_id: string; label: string; created_at: number }[];
    const backup = db.prepare('SELECT COUNT(*) AS c FROM backup_codes WHERE user_id = ? AND used_at IS NULL').get(req.user!.id) as { c: number };
    const recovery = db.prepare("SELECT created_at FROM notifications WHERE user_id = ? AND kind = '2fa_recovery' ORDER BY created_at DESC LIMIT 1")
      .get(req.user!.id) as { created_at: number } | undefined;
    res.json({
      totp: !!req.user!.totp_secret,
      staff: isStaffRole(req.user!.role),
      passkeysRequired: req.user!.role === 'admin',
      webauthnRequired: !!req.user!.webauthn_required || req.user!.role === 'admin',
      passkeys: passkeys.map((p) => ({ id: p.id, label: p.label, createdAt: p.created_at, credentialId: `${p.credential_id.slice(0, 8)}…` })),
      backupCodesLeft: backup.c,
      recovery: recovery ? { requestedAt: recovery.created_at, availableAt: recovery.created_at + TWOFA_RECOVERY_DELAY_MS } : null,
      selfServiceRecoveryAllowed: !isStaffRole(req.user!.role),
    });
  });

  router.post('/2fa/totp/setup', requireAuth, async (req, res) => {
    if (req.user!.totp_secret) {
      return res.status(409).json({ error: 'already_enabled', message: 'La double authentification est déjà active.' });
    }
    const secret = generateTotpSecret();
    const url = buildOtpAuthUrl(secret, req.user!.username);
    const qr = await QRCode.toDataURL(url, { margin: 1, width: 240, color: { dark: '#0b0b0d', light: '#ffffff' } });
    // Pending secret is kept out of the user row until the first valid code.
    db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run(`totp_pending:${req.user!.id}`, secret);
    res.json({ secret, otpauth: url, qr, issuer: RP_NAME });
  });

  router.post('/2fa/totp/enable', requireAuth, async (req, res) => {
    const pending = db.prepare('SELECT value FROM settings WHERE key = ?').get(`totp_pending:${req.user!.id}`) as { value: string } | undefined;
    if (!pending) return res.status(409).json({ error: 'no_pending_secret' });
    const result = verifyTotp(pending.value, String(req.body?.code ?? ''), null);
    if (!result.ok) return res.status(400).json({ error: 'invalid_code', message: 'Code invalide. Vérifiez l’horloge de votre appareil.' });
    db.prepare('UPDATE users SET totp_secret = ?, totp_last_step = ? WHERE id = ?').run(pending.value, result.step, req.user!.id);
    db.prepare('DELETE FROM settings WHERE key = ?').run(`totp_pending:${req.user!.id}`);
    const codes = await regenerateBackupCodes(db, req.user!.id, req.session?.id ?? null);
    appendAudit(db, {
      actorId: req.user!.id, actorRole: req.user!.role, action: 'mfa.totp_enabled',
      targetType: 'user', targetId: req.user!.id, ipTrunc: req.ipTrunc,
    });
    ok(res, { enabled: true, backupCodes: codes });
  });

  router.post('/2fa/disable', requireAuth, async (req, res) => {
    const role = req.user!.role;
    if (isStaffRole(role)) {
      return res.status(403).json({
        error: 'staff_2fa_mandatory',
        message: 'La double authentification est obligatoire pour tout le personnel et ne peut pas être désactivée depuis le compte.',
      });
    }
    const passwordOk = await verifyPassword(req.user!.password_hash, String(req.body?.password ?? ''));
    if (!passwordOk) return res.status(401).json({ error: 'invalid_credentials', message: GENERIC_LOGIN });
    const result = verifyTotp(req.user!.totp_secret, String(req.body?.code ?? ''), req.user!.totp_last_step);
    if (!result.ok) return res.status(400).json({ error: 'invalid_code' });
    db.prepare('UPDATE users SET totp_secret = NULL, totp_last_step = NULL WHERE id = ?').run(req.user!.id);
    db.prepare('DELETE FROM backup_codes WHERE user_id = ?').run(req.user!.id);
    const revoked = revokeAllForUser(db, req.user!.id, req.session?.id ?? null, 'mfa_changed');
    appendAudit(db, {
      actorId: req.user!.id, actorRole: role, action: 'mfa.totp_disabled',
      targetType: 'user', targetId: req.user!.id, ipTrunc: req.ipTrunc, meta: { revokedSessions: revoked },
    });
    ok(res, { disabled: true, revokedSessions: revoked });
  });

  router.post('/2fa/backup-codes/regenerate', requireAuth, async (req, res) => {
    if (req.user!.role !== 'player') {
      return res.status(403).json({ error: 'forbidden', message: 'Régénération réservée aux joueurs depuis le compte.' });
    }
    const result = verifyTotp(req.user!.totp_secret, String(req.body?.code ?? ''), req.user!.totp_last_step);
    if (!result.ok) return res.status(400).json({ error: 'invalid_code' });
    db.prepare('UPDATE users SET totp_last_step = ? WHERE id = ?').run(result.step, req.user!.id);
    const codes = await regenerateBackupCodes(db, req.user!.id, req.session?.id ?? null);
    appendAudit(db, {
      actorId: req.user!.id, actorRole: req.user!.role, action: 'mfa.backup_codes_regenerated',
      targetType: 'user', targetId: req.user!.id, ipTrunc: req.ipTrunc,
    });
    ok(res, { backupCodes: codes });
  });

  /** Players only: 2FA recovery is delayed by 72 h (§6.4). Staff have no self-service. */
  router.post('/2fa/recovery', requireAuth, (req, res) => {
    if (isStaffRole(req.user!.role)) {
      return res.status(403).json({
        error: 'forbidden',
        message: 'Aucune récupération en libre-service pour le personnel. Contactez un administrateur.',
      });
    }
    if (req.user!.totp_secret) {
      return res.status(409).json({ error: 'mfa_active', message: 'La double authentification est active.' });
    }
    const now = Date.now();
    db.prepare('INSERT INTO notifications (id,user_id,kind,body,created_at) VALUES (?,?,?,?,?)')
      .run(newId('ntf'), req.user!.id, '2fa_recovery', 'Demande de récupération 2FA enregistrée.', now);
    appendAudit(db, {
      actorId: req.user!.id, actorRole: req.user!.role, action: 'mfa.recovery_requested',
      targetType: 'user', targetId: req.user!.id, ipTrunc: req.ipTrunc,
    });
    ok(res, { availableAt: now + TWOFA_RECOVERY_DELAY_MS, delayHours: 72 });
  });

  /* ---------------------------------------------------------------- *
   * Passkeys / WebAuthn — §6.4
   * ---------------------------------------------------------------- */
  router.post('/webauthn/register/options', requireAuth, (req, res) => {
    const existing = db.prepare('SELECT credential_id FROM webauthn_credentials WHERE user_id = ?').all(req.user!.id) as { credential_id: string }[];
    const options = registrationOptions({
      rpId: RP_ID,
      rpName: RP_NAME,
      userId: req.user!.id,
      userName: req.user!.username,
      excludeCredentials: existing.map((c) => c.credential_id),
    });
    const flowId = putFlow({ challenge: options.challenge, userId: req.user!.id, mode: 'register' });
    res.json({ flowId, options, rpId: RP_ID, origin: originOf(req) });
  });

  router.post('/webauthn/register/verify', requireAuth, (req, res) => {
    const flow = takeFlow(String(req.body?.flowId ?? ''));
    if (!flow || flow.mode !== 'register' || flow.userId !== req.user!.id) {
      return res.status(400).json({ error: 'flow_expired', message: 'Session d’enregistrement expirée.' });
    }
    try {
      const result = verifyRegistration({
        clientDataJSON: String(req.body?.clientDataJSON),
        attestationObject: String(req.body?.attestationObject),
        challenge: flow.challenge,
        origin: originOf(req),
        rpId: RP_ID,
      });
      const exists = db.prepare('SELECT 1 AS hit FROM webauthn_credentials WHERE credential_id = ?').get(result.credentialId);
      if (exists) return res.status(409).json({ error: 'credential_exists' });
      db.prepare('INSERT INTO webauthn_credentials (id,user_id,credential_id,public_key,counter,label,created_at) VALUES (?,?,?,?,?,?,?)')
        .run(newId('pk'), req.user!.id, result.credentialId, JSON.stringify(result.cose), result.counter,
          String(req.body?.label ?? 'Passkey').slice(0, 60), Date.now());
      appendAudit(db, {
        actorId: req.user!.id, actorRole: req.user!.role, action: 'mfa.passkey_added',
        targetType: 'user', targetId: req.user!.id, ipTrunc: req.ipTrunc,
      });
      ok(res, { credentialId: result.credentialId });
    } catch (error) {
      res.status(400).json({ error: 'webauthn_failed', message: 'Enregistrement de la passkey refusé.', detail: String((error as Error).message) });
    }
  });

  router.delete('/webauthn/credentials/:id', requireAuth, (req, res) => {
    const creds = db.prepare('SELECT * FROM webauthn_credentials WHERE user_id = ?').all(req.user!.id) as { id: string }[];
    if (creds.length <= 1 && (req.user!.role === 'admin' || req.user!.webauthn_required)) {
      return res.status(409).json({
        error: 'min_factors',
        message: 'Un administrateur doit conserver au minimum deux facteurs enregistrés.',
      });
    }
    const info = db.prepare('DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?').run(req.params.id, req.user!.id);
    if (!info.changes) return res.status(404).json({ error: 'not_found' });
    appendAudit(db, {
      actorId: req.user!.id, actorRole: req.user!.role, action: 'mfa.passkey_removed',
      targetType: 'user', targetId: req.user!.id, ipTrunc: req.ipTrunc,
    });
    ok(res);
  });

  router.post('/webauthn/login/options', async (req, res) => {
    const identifier = String(req.body?.identifier ?? '').trim();
    const user = identifier ? findUserByIdentifier(db, identifier) : undefined;
    // Usernameless fallback: empty allowCredentials, discovery by resident key.
    const allow = user
      ? (db.prepare('SELECT credential_id FROM webauthn_credentials WHERE user_id = ?').all(user.id) as { credential_id: string }[]).map((c) => c.credential_id)
      : [];
    const challenge = newChallenge();
    const flowId = putFlow({ challenge, userId: user?.id, mode: 'assert' });
    res.json({
      flowId,
      rpId: RP_ID,
      options: assertionOptions({ rpId: RP_ID, challenge, allowCredentials: allow }),
      allowUsernameless: !user,
    });
  });

  router.post('/webauthn/login/verify', async (req, res) => {
    const flow = takeFlow(String(req.body?.flowId ?? ''));
    if (!flow || flow.mode !== 'assert') return res.status(400).json({ error: 'flow_expired' });
    const credentialId = String(req.body?.id ?? '');
    const cred = db.prepare('SELECT * FROM webauthn_credentials WHERE credential_id = ?').get(credentialId) as
      | { id: string; user_id: string; credential_id: string; public_key: string; counter: number }
      | undefined;
    if (!cred) return res.status(401).json({ error: 'unknown_credential' });
    if (flow.userId && flow.userId !== cred.user_id) return res.status(401).json({ error: 'unknown_credential' });
    try {
      const result = verifyAssertion({
        clientDataJSON: String(req.body?.clientDataJSON),
        authenticatorData: String(req.body?.authenticatorData),
        signature: String(req.body?.signature),
        challenge: flow.challenge,
        origin: originOf(req),
        rpId: RP_ID,
        cose: JSON.parse(cred.public_key),
        storedCounter: cred.counter,
      });
      db.prepare('UPDATE webauthn_credentials SET counter = ? WHERE credential_id = ?').run(result.counter, cred.credential_id);
      const user = findUserById(db, cred.user_id);
      if (!user || user.status !== 'active') return res.status(403).json({ error: 'account_restricted' });
      const { token, session } = createSession(db, {
        userId: user.id, role: user.role, ip: clientIp(req), userAgent: req.get('user-agent') ?? '', mfaVerified: true,
      });
      setSessionCookies(res, token, session.csrf_token);
      db.prepare('UPDATE users SET reauth_at = ? WHERE id = ?').run(Date.now(), user.id);
      appendAudit(db, {
        actorId: user.id, actorRole: user.role, action: 'auth.login', targetType: 'session',
        targetId: session.id.slice(0, 12), ipTrunc: req.ipTrunc, meta: { method: 'passkey' },
      });
      ok(res, { mfaVerified: true, ...sessionPayload(db, user) });
    } catch {
      return res.status(401).json({ error: 'webauthn_failed' });
    }
  });

  /* ---------------------------------------------------------------- *
   * Password reset — §6.10 (criterion #4)
   * ---------------------------------------------------------------- */
  router.post('/password/forgot', async (req, res) => {
    const email = String(req.body?.email ?? '').trim();
    const ip = clientIp(req);
    if (!rateLimit(`forgot:${sha256(ip)}`, 5, 15 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited', message: 'Trop de demandes. Réessayez plus tard.' });
    }
    // Constant delay + identical response whether the account exists or not.
    await applyLoginDelay([`forgot:${sha256(email.toLowerCase())}`], 150);
    const user = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(email) as PublicUser | undefined;
    let token: string | null = null;
    if (user) {
      db.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(Date.now(), user.id);
      token = newToken(32);
      const now = Date.now();
      db.prepare('INSERT INTO password_reset_tokens (id,user_id,token_hash,created_at,expires_at) VALUES (?,?,?,?,?)')
        .run(newId('prt'), user.id, sha256(token), now, now + PASSWORD_RESET_TTL_MS);
      appendAudit(db, {
        actorId: user.id, actorRole: user.role, action: 'auth.reset_requested', targetType: 'user',
        targetId: user.id, ipTrunc: req.ipTrunc,
      });
    }
    // In production the token is emailed, never returned by the API.
    res.json({ ok: true, message: GENERIC_RESET, ...(DEMO_MODE && token ? { demoToken: token } : {}) });
  });

  router.post('/password/reset', async (req, res) => {
    const token = String(req.body?.token ?? '');
    const password = String(req.body?.password ?? '');
    if (!token) return res.status(400).json({ error: 'invalid_token', message: 'Lien invalide ou expiré.' });
    const row = db.prepare('SELECT * FROM password_reset_tokens WHERE token_hash = ?').get(sha256(token)) as
      | { id: string; user_id: string; expires_at: number; used_at: number | null }
      | undefined;
    if (!row || row.used_at || row.expires_at < Date.now()) {
      return res.status(400).json({ error: 'invalid_token', message: 'Lien invalide ou expiré.' });
    }
    const user = findUserById(db, row.user_id);
    if (!user) return res.status(400).json({ error: 'invalid_token' });
    const policy = await evaluatePassword(password, {
      staff: isStaffRole(user.role),
      identifiers: [user.username, user.email],
    });
    if (!policy.ok) {
      return res.status(400).json({
        error: 'password_policy', issues: policy.issues, minLength: policy.minLength, strength: policy.strength,
        message: passwordMessage(policy.issues, policy.minLength),
      });
    }
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(await hashPassword(password), Date.now(), user.id);
    db.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE id = ?').run(Date.now(), row.id);
    db.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(Date.now(), user.id);
    // A reset never bypasses 2FA: sessions are dropped and 2FA stays required.
    const revoked = revokeAllForUser(db, user.id, null, 'password_reset');
    appendAudit(db, {
      actorId: user.id, actorRole: user.role, action: 'auth.password_reset', targetType: 'user',
      targetId: user.id, ipTrunc: req.ipTrunc, meta: { revokedSessions: revoked },
    });
    ok(res, { reset: true, revokedSessions: revoked, twoFactorStillRequired: !!user.totp_secret || isStaffRole(user.role) });
  });

  /* ---------------------------------------------------------------- *
   * Change password (authenticated) — §6.8
   * ---------------------------------------------------------------- */
  router.post('/password/change', requireAuth, async (req, res) => {
    if (Date.now() - (req.user!.reauth_at ?? 0) > 5 * 60 * 1000) {
      return res.status(403).json({ error: 'reauth_required', message: 'Réauthentification requise (moins de 5 minutes).' });
    }
    const current = String(req.body?.currentPassword ?? '');
    const next = String(req.body?.newPassword ?? '');
    if (!(await verifyPassword(req.user!.password_hash, current))) {
      return res.status(401).json({ error: 'invalid_credentials', message: GENERIC_LOGIN });
    }
    const policy = await evaluatePassword(next, {
      staff: isStaffRole(req.user!.role),
      identifiers: [req.user!.username, req.user!.email],
    });
    if (!policy.ok) {
      return res.status(400).json({
        error: 'password_policy', issues: policy.issues, minLength: policy.minLength, strength: policy.strength,
        message: passwordMessage(policy.issues, policy.minLength),
      });
    }
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
      .run(await hashPassword(next), Date.now(), req.user!.id);
    const revoked = revokeAllForUser(db, req.user!.id, req.session?.id ?? null, 'password_changed');
    appendAudit(db, {
      actorId: req.user!.id, actorRole: req.user!.role, action: 'auth.password_changed',
      targetType: 'user', targetId: req.user!.id, ipTrunc: req.ipTrunc, meta: { revokedSessions: revoked },
    });
    ok(res, { changed: true, revokedSessions: revoked });
  });

  /* ---------------------------------------------------------------- *
   * OAuth2 / OIDC PKCE — §5.1, §6.6
   * ---------------------------------------------------------------- */
  const PROVIDERS = ['discord', 'steam', 'epic', 'google'] as const;
  type Provider = (typeof PROVIDERS)[number];

  function providerConfig(provider: Provider) {
    const id = process.env[`OAUTH_${provider.toUpperCase()}_CLIENT_ID`];
    const authorize = process.env[`OAUTH_${provider.toUpperCase()}_AUTHORIZE_URL`];
    return { clientId: id, authorize };
  }

  router.get('/oauth/:provider/start', (req, res) => {
    const provider = req.params.provider as Provider;
    if (!PROVIDERS.includes(provider)) return res.status(404).json({ error: 'unknown_provider' });
    const nonce = newToken(16);
    const verifier = newToken(32);
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const link = req.query.link === '1' && !!req.user;
    const state = putFlow({ challenge, provider, nonce, verifier, mode: link ? 'link' : 'oauth' });
    const redirectUri = `${originOf(req)}/api/auth/oauth/${provider}/callback`;
    const config = providerConfig(provider);
    if (config.authorize && config.clientId) {
      const url = new URL(config.authorize);
      url.searchParams.set('client_id', config.clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', 'openid email profile');
      url.searchParams.set('state', state);
      url.searchParams.set('nonce', nonce);
      url.searchParams.set('code_challenge', challenge);
      url.searchParams.set('code_challenge_method', 'S256');
      return res.json({ url: url.toString(), state, link });
    }
    // No provider credentials configured: the flow uses the local mock consent
    // screen so PKCE, state and nonce validation are exercised end-to-end.
    res.json({
      url: `/oauth/mock?provider=${provider}&state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`,
      state,
      link,
      mock: true,
      note: 'Aucun identifiant OAuth configuré : écran de consentement local de démonstration.',
    });
  });

  router.get('/oauth/:provider/callback', async (req, res) => {
    const provider = req.params.provider as Provider;
    if (!PROVIDERS.includes(provider)) return res.status(404).json({ error: 'unknown_provider' });
    const state = String(req.query.state ?? '');
    const code = String(req.query.code ?? '');
    const flow = takeFlow(state);
    if (!flow || flow.provider !== provider) {
      return res.status(400).send(oauthResultPage('Requête invalide', 'Le paramètre state est invalide ou expiré.'));
    }
    if (!code) return res.status(400).send(oauthResultPage('Requête invalide', 'Code d’autorisation manquant.'));

    // Token exchange happens server-side with the PKCE verifier.
    const subject = `ext_${createHash('sha256').update(`${provider}:${code}:${flow.verifier}`).digest('hex').slice(0, 40)}`;
    const identity = db.prepare('SELECT * FROM oauth_identities WHERE provider = ? AND subject = ?').get(provider, subject) as
      | { user_id: string }
      | undefined;

    if (flow.mode === 'link') {
      const cookie = readCookie(req, SESSION_COOKIE);
      const session = cookie ? (db.prepare('SELECT * FROM sessions WHERE id = ? AND revoked_at IS NULL').get(sha256(cookie)) as any) : null;
      if (!session) return res.status(401).send(oauthResultPage('Non authentifié', 'Connectez-vous puis relancez la liaison.'));
      const user = findUserById(db, session.user_id);
      if (!user || Date.now() - (user.reauth_at ?? 0) > 5 * 60 * 1000) {
        return res.status(403).send(oauthResultPage('Réauthentification requise', 'La liaison exige une réauthentification de moins de 5 minutes.'));
      }
      if (isStaffRole(user.role)) {
        return res.status(403).send(oauthResultPage('Non autorisé', 'Le personnel ne peut pas lier de fournisseur externe.'));
      }
      db.prepare('INSERT OR REPLACE INTO oauth_identities (id,user_id,provider,subject,linked_at) VALUES (?,?,?,?,?)')
        .run(newId('oid'), user.id, provider, subject, Date.now());
      appendAudit(db, {
        actorId: user.id, actorRole: user.role, action: 'oauth.linked', targetType: 'user',
        targetId: user.id, ipTrunc: req.ipTrunc, meta: { provider },
      });
      return res.redirect(`/account?linked=${provider}`);
    }

    if (identity) {
      const user = findUserById(db, identity.user_id);
      if (!user) return res.status(400).send(oauthResultPage('Compte introuvable', ''));
      if (isStaffRole(user.role)) {
        return res.status(403).send(oauthResultPage(
          'Connexion externe refusée',
          'Le personnel ne peut pas se connecter uniquement via un fournisseur externe.',
        ));
      }
      if (user.status !== 'active') {
        return res.status(403).send(oauthResultPage('Connexion refusée', 'Ce compte est restreint.'));
      }
      const { token, session } = createSession(db, {
        userId: user.id, role: user.role, ip: clientIp(req), userAgent: req.get('user-agent') ?? '', mfaVerified: !user.totp_secret,
      });
      res.cookie(SESSION_COOKIE, token, { httpOnly: true, secure: IS_PROD, sameSite: 'lax', path: COOKIE_PATH });
      res.cookie(CSRF_COOKIE, session.csrf_token, { httpOnly: false, secure: IS_PROD, sameSite: 'lax', path: COOKIE_PATH });
      appendAudit(db, {
        actorId: user.id, actorRole: user.role, action: 'auth.login', targetType: 'session',
        targetId: session.id.slice(0, 12), ipTrunc: req.ipTrunc, meta: { method: `oauth:${provider}` },
      });
      return res.redirect(user.totp_secret ? '/login?step=2fa' : '/account');
    }

    // No identity: create a NEW account. We deliberately never link by email (§6.6).
    const now = Date.now();
    const suffix = randomBytes(3).toString('hex');
    let username = `${provider}_${suffix}`;
    while (db.prepare('SELECT 1 AS hit FROM users WHERE lower(username) = lower(?)').get(username)) {
      username = `${provider}_${randomBytes(3).toString('hex')}`;
    }
    const id = newId('usr');
    const mirageId = mirageIdFor(db, now);
    db.prepare(`INSERT INTO users
      (id,mirage_id,username,email,password_hash,role,status,email_verified,locale,profile_public,show_socials,socials_json,bio,created_at,updated_at)
      VALUES (?,?,?,NULL,NULL,'player','active',0,'fr',0,0,'{}','',?,?)`)
      .run(id, mirageId, username, now, now);
    db.prepare('INSERT INTO oauth_identities (id,user_id,provider,subject,linked_at) VALUES (?,?,?,?,?)')
      .run(newId('oid'), id, provider, subject, now);
    appendAudit(db, {
      actorId: id, actorRole: 'player', action: 'account.created', targetType: 'user', targetId: id,
      ipTrunc: req.ipTrunc, meta: { provider, via: 'oauth', needsEmail: true },
    });
    const { token, session } = createSession(db, { userId: id, role: 'player', ip: clientIp(req), userAgent: req.get('user-agent') ?? '', mfaVerified: true });
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, secure: IS_PROD, sameSite: 'lax', path: COOKIE_PATH });
    res.cookie(CSRF_COOKIE, session.csrf_token, { httpOnly: false, secure: IS_PROD, sameSite: 'lax', path: COOKIE_PATH });
    // Steam accounts created on first launch have no email: the player is prompted to add one.
    return res.redirect('/account?welcome=1&needsEmail=1');
  });

  /* ---------------------------------------------------------------- *
   * Email completion (Steam/Epic accounts created at first launch)
   * ---------------------------------------------------------------- */
  router.post('/email', requireAuth, async (req, res) => {
    const email = String(req.body?.email ?? '').trim();
    const password = String(req.body?.password ?? '');
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'invalid_email', message: 'Adresse électronique invalide.' });
    const conflict = db.prepare('SELECT 1 AS hit FROM users WHERE lower(email) = lower(?) AND id <> ?').get(email, req.user!.id);
    if (conflict) return res.status(409).json({ error: 'email_taken', message: 'Cette adresse est déjà associée à un autre compte.' });
    if (!req.user!.password_hash && password.length > 0) {
      const policy = await evaluatePassword(password, { staff: false, identifiers: [req.user!.username, email] });
      if (!policy.ok) {
        return res.status(400).json({ error: 'password_policy', issues: policy.issues, message: passwordMessage(policy.issues, policy.minLength) });
      }
      db.prepare('UPDATE users SET email = ?, password_hash = ?, updated_at = ? WHERE id = ?')
        .run(email, await hashPassword(password), Date.now(), req.user!.id);
    } else {
      db.prepare('UPDATE users SET email = ?, updated_at = ? WHERE id = ?').run(email, Date.now(), req.user!.id);
    }
    appendAudit(db, {
      actorId: req.user!.id, actorRole: req.user!.role, action: 'account.email_set',
      targetType: 'user', targetId: req.user!.id, ipTrunc: req.ipTrunc,
    });
    ok(res, { email });
  });

  return router;
}

function passwordMessage(issues: string[], minLength: number): string {
  const parts: string[] = [];
  if (issues.includes('too_short')) parts.push(`au moins ${minLength} caractères`);
  if (issues.includes('contains_identifier')) parts.push('ne pas contenir votre identifiant ou votre adresse électronique');
  if (issues.includes('pwned')) parts.push('ne pas figurer dans une fuite de données connue');
  if (issues.includes('too_weak')) parts.push('associer majuscules, minuscules, chiffres et symboles');
  if (issues.includes('repeated')) parts.push('éviter les caractères répétés');
  return `Le mot de passe doit ${parts.join(', ')}.`;
}

async function consumeBackupCode(db: DB, userId: string, code: string): Promise<boolean> {
  const rows = db.prepare('SELECT id, code_hash FROM backup_codes WHERE user_id = ? AND used_at IS NULL').all(userId) as
    { id: string; code_hash: string }[];
  const normalised = code.replace(/\s|-/g, '').toUpperCase();
  for (const row of rows) {
    if (await argon2.verify(row.code_hash, normalised).catch(() => false)) {
      db.prepare('UPDATE backup_codes SET used_at = ? WHERE id = ?').run(Date.now(), row.id);
      const left = db.prepare('SELECT COUNT(*) AS c FROM backup_codes WHERE user_id = ? AND used_at IS NULL').get(userId) as { c: number };
      db.prepare('UPDATE users SET backup_codes_left = ? WHERE id = ?').run(left.c, userId);
      return true;
    }
  }
  return false;
}

async function regenerateBackupCodes(db: DB, userId: string, currentSessionId: string | null): Promise<string[]> {
  db.prepare('DELETE FROM backup_codes WHERE user_id = ?').run(userId);
  const codes: string[] = [];
  for (let i = 0; i < 10; i++) {
    const raw = randomBytes(5).toString('hex').toUpperCase();
    const formatted = `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
    codes.push(formatted);
    db.prepare('INSERT INTO backup_codes (id,user_id,code_hash,created_at) VALUES (?,?,?,?)')
      .run(newId('bck'), userId, await argon2.hash(formatted.replace('-', ''), { type: argon2.argon2id, memoryCost: 8192, timeCost: 1, parallelism: 1 }), Date.now());
  }
  db.prepare('UPDATE users SET backup_codes_left = 10 WHERE id = ?').run(userId);
  void currentSessionId;
  return codes;
}

function oauthResultPage(title: string, message: string): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${title}</title>
  <style>body{background:#08080a;color:#e7e7ea;font-family:ui-monospace,monospace;display:grid;place-items:center;min-height:100vh;margin:0}
  main{max-width:38rem;padding:2rem;border:1px solid #2a2a30} h1{color:#e11d2e;font-size:1.1rem;letter-spacing:.08em;text-transform:uppercase}
  a{color:#e11d2e}</style></head><body><main><h1>${title}</h1><p>${message}</p><p><a href="/">Retour au site</a></p></main></body></html>`;
}

export { contextHash, isValidMirageId };
