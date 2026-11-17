import path from 'node:path';

export const NODE_ENV = process.env.NODE_ENV ?? 'development';
export const IS_PROD = NODE_ENV === 'production';
export const PORT = Number(process.env.PORT ?? 3000);
export const HOST = process.env.HOST ?? '0.0.0.0';

/**
 * §6.9.3 — the back-office is never served on a guessable path.
 * `/admin` and every variant is answered with a hard 404 by the router.
 */
export const ADMIN_PATH = (process.env.ADMIN_PATH ?? '/console-mirage').replace(/\/+$/, '');

export const SESSION_COOKIE = IS_PROD ? '__Host-zm_sid' : 'zm_sid';
export const CSRF_COOKIE = IS_PROD ? '__Host-zm_csrf' : 'zm_csrf';
export const COOKIE_PATH = '/';

export const SESSION_POLICY = {
  player: { idleMs: 30 * 24 * 60 * 60 * 1000, absoluteMs: 90 * 24 * 60 * 60 * 1000 },
  staff: { idleMs: 15 * 60 * 1000, absoluteMs: 8 * 60 * 60 * 1000 },
};

export const REAUTH_WINDOW_MS = 5 * 60 * 1000; // §6.8 — sensitive actions need < 5 min
export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000; // §6.10 — 30-minute single-use token
export const TWOFA_RECOVERY_DELAY_MS = 72 * 60 * 60 * 1000; // players only, 72 h
export const DELETION_GRACE_MS = 7 * 24 * 60 * 60 * 1000; // §5.8 — 7-day retraction window
export const OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1000; // §5.4 — Story offline grace (proposal)

export const RP_NAME = 'SCP: Mirage Protocol';
export const RP_ID = process.env.WEBAUTHN_RP_ID ?? 'localhost';
export const EXPECTED_ORIGIN = process.env.PUBLIC_ORIGIN ?? '';

export const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
export const BACKUP_DIR = process.env.BACKUP_DIR ?? path.join(DATA_DIR, 'backups');

/**
 * Mode de vérification des licences. En production, seules les API réelles
 * (Steam / Epic) sont interrogées ; `PLATFORM_MODE=fixture` n'est accepté que
 * hors production, pour les tests d'intégration.
 */
export const PLATFORM_FIXTURES = !IS_PROD && process.env.PLATFORM_MODE === 'fixture';

export const I18N_ACTIVE = ['fr', 'en'] as const;
export const I18N_MASKED = ['es', 'de', 'it'] as const;
export const I18N_THRESHOLD = Number(process.env.I18N_THRESHOLD ?? 0.85);
export const CROWDIN_URL = 'https://crowdin.com/project/scp-mirage-protocol';

export const TURNSTILE_SITE_KEY = process.env.TURNSTILE_SITE_KEY ?? '';
export const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET ?? '';
