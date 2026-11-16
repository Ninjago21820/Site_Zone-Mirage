import { Router, type Request } from 'express';
import type { DB } from '../db.js';
import { OFFLINE_GRACE_MS, DEMO_MODE } from '../config.js';
import {
  ensureSigningKey, publicSigningKeys, signLicenseToken, verifyLicenseToken,
  issueSessionTicket, consumeSessionTicket, verifyStatsSignature,
} from '../lib/licenses.js';
import { verifyOwnership, platformAppIds, type PlatformProvider } from '../lib/platform.js';
import { handleInteraction, verifyDiscordSignature, DISCORD_COMMANDS } from '../lib/discord.js';
import { appendAudit } from '../lib/audit.js';
import { rateLimit } from '../lib/throttle.js';
import { sha256, newId } from '../lib/ids.js';
import type { PublicUser } from '../types.js';

const PROVIDERS: PlatformProvider[] = ['steam', 'epic'];
const OPERATION_RE = /^[A-Z0-9-]{3,24}$/;
const MODES = ['story', 'multiplayer'];

interface LicenseAuth {
  ok: boolean;
  claims?: Record<string, any>;
  reason?: string;
}

function readLicense(req: Request, db: DB): LicenseAuth {
  const header = req.get('authorization') ?? '';
  const token = header.replace(/^License\s+/i, '').trim();
  if (!token) return { ok: false, reason: 'missing_token' };
  const result = verifyLicenseToken(db, token);
  if (!result.valid) return { ok: false, reason: result.reason };
  return { ok: true, claims: result.claims as unknown as Record<string, any> };
}

function serverAuth(db: DB, req: Request): { ok: boolean; serverId?: string } {
  const serverId = String(req.get('x-server-id') ?? req.body?.serverId ?? '');
  const signature = String(req.get('x-signature') ?? req.body?.signature ?? '');
  if (!serverId) return { ok: false };
  const server = db.prepare('SELECT id, status FROM servers WHERE id = ? AND deleted_at IS NULL').get(serverId) as
    | { id: string; status: string }
    | undefined;
  if (!server) return { ok: false };
  // The signature field itself is excluded from the canonical payload.
  const { signature: _ignored, ...payload } = (req.body ?? {}) as Record<string, unknown>;
  void _ignored;
  if (!verifyStatsSignature(serverId, payload, signature)) return { ok: false };
  return { ok: true, serverId };
}

