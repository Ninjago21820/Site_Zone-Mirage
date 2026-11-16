import { describe, expect, it } from 'vitest';
import {
  CONTENT_MATRIX, FUNCTION_MATRIX, STATUS_FLOW, ROLE_LABELS, canContent, canFunction,
} from '../server/lib/rbac.js';

const ROLES = Object.keys(ROLE_LABELS) as (keyof typeof ROLE_LABELS)[];
const CONTENT_TYPES = Object.keys(CONTENT_MATRIX) as (keyof typeof CONTENT_MATRIX)[];

/**
 * These tables are transcribed verbatim from §11.3 and §11.4 of the
 * specifications. If a cell is changed by mistake, this suite fails.
 */
describe('§11.3 — Matrice des droits par type de contenu', () => {
  const expected: Record<string, Record<string, string>> = {
    wiki: { admin: 'CVP', translator: 'T', writer: 'CV', game_designer: 'V', animator: 'C' },
    news: { admin: 'CVP', translator: 'T', writer: 'C', game_designer: 'CV', animator: 'C', dev: 'CV', community_manager: 'C' },
    roadmap: { admin: 'CVP', translator: 'T', writer: 'C', game_designer: 'CV', animator: 'C', dev: 'CV', community_manager: 'C' },
    map: { admin: 'CVP', translator: 'T', writer: 'V', game_designer: 'CV', animator: 'C', dev: 'CV' },
    faq: { admin: 'CVP', translator: 'T', moderator: 'C', game_designer: 'C', dev: 'C', community_manager: 'CV' },
    buyer_extras: { admin: 'CVP', translator: 'T', writer: 'C', game_designer: 'C', animator: 'CV' },
    legal: { admin: 'CVP', translator: 'T' },
  };

  it('déclare exactement les sept types de contenus attendus', () => {
    expect([...CONTENT_TYPES].sort()).toEqual(Object.keys(expected).sort());
  });

  it('reproduit chaque cellule de la matrice', () => {
    for (const type of CONTENT_TYPES) {
      for (const role of ROLES) {
        const declared = CONTENT_MATRIX[type]?.[role] ?? '';
        const reference = expected[type][role] ?? '';
        expect(`${type}/${role}=${[...declared].sort().join('')}`).toBe(`${type}/${role}=${[...reference].sort().join('')}`);
      }
    }
  });

  it('traduit les lettres en capacités exploitables', () => {
    expect(canContent('translator', 'news', 'T')).toBe(true);
    expect(canContent('translator', 'news', 'C')).toBe(false);
    expect(canContent('animator', 'wiki', 'C')).toBe(true);
    expect(canContent('animator', 'wiki', 'V')).toBe(false);
    expect(canContent('moderator', 'legal', 'C')).toBe(false);
    expect(canContent('admin', 'legal', 'P')).toBe(true);
  });
});

describe('§11.4 — Matrice des fonctions', () => {
  const expected: Record<string, string[]> = {
    store_pages: ['admin'],
    users_roles: ['admin'],
    account_sanctions: ['admin', 'moderator', 'community_manager'],
    server_validation: ['admin', 'moderator', 'community_manager'],
    support_tickets: ['admin', 'moderator', 'dev', 'community_manager'],
    score_removal: ['admin', 'moderator'],
    license_dispute: ['admin', 'moderator'],
    api_keys: ['admin', 'dev'],
    backups_logs: ['admin', 'dev'],
    audit_log: ['admin'],
  };

  it('accorde exactement les mêmes fonctions aux mêmes rôles', () => {
    for (const [fn, roles] of Object.entries(expected)) {
      for (const role of ROLES) {
        const label = `${fn}/${role}`;
        expect(`${label}=${canFunction(role, fn as never)}`).toBe(`${label}=${roles.includes(role)}`);
      }
    }
  });

  it('limite les sanctions du Community Manager aux avertissements', () => {
    const sanctions = FUNCTION_MATRIX.find((rule) => rule.key === 'account_sanctions')!;
    expect(sanctions.roles).toEqual(['admin', 'moderator', 'community_manager']);
    expect(sanctions.scope?.community_manager).toBe('warning_only');
    expect(FUNCTION_MATRIX.find((rule) => rule.key === 'audit_log')!.roles).toEqual(['admin']);
    expect(FUNCTION_MATRIX.find((rule) => rule.key === 'support_tickets')!.scope?.dev).toBe('technical_only');
  });
});

describe('§11.2 — Flux des six statuts', () => {
  it('respecte l’ordre Brouillon → Vérification → Planification → Publié → Archivé → Supprimé', () => {
    expect(STATUS_FLOW.draft).toContain('review');
    expect(STATUS_FLOW.review).toContain('scheduled');
    expect(STATUS_FLOW.scheduled).toContain('published');
    expect(STATUS_FLOW.published).toContain('archived');
    expect(STATUS_FLOW.archived).toContain('deleted');
    expect(STATUS_FLOW.deleted).toContain('draft');
  });

  it('interdit les sauts de statut non prévus', () => {
    expect(STATUS_FLOW.draft).not.toContain('published');
    expect(STATUS_FLOW.draft).not.toContain('archived');
    expect(STATUS_FLOW.published).not.toContain('draft');
  });
});
