import type { ContentType, Role, ContentStatus } from '../db.js';

export const STAFF_ROLES: Role[] = [
  'admin',
  'moderator',
  'translator',
  'writer',
  'game_designer',
  'animator',
  'dev',
  'community_manager',
];

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrateur',
  moderator: 'Modérateur',
  translator: 'Traducteur',
  writer: 'Rédacteur',
  game_designer: 'Game Designer',
  animator: 'Animateur',
  dev: 'Développeur',
  community_manager: 'Community Manager',
  player: 'Joueur',
};

export type ContentAction = 'C' | 'V' | 'P' | 'T';

/**
 * §11.3 — Content role matrix, transcribed verbatim from the specification.
 * C = create/draft/edit, V = verify, P = publish, T = translate.
 */
export const CONTENT_MATRIX: Record<ContentType, Partial<Record<Role, string>>> = {
  wiki: { admin: 'CVP', translator: 'T', writer: 'CV', game_designer: 'V', animator: 'C' },
  news: {
    admin: 'CVP',
    translator: 'T',
    writer: 'C',
    game_designer: 'CV',
    animator: 'C',
    dev: 'CV',
    community_manager: 'C',
  },
  roadmap: {
    admin: 'CVP',
    translator: 'T',
    writer: 'C',
    game_designer: 'CV',
    animator: 'C',
    dev: 'CV',
    community_manager: 'C',
  },
  map: { admin: 'CVP', translator: 'T', writer: 'V', game_designer: 'CV', animator: 'C', dev: 'CV' },
  faq: { admin: 'CVP', moderator: 'C', translator: 'T', game_designer: 'C', dev: 'C', community_manager: 'CV' },
  buyer_extras: { admin: 'CVP', translator: 'T', writer: 'C', game_designer: 'C', animator: 'CV' },
  legal: { admin: 'CVP', translator: 'T' },
};

export function actionsFor(role: Role, type: ContentType): ContentAction[] {
  const raw = CONTENT_MATRIX[type]?.[role] ?? '';
  return raw.split('') as ContentAction[];
}

export function canContent(role: Role, type: ContentType, action: ContentAction): boolean {
  return actionsFor(role, type).includes(action);
}

/** §11.4 — Function matrix. Notes in brackets are rendered in the back-office. */
export type FunctionKey =
  | 'store_pages'
  | 'users_roles'
  | 'account_sanctions'
  | 'server_validation'
  | 'support_tickets'
  | 'score_removal'
  | 'license_dispute'
  | 'api_keys'
  | 'backups_logs'
  | 'audit_log';

export interface FunctionRule {
  key: FunctionKey;
  label: string;
  roles: Role[];
  note?: string;
  scope?: Partial<Record<Role, string>>;
}

export const FUNCTION_MATRIX: FunctionRule[] = [
  { key: 'store_pages', label: 'Pages boutique', roles: ['admin'] },
  { key: 'users_roles', label: 'Utilisateurs & rôles', roles: ['admin'] },
  {
    key: 'account_sanctions',
    label: 'Sanctions de compte',
    roles: ['admin', 'moderator', 'community_manager'],
    note: 'Community Manager : avertissement uniquement',
    scope: { community_manager: 'warning_only' },
  },
  {
    key: 'server_validation',
    label: 'Validation / suspension de serveur',
    roles: ['admin', 'moderator', 'community_manager'],
    note: '[Proposition]',
  },
  {
    key: 'support_tickets',
    label: 'Tickets de support',
    roles: ['admin', 'moderator', 'dev', 'community_manager'],
    note: 'Développeur : technique uniquement · Community Manager : [Proposition]',
    scope: { dev: 'technical_only' },
  },
  { key: 'score_removal', label: 'Retrait de score', roles: ['admin', 'moderator'] },
  { key: 'license_dispute', label: 'Litige de licence', roles: ['admin', 'moderator'] },
  { key: 'api_keys', label: 'API & clés', roles: ['admin', 'dev'] },
  { key: 'backups_logs', label: 'Sauvegardes & journaux techniques', roles: ['admin', 'dev'] },
  { key: 'audit_log', label: 'Journal d’audit', roles: ['admin'] },
];

export function canFunction(role: Role, fn: FunctionKey): boolean {
  const rule = FUNCTION_MATRIX.find((r) => r.key === fn);
  return !!rule && rule.roles.includes(role);
}

