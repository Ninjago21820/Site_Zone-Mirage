/**
 * Server-side HTML sanitiser — defence in depth for §6.13 (XSS).
 * The editor stores block JSON; rendering also escapes. Nothing here ever
 * re-enables an attribute that is not on the allowlist.
 */

const ALLOWED_TAGS = new Set([
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'code', 'pre', 'blockquote',
  'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'a', 'span', 'div',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'figure', 'figcaption', 'sup', 'sub',
]);

const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'title', 'rel', 'target']),
  span: new Set(['class']),
  div: new Set(['class']),
  code: new Set(['class']),
  td: new Set(['colspan', 'rowspan']),
  th: new Set(['colspan', 'rowspan', 'scope']),
  img: new Set(['src', 'alt', 'title', 'width', 'height']),
};

const VOID_TAGS = new Set(['br', 'hr', 'img']);

export function escapeHtml(input: string): string {
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function isSafeUrl(url: string): boolean {
  const value = url.trim();
  if (!value) return false;
  if (value.startsWith('/') || value.startsWith('#')) return true;
  try {
    const parsed = new URL(value, 'https://example.invalid');
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

/** Conservative tag/attribute filtering on already-well-formed input. */
export function sanitizeHtml(input: string): string {
  if (!input) return '';
  let out = String(input);
  // Drop whole dangerous elements together with their contents.
  out = out.replace(/<(script|style|iframe|object|embed|template|svg|math|form|link|meta)\b[\s\S]*?<\/\1\s*>/gi, '');
  out = out.replace(/<(script|style|iframe|object|embed|link|meta|base)\b[^>]*\/?>/gi, '');
  // Strip HTML comments (including conditional comments).
  out = out.replace(/<!--[\s\S]*?-->/g, '');
  // Rebuild each remaining tag from an allowlist.
  out = out.replace(/<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:[^"'<>]|"[^"]*"|'[^']*')*)>/g, (match, rawName: string, rawAttrs: string) => {
    const name = rawName.toLowerCase();
    if (!ALLOWED_TAGS.has(name) && name !== 'img') return '';
    const closing = match.startsWith('</');
    if (closing) return `</${name}>`;
    const allowed = ALLOWED_ATTRS[name] ?? new Set<string>();
    const attrs: string[] = [];
    const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let m: RegExpExecArray | null;
    while ((m = attrRe.exec(rawAttrs))) {
      const attrName = m[1].toLowerCase();
      const value = m[3] ?? m[4] ?? '';
      if (!allowed.has(attrName)) continue;
      if (attrName.startsWith('on')) continue;
      if ((attrName === 'href' || attrName === 'src') && !isSafeUrl(value)) continue;
      attrs.push(`${attrName}="${escapeHtml(value)}"`);
    }
    if (name === 'a') {
      const rel = attrs.find((a) => a.startsWith('rel='));
      if (!rel) attrs.push('rel="noopener noreferrer nofollow"');
      if (attrs.some((a) => a.includes('http'))) attrs.push('target="_blank"');
    }
    return `<${name}${attrs.length ? ' ' + attrs.join(' ') : ''}${VOID_TAGS.has(name) ? ' /' : ''}>`;
  });
  return out;
}

export function stripTags(input: string): string {
  return String(input).replace(/<[^>]*>/g, '');
}

export type BlockKind = 'paragraph' | 'heading' | 'list' | 'quote' | 'code' | 'image' | 'table' | 'spoiler' | 'divider';

export interface Block {
  kind: BlockKind;
  text?: string;
  items?: string[];
  level?: number;
  src?: string;
  alt?: string;
  spoilerLabel?: string;
}

const BLOCK_KINDS = new Set<BlockKind>([
  'paragraph', 'heading', 'list', 'quote', 'code', 'image', 'table', 'spoiler', 'divider',
]);

/** Validate + sanitise untrusted block JSON coming from the editor. */
export function sanitizeBlocks(raw: unknown): Block[] {
  if (!Array.isArray(raw)) return [];
  const blocks: Block[] = [];
  for (const item of raw.slice(0, 500)) {
    if (!item || typeof item !== 'object') continue;
    const b = item as Record<string, unknown>;
    const kind = typeof b.kind === 'string' ? (b.kind as BlockKind) : 'paragraph';
    if (!BLOCK_KINDS.has(kind)) continue;
    const block: Block = { kind };
    if (typeof b.text === 'string') block.text = stripTags(b.text).slice(0, 20000);
    if (typeof b.spoilerLabel === 'string') block.spoilerLabel = stripTags(b.spoilerLabel).slice(0, 200);
    if (typeof b.level === 'number') block.level = Math.min(6, Math.max(2, Math.trunc(b.level)));
    if (typeof b.src === 'string' && isSafeUrl(b.src)) block.src = b.src;
    if (typeof b.alt === 'string') block.alt = stripTags(b.alt).slice(0, 300);
    if (Array.isArray(b.items)) block.items = b.items.filter((x) => typeof x === 'string').slice(0, 200).map((x) => stripTags(x as string).slice(0, 2000));
    blocks.push(block);
  }
  return blocks;
}

/** Naive search-term normalisation used by the wiki full-text search. */
export function normaliseSearch(input: string): string {
  return String(input || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}
