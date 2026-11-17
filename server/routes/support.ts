import { Router } from 'express';
import type { DB } from '../db.js';
import { requireAuth, requireStaff, requireFunction } from '../middleware/auth.js';
import { appendAudit } from '../lib/audit.js';
import { notifySupport, sendTicketReceived } from '../lib/mailer.js';
import { newId } from '../lib/ids.js';
import { stripTags } from '../lib/sanitize.js';
import { rateLimit } from '../lib/throttle.js';
import { canFunction, functionScope } from '../lib/rbac.js';
import type { Role } from '../db.js';

const CATEGORIES = ['security', 'account', 'license', 'server', 'technical', 'game', 'other'];
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;
const DEV_TECHNICAL_CATEGORIES = ['technical'];

async function nextRef(db: DB): Promise<string> {
  const row = await db.get('SELECT COUNT(*) AS c FROM support_tickets') as { c: number };
  return `SUP-${String(row.c + 1).padStart(4, '0')}`;
}

function canAccessTicket(role: Role, category: string): boolean {
  if (!canFunction(role, 'support_tickets')) return false;
  // The Developer function is restricted to technical tickets (§11.4).
  if (functionScope(role, 'support_tickets') === 'technical_only') {
    return DEV_TECHNICAL_CATEGORIES.includes(category);
  }
  return true;
}

