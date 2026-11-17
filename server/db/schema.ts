/**
 * Schéma physique commun. Les types sont choisis pour être valides à la fois
 * sur SQLite et sur MySQL/MariaDB : les clés sont des VARCHAR (MySQL refuse
 * une clé sur un TEXT sans longueur de préfixe), les horodatages sont des
 * BIGINT (les millisecondes dépassent la capacité d'un INT 32 bits) et les
 * contenus longs restent des TEXT.
 */
import type { Dialect } from './dialect.js';

const STATEMENTS = `
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  mirage_id VARCHAR(191) UNIQUE NOT NULL,
  username VARCHAR(191) UNIQUE NOT NULL,
  email VARCHAR(191) UNIQUE,
  password_hash VARCHAR(255),
  role VARCHAR(255) NOT NULL DEFAULT 'player',
  status VARCHAR(255) NOT NULL DEFAULT 'active',
  email_verified BIGINT NOT NULL DEFAULT 0,
  locale VARCHAR(191) NOT NULL DEFAULT 'fr',
  profile_public BIGINT NOT NULL DEFAULT 0,
  show_socials BIGINT NOT NULL DEFAULT 0,
  socials_json TEXT NOT NULL DEFAULT '{}',
  bio TEXT NOT NULL DEFAULT '',
  totp_secret VARCHAR(255),
  totp_last_step BIGINT,
  webauthn_required BIGINT NOT NULL DEFAULT 0,
  backup_codes_left BIGINT NOT NULL DEFAULT 10,
  failed_count BIGINT NOT NULL DEFAULT 0,
  fail_window_start BIGINT NOT NULL DEFAULT 0,
  last_failed_at BIGINT NOT NULL DEFAULT 0,
  reauth_at BIGINT NOT NULL DEFAULT 0,
  deletion_requested_at BIGINT,
  purge_after BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_mirage ON users(mirage_id);

CREATE TABLE IF NOT EXISTS reserved_mirage_ids (
  mirage_id VARCHAR(191) PRIMARY KEY,
  reason VARCHAR(255) NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token VARCHAR(255) NOT NULL,
  created_at BIGINT NOT NULL,
  last_seen BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  absolute_expires_at BIGINT NOT NULL,
  ip_trunc VARCHAR(255) NOT NULL DEFAULT '',
  ip_hash VARCHAR(255) NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  device_label VARCHAR(255) NOT NULL DEFAULT '',
  mfa_verified BIGINT NOT NULL DEFAULT 0,
  revoked_at BIGINT,
  revoked_reason VARCHAR(255)
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id VARCHAR(255) UNIQUE NOT NULL,
  public_key TEXT NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  label TEXT NOT NULL DEFAULT 'Passkey',
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS backup_codes (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  used_at BIGINT
);

CREATE TABLE IF NOT EXISTS oauth_identities (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(191) NOT NULL,
  subject TEXT NOT NULL,
  linked_at BIGINT NOT NULL,
  UNIQUE(provider, subject)
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  used_at BIGINT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at BIGINT NOT NULL,
  actor_id VARCHAR(64),
  actor_role VARCHAR(255),
  action VARCHAR(255) NOT NULL,
  target_type VARCHAR(255),
  target_id VARCHAR(64),
  ip_trunc VARCHAR(255),
  meta_json TEXT NOT NULL DEFAULT '{}',
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS content (
  id VARCHAR(64) PRIMARY KEY,
  type VARCHAR(255) NOT NULL,
  status VARCHAR(255) NOT NULL DEFAULT 'draft',
  slug VARCHAR(191) NOT NULL,
  category VARCHAR(255) NOT NULL DEFAULT '',
  author_id VARCHAR(64),
  verifier_id VARCHAR(64),
  published_at BIGINT,
  scheduled_at BIGINT,
  archived_at BIGINT,
  deleted_at BIGINT,
  spoiler BIGINT NOT NULL DEFAULT 0,
  acs_level VARCHAR(255),
  clearance VARCHAR(255),
  seo_title VARCHAR(255) NOT NULL DEFAULT '',
  seo_desc TEXT NOT NULL DEFAULT '',
  featured BIGINT NOT NULL DEFAULT 0,
  order_index BIGINT NOT NULL DEFAULT 0,
  blocks_json TEXT NOT NULL DEFAULT '[]',
  editor_note TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE(type, slug)
);

CREATE TABLE IF NOT EXISTS content_translations (
  content_id VARCHAR(64) NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  locale VARCHAR(191) NOT NULL,
  title VARCHAR(255) NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (content_id, locale)
);

CREATE TABLE IF NOT EXISTS content_revisions (
  id VARCHAR(64) PRIMARY KEY,
  content_id VARCHAR(64) NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  at BIGINT NOT NULL,
  actor_id VARCHAR(64),
  snapshot_json TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS map_floors (
  id VARCHAR(64) PRIMARY KEY,
  label TEXT NOT NULL,
  level BIGINT NOT NULL,
  order_index BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS map_nodes (
  id VARCHAR(64) PRIMARY KEY,
  floor_id VARCHAR(64) NOT NULL,
  code VARCHAR(255) NOT NULL,
  label TEXT NOT NULL,
  kind VARCHAR(255) NOT NULL DEFAULT 'room',
  x DOUBLE NOT NULL,
  y DOUBLE NOT NULL,
  restricted BIGINT NOT NULL DEFAULT 0,
  clearance VARCHAR(255),
  wiki_slug VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS map_edges (
  id VARCHAR(64) PRIMARY KEY,
  from_node VARCHAR(64) NOT NULL,
  to_node VARCHAR(64) NOT NULL,
  kind VARCHAR(255) NOT NULL DEFAULT 'corridor',
  distance DOUBLE NOT NULL DEFAULT 1,
  restricted BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS servers (
  id VARCHAR(64) PRIMARY KEY,
  owner_id VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  host VARCHAR(255) NOT NULL,
  port BIGINT NOT NULL,
  region VARCHAR(255) NOT NULL DEFAULT '',
  tag VARCHAR(255) NOT NULL DEFAULT '',
  status VARCHAR(255) NOT NULL DEFAULT 'pending',
  maintenance BIGINT NOT NULL DEFAULT 0,
  current_players BIGINT NOT NULL DEFAULT 0,
  avg_players DOUBLE NOT NULL DEFAULT 0,
  max_players BIGINT NOT NULL DEFAULT 24,
  validated_at BIGINT,
  validated_by VARCHAR(64),
  last_online_at BIGINT,
  created_at BIGINT NOT NULL,
  deleted_at BIGINT
);

CREATE TABLE IF NOT EXISTS stat_entries (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64),
  display_name VARCHAR(255) NOT NULL,
  mode VARCHAR(255) NOT NULL DEFAULT 'story',
  operation_code VARCHAR(255) NOT NULL,
  ending_code VARCHAR(255),
  best_time_ms BIGINT,
  deaths BIGINT NOT NULL DEFAULT 0,
  reputation BIGINT NOT NULL DEFAULT 0,
  playtime_ms BIGINT NOT NULL DEFAULT 0,
  score DOUBLE NOT NULL DEFAULT 0,
  hidden BIGINT NOT NULL DEFAULT 0,
  verified_at BIGINT,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS ticket_messages (
  id VARCHAR(64) PRIMARY KEY,
  ticket_id VARCHAR(64) NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_id VARCHAR(64),
  author_label TEXT NOT NULL,
  body TEXT NOT NULL,
  internal BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS support_tickets (
  id VARCHAR(64) PRIMARY KEY,
  ref VARCHAR(191) UNIQUE NOT NULL,
  user_id VARCHAR(64),
  email VARCHAR(191) NOT NULL DEFAULT '',
  subject TEXT NOT NULL,
  category VARCHAR(255) NOT NULL DEFAULT 'other',
  status VARCHAR(255) NOT NULL DEFAULT 'open',
  priority VARCHAR(255) NOT NULL DEFAULT 'normal',
  assigned_to VARCHAR(64),
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS game_session_tickets (
  jti VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  server_id VARCHAR(255) NOT NULL,
  issued_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  used_at BIGINT
);

CREATE TABLE IF NOT EXISTS api_keys (
  kid VARCHAR(64) PRIMARY KEY,
  algorithm VARCHAR(255) NOT NULL DEFAULT 'Ed25519',
  public_key TEXT NOT NULL,
  private_key TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  revoked_at BIGINT
);

CREATE TABLE IF NOT EXISTS discord_interactions (
  id VARCHAR(64) PRIMARY KEY,
  received_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key VARCHAR(191) PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS backup_runs (
  id VARCHAR(64) PRIMARY KEY,
  at BIGINT NOT NULL,
  size_bytes BIGINT NOT NULL,
  sha256 TEXT NOT NULL,
  status VARCHAR(255) NOT NULL,
  verified_at BIGINT
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at BIGINT NOT NULL,
  ident_hash VARCHAR(255) NOT NULL,
  ip_hash VARCHAR(255) NOT NULL,
  success BIGINT NOT NULL,
  reason VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS notifications (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  kind VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  read_at BIGINT,
  created_at BIGINT NOT NULL
);
`;

export function schemaStatements(dialect: Dialect): string[] {
  const body = dialect === 'mysql' ? toMysql(STATEMENTS) : STATEMENTS;
  return body
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

/**
 * MySQL n'accepte ni `IF NOT EXISTS` sur les index, ni un défaut littéral sur
 * une colonne TEXT : les défauts sont convertis en défauts d'expression
 * (`DEFAULT ('…')`, MySQL ≥ 8.0.13, MariaDB ≥ 10.2).
 */
function toMysql(schema: string): string {
  return schema
    .split('\n')
    .map((line) => {
      let out = line.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY');
      if (/^\s+\w+ TEXT\b/.test(out)) {
        out = out.replace(/\bTEXT\b/, 'MEDIUMTEXT');
        out = out.replace(/DEFAULT ('(?:[^']|'')*')/, 'DEFAULT ($1)');
      }
      return out.replace(/CREATE INDEX IF NOT EXISTS/g, 'CREATE INDEX');
    })
    .join('\n');
}
