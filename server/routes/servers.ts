import { Router } from 'express';
import type { DB } from '../db.js';
import { requireAuth, requireReauth, requireStaff, requireFunction } from '../middleware/auth.js';
import { appendAudit } from '../lib/audit.js';
import { newId } from '../lib/ids.js';
import { checkTarget, parseHostPort } from '../lib/ssrf.js';
import { serverSecret } from '../lib/licenses.js';
import { canFunction } from '../lib/rbac.js';
import { rateLimit } from '../lib/throttle.js';

const MAX_SERVERS_PER_USER = 3;
const OFFLINE_ALERT_DAYS = 14;

function shape(row: Record<string, any>) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    address: `${row.host}:${row.port}`,
    host: row.host,
    port: row.port,
    region: row.region,
    status: row.status,
    maintenance: !!row.maintenance,
    currentPlayers: row.current_players,
    averagePlayers: Math.round(Number(row.avg_players) * 10) / 10,
    maxPlayers: row.max_players,
    validatedAt: row.validated_at,
    validatedBy: row.validated_by,
    lastOnlineAt: row.last_online_at,
    offlineDays: row.last_online_at ? Math.floor((Date.now() - row.last_online_at) / 86400000) : null,
    createdAt: row.created_at,
  };
}

export function serverRoutes(db: DB): Router {
  const router = Router();

  router.get('/mine', requireAuth, (req, res) => {
    const rows = db.prepare('SELECT * FROM servers WHERE owner_id = ? AND deleted_at IS NULL ORDER BY created_at DESC')
      .all(req.user!.id) as Record<string, any>[];
    // §7 — alert the creator when a server has been offline for more than 14 days.
    for (const row of rows) {
      const offlineDays = row.last_online_at ? Math.floor((Date.now() - row.last_online_at) / 86400000) : 0;
      if (offlineDays > OFFLINE_ALERT_DAYS) {
        const existing = db.prepare("SELECT 1 AS hit FROM notifications WHERE user_id = ? AND kind = ? AND body LIKE ?")
          .get(req.user!.id, 'server_offline', `%${row.id}%`);
        if (!existing) {
          db.prepare('INSERT INTO notifications (id,user_id,kind,body,created_at) VALUES (?,?,?,?,?)')
            .run(newId('ntf'), req.user!.id, 'server_offline',
              `Votre serveur ${row.name} (${row.id}) est hors ligne depuis ${offlineDays} jours. Mettez-le à jour ou retirez-le du référencement.`,
              Date.now());
        }
      }
    }
    res.json({
      servers: rows.map(shape),
      limits: { maxPerUser: MAX_SERVERS_PER_USER, used: rows.length },
      rules: [
        'Trois serveurs maximum par compte.',
        'Toute inscription est validée par l’équipe avant publication.',
        'L’adresse IP:port est contrôlée côté serveur (protection SSRF).',
        'Les trois serveurs les plus récemment créés ou validés sont mis en avant.',
      ],
    });
  });

  router.post('/', requireAuth, async (req, res) => {
    if (!rateLimit(`server-create:${req.user!.id}`, 10, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    const count = db.prepare('SELECT COUNT(*) AS c FROM servers WHERE owner_id = ? AND deleted_at IS NULL').get(req.user!.id) as { c: number };
    if (count.c >= MAX_SERVERS_PER_USER) {
      return res.status(409).json({ error: 'server_limit', message: 'Limite de trois serveurs par compte atteinte.' });
    }
    const body = req.body ?? {};
    const name = String(body.name ?? '').trim();
    if (name.length < 3 || name.length > 60) {
      return res.status(400).json({ error: 'invalid_name', message: 'Le nom doit contenir entre 3 et 60 caractères.' });
    }
    const parsed = parseHostPort(String(body.address ?? ''));
    if (!parsed) return res.status(400).json({ error: 'invalid_address', message: 'Format attendu : IP:port (ou hôte:port).' });

    // §7 + §6.13 — SSRF validation happens before anything is stored.
    const target = await checkTarget(parsed.host, parsed.port);
    if (!target.ok) return res.status(400).json({ error: 'address_rejected', message: target.reason });

    const id = newId('srv');
    const now = Date.now();
    db.prepare(`INSERT INTO servers
      (id,owner_id,name,description,host,port,region,tag,status,maintenance,current_players,avg_players,max_players,last_online_at,created_at)
      VALUES (?,?,?,?,?,?,?,?, 'pending', 0, 0, 0, ?, ?, ?)`)
      .run(id, req.user!.id, name, String(body.description ?? '').slice(0, 400), target.host!.toLowerCase(), target.port!,
        String(body.region ?? '').slice(0, 8), '', Number(body.maxPlayers ?? 24) || 24, now, now);

    appendAudit(db, {
      actorId: req.user!.id, actorRole: req.user!.role, action: 'server.created', targetType: 'server',
      targetId: id, ipTrunc: req.ipTrunc, meta: { host: target.host, port: target.port, addresses: target.addresses },
    });
    res.status(201).json({
      ok: true,
      id,
      status: 'pending',
      message: 'Serveur enregistré. Il sera publié après validation par l’équipe.',
      secret: serverSecret(id),
      secretNote: 'Secret de signature à configurer sur le serveur de jeu (statistiques et battements de cœur).',
    });
  });

  router.patch('/:id', requireAuth, requireReauth, async (req, res) => {
    const row = db.prepare('SELECT * FROM servers WHERE id = ? AND owner_id = ? AND deleted_at IS NULL')
      .get(req.params.id, req.user!.id) as Record<string, any> | undefined;
    if (!row) return res.status(404).json({ error: 'not_found' });
    const body = req.body ?? {};
    const updates: Record<string, unknown> = {};

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (name.length < 3 || name.length > 60) return res.status(400).json({ error: 'invalid_name' });
      updates.name = name;
    }
    if (body.description !== undefined) updates.description = String(body.description).slice(0, 400);
    if (body.region !== undefined) updates.region = String(body.region).slice(0, 8);
    if (body.maxPlayers !== undefined) updates.max_players = Number(body.maxPlayers) || 24;
    if (body.address !== undefined) {
      const parsed = parseHostPort(String(body.address));
      if (!parsed) return res.status(400).json({ error: 'invalid_address' });
      const target = await checkTarget(parsed.host, parsed.port);
      if (!target.ok) return res.status(400).json({ error: 'address_rejected', message: target.reason });
      // Any address change sends the server back to validation.
      updates.host = target.host!.toLowerCase();
      updates.port = target.port;
      updates.status = 'pending';
      updates.validated_at = null;
      updates.validated_by = null;
    }
    if (body.maintenance !== undefined) updates.maintenance = body.maintenance ? 1 : 0;
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'no_changes' });

    const fields = Object.keys(updates).map((k) => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE servers SET ${fields} WHERE id = @id`).run({ ...updates, id: row.id });
    appendAudit(db, {
      actorId: req.user!.id, actorRole: req.user!.role, action: 'server.updated', targetType: 'server',
      targetId: row.id, ipTrunc: req.ipTrunc, meta: { fields: Object.keys(updates) },
    });
    const updated = db.prepare('SELECT * FROM servers WHERE id = ?').get(row.id) as Record<string, any>;
    res.json({ ok: true, server: shape(updated) });
  });

  router.post('/:id/maintenance', requireAuth, requireReauth, (req, res) => {
    const row = db.prepare('SELECT * FROM servers WHERE id = ? AND deleted_at IS NULL').get(req.params.id) as Record<string, any> | undefined;
    if (!row) return res.status(404).json({ error: 'not_found' });
    const isOwner = row.owner_id === req.user!.id;
    const isStaff = canFunction(req.user!.role as never, 'server_validation');
    if (!isOwner && !isStaff) return res.status(403).json({ error: 'forbidden' });
    const next = row.maintenance ? 0 : 1;
    db.prepare('UPDATE servers SET maintenance = ? WHERE id = ?').run(next, row.id);
    appendAudit(db, {
      actorId: req.user!.id, actorRole: req.user!.role, action: 'server.maintenance',
      targetType: 'server', targetId: row.id, ipTrunc: req.ipTrunc, meta: { maintenance: !!next },
    });
    res.json({ ok: true, maintenance: !!next });
  });

  router.delete('/:id', requireAuth, requireReauth, (req, res) => {
    const row = db.prepare('SELECT * FROM servers WHERE id = ? AND deleted_at IS NULL').get(req.params.id) as Record<string, any> | undefined;
    if (!row) return res.status(404).json({ error: 'not_found' });
    const isOwner = row.owner_id === req.user!.id;
    const isStaff = canFunction(req.user!.role as never, 'server_validation');
    if (!isOwner && !isStaff) return res.status(403).json({ error: 'forbidden' });
    db.prepare('UPDATE servers SET deleted_at = ? WHERE id = ?').run(Date.now(), row.id);
    appendAudit(db, {
      actorId: req.user!.id, actorRole: req.user!.role, action: 'server.deleted',
      targetType: 'server', targetId: row.id, ipTrunc: req.ipTrunc,
    });
    res.json({ ok: true });
  });

  /* ------------------------- staff moderation ------------------------- */
  router.get('/queue', requireStaff, requireFunction('server_validation'), (req, res) => {
    const rows = db.prepare("SELECT * FROM servers WHERE deleted_at IS NULL AND status IN ('pending','suspended') ORDER BY created_at ASC")
      .all() as Record<string, any>[];
    res.json({ servers: rows.map((r) => ({ ...shape(r), ownerId: r.owner_id })) });
  });

  router.post('/:id/validate', requireStaff, requireFunction('server_validation'), async (req, res) => {
    const row = db.prepare('SELECT * FROM servers WHERE id = ? AND deleted_at IS NULL').get(req.params.id) as Record<string, any> | undefined;
    if (!row) return res.status(404).json({ error: 'not_found' });
    const approve = req.body?.approve !== false;
    const reason = String(req.body?.reason ?? '').slice(0, 300);
    if (!approve && reason.trim().length < 5) {
      return res.status(400).json({ error: 'reason_required', message: 'Un motif est requis pour refuser ou suspendre.' });
    }
    // Re-run the SSRF check: a record could have been created before a DNS change.
    const target = await checkTarget(row.host, row.port);
    if (approve && !target.ok) {
      return res.status(409).json({ error: 'address_rejected', message: target.reason });
    }
    const now = Date.now();
    if (approve) {
      db.prepare("UPDATE servers SET status = 'active', validated_at = ?, validated_by = ?, last_online_at = ? WHERE id = ?")
        .run(now, req.user!.id, now, row.id);
    } else {
      db.prepare("UPDATE servers SET status = 'suspended', validated_by = ? WHERE id = ?").run(req.user!.id, row.id);
    }
    appendAudit(db, {
      actorId: req.user!.id, actorRole: req.user!.role, action: approve ? 'server.validated' : 'server.suspended',
      targetType: 'server', targetId: row.id, ipTrunc: req.ipTrunc, meta: { reason },
    });
    db.prepare('INSERT INTO notifications (id,user_id,kind,body,created_at) VALUES (?,?,?,?,?)')
      .run(newId('ntf'), row.owner_id, 'server_moderation',
        approve ? `Votre serveur ${row.name} a été validé et publié.` : `Votre serveur ${row.name} a été suspendu. Motif : ${reason}`,
        now);
    res.json({ ok: true, status: approve ? 'active' : 'suspended' });
  });

  return router;
}
