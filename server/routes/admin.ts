import { Router } from 'express';
import type { DB } from '../db.js';
import { requireStaff, requireFunction, requireReauth } from '../middleware/auth.js';
import {
  FUNCTION_MATRIX, ROLE_LABELS, STATUS_FLOW, STATUS_LABELS, CONTENT_MATRIX,
  actionsFor, canContent, canFunction, checkTransition, RESTORE_WINDOW_MS,
} from '../lib/rbac.js';
import { appendAudit, verifyAuditChain } from '../lib/audit.js';
import { newId } from '../lib/ids.js';
import { sanitizeBlocks, stripTags } from '../lib/sanitize.js';
import { createBackup, listBackups, verifyBackup } from '../lib/backup.js';
import { ensureSigningKey, publicSigningKeys } from '../lib/licenses.js';
import { revokeAllForUser } from '../lib/sessions.js';
import { rateLimit } from '../lib/throttle.js';
import { ADMIN_PATH } from '../config.js';
import type { ContentStatus, ContentType, Role } from '../db.js';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TYPES: ContentType[] = ['wiki', 'news', 'roadmap', 'map', 'faq', 'buyer_extras', 'legal'];
const STATUSES: ContentStatus[] = ['draft', 'review', 'scheduled', 'published', 'archived', 'deleted'];
const LOCALES = ['fr', 'en', 'es', 'de', 'it'];

function contentWithTranslations(db: DB, id: string) {
  const row = db.prepare('SELECT * FROM content WHERE id = ?').get(id) as Record<string, any> | undefined;
  if (!row) return null;
  const translations = db.prepare('SELECT locale,title,summary,body FROM content_translations WHERE content_id = ?').all(id) as {
    locale: string; title: string; summary: string; body: string;
  }[];
  const author = row.author_id
    ? (db.prepare('SELECT username FROM users WHERE id = ?').get(row.author_id) as { username: string } | undefined)?.username ?? null
    : null;
  const verifier = row.verifier_id
    ? (db.prepare('SELECT username FROM users WHERE id = ?').get(row.verifier_id) as { username: string } | undefined)?.username ?? null
    : null;
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    slug: row.slug,
    category: row.category,
    authorId: row.author_id,
    authorName: author,
    verifierId: row.verifier_id,
    verifierName: verifier,
    publishedAt: row.published_at,
    scheduledAt: row.scheduled_at,
    archivedAt: row.archived_at,
    deletedAt: row.deleted_at,
    spoiler: !!row.spoiler,
    acsLevel: row.acs_level,
    clearance: row.clearance,
    seoTitle: row.seo_title,
    seoDesc: row.seo_desc,
    featured: !!row.featured,
    order: row.order_index,
    editorNote: row.editor_note,
    blocks: JSON.parse(row.blocks_json || '[]'),
    translations,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    translationsMissing: LOCALES.filter((l) => !translations.some((t) => t.locale === l && (t.title || t.body))),
    canRestore: row.status === 'deleted' && !!row.deleted_at && Date.now() - row.deleted_at <= RESTORE_WINDOW_MS,
  };
}

function snapshot(db: DB, contentId: string, actorId: string, note: string) {
  const data = contentWithTranslations(db, contentId);
  if (!data) return;
  db.prepare('INSERT INTO content_revisions (id,content_id,at,actor_id,snapshot_json,note) VALUES (?,?,?,?,?,?)')
    .run(newId('rev'), contentId, Date.now(), actorId, JSON.stringify(data), note.slice(0, 200));
}

function validTranslations(raw: unknown): { locale: string; title: string; summary: string; body: string }[] {
  if (!raw || typeof raw !== 'object') return [];
  const out: { locale: string; title: string; summary: string; body: string }[] = [];
  for (const [locale, value] of Object.entries(raw as Record<string, any>)) {
    if (!LOCALES.includes(locale) || !value || typeof value !== 'object') continue;
    out.push({
      locale,
      title: stripTags(String(value.title ?? '')).slice(0, 200),
      summary: stripTags(String(value.summary ?? '')).slice(0, 500),
      body: String(value.body ?? '').slice(0, 60000),
    });
  }
  return out;
}