export function functionScope(role: Role, fn: FunctionKey): string | undefined {
  return FUNCTION_MATRIX.find((r) => r.key === fn)?.scope?.[role];
}

/** §11.2 — Editorial workflow, six statuses. */
export const STATUS_FLOW: Record<ContentStatus, ContentStatus[]> = {
  draft: ['review', 'deleted'],
  review: ['scheduled', 'published', 'draft', 'deleted'],
  scheduled: ['published', 'draft', 'deleted'],
  published: ['archived', 'deleted'],
  archived: ['published', 'deleted'],
  deleted: ['draft'],
};

export const STATUS_LABELS: Record<ContentStatus, string> = {
  draft: 'Brouillon',
  review: 'Vérification',
  scheduled: 'Planification',
  published: 'Publié',
  archived: 'Archivé',
  deleted: 'Supprimé',
};

export const RESTORE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export interface TransitionCheck {
  allowed: boolean;
  reason?: string;
  requiresOverride?: boolean;
}

/**
 * Transition rules with author/verifier separation (§11.2).
 * The only way an author can move their own content past verification is an
 * explicit, reasoned Admin override — always written to the audit log.
 */
export function checkTransition(params: {
  role: Role;
  type: ContentType;
  from: ContentStatus;
  to: ContentStatus;
  isAuthor: boolean;
  isVerifier: boolean;
  override?: boolean;
  overrideReason?: string;
  deletedAt?: number | null;
  now?: number;
}): TransitionCheck {
  const { role, type, from, to, isAuthor, override, overrideReason, deletedAt } = params;
  const target: string = to;
  if (!STATUS_FLOW[from]?.includes(to)) return { allowed: false, reason: `Transition ${from} → ${to} impossible.` };

  const isAdmin = role === 'admin';

  if (override) {
    if (!isAdmin) return { allowed: false, reason: 'Seul un administrateur peut passer outre.' };
    if (!overrideReason || overrideReason.trim().length < 10)
      return { allowed: false, reason: 'Un motif d’au moins 10 caractères est requis pour un passage outre.' };
    return { allowed: true, requiresOverride: true };
  }

  if (target === 'deleted') {
    return canContent(role, type, 'C') || canContent(role, type, 'P')
      ? { allowed: true }
      : { allowed: false, reason: 'Droit insuffisant sur ce type de contenu.' };
  }

  if (from === 'deleted' && target === 'draft') {
    if (!deletedAt) return { allowed: false, reason: 'Contenu non supprimé.' };
    if (Date.now() - deletedAt > RESTORE_WINDOW_MS) {
      return { allowed: false, reason: 'Le délai de restauration de 30 jours est dépassé.', requiresOverride: true };
    }
    return canContent(role, type, 'C') ? { allowed: true } : { allowed: false, reason: 'Droit de création requis.' };
  }

  if (from === 'draft' && target === 'review') {
    if (!canContent(role, type, 'C')) return { allowed: false, reason: 'Droit de rédaction requis.' };
    if (!isAuthor && !isAdmin) return { allowed: false, reason: 'Seul l’auteur peut soumettre son brouillon.' };
    return { allowed: true };
  }

  if (target === 'published' || (from === 'review' && target === 'scheduled')) {
    if (!canContent(role, type, 'P')) return { allowed: false, reason: 'Droit de publication requis.' };
    if (isAuthor) {
      return {
        allowed: false,
        reason: 'Séparation auteur / vérificateur : l’auteur ne peut pas publier son propre contenu. Un administrateur doit utiliser le passage outre motivé.',
        requiresOverride: isAdmin,
      };
    }
    return { allowed: true };
  }

  if (from === 'review' && target === 'draft') {
    if (!canContent(role, type, 'V') && !canContent(role, type, 'C')) {
      return { allowed: false, reason: 'Droit de vérification requis.' };
    }
    return { allowed: true };
  }

  if (from === 'published' && target === 'archived') {
    if (!canContent(role, type, 'P')) return { allowed: false, reason: 'Droit de publication requis.' };
    return { allowed: true };
  }

  if (from === 'archived' && target === 'published') {
    if (!canContent(role, type, 'P')) return { allowed: false, reason: 'Droit de publication requis.' };
    return { allowed: true };
  }

  return { allowed: false, reason: 'Transition non autorisée.' };
}
