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
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { openDb } from '../db.js';
import { mirageIdFor, newId } from '../lib/ids.js';
import { evaluatePassword, hashPassword } from '../lib/password.js';
import { appendAudit } from '../lib/audit.js';

const rl = readline.createInterface({ input: stdin, output: stdout });

function fail(message: string): never {
  console.error(`\n  Erreur : ${message}\n`);
  rl.close();
  process.exit(1);
}

async function ask(question: string, options: { silent?: boolean } = {}): Promise<string> {
  if (!options.silent) return (await rl.question(question)).trim();
  // Saisie masquée pour les mots de passe.
  return new Promise<string>((resolve) => {
    const onData = (char: Buffer) => {
      const text = char.toString();
      if (text === '\n' || text === '\r' || text === '\u0004') {
        stdin.setRawMode?.(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        stdout.write('\n');
        resolve(value);
      } else if (text === '\u0003') {
        stdout.write('\n');
        process.exit(130);
      } else if (text === '\u007f') {
        if (value.length) {
          value = value.slice(0, -1);
          stdout.write('\b \b');
        }
      } else {
        value += text;
        stdout.write('*');
      }
    };
    let value = '';
    stdout.write(question);
    stdin.resume();
    stdin.setRawMode?.(true);
    stdin.on('data', onData);
  });
}

async function askConfirmed(question: string): Promise<string> {
  const first = await ask(question, { silent: true });
  const second = await ask('Confirmez le mot de passe : ', { silent: true });
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
  rl.close();
}

main().catch((error: unknown) => {
  console.error('\n  Échec :', (error as Error).message, '\n');
  process.exit(1);
});
