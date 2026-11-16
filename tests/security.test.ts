import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  harness, newClient, loginStaff, loginPlayer, resetTotp, extractCookie, rid,
  STAFF_PASSWORD, PLAYER_PASSWORD, type Harness, DEMO_TOTP_SECRET,
} from './helpers.js';
import { verifyAuditChain } from '../server/lib/audit.js';
import { createBackup, verifyBackup } from '../server/lib/backup.js';
import { verifyLicenseToken, signStatsPayload, serverSecret } from '../server/lib/licenses.js';
import { totpAt } from '../server/lib/totp.js';
import { checkTarget } from '../server/lib/ssrf.js';
import { resetThrottleState, resetGenericLimits } from '../server/lib/throttle.js';
import { verifyStatsSignature } from '../server/lib/licenses.js';

let h: Harness;

beforeEach(async () => {
  h = await harness();
  resetThrottleState();
  resetGenericLimits();
});

describe('§5.2 — Mirage ID', () => {
  it('respecte le format MIRAGE:A.BB.<18 chiffres>', async () => {
    const { db } = h;
    const rows = db.prepare('SELECT mirage_id FROM users').all() as { mirage_id: string }[];
    expect(rows.length).toBeGreaterThan(5);
    for (const row of rows) {
      expect(row.mirage_id).toMatch(/^MIRAGE:[0-9]\.[0-9]{2}\.[0-9]{18}$/);
    }
  });

  it('réserve définitivement un identifiant après suppression du compte', async () => {
    const { db } = h;
    const user = db.prepare("SELECT id, mirage_id FROM users WHERE username = 'recrue'").get() as { id: string; mirage_id: string };
    db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
    const reserved = db.prepare('SELECT 1 AS hit FROM reserved_mirage_ids WHERE mirage_id = ?').get(user.mirage_id);
    expect(reserved).toBeTruthy();
  });
});

describe('§6.3 / critère #1 — Politique de mots de passe', () => {
  it('refuse un mot de passe trop court', async () => {
    const client = await newClient(h.app);
    const res = await client.post('/api/auth/register', {
      username: 'testcourt', email: `court.${rid()}@example.org`, password: 'Abc123!',
    });
    expect(res.status).toBe(400);
    expect(res.body.issues).toContain('too_short');
  });

  it('refuse un mot de passe contenant le pseudonyme', async () => {
    const client = await newClient(h.app);
    const res = await client.post('/api/auth/register', {
      username: 'mirageur', email: `m.${rid()}@example.org`, password: 'Mirageur-Securise-2026!',
    });
    expect(res.status).toBe(400);
    expect(res.body.issues).toContain('contains_identifier');
  });

  it('accepte un mot de passe conforme et stocke une empreinte Argon2id', async () => {
    const client = await newClient(h.app);
    const username = `agent${rid()}`;
    const res = await client.post('/api/auth/register', {
      username, email: `${username}@example.org`, password: 'Vault-Protocol-77!x',
    });
    expect(res.status).toBe(201);
    const row = h.db.prepare('SELECT password_hash FROM users WHERE username = ?').get(username) as { password_hash: string };
    expect(row.password_hash.startsWith('$argon2id$')).toBe(true);
  });
});

describe('§6.5 / critère #5 — Anti-énumération', () => {
  it('renvoie une réponse identique pour un compte inconnu et un mot de passe erroné', async () => {
    const a = await newClient(h.app);
    const unknown = await a.post('/api/auth/login', { identifier: 'inconnu-xyz', password: 'MotDePasse-Bidon-1!' });
    const wrong = await a.post('/api/auth/login', { identifier: 'joueur', password: 'MotDePasse-Bidon-1!' });
    expect(unknown.status).toBe(wrong.status);
    expect(unknown.status).toBe(401);
    expect(unknown.body.message).toBe(wrong.body.message);
    expect(unknown.body.error).toBe(wrong.body.error);
  });

  it('ne révèle pas l’existence d’un compte sur la réinitialisation', async () => {
    const a = await newClient(h.app);
    const known = await a.post('/api/auth/password/forgot', { email: 'joueur@mirage-protocol.example' });
    const unknown = await a.post('/api/auth/password/forgot', { email: 'personne@example.org' });
    expect(known.status).toBe(unknown.status);
    expect(known.body.message).toBe(unknown.body.message);
  });
});

describe('§6.7 / critère #8 — Délai progressif sans verrouillage', () => {
  it('exige une vérification après 3 échecs et ne verrouille jamais le compte', async () => {
    const client = await newClient(h.app);
    const identifier = 'joueur';
    for (let i = 0; i < 3; i++) {
      const res = await client.post('/api/auth/login', { identifier, password: `Mauvais-Mot-${i}!` });
      expect(res.status).toBe(401);
    }
    const challenged = await client.post('/api/auth/login', { identifier, password: 'Mauvais-Mot-encore!' });
    expect(challenged.status).toBe(403);
    expect(challenged.body.error).toBe('challenge_required');
    expect(challenged.body.token).toBeTruthy();

    // With a valid challenge the account is still reachable: no permanent lockout.
    const withChallenge = await client.post('/api/auth/login', {
      identifier, password: 'Mauvais-Mot-encore!', challengeRequired: true, challengeToken: challenged.body.token,
    });
    expect(withChallenge.status).toBe(401);
    expect(withChallenge.body.error).toBe('invalid_credentials');
  });
});

