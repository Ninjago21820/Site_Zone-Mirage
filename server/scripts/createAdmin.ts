#!/usr/bin/env node
/**
 * Création du premier compte administrateur — `npm run admin:create`.
 *
 * Aucun compte n'est créé automatiquement au démarrage : cette commande est la
 * seule porte d'entrée du personnel sur une base neuve. Elle écrit dans la base
 * configurée par DATABASE_URL (MySQL/MariaDB) ou DB_PATH (SQLite local).
 *
 * Le compte est créé avec l'obligation d'enrôler la double authentification :
 * à la première connexion, l'écran d'enrôlement TOTP/passkey est imposé.
 */
import { stdin, stdout } from 'node:process';
import { openDb } from '../db.js';
import { mirageIdFor, newId } from '../lib/ids.js';
import { evaluatePassword, hashPassword } from '../lib/password.js';
import { appendAudit } from '../lib/audit.js';

function fail(message: string): never {
  console.error(`\n  Erreur : ${message}\n`);
  process.exit(1);
}

/**
 * Lecture ligne par ligne sur stdin : un seul écouteur, sans `readline`, pour
 * que la saisie masquée du mot de passe ne perde jamais les lignes déjà reçues
 * (pipe, terminal, saisie collée d'un coup). Aucun écho en mode secret.
 */
function createReader() {
  const queued: string[] = [];
  let current = '';
  let secretMode = false;
  let active: ((line: string) => void) | null = null;

  stdin.on('data', (chunk: Buffer) => {
    for (const char of chunk.toString('utf8')) {
      if (char === '\u0003') {
        stdout.write('\n');
        process.exit(130);
      }
      if (char === '\r' || char === '\n') {
        const line = current;
        current = '';
        if (active) {
          const resolve = active;
          active = null;
          resolve(line);
        } else {
          queued.push(line);
        }
        continue;
      }
      if (char === '\u007f' || char === '\b') {
        if (current.length > 0) {
          current = current.slice(0, -1);
          if (!secretMode) stdout.write('\b \b');
        }
        continue;
      }
      if (char === '\u0004') continue;
      current += char;
      if (!secretMode) stdout.write(char);
    }
  });
  if (stdin.isTTY) stdin.setRawMode?.(true);
  stdin.resume();

  return function ask(question: string, secret = false): Promise<string> {
    stdout.write(question);
    secretMode = secret;
    const settle = (line: string): string => {
      secretMode = false;
      if (secret) stdout.write('\n');
      return line.trim();
    };
    const buffered = queued.shift();
    if (buffered !== undefined) return Promise.resolve(settle(buffered));
    return new Promise<string>((resolve) => {
      active = (line) => resolve(settle(line));
    });
  };
}

const ask = createReader();

async function askConfirmed(question: string): Promise<string> {
  const first = await ask(question, true);
  const second = await ask('Confirmez le mot de passe : ', true);
  if (first !== second) fail('les deux mots de passe ne correspondent pas.');
  return first;
}

async function main() {
  console.log('\n=== SCP: Mirage Protocol — création d’un administrateur ===\n');

  const db = await openDb();
  console.log(`Base : ${db.dialect === 'mysql' ? 'MySQL/MariaDB (DATABASE_URL)' : 'SQLite (DB_PATH)'}\n`);

  const username = await ask('Pseudonyme (3–20 caractères, [A-Za-z0-9_-]) : ');
  if (!/^[A-Za-z0-9_-]{3,20}$/.test(username)) fail('pseudonyme invalide.');

  const email = (await ask('Adresse e-mail : ')).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('adresse e-mail invalide.');

  const existing = await db.get('SELECT id FROM users WHERE lower(username) = lower(?) OR lower(email) = lower(?)', [username, email]);
  if (existing) fail('un compte utilise déjà ce pseudonyme ou cette adresse e-mail.');

  const password = await askConfirmed('Mot de passe (14 caractères minimum) : ');
  const policy = await evaluatePassword(password, { staff: true, identifiers: [username, email] });
  if (!policy.ok) fail(`mot de passe refusé : ${policy.issues.join(', ')} (minimum ${policy.minLength} caractères).`);

  const now = Date.now();
  const mirageId = await mirageIdFor(db, now);
  const hash = await hashPassword(password);

  await db.run(
    `INSERT INTO users (id,mirage_id,username,email,password_hash,role,status,email_verified,locale,
       profile_public,show_socials,socials_json,bio,totp_secret,webauthn_required,backup_codes_left,
       failed_count,fail_window_start,last_failed_at,reauth_at,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [newId('usr'), mirageId, username, email, hash, 'admin', 'active', 1, 'fr', 0, 0, '{}', '',
      null, 1, 10, 0, 0, 0, 0, now, now],
  );

  await appendAudit(db, {
    actorId: null,
    actorRole: 'system',
    action: 'user.admin_created',
    targetType: 'user',
    targetId: username,
    ipTrunc: null,
    meta: { via: 'cli', mirageId },
  });

  console.log(`\n  Administrateur créé : ${username} (${mirageId})`);
  console.log('  Double authentification : enrôlement obligatoire à la première connexion.');
  console.log('  Back-office : /console-mirage\n');

  await db.close();
}

main().catch((error: unknown) => {
  console.error('\n  Échec :', (error as Error).message, '\n');
  process.exit(1);
});
