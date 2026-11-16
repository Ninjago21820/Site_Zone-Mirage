/**
 * Backup + restore verification — §6.11 / criterion #10
 *
 * Usage:
 *   npm run backup:verify            # verify the most recent backup (creates one if none)
 *   npm run backup:verify -- --create   # always create a fresh backup, then verify it
 *   npm run backup:verify -- --file <path>
 *
 * Exit code 0 only when decryption, checksum, SQLite integrity and every
 * critical table check out.
 */
import path from 'node:path';
import fs from 'node:fs';
import { openDb, seed } from '../db.js';
import { createBackup, verifyBackup, latestBackup } from '../lib/backup.js';
import { BACKUP_DIR } from '../config.js';

const args = process.argv.slice(2);
const wantsCreate = args.includes('--create');
const fileIndex = args.indexOf('--file');
const explicitFile = fileIndex !== -1 ? args[fileIndex + 1] : null;

const line = (label: string, ok: boolean, detail?: string) =>
  `${ok ? '  OK  ' : ' FAIL '} ${label.padEnd(22)} ${detail ?? ''}`;

async function main() {
  console.log('\n=== SCP: Mirage Protocol — vérification de sauvegarde ===\n');
  console.log(`Dossier : ${BACKUP_DIR}`);

  let target = explicitFile;
  if (!target && (wantsCreate || !latestBackup())) {
    const db = openDb();
    await seed(db);
    const result = createBackup(db, BACKUP_DIR, 'verify');
    db.close();
    target = result.file;
    console.log(`Sauvegarde créée : ${path.basename(result.file)} (${(result.sizeBytes / 1024).toFixed(1)} Ko)`);
  }

  if (!target) target = latestBackup();
  if (!target || !fs.existsSync(target)) {
    console.error('\nAucune sauvegarde trouvée. Lancez avec --create.\n');
    process.exit(1);
  }

  console.log(`Cible   : ${path.basename(target)}\n`);
  const verification = verifyBackup(target);
  for (const check of verification.checks) {
    console.log(line(check.name, check.ok, check.detail));
  }

  if (verification.tables) {
    const entries = Object.entries(verification.tables).sort(([a], [b]) => a.localeCompare(b));
    console.log('\nTables restaurées :');
    for (const [name, count] of entries) console.log(`  ${name.padEnd(26)} ${String(count).padStart(6)} lignes`);
  }

  console.log(`\nRésultat : ${verification.ok ? 'SUCCÈS — restauration vérifiée' : 'ÉCHEC — sauvegarde non restaurable'}\n`);
  process.exit(verification.ok ? 0 : 1);
}

main().catch((error) => {
  console.error('Erreur inattendue :', error);
  process.exit(1);
});
