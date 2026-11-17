# SCP: Mirage Protocol — site officiel

Site officiel du jeu PC **SCP: Mirage Protocol** (univers SCP, modes Histoire et
Multijoueur sur la même carte « Zone Mirage », **en développement — date de sortie
non annoncée**). Application complète : vitrine, wiki, carte interactive, boutique,
serveurs communautaires, classements, espace compte sécurisé et back-office éditorial.

Cahier des charges de référence : *SCP: Mirage Protocol — Spécifications consolidées
v1.3* (17 pages). Chaque section est tracée dans [`docs/CONFORMITE.md`](docs/CONFORMITE.md).

## Démarrage

Prérequis : Node 20+, MySQL 8 ou MariaDB 10.6+ (base et utilisateur à créer par
l'hébergeur).

```bash
npm install
cp .env.example .env      # renseigner DATABASE_URL (ou MYSQL_*), SMTP, PUBLIC_ORIGIN…
npm run db:migrate        # applique le schéma (idempotent)
npm run admin:create      # crée le premier compte administrateur (CLI)
npm run dev               # http://localhost:3000 (front + API, rechargement à chaud)
```

En production :

```bash
npm run build             # front (dist/client) + serveur (dist/server)
npm start                 # NODE_ENV=production node dist/server/index.js
```

**Aucun compte, aucun contenu et aucune donnée de démonstration** n'existent dans
le code : la base démarre vide, seul le schéma est créé. Le premier
administrateur est créé exclusivement par `npm run admin:create` (saisie masquée,
politique de mot de passe renforcée à 14 caractères, 2FA/WebAuthn imposée dès la
première connexion). Les autres membres du personnel sont ensuite créés depuis le
back-office, avec leur rôle et leurs droits issus des matrices §11.3/§11.4.

| Commande | Effet |
| --- | --- |
| `npm run dev` | Serveur Express + Vite en mode middleware sur le port 3000 |
| `npm run build` | Compilation du front (`dist/client`) et du serveur (`dist/server`) |
| `npm start` | Exécution de la version compilée en `NODE_ENV=production` |
| `npm run db:migrate` | Crée / met à jour le schéma sur la base configurée |
| `npm run admin:create` | Crée un administrateur (première entrée du personnel) |
| `npm test` | 122 tests : critères §6.14, matrices §11.3/§11.4, rendu des pages |
| `npm run backup:verify` | Crée une sauvegarde chiffrée et vérifie sa restauration |

### Base de données

L'application parle à **MySQL/MariaDB** via `mysql2` (`DATABASE_URL` ou
`MYSQL_HOST` / `MYSQL_PORT` / `MYSQL_USER` / `MYSQL_PASSWORD` / `MYSQL_DATABASE`,
`DB_SSL=true` pour un serveur géré, `DB_POOL_SIZE` pour le pool). Le schéma
complet — 26 tables, index, contraintes — est défini dans `server/db/schema.ts`
et décliné pour les deux dialectes. La couche d'accès est entièrement
asynchrone et les transactions sont liées à leur connexion (`AsyncLocalStorage`).

SQLite (`better-sqlite3`, `DB_PATH`) reste disponible **uniquement** pour le
développement local, les tests automatisés et la restauration vérifiée des
sauvegardes ; il n'est jamais sélectionné en production.

### E-mails

Les e-mails transactionnels (réinitialisation de mot de passe, accusé de réception
d'un ticket, alerte au support) partent via `SMTP_URL` ou `SMTP_HOST`/`SMTP_PORT`/
`SMTP_USER`/`SMTP_PASS`. Sans configuration SMTP, l'application démarre quand même
et journalise un avertissement : aucun jeton n'est jamais exposé dans la réponse
HTTP.

### Sauvegardes

`POST` du back-office ou `npm run backup:verify` produisent une archive
`.zmbk1` (instantané logique + AES-256-GCM) dans `BACKUP_DIR`. La commande
restaure réellement l'archive dans une base SQLite en mémoire et sort en erreur
si un contrôle échoue. `BACKUP_ENCRYPTION_KEY` doit être conservée hors du
serveur : sans elle, les archives sont définitivement illisibles.

Back-office : **`/console-mirage`** (chemin non standard, §6.9.3). Toute requête sur
`/admin`, `/wp-admin`, `/administrator`, `/backoffice`, `/console` renvoie 404.

## Architecture

```
server/
  index.ts          assemblage Express, en-têtes, CSRF, fallback SPA, housekeeping
  config.ts         constantes de sécurité (sessions, reauth, délais, chemins)
  db/               couche de données : types, dialecte, schéma, pilote SQLite,
                    pilote MySQL, ouverture/migration/instantanés
  lib/              ids, password, totp, webauthn, rbac, sessions, licences,
                    ssrf, sanitize, audit, throttle, backup, discord, platform,
                    mailer, oauth
  middleware/       security (CSP/HSTS/CSRF/origine), auth (sessions, rôles)
  routes/           auth, account, servers, support, admin, api.v1, public
  scripts/          migrate, createAdmin, verifyBackup
src/
  pages/            23 pages publiques et compte
  admin/            back-office (tableau de bord, contenus, utilisateurs,
                    modération, système, sécurité, matrices)
  components/       primitives UI, layout, rendu Markdown assaini
  i18n/             fr, en (es/de/it masquées sous le seuil de traduction)
  styles.css        thème noir/rouge, scanlines terminal désactivables
tests/              122 tests (sécurité, matrices, rendu React) + fixtures
```

## Sécurité — points saillants

- **Argon2id**, 12 caractères minimum (14 pour le personnel), refus des mots de
  passe contenant l'identifiant, vérification *k-anonymity* Pwned Passwords.
- **2FA obligatoire pour tout le personnel** ; WebAuthn exigé pour les
  administrateurs (enrôlement suivi dans le back-office), TOTP ou passkey pour les
  autres rôles ; 10 codes de secours à usage unique hachés ; anti-rejeu TOTP.
- **Sessions** `HttpOnly` + `SameSite=Lax` (+ `Secure` et préfixe `__Host-` en
  production), régénérées à la connexion et au changement de privilège ; joueur
  30 j d'inactivité / 90 j maximum, personnel 15 min / 8 h.
- **Délai progressif** après échecs (jamais de verrouillage définitif), défi
  Turnstile-compatible, réponses et temps identiques contre l'énumération.
- **Réauthentification < 5 min** pour toute action sensible, révocation des autres
  sessions après changement de mot de passe ou de 2FA.
- **Journal d'audit append-only** chaîné en SHA-256, conservation 12 mois, IP
  tronquée après 30 jours, vérification en un clic dans le back-office.
- **Sauvegardes chiffrées** AES-256-GCM avec restauration vérifiée obligatoire
  (`npm run backup:verify`, code de sortie non nul si un contrôle échoue).
- **SSRF** : résolution et refus des plages privées, loopback, link-local et
  métadonnées cloud avant tout test de serveur communautaire.
- **Licences** : jeton signé Ed25519 (`kid` + rotation), jamais d'achat ni de
  paiement sur le site ; Steam Family Sharing marqué `shared` et accepté ; absence
  de licence refuse les fonctions en ligne sans sanction automatique.

## Choix de périmètre

Conformément au cahier des charges, le site **ne contient** : ni paiement ou
facturation, ni launcher téléchargeable, ni manifeste d'intégrité, ni mode
sanction, ni achat intégré, ni newsletter (§12.4). Les éléments `[À définir]`
prix Supporter/Deluxe, catégories d'actualités, titres de réputation, logos et
données de carte définitifs sont rendus comme **placeholders explicites** :
aucun contenu de lore n'a été inventé.
