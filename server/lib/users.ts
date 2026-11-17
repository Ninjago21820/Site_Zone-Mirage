import type { DB } from '../db.js';
import type { PublicUser } from '../types.js';

export async function findUserById(db: DB, id: string): Promise<PublicUser | undefined> {
  return await db.get('SELECT * FROM users WHERE id = ?', [id]) as PublicUser | undefined;
}

export async function findUserByIdentifier(db: DB, identifier: string): Promise<PublicUser | undefined> {
  const value = String(identifier ?? '').trim();
  if (!value) return undefined;
  const byUsername = await db.get('SELECT * FROM users WHERE lower(username) = lower(?)', [value]) as PublicUser | undefined;
  if (byUsername) return byUsername;
  const byEmail = await db.get('SELECT * FROM users WHERE lower(email) = lower(?)', [value]) as PublicUser | undefined;
  if (byEmail) return byEmail;
  return await db.get('SELECT * FROM users WHERE mirage_id = ?', [value]) as PublicUser | undefined;
}

export interface AccountView {
  id?: string;
  mirageId: string;
  username: string;
  role?: string;
  email?: string | null;
  locale?: string;
  bio?: string;
  profilePublic: boolean;
  showSocials: boolean;
  socials?: Record<string, string>;
  createdAt?: number;
  twoFactor?: { totp: boolean; passkeys: number; backupCodesLeft: number };
  licenses?: unknown[];
  security?: unknown;
  isOwner?: boolean;
}

const PUBLIC_SOCIAL_KEYS = ['discord', 'steam', 'epic', 'google', 'youtube', 'twitch', 'x'];

export function socialsOf(user: PublicUser): Record<string, string> {
  try {
    const parsed = JSON.parse(user.socials_json || '{}') as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const key of PUBLIC_SOCIAL_KEYS) {
      const value = parsed[key];
      if (typeof value === 'string' && /^https?:\/\/[^\s]+$/i.test(value)) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * §5.6 — pseudonym + Mirage ID are always visible; everything else is gated
 * by the Private/Public toggle. Email, licences and security data are only
 * ever visible to the owner.
 */
export async function profileView(db: DB, user: PublicUser, viewerId: string | null): Promise<AccountView> {
  const isOwner = viewerId === user.id;
  const viewer = viewerId ? await findUserById(db, viewerId) : undefined;
  const isStaffViewer = !!viewer && viewer.role !== 'player';
  const isPublic = !!user.profile_public;

  const base: AccountView = {
    mirageId: user.mirage_id,
    username: user.username,
    profilePublic: isPublic,
    showSocials: !!user.show_socials,
  };

  if (!isOwner && !isPublic) return base;

  const view: AccountView = {
    ...base,
    bio: user.bio,
    createdAt: user.created_at,
    role: isPublic || isOwner ? user.role : undefined,
  };
  if (isPublic && user.show_socials) view.socials = socialsOf(user);

  if (isOwner || isStaffViewer) {
    view.id = user.id;
    view.email = user.email;
    view.locale = user.locale;
  }

  if (isOwner) {
    view.isOwner = true;
    view.socials = socialsOf(user);
    const passkeys = await db.get('SELECT COUNT(*) AS c FROM webauthn_credentials WHERE user_id = ?', [user.id]) as { c: number };
    view.twoFactor = {
      totp: !!user.totp_secret,
      passkeys: passkeys.c,
      backupCodesLeft: user.backup_codes_left ?? 0,
    };
  }
  return view;
}

export interface StatRow {
  id: string;
  user_id: string | null;
  display_name: string;
  mode: string;
  operation_code: string;
  ending_code: string | null;
  best_time_ms: number | null;
  deaths: number;
  reputation: number;
  playtime_ms: number;
  score: number;
  hidden: number;
  verified_at: number | null;
  updated_at: number;
}

export async function statsFor(db: DB, userId: string) {
  return await db.all('SELECT * FROM stat_entries WHERE user_id = ? AND hidden = 0 ORDER BY mode, operation_code', [userId]) as StatRow[];
}

export async function statsSummary(db: DB, userId: string) {
  const rows = await statsFor(db, userId);
  const story = rows.filter((r) => r.mode === 'story');
  const mp = rows.filter((r) => r.mode === 'multiplayer');
  return {
    storyPlaytimeMs: story.reduce((a, r) => a + r.playtime_ms, 0),
    multiplayerPlaytimeMs: mp.reduce((a, r) => a + r.playtime_ms, 0),
    deaths: rows.reduce((a, r) => a + r.deaths, 0),
    reputation: rows.reduce((a, r) => a + r.reputation, 0),
    bestTimes: story
      .filter((r) => r.best_time_ms)
      .map((r) => ({ operation: r.operation_code, ending: r.ending_code, bestTimeMs: r.best_time_ms })),
    deathsByOperation: story.map((r) => ({ operation: r.operation_code, deaths: r.deaths })),
    rows: rows.length,
  };
}
