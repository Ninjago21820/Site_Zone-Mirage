import { Router } from 'express';
import type { DB } from '../db.js';
import {
  ADMIN_PATH, DEMO_MODE, I18N_ACTIVE, I18N_MASKED, I18N_THRESHOLD, CROWDIN_URL,
  TURNSTILE_SITE_KEY, IS_PROD,
} from '../config.js';
import {
  categoriesFor, clearanceRank, findBySlug, isPubliclyVisible, listPublished, serialize,
  WIKI_LICENSE, type ContentRow,
} from '../lib/content.js';
import { normaliseSearch } from '../lib/sanitize.js';
import { DEMO_TOTP_SECRET } from '../db.js';
import { rateLimit } from '../lib/throttle.js';
import { sha256 } from '../lib/ids.js';
import { clientIp } from '../middleware/security.js';
import { statsFor } from '../lib/users.js';
import type { PublicUser } from '../types.js';

const LOCALES = ['fr', 'en', 'es', 'de', 'it'];
const STORE_STANDARD_PRICE = 25;

export function publicRoutes(db: DB): Router {
  const router = Router();

  /* ---------------------------------------------------------------- *
   * Bootstrap: everything the shell needs in one round-trip
   * ---------------------------------------------------------------- */
  router.get('/site', (req, res) => {
    const locale = LOCALES.includes(String(req.query.locale)) ? String(req.query.locale) : 'fr';
    const progress = JSON.parse((db.prepare("SELECT value FROM settings WHERE key = 'i18n.progress'").get() as { value: string } | undefined)?.value ?? '{}');
    const news = listPublished(db, 'news', locale, { limit: 3 });
    res.json({
      site: {
        name: 'SCP: Mirage Protocol',
        version: (db.prepare("SELECT value FROM settings WHERE key = 'site.version'").get() as { value: string } | undefined)?.value ?? '1.3',
        releaseDate: 'undisclosed',
        releaseLabel: 'Date de sortie non annoncée',
        tagline: 'Jeu PC en développement — univers SCP. Modes Histoire et Multijoueur sur la même carte : la Zone Mirage.',
      },
      locale,
      i18n: {
        active: I18N_ACTIVE,
        masked: I18N_MASKED.filter((l) => (progress[l] ?? 0) < I18N_THRESHOLD),
        available: I18N_ACTIVE,
        threshold: I18N_THRESHOLD,
        progress,
        crowdin: CROWDIN_URL,
      },
      demoMode: DEMO_MODE,
      turnstileSiteKey: TURNSTILE_SITE_KEY || null,
      nav: [
        { key: 'home', to: '/' },
        { key: 'news', to: '/news' },
        { key: 'roadmap', to: '/roadmap' },
        { key: 'map', to: '/map' },
        { key: 'wiki', to: '/wiki' },
        { key: 'store', to: '/store' },
        { key: 'servers', to: '/servers' },
        { key: 'leaderboards', to: '/leaderboards' },
        { key: 'faq', to: '/faq' },
        { key: 'support', to: '/support' },
      ],
      latestNews: news,
      backOfficePath: ADMIN_PATH,
    });
  });

  router.get('/i18n', (_req, res) => {
    const progress = JSON.parse((db.prepare("SELECT value FROM settings WHERE key = 'i18n.progress'").get() as { value: string } | undefined)?.value ?? '{}');
    res.json({
      active: I18N_ACTIVE,
      masked: I18N_MASKED,
      progress,
      threshold: I18N_THRESHOLD,
      crowdin: CROWDIN_URL,
    });
  });

  /* ---------------------------------------------------------------- *
   * Generic content endpoints (§4, §10)
   * ---------------------------------------------------------------- */
  router.get('/content/:type', (req, res) => {
    const type = String(req.params.type);
    const allowed = ['news', 'roadmap', 'wiki', 'faq', 'legal', 'map', 'buyer_extras'];
    if (!allowed.includes(type)) return res.status(404).json({ error: 'not_found' });
    const locale = LOCALES.includes(String(req.query.locale)) ? String(req.query.locale) : 'fr';
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 100) || 100));
    const category = req.query.category ? String(req.query.category) : undefined;
    const search = req.query.q ? normaliseSearch(String(req.query.q)) : undefined;
    const items = listPublished(db, type, locale, { category, limit, search });
    res.json({ type, locale, items, categories: categoriesFor(db, type) });
  });

  router.get('/content/:type/:slug', (req, res) => {
    const row = findBySlug(db, String(req.params.type), String(req.params.slug));
    if (!row || !isPubliclyVisible(row)) return res.status(404).json({ error: 'not_found' });
    const locale = LOCALES.includes(String(req.query.locale)) ? String(req.query.locale) : 'fr';
    const item = serialize(db, row, locale);
    res.json({
      item,
      license: row.type === 'wiki' ? WIKI_LICENSE : null,
      related: row.type === 'wiki'
        ? listPublished(db, 'wiki', locale, { limit: 4 }).filter((x) => x.slug !== row.slug).slice(0, 3)
        : [],
    });
  });

  /** Wiki full-text search across titles, summaries and bodies. */
  router.get('/wiki/search', (req, res) => {
    const q = normaliseSearch(String(req.query.q ?? ''));
    const locale = LOCALES.includes(String(req.query.locale)) ? String(req.query.locale) : 'fr';
    if (q.length < 2) return res.json({ query: q, results: [] });
    const rows = db.prepare("SELECT * FROM content WHERE type = 'wiki' AND status = 'published'").all() as ContentRow[];
    const results = rows
      .map((row) => {
        const item = serialize(db, row, locale);
        const haystack = normaliseSearch(`${item.title} ${item.summary} ${item.body}`);
        if (!haystack.includes(q)) return null;
        const idx = haystack.indexOf(q);
        return {
          slug: item.slug,
          title: item.title,
          excerpt: `${item.summary}`.slice(0, 160) || haystack.slice(Math.max(0, idx - 40), idx + 80),
          category: item.category,
          acsLevel: item.acsLevel,
          clearance: item.clearance,
          spoiler: item.spoiler,
        };
      })
      .filter(Boolean);
    res.json({ query: q, results });
  });

  router.get('/wiki/categories', (_req, res) => {
    res.json({ categories: categoriesFor(db, 'wiki') });
  });

  /* ---------------------------------------------------------------- *
   * Interactive map — §9
   * ---------------------------------------------------------------- */
  router.get('/map', (_req, res) => {
    const floors = db.prepare('SELECT * FROM map_floors ORDER BY order_index').all();
    const nodes = db.prepare('SELECT * FROM map_nodes').all();
    const edges = db.prepare('SELECT * FROM map_edges').all();
    res.json({
      placeholder: true,
      notice: 'Plans de substitution explicites. Les plans définitifs seront fournis par l’équipe de level design.',
      floors,
      nodes,
      edges,
    });
  });

  router.post('/map/route', (req, res) => {
    const from = String(req.body?.from ?? '');
    const to = String(req.body?.to ?? '');
    const clearance = req.body?.clearance ? String(req.body.clearance) : null;
    const maxRank = clearanceRank(clearance);
    const nodes = db.prepare('SELECT * FROM map_nodes').all() as {
      id: string; floor_id: string; code: string; label: string; kind: string; restricted: number; clearance: string | null;
    }[];
    const edges = db.prepare('SELECT * FROM map_edges').all() as {
      id: string; from_node: string; to_node: string; kind: string; distance: number; restricted: number;
    }[];
    const floors = db.prepare('SELECT * FROM map_floors').all() as { id: string; label: string; level: number }[];

    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    if (!nodeMap.has(from) || !nodeMap.has(to)) return res.status(400).json({ error: 'unknown_node' });

    const blocked = (n: typeof nodes[number]) => n.restricted === 1 && maxRank < clearanceRank(n.clearance);
    if (blocked(nodeMap.get(from)!) || blocked(nodeMap.get(to)!)) {
      return res.status(403).json({
        error: 'clearance_required',
        message: 'Itinéraire impossible avec ce niveau d’habilitation : un accès restreint est requis.',
      });
    }

    const graph = new Map<string, { to: string; cost: number; kind: string; restricted: boolean }[]>();
    for (const edge of edges) {
      if (edge.restricted && maxRank < 3) continue;
      const target = nodeMap.get(edge.to_node);
      const source = nodeMap.get(edge.from_node);
      if (!target || !source) continue;
      if (blocked(target) || blocked(source)) continue;
      if (!graph.has(edge.from_node)) graph.set(edge.from_node, []);
      if (!graph.has(edge.to_node)) graph.set(edge.to_node, []);
      const cost = edge.distance + (edge.kind === 'elevator' ? 1.2 : edge.kind === 'stairs' ? 0.8 : 0);
      graph.get(edge.from_node)!.push({ to: edge.to_node, cost, kind: edge.kind, restricted: edge.restricted === 1 });
      graph.get(edge.to_node)!.push({ to: edge.from_node, cost, kind: edge.kind, restricted: edge.restricted === 1 });
    }

    // Dijkstra (positive weights only).
    const dist = new Map<string, number>();
    const prev = new Map<string, { node: string; kind: string } | null>();
    const visited = new Set<string>();
    dist.set(from, 0);
    prev.set(from, null);
    while (visited.size < nodeMap.size) {
      let current: string | null = null;
      let best = Infinity;
      for (const [id, d] of dist) {
        if (!visited.has(id) && d < best) {
          best = d;
          current = id;
        }
      }
      if (!current) break;
      if (current === to) break;
      visited.add(current);
      for (const link of graph.get(current) ?? []) {
        if (visited.has(link.to)) continue;
        const candidate = best + link.cost;
        if (candidate < (dist.get(link.to) ?? Infinity)) {
          dist.set(link.to, candidate);
          prev.set(link.to, { node: current, kind: link.kind });
        }
      }
    }

    if (!dist.has(to)) {
      return res.status(404).json({
        error: 'no_route',
        message: 'Aucun itinéraire praticable entre ces deux points avec les accès disponibles.',
      });
    }

    const path: string[] = [];
    let cursor: string | null = to;
    while (cursor) {
      path.unshift(cursor);
      cursor = prev.get(cursor)?.node ?? null;
    }
    const floorById = new Map(floors.map((f) => [f.id, f]));
    const steps = path.map((nodeId, index) => {
      const node = nodeMap.get(nodeId)!;
      const via = index > 0 ? prev.get(nodeId)?.kind ?? 'corridor' : 'start';
      const previous = index > 0 ? nodeMap.get(path[index - 1])! : null;
      const sameFloor = previous ? previous.floor_id === node.floor_id : true;
      const floor = floorById.get(node.floor_id);
      let instruction = `Rejoindre ${node.label}`;
      if (via === 'elevator') instruction = `Prendre l’ascenseur jusqu’à ${floor?.label ?? node.floor_id} — ${node.label}`;
      else if (via === 'stairs') instruction = `Emprunter les escaliers jusqu’à ${floor?.label ?? node.floor_id} — ${node.label}`;
      else if (!sameFloor) instruction = `Changement de niveau — ${floor?.label ?? node.floor_id}`;
      return {
        nodeId,
        code: node.code,
        label: node.label,
        floorId: node.floor_id,
        floorLabel: floor?.label ?? node.floor_id,
        kind: node.kind,
        via,
        restricted: node.restricted === 1,
        clearance: node.clearance,
        instruction,
      };
    });

    res.json({
      from,
      to,
      clearance,
      totalCost: Number((dist.get(to) ?? 0).toFixed(2)),
      floorsUsed: [...new Set(steps.map((s) => s.floorId))],
      steps,
      placeholder: true,
    });
  });

  /* ---------------------------------------------------------------- *
   * Community servers — §7
   * ---------------------------------------------------------------- */
  router.get('/servers', (_req, res) => {
    const rows = db.prepare(
      "SELECT * FROM servers WHERE deleted_at IS NULL AND status IN ('active','suspended') AND status <> 'pending'",
    ).all() as Record<string, any>[];
    const active = rows.filter((r) => r.status === 'active');
    const featured = [...active]
      .sort((a, b) => Math.max(b.validated_at ?? 0, b.created_at) - Math.max(a.validated_at ?? 0, a.created_at))
      .slice(0, 3)
      .map((r) => r.id);
    const shaped = rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      address: `${r.host}:${r.port}`,
      region: r.region,
      status: r.status,
      maintenance: !!r.maintenance,
      currentPlayers: r.current_players,
      averagePlayers: Math.round(r.avg_players * 10) / 10,
      maxPlayers: r.max_players,
      featured: featured.includes(r.id),
      tag: featured.includes(r.id) ? 'Nouveau' : r.tag || null,
      validatedAt: r.validated_at,
      createdAt: r.created_at,
      lastOnlineAt: r.last_online_at,
      offlineDays: r.last_online_at ? Math.floor((Date.now() - r.last_online_at) / 86400000) : null,
    }));
    const top = shaped.filter((s) => s.featured).sort((a, b) => (b.validatedAt ?? b.createdAt) - (a.validatedAt ?? a.createdAt));
    const rest = shaped.filter((s) => !s.featured).sort((a, b) => b.averagePlayers - a.averagePlayers);
    res.json({
      featured: top,
      servers: [...top, ...rest],
      rules: { maxPerUser: 3, requiresValidation: true, ssrfProtected: true },
    });
  });

  /* ---------------------------------------------------------------- *
   * Leaderboards & public stats — §5.7
   * ---------------------------------------------------------------- */
  router.get('/leaderboards', (req, res) => {
    const mode = req.query.mode === 'multiplayer' ? 'multiplayer' : 'story';
    const operation = req.query.operation ? String(req.query.operation) : null;
    const ending = req.query.ending ? String(req.query.ending) : null;

    const rows = db.prepare(
      `SELECT s.*, u.username, u.profile_public, u.mirage_id
       FROM stat_entries s LEFT JOIN users u ON u.id = s.user_id
       WHERE s.mode = ? AND s.hidden = 0 AND (s.user_id IS NULL OR u.profile_public = 1)
       ${operation ? 'AND s.operation_code = ?' : ''}
       ${ending ? 'AND s.ending_code = ?' : ''}`,
    ).all(...[mode, ...(operation ? [operation] : []), ...(ending ? [ending] : [])]) as Record<string, any>[];

    const shaped = rows.map((r) => ({
      displayName: r.username ?? r.display_name,
      mirageId: r.mirage_id ?? null,
      mode: r.mode,
      operation: r.operation_code,
      ending: r.ending_code,
      bestTimeMs: r.best_time_ms,
      deaths: r.deaths,
      reputation: r.reputation,
      score: Math.round(r.score * 10) / 10,
      updatedAt: r.updated_at,
    }));

    const byOperation = new Map<string, typeof shaped>();
    for (const row of shaped) {
      if (!row.bestTimeMs) continue;
      if (!byOperation.has(row.operation)) byOperation.set(row.operation, []);
      byOperation.get(row.operation)!.push(row);
    }
    const bestTimes = [...byOperation.entries()].map(([op, list]) => ({
      operation: op,
      entries: list.sort((a, b) => (a.bestTimeMs ?? 0) - (b.bestTimeMs ?? 0)).slice(0, 20),
    }));
    const byEnding = new Map<string, typeof shaped>();
    for (const row of shaped) {
      if (!row.ending) continue;
      if (!byEnding.has(row.ending)) byEnding.set(row.ending, []);
      byEnding.get(row.ending)!.push(row);
    }
    res.json({
      mode,
      operations: [...new Set(shaped.map((s) => s.operation))],
      endings: [...byEnding.keys()],
      bestTimes,
      byEnding: [...byEnding.entries()].map(([endingCode, list]) => ({
        ending: endingCode,
        entries: list.sort((a, b) => (a.bestTimeMs ?? 0) - (b.bestTimeMs ?? 0)).slice(0, 20),
      })),
      byScore: [...shaped].sort((a, b) => b.score - a.score).slice(0, 20),
      deathsTop: [...shaped].sort((a, b) => b.deaths - a.deaths).slice(0, 10),
      note: 'Seuls les profils rendus publics apparaissent dans les classements.',
    });
  });

  router.get('/stats/global', (_req, res) => {
    const users = db.prepare("SELECT COUNT(*) AS c FROM users WHERE status = 'active' AND role = 'player'").get() as { c: number };
    const servers = db.prepare("SELECT COUNT(*) AS c FROM servers WHERE status = 'active' AND deleted_at IS NULL").get() as { c: number };
    const wiki = db.prepare("SELECT COUNT(*) AS c FROM content WHERE type = 'wiki' AND status = 'published'").get() as { c: number };
    const news = db.prepare("SELECT COUNT(*) AS c FROM content WHERE type = 'news' AND status = 'published'").get() as { c: number };
    res.json({
      players: users.c,
      servers: servers.c,
      wikiPages: wiki.c,
      news: news.c,
      releaseDate: null,
      releaseLabel: 'Date de sortie non annoncée',
    });
  });

  /* ---------------------------------------------------------------- *
   * Storefront — §8 (no payment, no launcher)
   * ---------------------------------------------------------------- */
  router.get('/store', (_req, res) => {
    const extras = listPublished(db, 'buyer_extras', 'fr');
    res.json({
      editions: [
        {
          id: 'standard',
          name: 'Édition standard',
          price: STORE_STANDARD_PRICE,
          priceLabel: '25,00 € TTC',
          status: 'defined',
          features: [
            'Modes Histoire et Multijoueur',
            'Carte unique : la Zone Mirage',
            'Wiki officiel accessible',
          ],
          note: null,
        },
        {
          id: 'supporter',
          name: 'Édition Supporter',
          price: null,
          priceLabel: '[prix et contenu à définir]',
          status: 'placeholder',
          features: ['[contenu à définir]'],
          note: 'Prix et contenu non communiqués par l’équipe.',
        },
        {
          id: 'deluxe',
          name: 'Édition Deluxe',
          price: null,
          priceLabel: '[prix et contenu à définir]',
          status: 'placeholder',
          features: ['[contenu à définir]'],
          note: 'Prix et contenu non communiqués par l’équipe.',
        },
      ],
      platforms: [
        { id: 'steam', label: 'Steam', buyUrl: null, wishlistUrl: null, available: true, note: 'Boutique externe — aucun paiement sur ce site.' },
        { id: 'epic', label: 'Epic Games Store', buyUrl: null, wishlistUrl: null, available: false, note: 'Bouton masqué jusqu’à la mise en ligne de la page Epic.' },
      ],
      buyerExtras: extras.map((e) => ({ slug: e.slug, title: e.title, summary: e.summary, hasVisuals: false })),
      buyerExtrasNote: 'Contenus réservés aux acheteurs, listés sans visuel. Aucun téléchargement n’est distribué depuis ce site.',
      payment: false,
      launcher: false,
      dlc: { ownershipCheckedViaApi: true, note: 'La possession des DLC est vérifiée via l’API de la plateforme.' },
    });
  });

  /* ---------------------------------------------------------------- *
   * Maintenance & legal
   * ---------------------------------------------------------------- */
  router.get('/maintenance', (_req, res) => {
    const setting = db.prepare("SELECT value FROM settings WHERE key = 'maintenance.enabled'").get() as { value: string } | undefined;
    res.json({
      enabled: setting?.value === 'true',
      message: 'Aucune maintenance planifiée. Les créneaux seront annoncés par l’équipe technique.',
      placeholder: true,
      schedule: '[À définir]',
    });
  });

  router.get('/legal/:slug', (req, res) => {
    const row = findBySlug(db, 'legal', String(req.params.slug));
    if (!row || !isPubliclyVisible(row)) return res.status(404).json({ error: 'not_found' });
    res.json({ item: serialize(db, row, String(req.query.locale ?? 'fr')) });
  });

  /* ---------------------------------------------------------------- *
   * Public profile — §5.6
   * ---------------------------------------------------------------- */
  router.get('/profile/:mirageId', (req, res) => {
    const mirageId = String(req.params.mirageId);
    const user = db.prepare('SELECT * FROM users WHERE mirage_id = ? AND (purge_after IS NULL OR purge_after > ?)')
      .get(mirageId, Date.now()) as PublicUser | undefined;
    if (!user) return res.status(404).json({ error: 'not_found', message: 'Profil introuvable.' });
    const viewer = req.user?.id ?? null;
    const isOwner = viewer === user.id;
    const isPublic = !!user.profile_public;
    const base = {
      mirageId: user.mirage_id,
      username: user.username,
      profilePublic: isPublic,
      restricted: !isOwner && !isPublic,
    };
    if (!isOwner && !isPublic) {
      return res.json({ profile: base, stats: null, socials: null });
    }
    const stats = statsFor(db, user.id);
    const socials = JSON.parse(user.socials_json || '{}');
    res.json({
      profile: {
        ...base,
        bio: user.bio,
        createdAt: user.created_at,
        role: user.role,
        showSocials: !!user.show_socials,
      },
      stats: stats.map((s) => ({
        mode: s.mode,
        operation: s.operation_code,
        ending: s.ending_code,
        bestTimeMs: s.best_time_ms,
        deaths: s.deaths,
        reputation: s.reputation,
        playtimeMs: s.playtime_ms,
        score: Math.round(s.score * 10) / 10,
        updatedAt: s.updated_at,
      })),
      socials: isPublic ? (user.show_socials ? socials : null) : undefined,
    });
  });

  /* ---------------------------------------------------------------- *
   * CSRF helper for the SPA
   * ---------------------------------------------------------------- */
  router.get('/csrf', (req, res) => {
    res.json({ token: req.csrfCookie ?? null });
  });

  /* ---------------------------------------------------------------- *
   * Support ticket creation is public (with rate limiting) — §12.3
   * ---------------------------------------------------------------- */
  router.get('/support/status', (_req, res) => {
    res.json({
      securityContact: 'security@mirage-protocol.example',
      responseTimes: { security: '24 h', billing: '72 h', technical: '72 h', other: '5 jours' },
      placeholder: true,
    });
  });

  /* ---------------------------------------------------------------- *
   * Demos/health
   * ---------------------------------------------------------------- */
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', env: IS_PROD ? 'production' : 'development', time: Date.now() });
  });

  router.use((_req, res) => res.status(404).json({ error: 'not_found' }));

  return router;
}

export const publicConfig = {
  demoMode: DEMO_MODE,
  totpPreview: DEMO_MODE ? DEMO_TOTP_SECRET : null,
  locales: LOCALES,
  standardPrice: STORE_STANDARD_PRICE,
  rateKey: (ip: string) => sha256(ip),
  clientIp,
};
