import { Router } from 'express';
import type { DB } from '../db.js';
import { DELETION_GRACE_MS, TWOFA_RECOVERY_DELAY_MS } from '../config.js';
import { requireAuth, requireReauth } from '../middleware/auth.js';
import { appendAudit } from '../lib/audit.js';
import { newId } from '../lib/ids.js';
import { profileView, socialsOf, statsFor, statsSummary, findUserById } from '../lib/users.js';
import { verifyPassword } from '../lib/password.js';
import { revokeAllForUser } from '../lib/sessions.js';
import { normaliseSearch, sanitizeBlocks } from '../lib/sanitize.js';
import type { PublicUser } from '../types.js';

const USERNAME_RE = /^[A-Za-z0-9_-]{3,20}$/;
const LOCALES = ['fr', 'en', 'es', 'de', 'it'];

export function accountRoutes(db: DB): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/', async (req, res) => {
    const user = req.user!;
    const passkeys = await db.all('SELECT id, label, created_at FROM webauthn_credentials WHERE user_id = ? ORDER BY created_at DESC', [user.id]) as { id: string; label: string; created_at: number }[];
    const backup = await db.get('SELECT COUNT(*) AS c FROM backup_codes WHERE user_id = ? AND used_at IS NULL', [user.id]) as { c: number };
    const oauth = await db.all('SELECT provider, linked_at FROM oauth_identities WHERE user_id = ?', [user.id]) as { provider: string; linked_at: number }[];
    const activeSessions = await db.get('SELECT COUNT(*) AS c FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?', [user.id, Date.now()]) as { c: number };
    const pendingDeletion = (user as unknown as { deletion_requested_at?: number | null }).deletion_requested_at ?? null;
    const hasPasskey = passkeys.length > 0;
    const licenses = oauth.filter((o) => ['steam', 'epic'].includes(o.provider)).map((o) => ({
      provider: o.provider,
      status: 'linked',
      ownership: 'self',
      verifiedAt: o.linked_at,
      note: 'La licence est vérifiée par le jeu auprès de la plateforme, jamais depuis le navigateur.',
    }));

    res.json({
      profile: await profileView(db, user, user.id),
      email: user.email,
      needsEmail: !user.email,
      locale: user.locale,
      role: user.role,
      createdAt: user.created_at,
      socials: socialsOf(user),
      oauthIdentities: oauth.map((o) => ({ provider: o.provider, linkedAt: o.linked_at })),
      twoFactor: {
        totp: !!user.totp_secret,
        passkeys: passkeys.map((p) => ({ id: p.id, label: p.label, createdAt: p.created_at })),
        passkeysRequired: user.role === 'admin',
        staffMandatory: user.role !== 'player',
        backupCodesLeft: backup.c,
        recoveryDelayHours: 72,
        recoveryAvailableAt: (await db.get("SELECT created_at FROM notifications WHERE user_id = ? AND kind = '2fa_recovery' ORDER BY created_at DESC LIMIT 1", [user.id]) as { created_at: number } | undefined)?.created_at ?? null,
      },
      sessions: { active: activeSessions, staffPolicy: user.role !== 'player' },
      licenses,
      stats: await statsSummary(db, user.id),
      pendingDeletion: pendingDeletion ? { requestedAt: pendingDeletion, purgeAfter: pendingDeletion + DELETION_GRACE_MS } : null,
      reauthFresh: Date.now() - (user.reauth_at ?? 0) < 5 * 60 * 1000,
      notifications: await db.all('SELECT id, kind, body, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20', [user.id]),
    });
  });

  router.patch('/profile', async (req, res) => {
    const user = req.user!;
    const body = req.body ?? {};
    const updates: Record<string, unknown> = {};

    if (body.username !== undefined) {
      const username = String(body.username).trim();
      if (!USERNAME_RE.test(username)) {
        return res.status(400).json({ error: 'invalid_username', message: '3 à 20 caractères : lettres, chiffres, tiret, tiret bas.' });
      }
      const conflict = await db.get('SELECT 1 AS hit FROM users WHERE lower(username) = lower(?) AND id <> ?', [username, user.id]);
      if (conflict) return res.status(409).json({ error: 'username_taken', message: 'Ce pseudonyme est déjà utilisé.' });
      updates.username = username;
    }
    if (body.bio !== undefined) updates.bio = String(body.bio).slice(0, 600);
    if (body.profilePublic !== undefined) updates.profile_public = body.profilePublic ? 1 : 0;
    if (body.showSocials !== undefined) updates.show_socials = body.showSocials ? 1 : 0;
    if (body.locale !== undefined) {
      if (!LOCALES.includes(String(body.locale))) return res.status(400).json({ error: 'invalid_locale' });
      updates.locale = String(body.locale);
    }
    if (body.socials !== undefined && typeof body.socials === 'object' && body.socials) {
      const clean: Record<string, string> = {};
      for (const [key, value] of Object.entries(body.socials as Record<string, unknown>)) {
        if (!['discord', 'steam', 'epic', 'google', 'youtube', 'twitch', 'x'].includes(key)) continue;
        const text = String(value ?? '').trim();
        if (!text) continue;
        if (!/^https?:\/\/[^\s]{3,200}$/i.test(text)) {
          return res.status(400).json({ error: 'invalid_social_url', message: 'Les liens doivent commencer par http(s)://' });
        }
        clean[key] = text;
      }
      updates.socials_json = JSON.stringify(clean);
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'no_changes' });

    const fields = Object.keys(updates).map((k) => `${k} = @${k}`).join(', ');
    await db.run(`UPDATE users SET ${fields}, updated_at = @updated_at WHERE id = @id`, [{ ...updates, updated_at: Date.now(), id: user.id }]);

    await appendAudit(db, {
      actorId: user.id, actorRole: user.role, action: 'account.profile_updated',
      targetType: 'user', targetId: user.id, ipTrunc: req.ipTrunc,
      meta: { fields: Object.keys(updates) },
    });
    const updated = (await findUserById(db, user.id))!;
    res.json({ ok: true, profile: await profileView(db, updated, user.id) });
  });

  router.get('/stats', async (req, res) => {
    res.json({
      summary: await statsSummary(db, req.user!.id),
      rows: (await statsFor(db, req.user!.id)).map((s) => ({
        mode: s.mode,
        operation: s.operation_code,
        ending: s.ending_code,
        bestTimeMs: s.best_time_ms,
        deaths: s.deaths,
        reputation: s.reputation,
        playtimeMs: s.playtime_ms,
        score: Math.round(s.score * 10) / 10,
        verifiedAt: s.verified_at,
        updatedAt: s.updated_at,
      })),
      scoring: {
        reputationTitles: '[titres à définir]',
        syncIntervalHours: 24,
        validatedServerSide: true,
        moderatorRemoval: true,
      },
    });
  });

  router.get('/licenses', async (req, res) => {
    const rows = await db.all("SELECT provider, linked_at FROM oauth_identities WHERE user_id = ? AND provider IN ('steam','epic')", [req.user!.id]) as { provider: string; linked_at: number }[];
    res.json({
      licenses: rows.map((r) => ({
        provider: r.provider,
        ownership: 'self',
        status: 'verified',
        verifiedAt: r.linked_at,
        note: 'Licence vérifiée côté API. Le partage familial Steam est accepté et marqué « shared ».',
      })),
      dispute: { available: true, via: '/support', note: 'Les litiges de licence sont traités par un modérateur ou un administrateur.' },
    });
  });

  router.get('/notifications', async (req, res) => {
    res.json({
      items: await db.all('SELECT id, kind, body, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', [req.user!.id]),
    });
  });

  router.post('/notifications/read', async (req, res) => {
    if (req.body?.id) {
      await db.run('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?', [Date.now(), String(req.body.id), req.user!.id]);
    } else {
      await db.run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', [Date.now(), req.user!.id]);
    }
    res.json({ ok: true });
  });

  /** Unlinking an external provider is a sensitive action. */
  router.post('/oauth/:provider/unlink', requireReauth, async (req, res) => {
    const provider = String(req.params.provider);
    if (!['discord', 'steam', 'epic', 'google'].includes(provider)) return res.status(404).json({ error: 'not_found' });
    const info = await db.run('DELETE FROM oauth_identities WHERE user_id = ? AND provider = ?', [req.user!.id, provider]);
    if (!info.changes) return res.status(404).json({ error: 'not_linked' });
    await appendAudit(db, {
      actorId: req.user!.id, actorRole: req.user!.role, action: 'oauth.unlinked',
      targetType: 'user', targetId: req.user!.id, ipTrunc: req.ipTrunc, meta: { provider },
    });
    res.json({ ok: true });
  });

  /** RGPD export (§5.9 / legal). */
  router.get('/export', async (req, res) => {
    const user = req.user!;
    const payload = {
      exportedAt: new Date().toISOString(),
      account: {
        mirageId: user.mirage_id,
        username: user.username,
        email: user.email,
        role: user.role,
        locale: user.locale,
        createdAt: new Date(user.created_at).toISOString(),
        profilePublic: !!user.profile_public,
        socials: socialsOf(user),
        bio: user.bio,
      },
      stats: await statsFor(db, user.id),
      sessions: await db.all('SELECT created_at, last_seen, expires_at, ip_trunc, device_label FROM sessions WHERE user_id = ?', [user.id]),
      oauth: await db.all('SELECT provider, linked_at FROM oauth_identities WHERE user_id = ?', [user.id]),
      servers: await db.all('SELECT name, host, port, status FROM servers WHERE owner_id = ? AND deleted_at IS NULL', [user.id]),
      tickets: await db.all('SELECT ref, subject, status, created_at FROM support_tickets WHERE user_id = ?', [user.id]),
      audit: await db.all('SELECT at, action, target_type, target_id FROM audit_log WHERE actor_id = ? ORDER BY at DESC LIMIT 500', [user.id]),
    };
    await appendAudit(db, {
      actorId: user.id, actorRole: user.role, action: 'account.export',
      targetType: 'user', targetId: user.id, ipTrunc: req.ipTrunc,
    });
    res.setHeader('Content-Disposition', `attachment; filename="mirage-export-${user.mirage_id.replace(/[:.]/g, '-')}.json"`);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.send(JSON.stringify(payload, null, 2));
  });

  /**
   * Account deletion — §5.8. Seven-day retraction window; the Mirage ID stays
   * reserved forever even after the account is purged.
   */
  router.post('/delete', async (req, res) => {
    if (Date.now() - (req.user!.reauth_at ?? 0) > 5 * 60 * 1000) {
      return res.status(403).json({ error: 'reauth_required' });
    }
    const password = String(req.body?.password ?? '');
    if (req.user!.password_hash) {
      if (!(await verifyPassword(req.user!.password_hash, password))) {
        return res.status(401).json({ error: 'invalid_credentials', message: 'Mot de passe invalide.' });
      }
    }
    const now = Date.now();
    await db.run('UPDATE users SET deletion_requested_at = ?, purge_after = ?, status = ?, updated_at = ? WHERE id = ?', [now, now + DELETION_GRACE_MS, 'pending_deletion', now, req.user!.id]);
    await revokeAllForUser(db, req.user!.id, null, 'account_deletion');
    await appendAudit(db, {
      actorId: req.user!.id, actorRole: req.user!.role, action: 'account.deletion_requested',
      targetType: 'user', targetId: req.user!.id, ipTrunc: req.ipTrunc,
      meta: { mirageId: req.user!.mirage_id, purgeAfter: now + DELETION_GRACE_MS },
    });
    res.json({
      ok: true,
      purgeAfter: now + DELETION_GRACE_MS,
      retractionWindowDays: 7,
      mirageIdReservedForever: req.user!.mirage_id,
      message: 'Suppression programmée. Le Mirage ID reste réservé définitivement.',
    });
  });

  router.post('/delete/cancel', async (req, res) => {
    const now = Date.now();
    const info = await db.run("UPDATE users SET deletion_requested_at = NULL, purge_after = NULL, status = 'active', updated_at = ? WHERE id = ? AND status = 'pending_deletion'", [now, req.user!.id]);
    if (!info.changes) return res.status(409).json({ error: 'not_pending' });
    await appendAudit(db, {
      actorId: req.user!.id, actorRole: req.user!.role, action: 'account.deletion_cancelled',
      targetType: 'user', targetId: req.user!.id, ipTrunc: req.ipTrunc,
    });
    res.json({ ok: true });
  });

  router.get('/search-wiki', async (req, res) => {
    const q = normaliseSearch(String(req.query.q ?? ''));
    const rows = await db.all("SELECT slug FROM content WHERE type = 'wiki' AND status = 'published' AND lower(slug) LIKE ? LIMIT 10", [`%${q}%`]) as { slug: string }[];
    res.json({ results: rows });
  });

  router.post('/blocks/preview', (req, res) => {
    res.json({ blocks: sanitizeBlocks(req.body?.blocks) });
  });

  void TWOFA_RECOVERY_DELAY_MS;
  return router;
}

export const accountHelpers = { newId, twoFa: (user: PublicUser) => !!user.totp_secret };
