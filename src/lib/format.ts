export function formatDate(value: number | string | null | undefined, locale = 'fr'): string {
  if (!value) return '—';
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric',
  }).format(date);
}

export function formatDateTime(value: number | string | null | undefined, locale = 'fr'): string {
  if (!value) return '—';
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

export function relativeTime(value: number | null | undefined, locale = 'fr'): string {
  if (!value) return '—';
  const diff = Date.now() - value;
  const minutes = Math.round(diff / 60000);
  const rtf = new Intl.RelativeTimeFormat(locale === 'en' ? 'en' : 'fr', { numeric: 'auto' });
  if (Math.abs(minutes) < 60) return rtf.format(-minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 48) return rtf.format(-hours, 'hour');
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 60) return rtf.format(-days, 'day');
  return rtf.format(-Math.round(days / 30), 'month');
}

export function duration(ms: number | null | undefined): string {
  if (!ms || ms < 0) return '—';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`;
  if (m > 0) return `${m} min ${String(s).padStart(2, '0')} s`;
  return `${s} s`;
}

export function playtime(ms: number | null | undefined): string {
  if (!ms) return '0 h';
  const hours = ms / 3600000;
  return `${hours.toFixed(1)} h`;
}

export function shortHash(value: string, size = 10): string {
  return value ? `${value.slice(0, size)}…` : '—';
}

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');