export function supportRoutes(db: DB): Router {
  const router = Router();

  /** Public creation: no account required, rate limited, sanitised (§12.3). */
  router.post('/tickets', async (req, res) => {
    const ip = req.ipTrunc ?? 'unknown';
    if (!rateLimit(`ticket:${ip}`, 5, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'rate_limited', message: 'Trop de demandes. Réessayez plus tard.' });
    }
    const body = req.body ?? {};
    const subject = stripTags(String(body.subject ?? '')).trim().slice(0, 140);
    const message = stripTags(String(body.message ?? '')).trim().slice(0, 5000);
    const email = String(body.email ?? '').trim();
    const category = CATEGORIES.includes(String(body.category)) ? String(body.category) : 'other';

    if (subject.length < 5) return res.status(400).json({ error: 'invalid_subject', message: 'L’objet doit contenir au moins 5 caractères.' });
    if (message.length < 20) return res.status(400).json({ error: 'invalid_message', message: 'Le message doit contenir au moins 20 caractères.' });
    if (!email && !req.user) return res.status(400).json({ error: 'email_required', message: 'Une adresse électronique est requise.' });
    if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: 'invalid_email', message: 'Adresse électronique invalide.' });

    const ref = await nextRef(db);
    const id = newId('tkt');
    const now = Date.now();
    await db.run('INSERT INTO support_tickets (id,ref,user_id,email,subject,category,status,priority,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [id, ref, req.user?.id ?? null, email || req.user?.email || '', subject, category, 'open', category === 'security' ? 'high' : 'normal', now, now]);
    await db.run('INSERT INTO ticket_messages (id,ticket_id,author_id,author_label,body,internal,created_at) VALUES (?,?,?,?,?,0,?)', [newId('msg'), id, req.user?.id ?? null, req.user?.username ?? 'anonyme', message, now]);

    await appendAudit(db, {
      actorId: req.user?.id ?? null, actorRole: req.user?.role ?? null, action: 'support.ticket_created',
      targetType: 'ticket', targetId: ref, ipTrunc: req.ipTrunc, meta: { category },
    });
    const recipient = email || req.user?.email || '';
    await sendTicketReceived(recipient, ref, subject).catch(() => undefined);
    await notifySupport(ref, subject, category, message);

    res.status(201).json({
      ok: true,
      ref,
      message: 'Demande enregistrée. Conservez la référence pour suivre son traitement.',
      responseTimes: { security: '24 h', other: '72 h' },
    });
  });

  router.get('/tickets', requireAuth, async (req, res) => {
    const rows = await db.all('SELECT * FROM support_tickets WHERE user_id = ? ORDER BY created_at DESC', [req.user!.id]) as Record<string, any>[];
    res.json({ tickets: rows.map((r) => ({ ref: r.ref, subject: r.subject, category: r.category, status: r.status, priority: r.priority, createdAt: r.created_at, updatedAt: r.updated_at })) });
  });

  router.get('/tickets/:ref', requireAuth, async (req, res) => {
    const row = await db.get('SELECT * FROM support_tickets WHERE ref = ?', [String(req.params.ref)]) as Record<string, any> | undefined;
    if (!row) return res.status(404).json({ error: 'not_found' });
    const isOwner = row.user_id === req.user!.id;
    const isStaff = canAccessTicket(req.user!.role as Role, row.category);
    if (!isOwner && !isStaff) return res.status(404).json({ error: 'not_found' });
    const messages = await db.all('SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC', [row.id]) as Record<string, any>[];
    res.json({
      ticket: { ref: row.ref, subject: row.subject, category: row.category, status: row.status, priority: row.priority, createdAt: row.created_at, updatedAt: row.updated_at, assignedTo: row.assigned_to },
      messages: messages
        .filter((m) => isStaff || !m.internal)
        .map((m) => ({ id: m.id, author: m.author_label, body: m.body, internal: !!m.internal, createdAt: m.created_at })),
      viewer: { isStaff, isOwner },
    });
  });

  router.post('/tickets/:ref/messages', requireAuth, async (req, res) => {
    const row = await db.get('SELECT * FROM support_tickets WHERE ref = ?', [String(req.params.ref)]) as Record<string, any> | undefined;
    if (!row) return res.status(404).json({ error: 'not_found' });
    const isOwner = row.user_id === req.user!.id;
    const isStaff = canAccessTicket(req.user!.role as Role, row.category);
    if (!isOwner && !isStaff) return res.status(404).json({ error: 'not_found' });
    const body = stripTags(String(req.body?.body ?? '')).trim().slice(0, 5000);
    if (body.length < 2) return res.status(400).json({ error: 'invalid_message' });
    const internal = isStaff && !!req.body?.internal;
    await db.run('INSERT INTO ticket_messages (id,ticket_id,author_id,author_label,body,internal,created_at) VALUES (?,?,?,?,?,?,?)', [newId('msg'), row.id, req.user!.id, req.user!.username, body, internal ? 1 : 0, Date.now()]);
    if (!internal) {
      await db.run("UPDATE support_tickets SET updated_at = ?, status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END WHERE id = ?", [Date.now(), row.id]);
    }
    await appendAudit(db, {
      actorId: req.user!.id, actorRole: req.user!.role, action: 'support.message', targetType: 'ticket',
      targetId: row.ref, ipTrunc: req.ipTrunc, meta: { internal },
    });
    res.json({ ok: true });
  });

  /* ------------------------------ staff ------------------------------ */
  router.get('/queue', requireStaff, requireFunction('support_tickets'), async (req, res) => {
    const rows = await db.all("SELECT * FROM support_tickets WHERE status <> 'closed' ORDER BY priority DESC, created_at ASC") as Record<string, any>[];
    const role = req.user!.role as Role;
    res.json({
      scope: functionScope(role, 'support_tickets') ?? 'all',
      tickets: rows
        .filter((r) => canAccessTicket(role, r.category))
        .map((r) => ({ ref: r.ref, subject: r.subject, category: r.category, status: r.status, priority: r.priority, email: r.email, assignedTo: r.assigned_to, createdAt: r.created_at })),
    });
  });

  router.post('/tickets/:ref/status', requireStaff, requireFunction('support_tickets'), async (req, res) => {
    const row = await db.get('SELECT * FROM support_tickets WHERE ref = ?', [String(req.params.ref)]) as Record<string, any> | undefined;
    if (!row) return res.status(404).json({ error: 'not_found' });
    if (!canAccessTicket(req.user!.role as Role, row.category)) {
      return res.status(403).json({ error: 'scope_forbidden', message: 'Accès limité aux tickets techniques pour ce rôle.' });
    }
    const status = ['open', 'in_progress', 'waiting', 'closed'].includes(String(req.body?.status)) ? String(req.body.status) : null;
    if (!status) return res.status(400).json({ error: 'invalid_status' });
    await db.run('UPDATE support_tickets SET status = ?, updated_at = ? WHERE id = ?', [status, Date.now(), row.id]);
    await appendAudit(db, {
      actorId: req.user!.id, actorRole: req.user!.role, action: 'support.status', targetType: 'ticket',
      targetId: row.ref, ipTrunc: req.ipTrunc, meta: { status },
    });
    res.json({ ok: true, status });
  });

  router.post('/tickets/:ref/assign', requireStaff, requireFunction('support_tickets'), async (req, res) => {
    const row = await db.get('SELECT * FROM support_tickets WHERE ref = ?', [String(req.params.ref)]) as Record<string, any> | undefined;
    if (!row) return res.status(404).json({ error: 'not_found' });
    await db.run('UPDATE support_tickets SET assigned_to = ?, updated_at = ? WHERE id = ?', [req.user!.id, Date.now(), row.id]);
    await appendAudit(db, {
      actorId: req.user!.id, actorRole: req.user!.role, action: 'support.assigned', targetType: 'ticket',
      targetId: row.ref, ipTrunc: req.ipTrunc,
    });
    res.json({ ok: true });
  });

  return router;
}
