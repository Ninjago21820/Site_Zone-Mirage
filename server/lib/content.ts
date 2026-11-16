import type { DB } from '../db.js';

export interface ContentRow {
  id: string;
  type: string;
  status: string;
  slug: string;
  category: string;
  author_id: string | null;
  verifier_id: string | null;
  published_at: number | null;
  scheduled_at: number | null;
  archived_at: number | null;
  deleted_at: number | null;
  spoiler: number;
  acs_level: string | null;
  clearance: string | null;
  seo_title: string;
  seo_desc: string;
  featured: number;
  order_index: number;
  created_at: number;
  updated_at: number;
}

export interface ContentTranslation {
  locale: string;
  title: string;
  summary: string;
  body: string;
}

export interface SerializedContent {
  id: string;
  type: string;
  status: string;
  slug: string;
  category: string;
  title: string;
  summary: string;
  body: string;
  locale: string;
  availableLocales: string[];
  authorId: string | null;
  verifierId: string | null;
  publishedAt: number | null;
  spoiler: boolean;
  acsLevel: string | null;
  clearance: string | null;
  seoTitle: string;
  seoDesc: string;
  featured: boolean;
  order: number;
  updatedAt: number;
  license?: string;
}

export const WIKI_LICENSE = 'CC BY-SA 3.0';

const FALLBACK_LOCALE = 'fr';
export const SUPPORTED_LOCALES = ['fr', 'en', 'es', 'de', 'it'];

export function getTranslations(db: DB, contentId: string): ContentTranslation[] {
  return db.prepare('SELECT locale,title,summary,body FROM content_translations WHERE content_id = ?').all(contentId) as ContentTranslation[];
}

export function serialize(
  db: DB,
  row: ContentRow,
  locale = 'fr',
  translations?: ContentTranslation[],
): SerializedContent {
  const list = translations ?? getTranslations(db, row.id);
  const requested = list.find((t) => t.locale === locale && (t.title || t.body));
  const fallback = list.find((t) => t.locale === FALLBACK_LOCALE) ?? list[0];
  const chosen = requested ?? fallback;
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    slug: row.slug,
    category: row.category,
    title: chosen?.title ?? row.slug,
    summary: chosen?.summary ?? '',
    body: chosen?.body ?? '',
    locale: requested ? locale : FALLBACK_LOCALE,
    availableLocales: list.filter((t) => t.title || t.body).map((t) => t.locale),
    authorId: row.author_id,
    verifierId: row.verifier_id,
    publishedAt: row.published_at,
    spoiler: !!row.spoiler,
    acsLevel: row.acs_level,
    clearance: row.clearance,
    seoTitle: row.seo_title,
    seoDesc: row.seo_desc,
    featured: !!row.featured,
    order: row.order_index,
    updatedAt: row.updated_at,
    license: row.type === 'wiki' ? WIKI_LICENSE : undefined,
  };
}

export function isPubliclyVisible(row: ContentRow, now = Date.now()): boolean {
  if (row.status === 'published') return !row.published_at || row.published_at <= now;
  if (row.status === 'scheduled') return !!row.scheduled_at && row.scheduled_at <= now;
  return false;
}

export function listPublished(db: DB, type: string, locale = 'fr', opts: { category?: string; limit?: number; search?: string; clearanceMax?: number } = {}) {
  const rows = db.prepare(
    "SELECT * FROM content WHERE type = ? AND status = 'published' AND (published_at IS NULL OR published_at <= ?) ORDER BY order_index ASC, published_at DESC",
  ).all(type, Date.now()) as ContentRow[];
  const filtered = rows.filter((r) => {
    if (opts.category && r.category !== opts.category) return false;
    if (opts.search) {
      const q = opts.search.toLowerCase();
      const tr = getTranslations(db, r.id);
      const hit = tr.some((t) => `${t.title} ${t.summary} ${t.body}`.toLowerCase().includes(q));
      if (!hit) return false;
    }
    return true;
  });
  const limited = opts.limit ? filtered.slice(0, opts.limit) : filtered;
  return limited.map((r) => serialize(db, r, locale));
}

export function findBySlug(db: DB, type: string, slug: string): ContentRow | undefined {
  return db.prepare('SELECT * FROM content WHERE type = ? AND slug = ?').get(type, slug) as ContentRow | undefined;
}

export function categoriesFor(db: DB, type: string): { category: string; count: number }[] {
  return db.prepare(
    `SELECT category, COUNT(*) AS count FROM content
     WHERE type = ? AND status = 'published' AND category <> '' GROUP BY category ORDER BY category`,
  ).all(type) as { category: string; count: number }[];
}

export function clearanceRank(clearance: string | null | undefined): number {
  if (!clearance) return 1;
  const m = /^N(\d)$/.exec(clearance);
  return m ? Number(m[1]) : 1;
}
