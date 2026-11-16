# SCP: Mirage Protocol — site officiel

Site officiel du jeu PC **SCP: Mirage Protocol** (univers SCP, modes Histoire et
Multijoueur sur la même carte « Zone Mirage », **en développement — date de sortie
non annoncée**). Application complète : vitrine, wiki, carte interactive, boutique,
serveurs communautaires, classements, espace compte sécurisé et back-office éditorial.

Cahier des charges de référence : *SCP: Mirage Protocol — Spécifications consolidées
v1.3* (17 pages). Chaque section est tracée dans [`docs/CONFORMITE.md`](docs/CONFORMITE.md).

## Démarrage

```bash
npm install
npm run dev          # http://localhost:3000 (front + API, rechargement à chaud)
```

Premier lancement : la base SQLite `data/mirage.db` est créée, le schéma appliqué et
le jeu de démonstration inséré (contenus, serveurs, tickets, statistiques, comptes).

| Commande | Effet |
| --- | --- |
| `npm run dev` | Serveur Express + Vite en mode middleware sur le port 3000 |
| `npm run build` | Compilation du front (`dist/client`) et du serveur (`dist/server`) |
| `npm start` | Exécution de la version compilée en `NODE_ENV=production` |
| `npm test` | 121 tests : critères §6.14, matrices §11.3/§11.4, rendu des pages |
| `npm run backup:verify` | Crée une sauvegarde chiffrée et vérifie sa restauration |

## Comptes de démonstration

| Rôle | Identifiant | Mot de passe | Second facteur |
| --- | --- | --- | --- |
| Administrateur | `admin` | `Mirage-Staff-2026` | TOTP `JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP` |
| Modérateur | `moderator` | `Mirage-Staff-2026` | même secret TOTP |
| Traducteur | `translator` | `Mirage-Staff-2026` | même secret TOTP |
| Rédacteur | `writer` | `Mirage-Staff-2026` | même secret TOTP |
| Game Designer | `game_designer` | `Mirage-Staff-2026` | même secret TOTP |
| Animateur | `animator` | `Mirage-Staff-2026` | même secret TOTP |
| Développeur | `dev` | `Mirage-Staff-2026` | même secret TOTP |
| Community Manager | `community_manager` | `Mirage-Staff-2026` | même secret TOTP |
| Joueur (profil public) | `joueur` | `Mirage-Demo-2026` | — |
| Joueur (profil privé) | `recrue` | `Mirage-Demo-2026` | — |

> Le second facteur se saisit sur l'écran de connexion après le mot de passe. Le
> secret ci-dessus est à importer dans une application TOTP (ou à générer avec
> `oathtool --totp -b JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP`). Ces identifiants
> n'existent qu'en démonstration : `DEMO_MODE` est désactivé en production.

Back-office : **`/console-mirage`** (chemin non standard, §6.9.3). Toute requête sur
`/admin`, `/wp-admin`, `/administrator`, `/backoffice`, `/console` renvoie 404.

## Architecture

```
server/
  index.ts          assemblage Express, en-têtes, CSRF, fallback SPA, housekeeping
  config.ts         constantes de sécurité (sessions, reauth, délais, chemins)
  db.ts             schéma SQLite complet + seed de démonstration
  lib/              ids, password, totp, webauthn, rbac, sessions, licences,
                    ssrf, sanitize, audit, throttle, backup, discord, platform
  middleware/       security (CSP/HSTS/CSRF/origine), auth (sessions, rôles)
  routes/           auth, account, servers, support, admin, api.v1, public
src/
  pages/            23 pages publiques et compte
  admin/            back-office (tableau de bord, contenus, utilisateurs,
                    modération, système, sécurité, matrices)
  components/       primitives UI, layout, rendu Markdown assaini
  i18n/             fr, en (es/de/it masquées sous le seuil de traduction)
  styles.css        thème noir/rouge, scanlines terminal désactivables
tests/              121 tests (sécurité, matrices, rendu React)
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