export function apiV1Routes(db: DB): Router {
  const router = Router();

  router.get('/config', (_req, res) => {
    ensureSigningKey(db);
    res.json({
      apiVersion: '1.0',
      game: { name: 'SCP: Mirage Protocol', releaseDate: null, releaseLabel: 'Date de sortie non annoncée' },
      platforms: platformAppIds(),
      offlineGraceDays: OFFLINE_GRACE_MS / 86400000,
      sessionTicketTtlSeconds: 60,
      statsSyncIntervalHours: 24,
      maxServersPerAccount: 3,
      demoMode: DEMO_MODE,
      discordCommands: DISCORD_COMMANDS,
    });
  });

  /** Public keys for offline licence-token verification in the game client. */
  router.get('/keys', (_req, res) => {
    ensureSigningKey(db);
    res.json({ keys: publicSigningKeys(db).filter((k) => !k.revoked) });
  });

  /**
   * §5.4 — licence verification.
   * Returns a neutral decision; a platform error never produces a sanction.
   */
  router.post('/licenses/verify', async (req, res) => {
    const ip = req.ipTrunc ?? 'unknown';
    if (!rateLimit(`lic:${ip}`, 120, 60 * 1000)) return res.status(429).json({ error: 'rate_limited' });
    const body = req.body ?? {};
    const provider = String(body.provider ?? '') as PlatformProvider;
    const proof = String(body.proof ?? '');
    if (!PROVIDERS.includes(provider)) return res.status(400).json({ error: 'invalid_provider' });
    if (!proof) return res.status(400).json({ error: 'missing_proof', message: 'Preuve d’authentification de la plateforme manquante.' });

    const ownership = await verifyOwnership(provider, proof);
    const mirageId = body.mirageId ? String(body.mirageId) : null;
    const user = mirageId
      ? (db.prepare('SELECT * FROM users WHERE mirage_id = ?').get(mirageId) as PublicUser | undefined)
      : undefined;

    appendAudit(db, {
      actorId: user?.id ?? null, actorRole: user?.role ?? null, action: 'license.verified',
      targetType: 'license', targetId: mirageId, ipTrunc: req.ipTrunc,
      meta: { provider, status: ownership.status, error: ownership.error ?? null },
    });

    if (ownership.status === 'unowned') {
      return res.status(200).json({
        decision: 'unowned',
        provider,
        features: { story: false, online: false },
        sanction: false,
        message: 'Aucune licence valide n’a été trouvée pour ce compte de plateforme.',
        messageEn: 'No valid licence was found for this platform account.',
        retryAfterSeconds: 300,
      });
    }

    if (ownership.status === 'unavailable') {
      // Platform timeout: no sanction, Story grace applies.
      const { token, claims } = signLicenseToken(db, {
        sub: user?.id ?? 'anonymous',
        mid: user?.mirage_id ?? mirageId ?? '',
        provider,
        appId: ownership.appId ?? '',
        ownership: 'self',
        scope: ['story'],
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor((Date.now() + OFFLINE_GRACE_MS) / 1000),
      });
      return res.status(200).json({
        decision: 'grace',
        provider,
        ownership: 'unknown',
        reason: ownership.error ?? 'platform_unavailable',
        features: { story: true, online: false },
        sanction: false,
        token,
        claims,
        graceDays: OFFLINE_GRACE_MS / 86400000,
        message: 'Plateforme temporairement indisponible. Le mode Histoire reste accessible, sans sanction.',
      });
    }

    const scope: ('story' | 'online')[] = ownership.status === 'shared' ? ['story', 'online'] : ['story', 'online'];
    const { token, claims } = signLicenseToken(db, {
      sub: user?.id ?? 'anonymous',
      mid: user?.mirage_id ?? mirageId ?? '',
      provider,
      appId: ownership.appId ?? '',
      ownership: ownership.status === 'shared' ? 'shared' : 'self',
      scope,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor((Date.now() + OFFLINE_GRACE_MS) / 1000),
    });

    res.json({
      decision: 'granted',
      provider,
      ownership: ownership.status,
      familySharing: ownership.status === 'shared',
      features: { story: true, online: true },
      sanction: false,
      token,
      claims,
      graceDays: OFFLINE_GRACE_MS / 86400000,
      message: ownership.status === 'shared'
        ? 'Licence reçue via le partage familial. Toutes les fonctionnalités en ligne sont accessibles.'
        : 'Licence vérifiée.',
    });
  });

  router.post('/licenses/decode', (req, res) => {
    const token = String(req.body?.token ?? '');
    const result = verifyLicenseToken(db, token);
    res.status(result.valid ? 200 : 400).json(result);
  });

  /** §5.5 — single-use, short-lived, server-bound session ticket. */
  router.post('/session-tickets', (req, res) => {
    const auth = readLicense(req, db);
    if (!auth.ok) return res.status(401).json({ error: 'invalid_license', reason: auth.reason });
    if (!Array.isArray(auth.claims?.scope) || !auth.claims!.scope.includes('online')) {
      return res.status(403).json({ error: 'online_not_allowed', message: 'Cette licence n’autorise pas les fonctionnalités en ligne.' });
    }
    const serverId = String(req.body?.serverId ?? '');
    const server = db.prepare("SELECT id, status, maintenance FROM servers WHERE id = ? AND deleted_at IS NULL").get(serverId) as
      | { id: string; status: string; maintenance: number }
      | undefined;
    if (!server || server.status !== 'active') return res.status(404).json({ error: 'server_unavailable' });
    if (server.maintenance) return res.status(409).json({ error: 'server_in_maintenance' });
    const userId = String(auth.claims?.sub ?? '');
    if (!userId || userId === 'anonymous') return res.status(409).json({ error: 'account_required', message: 'Un compte lié est requis pour le mode Multijoueur.' });

    const ticket = issueSessionTicket(db, userId, serverId);
    appendAudit(db, {
      actorId: userId, actorRole: 'player', action: 'session.ticket_issued', targetType: 'server',
      targetId: serverId, ipTrunc: req.ipTrunc,
    });
    res.json(ticket);
  });

  router.post('/session-tickets/redeem', (req, res) => {
    const auth = serverAuth(db, req);
    if (!auth.ok) return res.status(401).json({ error: 'invalid_server_signature' });
    const ticket = String(req.body?.ticket ?? '');
    const result = consumeSessionTicket(db, ticket, auth.serverId!);
    if (!result.ok) {
      appendAudit(db, {
        actorId: null, actorRole: null, action: 'session.ticket_rejected', targetType: 'server',
        targetId: auth.serverId!, ipTrunc: req.ipTrunc, meta: { reason: result.reason },
      });
      return res.status(409).json({ error: result.reason });
    }
    res.json({ ok: true, userId: result.userId });
  });

  /** §5.7 — signed stats synchronisation from a validated game server. */
  router.post('/stats/sync', (req, res) => {
    const auth = serverAuth(db, req);
    if (!auth.ok) return res.status(401).json({ error: 'invalid_server_signature' });
    const entries = Array.isArray(req.body?.entries) ? req.body.entries.slice(0, 500) : [];
    const now = Date.now();
    let accepted = 0;
    const rejected: { index: number; reason: string }[] = [];

    for (const [index, raw] of entries.entries()) {
      if (!raw || typeof raw !== 'object') {
        rejected.push({ index, reason: 'invalid_entry' });
        continue;
      }
      const mode = MODES.includes(String(raw.mode)) ? String(raw.mode) : null;
      const operation = String(raw.operation ?? '');
      if (!mode) {
        rejected.push({ index, reason: 'invalid_mode' });
        continue;
      }
      if (!OPERATION_RE.test(operation)) {
        rejected.push({ index, reason: 'invalid_operation' });
        continue;
      }
      const user = raw.mirageId
        ? (db.prepare('SELECT id FROM users WHERE mirage_id = ?').get(String(raw.mirageId)) as { id: string } | undefined)
        : undefined;
      const bestTime = raw.bestTimeMs != null ? Math.trunc(Number(raw.bestTimeMs)) : null;
      if (bestTime !== null && (bestTime <= 1000 || bestTime > 86400000)) {
        rejected.push({ index, reason: 'implausible_time' });
        continue;
      }
      const deaths = Math.max(0, Math.min(1_000_000, Math.trunc(Number(raw.deaths ?? 0))));
      const playtime = Math.max(0, Math.min(10_000 * 3600 * 1000, Math.trunc(Number(raw.playtimeMs ?? 0))));
      const reputation = Math.max(0, Math.min(1_000_000, Math.trunc(Number(raw.reputation ?? 0))));
      const score = Math.max(0, Math.min(100_000, Number(raw.score ?? 0)));
      const ending = raw.ending ? String(raw.ending).slice(0, 24) : null;

      const existing = db.prepare(
        'SELECT * FROM stat_entries WHERE user_id = ? AND mode = ? AND operation_code = ?',
      ).get(user?.id ?? null, mode, operation) as Record<string, any> | undefined;

      if (existing) {
        const betterTime = bestTime !== null && (existing.best_time_ms === null || bestTime < existing.best_time_ms);
        db.prepare(`UPDATE stat_entries SET ending_code = COALESCE(?, ending_code), best_time_ms = ?, deaths = ?,
          reputation = ?, playtime_ms = ?, score = ?, verified_at = ?, updated_at = ? WHERE id = ?`)
          .run(ending, betterTime ? bestTime : existing.best_time_ms, deaths, reputation, playtime, score, now, now, existing.id);
      } else {
        db.prepare(`INSERT INTO stat_entries
          (id,user_id,display_name,mode,operation_code,ending_code,best_time_ms,deaths,reputation,playtime_ms,score,hidden,verified_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?,?)`)
          .run(newId('st'), user?.id ?? null, raw.displayName ? String(raw.displayName).slice(0, 40) : 'Anonyme',
            mode, operation, ending, bestTime, deaths, reputation, playtime, score, now, now);
      }
      accepted++;
    }

    db.prepare('UPDATE servers SET last_online_at = ? WHERE id = ?').run(now, auth.serverId!);
    appendAudit(db, {
      actorId: null, actorRole: 'server', action: 'stats.synced', targetType: 'server',
      targetId: auth.serverId!, ipTrunc: req.ipTrunc, meta: { accepted, rejected: rejected.length },
    });
    res.json({ ok: true, accepted, rejected, syncedAt: now, nextSyncBefore: now + 24 * 3600 * 1000 });
  });

  router.post('/servers/heartbeat', (req, res) => {
    const auth = serverAuth(db, req);
    if (!auth.ok) return res.status(401).json({ error: 'invalid_server_signature' });
    const current = Math.max(0, Math.trunc(Number(req.body?.currentPlayers ?? 0)));
    const avg = Math.max(0, Number(req.body?.avgPlayers ?? current));
    const max = Math.max(1, Math.trunc(Number(req.body?.maxPlayers ?? 24)));
    const row = db.prepare('SELECT avg_players FROM servers WHERE id = ?').get(auth.serverId!) as { avg_players: number };
    const smoothed = row.avg_players > 0 ? row.avg_players * 0.8 + avg * 0.2 : avg;
    db.prepare('UPDATE servers SET current_players = ?, avg_players = ?, max_players = ?, last_online_at = ? WHERE id = ?')
      .run(current, Math.round(smoothed * 100) / 100, max, Date.now(), auth.serverId!);
    res.json({ ok: true });
  });

  router.get('/leaderboards', (req, res) => {
    const mode = req.query.mode === 'multiplayer' ? 'multiplayer' : 'story';
    const rows = db.prepare(
      `SELECT s.*, u.username, u.profile_public FROM stat_entries s
       LEFT JOIN users u ON u.id = s.user_id
       WHERE s.mode = ? AND s.hidden = 0 AND (s.user_id IS NULL OR u.profile_public = 1)
       ORDER BY s.best_time_ms IS NULL, s.best_time_ms ASC LIMIT 100`,
    ).all(mode) as Record<string, any>[];
    res.json({
      mode,
      entries: rows.map((r) => ({
        player: r.username ?? r.display_name,
        operation: r.operation_code,
        ending: r.ending_code,
        bestTimeMs: r.best_time_ms,
        deaths: r.deaths,
        reputation: r.reputation,
        score: r.score,
        updatedAt: r.updated_at,
      })),
      validation: 'Entrées validées côté serveur de jeu, synchronisées au plus toutes les 24 h.',
    });
  });

  /* ------------------------------------------------------------------ *
   * Discord interactions (Ed25519) — §12.3
   * ------------------------------------------------------------------ */
  router.post('/discord/interactions', (req, res) => {
    const raw = (req as Request & { rawBody?: Buffer }).rawBody;
    const valid = verifyDiscordSignature({
      publicKeyHex: process.env.DISCORD_PUBLIC_KEY,
      signatureHex: req.get('x-signature-ed25519') ?? undefined,
      timestamp: req.get('x-signature-timestamp') ?? undefined,
      rawBody: raw,
    });
    if (!valid) {
      // Without a configured public key the endpoint stays closed rather than open.
      if (!process.env.DISCORD_PUBLIC_KEY) {
        return res.status(503).json({ error: 'discord_not_configured', message: 'Clé publique Discord non configurée.' });
      }
      return res.status(401).json({ error: 'invalid_signature' });
    }
    const result = handleInteraction(db, req.body ?? {}, req.get('x-interaction-id') ?? undefined);
    res.status(result.status).json(result.body);
  });

  router.use((_req, res) => res.status(404).json({ error: 'not_found', api: 'v1' }));

  return router;
}

export const apiHelpers = { sha256 };
