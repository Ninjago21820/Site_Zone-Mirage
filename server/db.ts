/**
 * Domaine partagé : énumérations, types et point d'entrée de la base.
 * Le schéma et les pilotes vivent dans `server/db/`.
 */
export type { DB } from './db/index.js';
export { openDb, migrate } from './db/index.js';

export const NOW = () => Date.now();

export const ROLES = [
  'admin',
  'moderator',
  'translator',
  'writer',
  'game_designer',
  'animator',
  'dev',
  'community_manager',
  'player',
] as const;
export type Role = (typeof ROLES)[number];

export const CONTENT_TYPES = [
  'wiki',
  'news',
  'roadmap',
  'map',
  'faq',
  'buyer_extras',
  'legal',
] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const STATUSES = [
  'draft',
  'review',
  'scheduled',
  'published',
  'archived',
  'deleted',
] as const;
export type ContentStatus = (typeof STATUSES)[number];