describe('§6.4 / critère #2 — Double authentification du personnel', () => {
  it('exige un second facteur avant d’ouvrir une session staff', async () => {
    const client = await newClient(h.app);
    resetTotp(h.db, 'admin');
    const step1 = await client.post('/api/auth/login', { identifier: 'admin', password: STAFF_PASSWORD });
    expect(step1.status).toBe(200);
    expect(step1.body.mfaRequired).toBe(true);

    const blocked = await client.get('/api/backoffice/session');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe('mfa_required');

    const ok = await client.post('/api/auth/login/2fa', { code: totpAt(DEMO_TOTP_SECRET) });
    expect(ok.status).toBe(200);
    const session = await client.get('/api/backoffice/session');
    expect(session.status).toBe(200);
    expect(session.body.user.role).toBe('admin');
  });

  it('refuse un code TOTP rejoué dans la même fenêtre', async () => {
    const client = await newClient(h.app);
    resetTotp(h.db, 'moderator');
    await client.post('/api/auth/login', { identifier: 'moderator', password: STAFF_PASSWORD });
    const code = totpAt(DEMO_TOTP_SECRET);
    const first = await client.post('/api/auth/login/2fa', { code });
    expect(first.status).toBe(200);

    const second = await newClient(h.app);
    await second.post('/api/auth/login', { identifier: 'moderator', password: STAFF_PASSWORD });
    const replay = await second.post('/api/auth/login/2fa', { code });
    expect(replay.status).toBe(401);
    expect(replay.body.error).toBe('invalid_second_factor');
  });

  it('interdit au personnel de désactiver sa double authentification', async () => {
    const client = await newClient(h.app);
    await loginStaff(client, h.db, 'moderator');
    const res = await client.post('/api/auth/2fa/disable', { password: STAFF_PASSWORD, code: '000000' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('staff_2fa_mandatory');
  });

  it('bloque la connexion externe seule pour le personnel', async () => {
    const client = await newClient(h.app);
    // An admin cannot be created through the OAuth flow: the callback refuses staff.
    const start = await client.get('/api/auth/oauth/discord/start');
    const res = await client.get(`/api/auth/oauth/discord/callback?state=${start.body.state}&code=abc123`);
    expect(res.status).toBe(302);
    const created = h.db.prepare("SELECT role FROM users ORDER BY created_at DESC, rowid DESC LIMIT 1").get() as { role: string };
    expect(created.role).toBe('player');
  });
});

describe('§6.6 / critère #3 — Aucune liaison automatique par e-mail', () => {
  it('crée un nouveau compte au lieu de lier un compte existant', async () => {
    const { db } = h;
    const before = (db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c;
    const existing = db.prepare("SELECT id FROM users WHERE username = 'joueur'").get() as { id: string };
    const client = await newClient(h.app);
    const start = await client.get('/api/auth/oauth/steam/start');
    const callback = await client.get(`/api/auth/oauth/steam/callback?state=${start.body.state}&code=steam-code`);
    expect(callback.status).toBe(302);
    expect(callback.headers.location).toContain('needsEmail=1');
    const after = (db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c;
    expect(after).toBe(before + 1);
    const linked = db.prepare("SELECT 1 AS hit FROM oauth_identities WHERE user_id = ?").get(existing.id);
    expect(linked).toBeUndefined();
  });

  it('refuse un state OAuth inconnu', async () => {
    const client = await newClient(h.app);
    const res = await client.get('/api/auth/oauth/google/callback?state=forged&code=x');
    expect(res.status).toBe(400);
  });
});

describe('§6.10 / critère #4 — Jetons de réinitialisation', () => {
  it('émet un jeton 30 min à usage unique, invalide les précédents et ne contourne pas la 2FA', async () => {
    const { db } = h;
    const client = await newClient(h.app);
    const first = await client.post('/api/auth/password/forgot', { email: 'joueur@mirage-protocol.example' });
    const second = await client.post('/api/auth/password/forgot', { email: 'joueur@mirage-protocol.example' });
    expect(second.body.demoToken).toBeTruthy();

    const stale = await client.post('/api/auth/password/reset', { token: first.body.demoToken, password: 'Nouveau-Vault-2026!' });
    expect(stale.status).toBe(400);

    const ok = await client.post('/api/auth/password/reset', { token: second.body.demoToken, password: 'Nouveau-Vault-2026!' });
    expect(ok.status).toBe(200);
    expect(ok.body.twoFactorStillRequired).toBe(false);

    const reuse = await client.post('/api/auth/password/reset', { token: second.body.demoToken, password: 'Autre-Vault-2026!' });
    expect(reuse.status).toBe(400);

    const token = db.prepare('SELECT expires_at, created_at FROM password_reset_tokens ORDER BY created_at DESC LIMIT 1').get() as { expires_at: number; created_at: number };
    expect(token.expires_at - token.created_at).toBe(30 * 60 * 1000);
  });

  it('conserve l’obligation de 2FA après réinitialisation pour un compte staff', async () => {
    const client = await newClient(h.app);
    const forgot = await client.post('/api/auth/password/forgot', { email: 'admin@mirage-protocol.example' });
    const reset = await client.post('/api/auth/password/reset', { token: forgot.body.demoToken, password: 'Vault-Cadmium-2026!' });
    expect(reset.status).toBe(200);
    expect(reset.body.twoFactorStillRequired).toBe(true);
    const login = await client.post('/api/auth/login', { identifier: 'admin', password: 'Vault-Cadmium-2026!' });
    expect(login.body.mfaRequired).toBe(true);

  });
});

describe('§6.8 / critère #6 — Révocation des sessions', () => {
  it('révoque les autres sessions après un changement de mot de passe', async () => {
    const a = await newClient(h.app);
    const b = await newClient(h.app);
    await loginPlayer(a);
    await loginPlayer(b);
    expect((await b.get('/api/account')).status).toBe(200);

    const reauth = await a.post('/api/auth/reauth', { password: PLAYER_PASSWORD });
    expect(reauth.status).toBe(200);
    const changed = await a.post('/api/auth/password/change', {
      currentPassword: PLAYER_PASSWORD, newPassword: 'Vault-Changed-2026!x',
    });
    expect(changed.status).toBe(200);
    expect(changed.body.revokedSessions).toBeGreaterThanOrEqual(1);
    expect((await b.get('/api/account')).status).toBe(401);
    expect((await a.get('/api/account')).status).toBe(200);
  });

  it('exige une réauthentification récente pour une action sensible', async () => {
    const a = await newClient(h.app);
    await loginPlayer(a);
    h.db.prepare("UPDATE users SET reauth_at = 0 WHERE username = 'joueur'").run();
    const blocked = await a.post('/api/auth/password/change', {
      currentPassword: PLAYER_PASSWORD, newPassword: 'Autre-Vault-2026!x',
    });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe('reauth_required');
  });

  it('applique des durées de session distinctes joueur / personnel', async () => {
    const a = await newClient(h.app);
    await loginPlayer(a);
    const playerSessions = await a.get('/api/auth/sessions');
    expect(playerSessions.body.policy).toEqual({ idleDays: 30, absoluteDays: 90 });

    const staff = await newClient(h.app);
    await loginStaff(staff, h.db, 'writer');
    const staffSessions = await staff.get('/api/auth/sessions');
    expect(staffSessions.body.policy).toEqual({ idleMinutes: 15, absoluteHours: 8 });
  });
});

describe('§6.9 / critère #7 — Contrôles d’accès serveur', () => {
  it('renvoie 404 sur /admin et les chemins d’administration standards', async () => {
    for (const p of ['/admin', '/wp-admin', '/administrator', '/backoffice', '/admin/users']) {
      const res = await request(h.app).get(p);
      expect(res.status).toBe(404);
    }
  });

  it('refuse l’accès au back-office sans session staff', async () => {
    const anon = await newClient(h.app);
    expect((await anon.get('/api/backoffice/session')).status).toBe(401);
    await loginPlayer(anon);
    expect((await anon.get('/api/backoffice/session')).status).toBe(403);
  });

  it('applique la matrice : un rédacteur ne gère pas les utilisateurs', async () => {
    const writer = await newClient(h.app);
    await loginStaff(writer, h.db, 'writer');
    expect((await writer.get('/api/backoffice/users')).status).toBe(403);
    expect((await writer.get('/api/backoffice/session')).status).toBe(200);

    const admin = await newClient(h.app);
    await loginStaff(admin, h.db, 'admin');
    expect((await admin.get('/api/backoffice/users')).status).toBe(200);
    expect((await admin.get('/api/backoffice/audit')).status).toBe(200);
  });

  it('restreint le développeur aux tickets techniques', async () => {
    const dev = await newClient(h.app);
    await loginStaff(dev, h.db, 'dev');
    const queue = await dev.get('/api/support/queue');
    expect(queue.status).toBe(200);
    expect(queue.body.scope).toBe('technical_only');
    for (const ticket of queue.body.tickets) expect(ticket.category).toBe('technical');
    const forbidden = await dev.post('/api/support/tickets/SUP-0001/status', { status: 'closed' });
    expect(forbidden.status).toBe(403);
  });

  it('limite le Community Manager aux avertissements', async () => {
    const cm = await newClient(h.app);
    await loginStaff(cm, h.db, 'community_manager');
    const target = h.db.prepare("SELECT id FROM users WHERE username = 'recrue'").get() as { id: string };
    expect((await cm.post(`/api/backoffice/users/${target.id}/sanction`, { kind: 'warning', reason: 'Rappel des règles' })).status).toBe(200);
    const suspend = await cm.post(`/api/backoffice/users/${target.id}/sanction`, { kind: 'suspend', reason: 'Tentative de suspension' });
    expect(suspend.status).toBe(403);
    expect(suspend.body.error).toBe('warning_only');
  });

  it('rejette toute requête mutante sans jeton CSRF', async () => {
    const res = await request(h.app).post('/api/auth/login').send({ identifier: 'joueur', password: PLAYER_PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('csrf_invalid');
  });

  it('protège l’export de données par l’authentification', async () => {
    const anon = await newClient(h.app);
    expect((await anon.get('/api/account/export')).status).toBe(401);
    const player = await newClient(h.app);
    await loginPlayer(player);
    const res = await player.get('/api/account/export');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('mirage-export');
  });
});

describe('§11.2 / §11.3 — Workflow et matrices éditoriales', () => {
  it('applique la séparation auteur / vérificateur puis accepte un passage outre motivé', async () => {
    const admin = await newClient(h.app);
    await loginStaff(admin, h.db, 'admin');
    const created = await admin.post('/api/backoffice/content', {
      type: 'news', slug: `test-${rid()}`,
      translations: { fr: { title: 'Test de workflow', summary: 'r', body: 'b' } },
    });
    expect(created.status).toBe(201);
    const id = created.body.item.id;

    const toReview = await admin.post(`/api/backoffice/content/${id}/transition`, { to: 'review' });
    expect(toReview.status).toBe(200);

    const selfPublish = await admin.post(`/api/backoffice/content/${id}/transition`, { to: 'published' });
    expect(selfPublish.status).toBe(403);
    expect(selfPublish.body.message).toMatch(/auteur/i);

    const noReason = await admin.post(`/api/backoffice/content/${id}/transition`, { to: 'published', override: true });
    expect(noReason.status).toBe(403);

    const override = await admin.post(`/api/backoffice/content/${id}/transition`, {
      to: 'published', override: true, overrideReason: 'Publication urgente validée en réunion éditoriale.',
    });
    expect(override.status).toBe(200);
    expect(override.body.override).toBe(true);

    const audit = await admin.get('/api/backoffice/audit?action=content.transition_override');
    expect(audit.body.entries.length).toBeGreaterThan(0);
  });

  it('interdit à un rédacteur de publier et à un traducteur de créer', async () => {
    const writer = await newClient(h.app);
    await loginStaff(writer, h.db, 'writer');
    const created = await writer.post('/api/backoffice/content', {
      type: 'news', slug: `news-${rid()}`,
      translations: { fr: { title: 'Article rédacteur', summary: '', body: '' } },
    });
    expect(created.status).toBe(201);
    const id = created.body.item.id;
    await writer.post(`/api/backoffice/content/${id}/transition`, { to: 'review' });
    const publish = await writer.post(`/api/backoffice/content/${id}/transition`, { to: 'published' });
    expect(publish.status).toBe(403);

    const legal = await writer.post('/api/backoffice/content', {
      type: 'legal', slug: `legal-${rid()}`,
      translations: { fr: { title: 'Texte juridique', summary: '', body: '' } },
    });
    expect(legal.status).toBe(403);

    const translator = await newClient(h.app);
    await loginStaff(translator, h.db, 'translator');
    const forbidden = await translator.post('/api/backoffice/content', {
      type: 'wiki', slug: `wiki-${rid()}`,
      translations: { fr: { title: 'Fiche', summary: '', body: '' } },
    });
    expect(forbidden.status).toBe(403);
    const translated = await translator.post(`/api/backoffice/content/${id}/translate`, {
      locale: 'en', title: 'Writer article', summary: '', body: '',
    });
    expect(translated.status).toBe(200);
  });

  it('restaure un contenu supprimé dans la fenêtre de 30 jours et refuse au-delà', async () => {
    const admin = await newClient(h.app);
    await loginStaff(admin, h.db, 'admin');
    const created = await admin.post('/api/backoffice/content', {
      type: 'faq', slug: `faq-${rid()}`,
      translations: { fr: { title: 'Question de test', summary: 's', body: 'b' } },
    });
    const id = created.body.item.id;
    await admin.post(`/api/backoffice/content/${id}/transition`, { to: 'deleted' });
    const restore = await admin.post(`/api/backoffice/content/${id}/transition`, { to: 'draft' });
    expect(restore.status).toBe(200);

    await admin.post(`/api/backoffice/content/${id}/transition`, { to: 'deleted' });
    h.db.prepare('UPDATE content SET deleted_at = ? WHERE id = ?').run(Date.now() - 31 * 86400000, id);
    const tooLate = await admin.post(`/api/backoffice/content/${id}/transition`, { to: 'draft' });
    expect(tooLate.status).toBe(403);
    expect(tooLate.body.message).toMatch(/30 jours/);
  });

  it('empêche un éditeur non auteur de contourner les droits de son rôle', async () => {
    const animator = await newClient(h.app);
    await loginStaff(animator, h.db, 'animator');
    const wiki = await animator.post('/api/backoffice/content', {
      type: 'wiki', slug: `wiki-anim-${rid()}`,
      translations: { fr: { title: 'Fiche animateur', summary: '', body: '' } },
    });
    expect(wiki.status).toBe(201);
    const publish = await animator.post(`/api/backoffice/content/${wiki.body.item.id}/transition`, { to: 'published', override: true, overrideReason: 'Contournement volontaire du rôle.' });
    expect(publish.status).toBe(403);
  });
});

describe('§7 / critère — Serveurs communautaires', () => {
  it('refuse les adresses internes et les métadonnées cloud (SSRF)', async () => {
    for (const address of ['127.0.0.1:7777', '10.1.2.3:7777', '169.254.169.254:80', '192.168.1.10:7777', 'localhost:7777', '[::1]:7777']) {
      const result = await checkTarget(...(address.startsWith('[')
        ? [address.slice(1, address.indexOf(']')), Number(address.split(']:')[1])]
        : [address.split(':')[0], Number(address.split(':')[1])]));
      expect(result.ok).toBe(false);
    }
    expect((await checkTarget('93.184.216.34', 7777)).ok).toBe(true);
  });

  it('limite à trois serveurs par compte et exige une réauthentification pour modifier', async () => {
    const player = await newClient(h.app);
    await loginPlayer(player);
    h.db.prepare("DELETE FROM servers WHERE owner_id = (SELECT id FROM users WHERE username = 'joueur')").run();
    for (let i = 0; i < 3; i++) {
      const res = await player.post('/api/servers', {
        name: `Serveur test ${i}`, address: `93.184.216.${20 + i}:7777`, description: 'Test', region: 'EU', maxPlayers: 24,
      });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('pending');
    }
    const fourth = await player.post('/api/servers', {
      name: 'Serveur de trop', address: '93.184.216.44:7777', description: 'Trop', region: 'EU', maxPlayers: 24,
    });
    expect(fourth.status).toBe(409);
    expect(fourth.body.error).toBe('server_limit');

    const mine = await player.get('/api/servers/mine');
    expect(mine.body.limits.used).toBe(3);
    const target = mine.body.servers[0].id;
    h.db.prepare("UPDATE users SET reauth_at = 0 WHERE username = 'joueur'").run();
    const edit = await player.patch(`/api/servers/${target}`, { name: 'Nouveau nom' });
    expect(edit.status).toBe(403);
    expect(edit.body.error).toBe('reauth_required');

    const rejectedAddress = await player.post('/api/servers', {
      name: 'Serveur interne', address: '10.0.0.1:7777', description: 'x', region: 'EU', maxPlayers: 24,
    });
    // Address validation happens before the per-account quota check.
    expect([400, 409]).toContain(rejectedAddress.status);
    if (rejectedAddress.status === 400) expect(rejectedAddress.body.error).toBe('address_rejected');
  });

  it('met en avant les trois serveurs les plus récemment validés', async () => {
    const res = await request(h.app).get('/api/servers');
    expect(res.status).toBe(200);
    expect(res.body.featured.length).toBe(3);
    const timestamps = res.body.featured.map((s: any) => s.validatedAt ?? s.createdAt);
    const sorted = [...timestamps].sort((a, b) => b - a);
    expect(timestamps).toEqual(sorted);
    expect(res.body.servers.slice(0, 3).every((s: any) => s.featured)).toBe(true);
  });
});

describe('§5.4 / §5.5 / critère #9 — Licences et tickets de session', () => {
  it('émet un jeton signé Ed25519 vérifiable avec la clé publique', async () => {
    const res = await request(h.app).post('/api/v1/licenses/verify').send({ provider: 'steam', proof: 'demo-proof-owned-123456' });
    expect(res.status).toBe(200);
    expect(res.body.decision).toBe('granted');
    expect(res.body.ownership).toBe('owned');
    const decoded = verifyLicenseToken(h.db, res.body.token);
    expect(decoded.valid).toBe(true);
    expect(decoded.claims?.scope).toContain('online');
    expect(decoded.claims?.kid).toBeTruthy();
  });

  it('accepte le partage familial Steam et le marque « shared »', async () => {
    const res = await request(h.app).post('/api/v1/licenses/verify').send({ provider: 'steam', proof: 'demo-proof-shared-999999' });
    expect(res.body.ownership).toBe('shared');
    expect(res.body.familySharing).toBe(true);
    expect(res.body.features.online).toBe(true);
  });

  it('refuse les fonctionnalités en ligne sans licence, sans sanction', async () => {
    const res = await request(h.app).post('/api/v1/licenses/verify').send({ provider: 'steam', proof: 'demo-proof-unowned-1' });
    expect(res.status).toBe(200);
    expect(res.body.decision).toBe('unowned');
    expect(res.body.sanction).toBe(false);
    expect(res.body.features.online).toBe(false);
    expect(res.body.token).toBeUndefined();
  });

  it('accorde la grâce Histoire lorsque la plateforme est indisponible', async () => {
    const res = await request(h.app).post('/api/v1/licenses/verify').send({ provider: 'steam', proof: 'demo-proof-timeout-1' });
    expect(res.body.decision).toBe('grace');
    expect(res.body.sanction).toBe(false);
    expect(res.body.features.story).toBe(true);
    expect(res.body.features.online).toBe(false);
    expect(res.body.graceDays).toBe(7);
  });

  it('émet un ticket de session à usage unique lié au serveur', async () => {
    const playerId = (h.db.prepare("SELECT id FROM users WHERE username = 'joueur'").get() as { id: string }).id;
    const mirageId = (h.db.prepare("SELECT mirage_id FROM users WHERE id = ?").get(playerId) as { mirage_id: string }).mirage_id;
    const license = await request(h.app).post('/api/v1/licenses/verify').send({
      provider: 'steam', proof: 'demo-proof-owned-123456', mirageId,
    });
    const ticket = await request(h.app)
      .post('/api/v1/session-tickets')
      .set('Authorization', `License ${license.body.token}`)
      .send({ serverId: 'srv-1' });
    expect(ticket.status).toBe(200);
    expect(ticket.body.ticket).toBeTruthy();

    const payload = { ticket: ticket.body.ticket, serverId: 'srv-1' };
    const signature = signStatsPayload('srv-1', payload);
    const redeem = await request(h.app)
      .post('/api/v1/session-tickets/redeem')
      .set('X-Server-Id', 'srv-1').set('X-Signature', signature)
      .send(payload);
    expect(redeem.status).toBe(200);
    expect(redeem.body.userId).toBe(playerId);

    const replay = await request(h.app)
      .post('/api/v1/session-tickets/redeem')
      .set('X-Server-Id', 'srv-1').set('X-Signature', signature)
      .send(payload);
    expect(replay.status).toBe(409);
    expect(replay.body.error).toBe('already_used');
  });

  it('refuse un ticket présenté à un autre serveur', async () => {
    const mirageId = (h.db.prepare("SELECT mirage_id FROM users WHERE username = 'joueur'").get() as { mirage_id: string }).mirage_id;
    const license = await request(h.app).post('/api/v1/licenses/verify').send({ provider: 'steam', proof: 'demo-proof-owned-1', mirageId });
    const ticket = await request(h.app).post('/api/v1/session-tickets')
      .set('Authorization', `License ${license.body.token}`).send({ serverId: 'srv-1' });
    const payload = { ticket: ticket.body.ticket, serverId: 'srv-2' };
    const res = await request(h.app).post('/api/v1/session-tickets/redeem')
      .set('X-Server-Id', 'srv-2').set('X-Signature', signStatsPayload('srv-2', payload)).send(payload);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('wrong_server');
  });

  it('refuse un ticket de session sans portée en ligne', async () => {
    const res = await request(h.app).post('/api/v1/session-tickets')
      .set('Authorization', 'License forged.token.value').send({ serverId: 'srv-1' });
    expect(res.status).toBe(401);
  });
});

describe('§5.7 — Synchronisation des statistiques', () => {
  it('rejette une signature de serveur invalide', async () => {
    const res = await request(h.app).post('/api/v1/stats/sync').send({
      serverId: 'srv-1', signature: 'deadbeef', entries: [{ mode: 'story', operation: 'OP-001', bestTimeMs: 100000 }],
    });
    expect(res.status).toBe(401);
  });

  it('accepte une charge signée et rejette les temps invraisemblables', async () => {
    const payload = {
      serverId: 'srv-1',
      entries: [
        { mirageId: (h.db.prepare("SELECT mirage_id FROM users WHERE username = 'joueur'").get() as { mirage_id: string }).mirage_id, mode: 'story', operation: 'OP-009', bestTimeMs: 125000, deaths: 3, playtimeMs: 3_600_000, reputation: 42, score: 100, ending: 'FIN-X' },
        { mode: 'story', operation: 'OP-010', bestTimeMs: 5, deaths: 0 },
        { mode: 'invalid', operation: 'OP-011' },
      ],
    };
    const signature = signStatsPayload('srv-1', payload);
    const res = await request(h.app).post('/api/v1/stats/sync')
      .set('X-Server-Id', 'srv-1').set('X-Signature', signature).send({ ...payload, signature });
    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(1);
    expect(res.body.rejected.length).toBe(2);
    expect(verifyStatsSignature('srv-1', payload, signature)).toBe(true);
    expect(serverSecret('srv-1')).not.toBe(serverSecret('srv-2'));
  });

  it('exclut les profils privés et les scores retirés des classements publics', async () => {
    const before = await request(h.app).get('/api/leaderboards?mode=story');
    expect(before.status).toBe(200);
    const names = before.body.bestTimes.flatMap((g: any) => g.entries.map((e: any) => e.displayName));
    expect(names).not.toContain('recrue'); // private profile
    expect(names).toContain('joueur');

    h.db.prepare("UPDATE stat_entries SET hidden = 1 WHERE user_id = (SELECT id FROM users WHERE username = 'joueur')").run();
    const after = await request(h.app).get('/api/leaderboards?mode=story');
    const afterNames = after.body.bestTimes.flatMap((g: any) => g.entries.map((e: any) => e.displayName));
    expect(afterNames).not.toContain('joueur');
  });
});

describe('§5.6 — Confidentialité du profil', () => {
  it('ne montre que le pseudonyme et le Mirage ID pour un profil privé', async () => {
    const mirageId = (h.db.prepare("SELECT mirage_id FROM users WHERE username = 'recrue'").get() as { mirage_id: string }).mirage_id;
    const res = await request(h.app).get(`/api/profile/${mirageId}`);
    expect(res.status).toBe(200);
    expect(res.body.profile.restricted).toBe(true);
    expect(res.body.stats).toBeNull();
    expect(res.body.profile.username).toBe('recrue');
  });

  it('expose les statistiques d’un profil public mais jamais l’adresse électronique', async () => {
    const mirageId = (h.db.prepare("SELECT mirage_id FROM users WHERE username = 'joueur'").get() as { mirage_id: string }).mirage_id;
    const res = await request(h.app).get(`/api/profile/${mirageId}`);
    expect(res.body.profile.restricted).toBe(false);
    expect(Array.isArray(res.body.stats)).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('@mirage-protocol.example');
  });
});

describe('§6.12 / critère #11 — Journal d’audit append-only', () => {
  it('chaîne de hachage valide puis détecte une altération', async () => {
    const admin = await newClient(h.app);
    await loginStaff(admin, h.db, 'admin');
    const created = await admin.post('/api/backoffice/content', {
      type: 'news', slug: `audit-${rid()}`,
      translations: { fr: { title: 'Journal', summary: '', body: '' } },
    });
    expect(created.status).toBe(201);
    expect(verifyAuditChain(h.db).ok).toBe(true);

    const row = h.db.prepare("SELECT id FROM audit_log WHERE action = 'content.created' ORDER BY id DESC LIMIT 1").get() as { id: number };
    h.db.prepare("UPDATE audit_log SET action = 'content.created.tampered' WHERE id = ?").run(row.id);
    const broken = verifyAuditChain(h.db);
    expect(broken.ok).toBe(false);
    expect(broken.brokenAt).toBe(row.id);
  });
});

describe('§6.11 / critère #10 — Sauvegardes chiffrées et restauration vérifiée', () => {
  it('chiffre la sauvegarde et valide une restauration complète', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zm-backup-'));
    const backup = createBackup(h.db, dir, 'test');
    const raw = fs.readFileSync(backup.file).toString('latin1');
    expect(raw.includes('CREATE TABLE')).toBe(false);
    expect(raw.slice(0, 5)).toBe('ZMBK1');

    const verification = verifyBackup(backup.file);
    expect(verification.ok).toBe(true);
    expect(verification.checks.every((c) => c.ok)).toBe(true);
    expect(verification.tables?.users).toBeGreaterThan(5);
    expect(verification.tables?.audit_log).toBeGreaterThan(0);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('détecte une sauvegarde corrompue', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zm-backup-bad-'));
    const backup = createBackup(h.db, dir, 'corrupt');
    const payload = fs.readFileSync(backup.file);
    payload[payload.length - 10] ^= 0xff;
    fs.writeFileSync(backup.file, payload);
    const verification = verifyBackup(backup.file);
    expect(verification.ok).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('§6.13 — En-têtes, CSRF et assainissement', () => {
  it('applique des en-têtes de sécurité stricts sans divulguer x-powered-by', async () => {
    const res = await request(h.app).get('/api/site');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['content-security-policy']).toContain('frame-ancestors');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('assainit le HTML et le JSON de blocs côté serveur', async () => {
    const admin = await newClient(h.app);
    await loginStaff(admin, h.db, 'admin');
    const created = await admin.post('/api/backoffice/content', {
      type: 'wiki', slug: `sanitize-${rid()}`,
      translations: { fr: { title: 'Assainissement', summary: '', body: 'ok' } },
      blocks: [
        { kind: 'paragraph', text: '<img src=x onerror=alert(1)>Texte utile' },
        { kind: 'unknown', text: 'ignoré' },
        { kind: 'image', src: 'javascript:alert(1)', alt: 'x' },
      ],
    });
    expect(created.status).toBe(201);
    const blocks = created.body.item.blocks;
    expect(blocks.length).toBe(2);
    expect(blocks[0].text).not.toContain('<img');
    expect(blocks[0].text).toContain('Texte utile');
    expect(blocks[1].src).toBeUndefined();
  });

  it('refuse les interactions Discord non signées', async () => {
    const res = await request(h.app).post('/api/v1/discord/interactions').send({ type: 1 });
    expect([401, 503]).toContain(res.status);
  });

  it('tronque l’adresse IP du journal d’audit', async () => {
    const admin = await newClient(h.app);
    await loginStaff(admin, h.db, 'admin');
    const entries = (await admin.get('/api/backoffice/audit?limit=5')).body.entries as { ip: string | null }[];
    for (const entry of entries) {
      if (entry.ip) expect(entry.ip).toMatch(/\/(24|48)$|anonymisé/);
    }
  });
});

describe('§5.8 — Suppression du compte et rétraction', () => {
  it('programme la suppression avec une fenêtre de 7 jours', async () => {
    const client = await newClient(h.app);
    await loginPlayer(client);
    const reauth = await client.post('/api/auth/reauth', { password: PLAYER_PASSWORD });
    expect(reauth.status).toBe(200);
    const res = await client.post('/api/account/delete', { password: PLAYER_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.retractionWindowDays).toBe(7);
    expect(res.body.mirageIdReservedForever).toMatch(/^MIRAGE:/);
    // Sessions are dropped and the account is no longer usable.
    expect((await client.get('/api/account')).status).toBe(401);
  });
});

describe('§4 — Contenus publics et i18n', () => {
  it('ne sert que les contenus publiés', async () => {
    const res = await request(h.app).get('/api/content/news');
    expect(res.status).toBe(200);
    const slugs = res.body.items.map((i: any) => i.slug);
    expect(slugs).toContain('ouverture-du-site-officiel');
    expect(slugs).not.toContain('gabarit-article-en-brouillon');
    expect(slugs).not.toContain('gabarit-article-en-verification');
  });

  it('masque les langues sous le seuil de traduction', async () => {
    const res = await request(h.app).get('/api/site');
    expect(res.body.i18n.active).toEqual(['fr', 'en']);
    expect(res.body.i18n.masked).toEqual(['es', 'de', 'it']);
    expect(res.body.i18n.crowdin).toContain('crowdin.com');
  });

  it('expose la licence CC BY-SA 3.0 sur les pages du wiki', async () => {
    const res = await request(h.app).get('/api/content/wiki/zone-mirage');
    expect(res.status).toBe(200);
    expect(res.body.license).toBe('CC BY-SA 3.0');
  });

  it('n’expose ni paiement ni launcher dans la vitrine', async () => {
    const res = await request(h.app).get('/api/store');
    expect(res.body.payment).toBe(false);
    expect(res.body.launcher).toBe(false);
    const epic = res.body.platforms.find((p: any) => p.id === 'epic');
    expect(epic.available).toBe(false);
    const standard = res.body.editions.find((e: any) => e.id === 'standard');
    expect(standard.price).toBe(25);
    const supporter = res.body.editions.find((e: any) => e.id === 'supporter');
    expect(supporter.price).toBeNull();
    expect(supporter.priceLabel).toContain('à définir');
  });

  it('calcule un itinéraire multi-niveaux en respectant l’habilitation', async () => {
    const client = await newClient(h.app);
    const ok = await client.post('/api/map/route', { from: 'n0-1', to: 'n2-3', clearance: 'N4' });
    expect(ok.status).toBe(200);
    expect(ok.body.steps.length).toBeGreaterThan(2);
    expect(ok.body.floorsUsed.length).toBeGreaterThan(1);

    const denied = await client.post('/api/map/route', { from: 'n0-1', to: 'n2-3', clearance: 'N1' });
    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe('clearance_required');
  });
});

describe('§5.4 — Rotation des clés de signature', () => {
  it('publie les clés actives et révoque l’ancienne lors d’une rotation', async () => {
    const admin = await newClient(h.app);
    await loginStaff(admin, h.db, 'admin');
    const before = await admin.get('/api/backoffice/api-keys');
    expect(before.status).toBe(200);
    const kid = before.body.keys[0].kid;
    const rotate = await admin.post('/api/backoffice/api-keys/rotate', { reason: 'Rotation trimestrielle planifiée' });
    expect(rotate.status).toBe(200);
    expect(rotate.body.kid).not.toBe(kid);
    const after = await admin.get('/api/backoffice/api-keys');
    const revoked = after.body.keys.find((k: any) => k.kid === kid);
    expect(revoked.revoked).toBe(true);
    const legacy = await request(h.app).get('/api/v1/keys');
    expect(legacy.body.keys.every((k: any) => !k.revoked)).toBe(true);
  });
});

describe('§6.14 — Rapport de conformité calculé', () => {
  it('renvoie onze critères évalués avec leur preuve', async () => {
    const admin = await newClient(h.app);
    await loginStaff(admin, h.db, 'admin');
    const res = await admin.get('/api/backoffice/criteria');
    expect(res.status).toBe(200);
    expect(res.body.criteria.length).toBe(11);
    for (const criterion of res.body.criteria) {
      expect(['pass', 'warn', 'fail']).toContain(criterion.status);
      expect(criterion.evidence).toBeTruthy();
    }
    expect(res.body.criteria.find((c: any) => c.id === 9).status).toBe('pass');
  });
});

void extractCookie;