export function adminRoutes(db: DB): Router {
  const router = Router();
  router.use(requireStaff);

  /* ---------------------------------------------------------------- *
   * Session context + matrices (§11.3, §11.4)
   * ---------------------------------------------------------------- */
  router.get('/session', (req, res) => {
    const role = req.user!.role as Role;
    res.json({
      path: ADMIN_PATH,
      user: { id: req.user!.id, username: req.user!.username, role, roleLabel: ROLE_LABELS[role], mirageId: req.user!.mirage_id },
      permissions: {
        content: Object.fromEntries(TYPES.map((t) => [t, actionsFor(role, t)])),
        functions: Object.fromEntries(FUNCTION_MATRIX.map((f) => [f.key, canFunction(role, f.key)])),
      },
      matrices: {
        content: CONTENT_MATRIX,
        functions: FUNCTION_MATRIX,
        roles: ROLE_LABELS,
        statuses: STATUS_LABELS,
        flow: STATUS_FLOW,
      },
      security: {
        mfaVerified: !!req.session?.mfa_verified,
        reauthFresh: Date.now() - (req.user!.reauth_at ?? 0) < 5 * 60 * 1000,
        sessionMinutes: 15,
        absoluteHours: 8,
      },
    });
  });

  /* ---------------------------------------------------------------- *
   * Dashboard
   * ---------------------------------------------------------------- */
  router.get('/dashboard', (req, res) => {
    const byStatus = db.prepare('SELECT status, COUNT(*) AS c FROM content GROUP BY status').all() as { status: string; c: number }[];
    const byType = db.prepare('SELECT type, COUNT(*) AS c FROM content GROUP BY type').all() as { type: string; c: number }[];
    const pendingServers = db.prepare("SELECT COUNT(*) AS c FROM servers WHERE status = 'pending' AND deleted_at IS NULL").get() as { c: number };
    const openTickets = db.prepare("SELECT COUNT(*) AS c FROM support_tickets WHERE status IN ('open','in_progress')").get() as { c: number };
    const staff = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role <> 'player'").get() as { c: number };
    const players = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'player'").get() as { c: number };
    const mk = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role <> 'player' AND totp_secret IS NULL AND webauthn_required = 0").get() as { c: number };
    const lastAudit = db.prepare('SELECT at, actor_id, action, target_type, target_id FROM audit_log ORDER BY id DESC LIMIT 12').all();
    const chain = verifyAuditChain(db);
    res.json({
      counts: {
        content: byStatus.reduce((a, r) => a + r.c, 0),
        byStatus: Object.fromEntries(STATUSES.map((s) => [s, byStatus.find((r) => r.status === s)?.c ?? 0])),
        byType: Object.fromEntries(TYPES.map((t) => [t, byType.find((r) => r.type === t)?.c ?? 0])),
        pendingServers: pendingServers.c,
        openTickets: openTickets.c,
        staff: staff.c,
        players: players.c,
        staffWithoutMfa: mk.c,
      },
      queue: {
        review: db.prepare("SELECT id, type, slug, updated_at FROM content WHERE status = 'review' ORDER BY updated_at ASC LIMIT 10").all(),
        scheduled: db.prepare("SELECT id, type, slug, scheduled_at FROM content WHERE status = 'scheduled' ORDER BY scheduled_at ASC LIMIT 10").all(),
      },
      audit: { chainOk: chain.ok, checked: chain.checked, recent: lastAudit },
    });
  });

  /* ---------------------------------------------------------------- *
   * Content CRUD + workflow (§11.1, §11.2)
   * ---------------------------------------------------------------- */
  router.get('/content', (req, res) => {
    const type = req.query.type ? String(req.query.type) : null;
    const status = req.query.status ? String(req.query.status) : null;
    const rows = db.prepare(
      `SELECT id FROM content WHERE (? IS NULL OR type = ?) AND (? IS NULL OR status = ?) ORDER BY updated_at DESC LIMIT 300`,
    ).all(type, type, status, status) as { id: string }[];
    res.json({
      items: rows.map((r) => contentWithTranslations(db, r.id)).filter(Boolean),
      canCreate: TYPES.filter((t) => canContent(req.user!.role as Role, t, 'C')),
    });
  });

  router.post('/content', (req, res) => {
    const role = req.user!.role as Role;
    const body = req.body ?? {};
    const type = String(body.type) as ContentType;
    if (!TYPES.includes(type)) return res.status(400).json({ error: 'invalid_type' });
    if (!canContent(role, type, 'C')) {
      return res.status(403).json({ error: 'forbidden', message: `Votre rôle ne permet pas de créer du contenu « ${type} ».` });
    }
    const slug = String(body.slug ?? '').trim().toLowerCase();
    if (!SLUG_RE.test(slug)) {
      return res.status(400).json({ error: 'invalid_slug', message: 'Identifiant attendu : minuscules, chiffres et tirets.' });
    }
    const conflict = db.prepare('SELECT 1 AS hit FROM content WHERE type = ? AND slug = ?').get(type, slug);
    if (conflict) return res.status(409).json({ error: 'slug_taken' });
    const translations = validTranslations(body.translations);
    if (!translations.some((t) => t.locale === 'fr' && t.title)) {
      return res.status(400).json({ error: 'french_title_required', message: 'Le titre français est obligatoire.' });
    }
    const blocks = sanitizeBlocks(body.blocks);
    const now = Date.now();
    const id = newId('cnt');
    db.prepare(`INSERT INTO content
      (id,type,status,slug,category,author_id,verifier_id,published_at,scheduled_at,archived_at,deleted_at,spoiler,acs_level,clearance,seo_title,seo_desc,featured,order_index,blocks_json,editor_note,created_at,updated_at)
      VALUES (?,?, 'draft', ?,?,?,NULL,NULL,NULL,NULL,NULL,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, type, slug, String(body.category ?? '').slice(0, 40), req.user!.id,
        body.spoiler ? 1 : 0, body.acsLevel ? String(body.acsLevel).slice(0, 20) : null,
        body.clearance ? String(body.clearance).slice(0, 8) : null,
        stripTags(String(body.seoTitle ?? '')).slice(0, 200), stripTags(String(body.seoDesc ?? '')).slice(0, 300),
        body.featured ? 1 : 0, Number(body.order ?? 0) || 0, JSON.stringify(blocks),
        stripTags(String(body.editorNote ?? '')).slice(0, 300), now, now);
    const insTr = db.prepare('INSERT INTO content_translations (content_id,locale,title,summary,body) VALUES (?,?,?,?,?)');
    for (const t of translations) insTr.run(id, t.locale, t.title, t.summary, t.body);

    snapshot(db, id, req.user!.id, 'created');
    appendAudit(db, {
      actorId: req.user!.id, actorRole: role, action: 'content.created', targetType: 'content',
      targetId: id, ipTrunc: req.ipTrunc, meta: { type, slug },
    });
    res.status(201).json({ ok: true, item: contentWithTranslations(db, id) });
  });

  router.get('/content/:id', (req, res) => {
    const item = contentWithTranslations(db, String(req.params.id));
    if (!item) return res.status(404).json({ error: 'not_found' });
    const revisions = db.prepare('SELECT id, at, actor_id, note FROM content_revisions WHERE content_id = ? ORDER BY at DESC LIMIT 30')
      .all(item.id);
    res.json({ item, revisions, permissions: actionsFor(req.user!.role as Role, item.type as ContentType) });
  });

  router.put('/content/:id', (req, res) => {
    const role = req.user!.role as Role;
    const item = contentWithTranslations(db, String(req.params.id));
    if (!item) return res.status(404).json({ error: 'not_found' });
    const type = item.type as ContentType;
    if (!canContent(role, type, 'C')) return res.status(403).json({ error: 'forbidden' });
    if (item.status === 'published' && !canContent(role, type, 'P')) {
      return res.status(403).json({ error: 'forbidden', message: 'Contenu publié : droit de publication requis pour le modifier.' });
    }
    if (item.status === 'deleted') {
      return res.status(409).json({ error: 'content_deleted', message: 'Restaurez le contenu avant de le modifier.' });
    }
    const body = req.body ?? {};
    const blocks = body.blocks !== undefined ? sanitizeBlocks(body.blocks) : item.blocks;
    const updates: Record<string, unknown> = {
      category: body.category !== undefined ? String(body.category).slice(0, 40) : item.category,
      spoiler: body.spoiler !== undefined ? (body.spoiler ? 1 : 0) : item.spoiler ? 1 : 0,
      acs_level: body.acsLevel !== undefined ? (body.acsLevel ? String(body.acsLevel).slice(0, 20) : null) : item.acsLevel,
      clearance: body.clearance !== undefined ? (body.clearance ? String(body.clearance).slice(0, 8) : null) : item.clearance,
      seo_title: body.seoTitle !== undefined ? stripTags(String(body.seoTitle)).slice(0, 200) : item.seoTitle,
      seo_desc: body.seoDesc !== undefined ? stripTags(String(body.seoDesc)).slice(0, 300) : item.seoDesc,
      featured: body.featured !== undefined ? (body.featured ? 1 : 0) : item.featured ? 1 : 0,
      order_index: body.order !== undefined ? Number(body.order) || 0 : item.order,
      blocks_json: JSON.stringify(blocks),
      editor_note: body.editorNote !== undefined ? stripTags(String(body.editorNote)).slice(0, 300) : item.editorNote,
      updated_at: Date.now(),
    };
    const fields = Object.keys(updates).map((k) => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE content SET ${fields} WHERE id = @id`).run({ ...updates, id: item.id });

    if (body.translations) {
      const translations = validTranslations(body.translations);
      const upsert = db.prepare('INSERT INTO content_translations (content_id,locale,title,summary,body) VALUES (?,?,?,?,?) ON CONFLICT(content_id,locale) DO UPDATE SET title = excluded.title, summary = excluded.summary, body = excluded.body');
      for (const t of translations) upsert.run(item.id, t.locale, t.title, t.summary, t.body);
    }
    snapshot(db, item.id, req.user!.id, 'updated');
    appendAudit(db, {
      actorId: req.user!.id, actorRole: role, action: 'content.updated', targetType: 'content',
      targetId: item.id, ipTrunc: req.ipTrunc, meta: { type, status: item.status },
    });
    res.json({ ok: true, item: contentWithTranslations(db, item.id) });
  });

  router.post('/content/:id/transition', (req, res) => {
    const role = req.user!.role as Role;
    const item = contentWithTranslations(db, String(req.params.id));
    if (!item) return res.status(404).json({ error: 'not_found' });
    const to = String(req.body?.to) as ContentStatus;
    if (!STATUSES.includes(to)) return res.status(400).json({ error: 'invalid_status' });
    const from = item.status as ContentStatus;
    const type = item.type as ContentType;
    const override = !!req.body?.override;
    const overrideReason = String(req.body?.overrideReason ?? '');

    const check = checkTransition({
      role,
      type,
      from,
      to,
      isAuthor: item.authorId === req.user!.id,
      isVerifier: item.verifierId === req.user!.id,
      override,
      overrideReason,
      deletedAt: item.deletedAt,
    });
    if (!check.allowed) return res.status(403).json({ error: 'transition_forbidden', message: check.reason });

    const now = Date.now();
    const updates: Record<string, unknown> = { status: to, updated_at: now };
    if (to === 'published') {
      updates.published_at = now;
      updates.scheduled_at = null;
      if (item.authorId !== req.user!.id || override) updates.verifier_id = req.user!.id;
    }
    if (to === 'scheduled') {
      const scheduledAt = Number(req.body?.scheduledAt ?? 0);
      if (!scheduledAt || scheduledAt < now) {
        return res.status(400).json({ error: 'invalid_schedule', message: 'Date de publication planifiée requise (futur).' });
      }
      if (item.authorId !== req.user!.id || override) updates.verifier_id = req.user!.id;
      updates.scheduled_at = scheduledAt;
    }
    if (to === 'archived') updates.archived_at = now;
    if (to === 'deleted') updates.deleted_at = now;
    if (from === 'deleted' && to === 'draft') updates.deleted_at = null;

    const fields = Object.keys(updates).map((k) => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE content SET ${fields} WHERE id = @id`).run({ ...updates, id: item.id });
    snapshot(db, item.id, req.user!.id, `transition ${from} → ${to}`);

    appendAudit(db, {
      actorId: req.user!.id, actorRole: role,
      action: check.requiresOverride ? 'content.transition_override' : 'content.transition',
      targetType: 'content', targetId: item.id, ipTrunc: req.ipTrunc,
      meta: { type, from, to, override: !!check.requiresOverride, reason: overrideReason || null },
    });

    if (to === 'review') {
      const candidates = db.prepare(
        "SELECT id FROM users WHERE role <> 'player' AND id <> ? ORDER BY role = 'admin' DESC LIMIT 5",
      ).all(req.user!.id) as { id: string }[];
      for (const candidate of candidates) {
        if (!canContent((db.prepare('SELECT role FROM users WHERE id = ?').get(candidate.id) as { role: Role }).role, type, 'V')) continue;
        db.prepare('INSERT INTO notifications (id,user_id,kind,body,created_at) VALUES (?,?,?,?,?)')
          .run(newId('ntf'), candidate.id, 'content_review', `Contenu à vérifier : ${type}/${item.slug}`, now);
      }
    }

    res.json({ ok: true, item: contentWithTranslations(db, item.id), override: !!check.requiresOverride });
  });

  router.post('/content/:id/translate', (req, res) => {
    const role = req.user!.role as Role;
    const item = contentWithTranslations(db, String(req.params.id));
    if (!item) return res.status(404).json({ error: 'not_found' });
    if (!canContent(role, item.type as ContentType, 'T')) {
      return res.status(403).json({ error: 'forbidden', message: 'Droit de traduction requis.' });
    }
    const locale = String(req.body?.locale ?? '');
    if (!LOCALES.includes(locale)) return res.status(400).json({ error: 'invalid_locale' });
    const title = stripTags(String(req.body?.title ?? '')).slice(0, 200);
    const summary = stripTags(String(req.body?.summary ?? '')).slice(0, 500);
    const body = String(req.body?.body ?? '').slice(0, 60000);
    if (!title) return res.status(400).json({ error: 'title_required' });
    db.prepare('INSERT INTO content_translations (content_id,locale,title,summary,body) VALUES (?,?,?,?,?) ON CONFLICT(content_id,locale) DO UPDATE SET title = excluded.title, summary = excluded.summary, body = excluded.body')
      .run(item.id, locale, title, summary, body);
    db.prepare('UPDATE content SET updated_at = ? WHERE id = ?').run(Date.now(), item.id);
    appendAudit(db, {
      actorId: req.user!.id, actorRole: role, action: 'content.translated', targetType: 'content',
      targetId: item.id, ipTrunc: req.ipTrunc, meta: { locale },
    });
    res.json({ ok: true, item: contentWithTranslations(db, item.id) });
  });

  router.get('/content/:id/revisions', (req, res) => {
    const rows = db.prepare('SELECT id, at, actor_id, note, snapshot_json FROM content_revisions WHERE content_id = ? ORDER BY at DESC')
      .all(String(req.params.id)) as { id: string; at: number; actor_id: string; note: string; snapshot_json: string }[];
    res.json({ revisions: rows.map((r) => ({ ...r, snapshot: JSON.parse(r.snapshot_json) })) });
  });

  /* ---------------------------------------------------------------- *
   * Users, roles, sanctions
   * ---------------------------------------------------------------- */
  router.get('/users', requireFunction('users_roles'), (req, res) => {
    const search = String(req.query.q ?? '').trim().toLowerCase();
    const rows = db.prepare(
      `SELECT id, mirage_id, username, email, role, status, profile_public, created_at,
        (SELECT COUNT(*) FROM webauthn_credentials w WHERE w.user_id = users.id) AS passkeys,
        totp_secret IS NOT NULL AS totp
       FROM users
       WHERE (? = '' OR lower(username) LIKE ? OR lower(email) LIKE ? OR mirage_id LIKE ?)
       ORDER BY role = 'player', username LIMIT 200`,
    ).all(search, `%${search}%`, `%${search}%`, `%${search}%`) as Record<string, any>[];
    res.json({
      users: rows.map((r) => ({
        id: r.id, mirageId: r.mirage_id, username: r.username, email: r.email, role: r.role,
        roleLabel: ROLE_LABELS[r.role as Role] ?? r.role, status: r.status, totp: !!r.totp,
        passkeys: r.passkeys, profilePublic: !!r.profile_public, createdAt: r.created_at,
      })),
      roles: ROLE_LABELS,
    });
  });

  router.patch('/users/:id', requireFunction('users_roles'), requireReauth, (req, res) => {
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(String(req.params.id)) as Record<string, any> | undefined;
    if (!target) return res.status(404).json({ error: 'not_found' });
    const role = String(req.body?.role ?? '') as Role;
    if (!(role in ROLE_LABELS)) return res.status(400).json({ error: 'invalid_role' });
    if (target.id === req.user!.id && role !== 'admin') {
      return res.status(409).json({ error: 'self_demotion', message: 'Vous ne pouvez pas retirer votre propre rôle administrateur.' });
    }
    if (ROLE_LABELS[role] === 'Joueur' && target.role !== 'player') {
      const admins = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get() as { c: number };
      if (target.role === 'admin' && admins.c <= 1) {
        return res.status(409).json({ error: 'last_admin', message: 'Le dernier administrateur ne peut pas être rétrogradé.' });
      }
    }
    db.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?').run(role, Date.now(), target.id);
    if (role !== 'player') {
      db.prepare('UPDATE users SET webauthn_required = ? WHERE id = ?').run(role === 'admin' ? 1 : 0, target.id);
      revokeAllForUser(db, target.id, null, 'role_changed');
    }
    appendAudit(db, {
      actorId: req.user!.id, actorRole: req.user!.role, action: 'user.role_changed', targetType: 'user',
      targetId: target.id, ipTrunc: req.ipTrunc, meta: { from: target.role, to: role, target: target.username },
    });
    res.json({ ok: true });
  });

  router.post('/users/:id/sanction', requireFunction('account_sanctions'), (req, res) => {
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(String(req.params.id)) as Record<string, any> | undefined;
    if (!target) return res.status(404).json({ error: 'not_found' });
    const kind = String(req.body?.kind ?? '');
    const reason = stripTags(String(req.body?.reason ?? '')).slice(0, 500);
    if (reason.length < 5) return res.status(400).json({ error: 'reason_required', message: 'Motif requis.' });
    const role = req.user!.role as Role;

    if (kind === 'warning') {
      db.prepare('INSERT INTO notifications (id,user_id,kind,body,created_at) VALUES (?,?,?,?,?)')
        .run(newId('ntf'), target.id, 'sanction', `Avertissement : ${reason}`, Date.now());
    } else if (kind === 'suspend' || kind === 'ban') {
      // The Community Manager may only issue warnings (§11.4).
      if (role === 'community_manager') {
        return res.status(403).json({ error: 'warning_only', message: 'Le Community Manager peut uniquement délivrer un avertissement.' });
      }
      if (role !== 'admin' && role !== 'moderator') return res.status(403).json({ error: 'forbidden' });
      if (target.role === 'admin') return res.status(403).json({ error: 'forbidden', message: 'Un administrateur ne peut pas être sanctionné ici.' });
      db.prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?')
        .run(kind === 'ban' ? 'banned' : 'suspended', Date.now(), target.id);
      revokeAllForUser(db, target.id, null, 'sanction');
    } else {
      return res.status(400).json({ error: 'invalid_kind' });
    }
    appendAudit(db, {
      actorId: req.user!.id, actorRole: role, action: `user.sanction_${kind}`, targetType: 'user',
      targetId: target.id, ipTrunc: req.ipTrunc, meta: { reason },
    });
    res.json({ ok: true });
  });

  /** Staff 2FA reset: admin only, reasoned, fully audited (§6.4). */
  router.post('/users/:id/mfa-reset', requireFunction('users_roles'), requireReauth, (req, res) => {
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(String(req.params.id)) as Record<string, any> | undefined;
    if (!target) return res.status(404).json({ error: 'not_found' });
    if (target.role === 'admin' && target.id !== req.user!.id) {
      const admins = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND id <> ?").get(target.id) as { c: number };
      if (admins.c < 1) return res.status(409).json({ error: 'last_admin', message: 'Un autre administrateur doit valider cette réinitialisation.' });
    }
    const reason = stripTags(String(req.body?.reason ?? '')).slice(0, 300);
    if (reason.length < 10) return res.status(400).json({ error: 'reason_required', message: 'Motif d’au moins 10 caractères requis.' });
    db.prepare('UPDATE users SET totp_secret = NULL, totp_last_step = NULL WHERE id = ?').run(target.id);
    db.prepare('DELETE FROM backup_codes WHERE user_id = ?').run(target.id);
    revokeAllForUser(db, target.id, null, 'mfa_reset_by_admin');
    appendAudit(db, {
      actorId: req.user!.id, actorRole: req.user!.role, action: 'mfa.admin_reset', targetType: 'user',
      targetId: target.id, ipTrunc: req.ipTrunc, meta: { reason, target: target.username },
    });
    res.json({
      ok: true,
      message: 'Double authentification réinitialisée. Le membre du personnel doit réenrôler un facteur à sa prochaine connexion.',
    });
  });

  /* ---------------------------------------------------------------- *
   * Audit log (§6.12)
   * ---------------------------------------------------------------- */
  router.get('/audit', requireFunction('audit_log'), (req, res) => {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 100)));
    const action = req.query.action ? String(req.query.action) : null;
    const rows = db.prepare(
      `SELECT * FROM audit_log WHERE (? IS NULL OR action LIKE ?) ORDER BY id DESC LIMIT ?`,
    ).all(action, action ? `%${action}%` : null, limit) as Record<string, any>[];
    res.json({
      entries: rows.map((r) => ({
        id: r.id, at: r.at, actorId: r.actor_id, actorRole: r.actor_role, action: r.action,
        targetType: r.target_type, targetId: r.target_id, ip: r.ip_trunc,
        meta: JSON.parse(r.meta_json || '{}'), hash: r.hash, prevHash: r.prev_hash,
      })),
      chain: verifyAuditChain(db),
      retention: { months: 12, ipTruncatedAfterDays: 30 },
    });
  });

  router.post('/audit/verify', requireFunction('audit_log'), (_req, res) => {
    res.json(verifyAuditChain(db));
  });

  /* ---------------------------------------------------------------- *
   * Servers moderation queue is served by /api/servers/queue
   * ---------------------------------------------------------------- */
  router.get('/servers', requireFunction('server_validation'), (_req, res) => {
    const rows = db.prepare('SELECT * FROM servers WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 200').all() as Record<string, any>[];
    res.json({
      servers: rows.map((r) => ({
        id: r.id, name: r.name, address: `${r.host}:${r.port}`, status: r.status,
        maintenance: !!r.maintenance, ownerId: r.owner_id, validatedBy: r.validated_by,
        validatedAt: r.validated_at, createdAt: r.created_at,
      })),
    });
  });

  /* ---------------------------------------------------------------- *
   * API keys / signing keys (§5.4)
   * ---------------------------------------------------------------- */
  router.get('/api-keys', requireFunction('api_keys'), (_req, res) => {
    ensureSigningKey(db);
    res.json({
      keys: publicSigningKeys(db),
      endpoints: [
        'POST /api/v1/licenses/verify',
        'POST /api/v1/session-tickets',
        'POST /api/v1/session-tickets/redeem',
        'POST /api/v1/stats/sync',
        'POST /api/v1/servers/heartbeat',
        'GET  /api/v1/leaderboards',
      ],
    });
  });

  router.post('/api-keys/rotate', requireFunction('api_keys'), requireReauth, (req, res) => {
    const reason = stripTags(String(req.body?.reason ?? '')).slice(0, 300);
    if (reason.length < 10) return res.status(400).json({ error: 'reason_required' });
    db.prepare('UPDATE api_keys SET revoked_at = ? WHERE revoked_at IS NULL').run(Date.now());
    const key = ensureSigningKey(db);
    appendAudit(db, {
      actorId: req.user!.id, actorRole: req.user!.role, action: 'api_keys.rotated',
      targetType: 'api_key', targetId: key.kid, ipTrunc: req.ipTrunc, meta: { reason },
    });
    res.json({ ok: true, kid: key.kid });
  });

  /* ---------------------------------------------------------------- *
   * Backups (§6.11) — run + verify
   * ---------------------------------------------------------------- */
  router.get('/backups', requireFunction('backups_logs'), (_req, res) => {
    res.json({
      runs: db.prepare('SELECT * FROM backup_runs ORDER BY at DESC LIMIT 40').all(),
      files: listBackups().map((b) => ({ file: b.file, sizeBytes: b.sizeBytes, createdAt: b.createdAt })),
      encryption: 'AES-256-GCM',
      restoreVerificationRequired: true,
    });
  });

  router.post('/backups/run', requireFunction('backups_logs'), (req, res) => {
    if (!rateLimit(`backup:${req.user!.id}`, 5, 10 * 60 * 1000)) return res.status(429).json({ error: 'rate_limited' });
    try {
      const result = createBackup(db, undefined, 'manual');
      const verification = verifyBackup(result.file);
      db.prepare('UPDATE backup_runs SET status = ?, verified_at = ? WHERE id = ?')
        .run(verification.ok ? 'verified' : 'verification_failed', verification.ok ? Date.now() : null, result.id);
      appendAudit(db, {
        actorId: req.user!.id, actorRole: req.user!.role, action: 'backup.created', targetType: 'backup',
        targetId: result.id, ipTrunc: req.ipTrunc, meta: { verified: verification.ok, sizeBytes: result.sizeBytes },
      });
      res.json({
        ok: verification.ok,
        backup: { id: result.id, file: result.file.split('/').pop(), sizeBytes: result.sizeBytes, sha256: result.sha256 },
        verification,
      });
    } catch (error) {
      res.status(500).json({ error: 'backup_failed', message: String((error as Error).message) });
    }
  });

  router.post('/backups/verify', requireFunction('backups_logs'), (req, res) => {
    const files = listBackups();
    const target = String(req.body?.file ?? '');
    const file = target ? files.find((f) => f.file === target)?.path : files[0]?.path;
    if (!file) return res.status(404).json({ error: 'no_backup' });
    const verification = verifyBackup(file);
    appendAudit(db, {
      actorId: req.user!.id, actorRole: req.user!.role, action: 'backup.verified', targetType: 'backup',
      targetId: file.split('/').pop(), ipTrunc: req.ipTrunc, meta: { ok: verification.ok },
    });
    res.json(verification);
  });

  /* ---------------------------------------------------------------- *
   * Scores / leaderboard moderation
   * ---------------------------------------------------------------- */
  router.get('/scores', requireFunction('score_removal'), (_req, res) => {
    const rows = db.prepare(
      `SELECT s.*, u.username FROM stat_entries s LEFT JOIN users u ON u.id = s.user_id ORDER BY s.updated_at DESC LIMIT 300`,
    ).all() as Record<string, any>[];
    res.json({
      scores: rows.map((r) => ({
        id: r.id, player: r.username ?? r.display_name, mode: r.mode, operation: r.operation_code,
        ending: r.ending_code, bestTimeMs: r.best_time_ms, deaths: r.deaths, score: r.score,
        hidden: !!r.hidden, verifiedAt: r.verified_at, updatedAt: r.updated_at,
      })),
    });
  });

  router.post('/scores/:id/remove', requireFunction('score_removal'), (req, res) => {
    const row = db.prepare('SELECT * FROM stat_entries WHERE id = ?').get(String(req.params.id)) as Record<string, any> | undefined;
    if (!row) return res.status(404).json({ error: 'not_found' });
    const reason = stripTags(String(req.body?.reason ?? '')).slice(0, 300);
    if (reason.length < 5) return res.status(400).json({ error: 'reason_required' });
    db.prepare('UPDATE stat_entries SET hidden = 1, updated_at = ? WHERE id = ?').run(Date.now(), row.id);
    appendAudit(db, {
      actorId: req.user!.id, actorRole: req.user!.role, action: 'score.removed', targetType: 'stat_entry',
      targetId: row.id, ipTrunc: req.ipTrunc, meta: { reason, operation: row.operation_code, player: row.user_id },
    });
    res.json({ ok: true });
  });

  /* ---------------------------------------------------------------- *
   * i18n progress (translator)
   * ---------------------------------------------------------------- */
  router.get('/i18n', (_req, res) => {
    const progress = JSON.parse((db.prepare("SELECT value FROM settings WHERE key = 'i18n.progress'").get() as { value: string } | undefined)?.value ?? '{}');
    const counts = db.prepare('SELECT locale, COUNT(*) AS c FROM content_translations WHERE title <> \'\' GROUP BY locale').all() as { locale: string; c: number }[];
    res.json({ progress, counts, locales: LOCALES, threshold: 0.85 });
  });

  router.post('/i18n', (req, res) => {
    const role = req.user!.role as Role;
    if (role !== 'translator' && role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    const locale = String(req.body?.locale ?? '');
    const value = Number(req.body?.progress);
    if (!LOCALES.includes(locale) || !(value >= 0 && value <= 1)) return res.status(400).json({ error: 'invalid_payload' });
    const current = JSON.parse((db.prepare("SELECT value FROM settings WHERE key = 'i18n.progress'").get() as { value: string } | undefined)?.value ?? '{}');
    current[locale] = value;
    db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('i18n.progress', ?)").run(JSON.stringify(current));
    appendAudit(db, {
      actorId: req.user!.id, actorRole: role, action: 'i18n.progress_updated', targetType: 'setting',
      targetId: locale, ipTrunc: req.ipTrunc, meta: { value },
    });
    res.json({ ok: true, progress: current });
  });

  /* ---------------------------------------------------------------- *
   * Security posture / acceptance criteria (§6.14)
   * ---------------------------------------------------------------- */
  router.get('/criteria', (_req, res) => {
    const staffWithoutMfa = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role <> 'player' AND totp_secret IS NULL").get() as { c: number };
    const adminWithoutPasskey = db.prepare(
      `SELECT COUNT(*) AS c FROM users u WHERE u.role = 'admin'
       AND (SELECT COUNT(*) FROM webauthn_credentials w WHERE w.user_id = u.id) = 0`,
    ).get() as { c: number };
    const plainPasswords = db.prepare("SELECT COUNT(*) AS c FROM users WHERE password_hash IS NOT NULL AND password_hash NOT LIKE '$argon2id$%'").get() as { c: number };
    const chain = verifyAuditChain(db);
    const latestBackup = db.prepare("SELECT * FROM backup_runs WHERE status = 'verified' ORDER BY at DESC LIMIT 1").get() as Record<string, any> | undefined;

    res.json({
      generatedAt: Date.now(),
      criteria: [
        { id: 1, title: 'Mots de passe Argon2id, 12 caractères (14 pour le personnel), vérification k-anonymity', status: plainPasswords.c === 0 ? 'pass' : 'fail', detail: `${plainPasswords.c} empreinte(s) non Argon2id`, evidence: 'server/lib/password.ts' },
        { id: 2, title: '2FA obligatoire pour le personnel, passkey requise pour les administrateurs', status: staffWithoutMfa.c === 0 ? 'pass' : 'warn', detail: `${staffWithoutMfa.c} membre(s) du personnel sans facteur ; ${adminWithoutPasskey.c} administrateur(s) sans passkey`, evidence: 'server/routes/auth.ts' },
        { id: 3, title: 'Aucune liaison automatique de compte social par adresse électronique', status: 'pass', detail: 'La liaison exige une session authentifiée et une réauthentification < 5 min', evidence: 'GET /api/auth/oauth/:provider/callback' },
        { id: 4, title: 'Jeton de réinitialisation 256 bits, usage unique, 30 minutes, sans contournement du 2FA', status: 'pass', detail: 'Les jetons antérieurs sont invalidés ; toutes les sessions sont révoquées', evidence: 'POST /api/auth/password/reset' },
        { id: 5, title: 'Réponses et temps identiques contre l’énumération (connexion et réinitialisation)', status: 'pass', detail: 'Message générique unique, vérification factice Argon2, délai constant', evidence: 'server/routes/auth.ts' },
        { id: 6, title: 'Révocation des autres sessions après changement de mot de passe ou de 2FA', status: 'pass', detail: 'revokeAllForUser() sur les deux flux', evidence: 'server/lib/sessions.ts' },
        { id: 7, title: 'Contrôles d’accès stricts côté serveur', status: 'pass', detail: 'RBAC 8 rôles, 10 fonctions, matrices §11.3/§11.4 appliquées à chaque route', evidence: 'server/lib/rbac.ts' },
        { id: 8, title: 'Délai progressif après 5 échecs, jamais de verrouillage définitif', status: 'pass', detail: 'Backoff exponentiel plafonné, fenêtre glissante de 15 min', evidence: 'server/lib/throttle.ts' },
        { id: 9, title: 'Tickets de session de serveur à usage unique, courte durée, liés au serveur', status: 'pass', detail: 'TTL 60 s, consommation atomique, vérification du serveur cible', evidence: 'server/lib/licenses.ts' },
        { id: 10, title: 'Sauvegarde chiffrée et restauration vérifiée', status: latestBackup ? 'pass' : 'warn', detail: latestBackup ? `Dernière sauvegarde vérifiée le ${new Date(latestBackup.verified_at ?? latestBackup.at).toISOString()}` : 'Aucune sauvegarde vérifiée pour l’instant', evidence: 'npm run backup:verify' },
        { id: 11, title: 'Journal d’audit append-only avec chaîne de hachage', status: chain.ok ? 'pass' : 'fail', detail: `${chain.checked} entrée(s) vérifiée(s)`, evidence: 'server/lib/audit.ts' },
      ],
    });
  });

  router.get('/store', requireFunction('store_pages'), (_req, res) => {
    res.json({
      editions: [
        { id: 'standard', price: 25, priceLabel: '25,00 € TTC', defined: true },
        { id: 'supporter', price: null, priceLabel: '[prix et contenu à définir]', defined: false },
        { id: 'deluxe', price: null, priceLabel: '[prix et contenu à définir]', defined: false },
      ],
      platforms: [
        { id: 'steam', available: true, note: 'Boutons d’achat et de liste de souhaits' },
        { id: 'epic', available: false, note: 'Masqué jusqu’à la mise en ligne de la page Epic' },
      ],
      buyerExtras: db.prepare("SELECT slug, updated_at FROM content WHERE type = 'buyer_extras'").all(),
      paymentDisabled: true,
      launcherDisabled: true,
    });
  });

  return router;
}
