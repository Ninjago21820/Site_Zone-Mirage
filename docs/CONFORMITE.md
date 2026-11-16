# Conformité au cahier des charges v1.3

Table de correspondance entre chaque section des spécifications et son
implémentation. Les chemins sont relatifs à la racine du dépôt.

| § | Exigence | Implémentation | Vérification |
| --- | --- | --- | --- |
| 1 | Jeu PC, univers SCP, modes Histoire + Multijoueur, même carte | `src/pages/Home.tsx`, `server/routes/public.ts` (`/api/site`), champ `releaseDate: undisclosed` | `tests/render.test.tsx` (« rend / »), `/api/site` |
| 2 | En développement, aucune date de sortie | `server/config.ts` (`SITE_VERSION`), `Home`, `Store`, bannière `Layout` | `/api/site` → `releaseLabel` |
| 3 | Périmètre exclu (paiement, launcher, manifeste, sanctions, achats intégrés, newsletter) | `server/routes/public.ts` (`/api/store` → `payment:false`, `launcher:false`), aucune route de paiement | `tests/security.test.ts` (« n'expose ni paiement ni launcher ») |
| 4 | Navigation : Accueil, Actualités, Roadmap, Carte, Wiki, Boutique, Serveurs + Classements, FAQ, Support, Maintenance, Compte, Profil, pages légales, back-office, API | `src/App.tsx` (23 routes), `server/routes/public.ts`, `server/routes/api.v1.ts` | `tests/render.test.tsx` (26 routes) |
| 4 | Catégories d'actualités `[à définir]` | `src/pages/News.tsx` (liste des catégories servie par l'API, placeholder explicite) | `/api/content/news` |
| 5.1 | Connexion e-mail/mot de passe + OAuth2/OIDC PKCE (Discord, Steam, Epic, Google) | `server/routes/auth.ts` (`/api/auth/oauth/:provider/start|callback`, `state` + `nonce` + PKCE) | « refuse un state OAuth inconnu » |
| 5.2 | Mirage ID `MIRAGE:A.BB.<18 chiffres>`, immuable, unique, réservé à vie | `server/lib/ids.ts` (`mirageIdFor`), table `reserved_mirage_ids` | « respecte le format », « réserve définitivement » |
| 5.3 | Aucune liaison automatique par e-mail ; liaison = session authentifiée + réauth < 5 min ; pas de connexion staff par fournisseur externe | `server/routes/auth.ts` (callback crée toujours un compte ou exige `link=1` + réauth) | « crée un nouveau compte au lieu de lier », « bloque la connexion externe seule » |
| 5.3 | Comptes Steam sans e-mail → demande d'ajout | `server/routes/auth.ts` (redirection `needsEmail=1`), `src/pages/OAuthMock.tsx` | « crée un nouveau compte… » |
| 5.4 | Vérification de licence API → Steam/Epic, jeton signé asymétrique, `kid` + rotation, grâce hors-ligne 7 j, partage familial `shared`, aucune sanction | `server/lib/licenses.ts`, `server/routes/api.v1.ts` (`/api/v1/licenses/verify`, `/api/v1/keys`), `server/routes/admin.ts` (rotation) | « émet un jeton signé », « accepte le partage familial », « refuse… sans sanction », « accorde la grâce », « rotation des clés » |
| 5.5 | Tickets de session serveur : usage unique, courte durée, liés au serveur | `server/lib/licenses.ts` (`createSessionTicket`, `redeemSessionTicket`), table `game_session_tickets` | « usage unique », « refuse un ticket présenté à un autre serveur » |
| 5.6 | Profil privé/public : pseudonyme + Mirage ID toujours visibles, stats si public, liens sociaux masqués par défaut | `src/pages/Profile.tsx`, `server/lib/users.ts` (`profileView`), `src/pages/Account.tsx` | « ne montre que le pseudonyme », « expose les statistiques… jamais l'e-mail » |
| 5.7 | Meilleur temps par opération et par fin, temps de jeu Histoire/Multijoueur séparés, morts globales + détail, réputation, synchronisation < 24 h, validation serveur, retrait de score | `server/lib/platform.ts`, `server/routes/api.v1.ts` (`/api/v1/stats/sync`), `src/pages/Leaderboards.tsx`, `src/admin/Moderation.tsx` | « rejette une signature invalide », « accepte une charge signée », « exclut les profils privés » |
| 5.8 | Suppression de compte, fenêtre de rétraction 7 jours, Mirage ID réservé | `server/routes/account.ts` (`/api/account/delete`, `/delete/cancel`), `server/index.ts` (purge) | « programme la suppression avec une fenêtre de 7 jours » |
| 6.1–6.2 | Argon2id, 12/14 caractères, collage autorisé, jauge, refus identifiant, k-anonymity | `server/lib/password.ts`, `src/pages/Register.tsx` | « politique de mots de passe » (3 tests) |
| 6.3 | 2FA obligatoire staff, WebAuthn admin + ≥ 2 facteurs, TOTP/passkey sinon, codes de secours, anti-rejeu | `server/lib/totp.ts`, `server/lib/webauthn.ts`, `server/routes/auth.ts` | « exige un second facteur », « refuse un code TOTP rejoué », « interdit au personnel de désactiver » |
| 6.4 | Cookies `HttpOnly`/`Secure`/`SameSite`/`__Host-`, régénération, durées joueur 30/90 j, staff 15 min/8 h, liste d'appareils, révocation, révocation après changement de secret | `server/lib/sessions.ts`, `server/middleware/auth.ts`, `src/pages/Account.tsx` (onglet Appareils) | « révoque les autres sessions », « durées de session distinctes » |
| 6.5–6.7 | Anti-énumération, délai progressif sans verrouillage, défi Turnstile, jeton de réinitialisation 30 min à usage unique, 2FA jamais contournée | `server/lib/throttle.ts`, `server/routes/auth.ts` | critères #4, #5, #8 |
| 6.8 | Réauthentification < 5 min pour toute action sensible | `server/middleware/auth.ts` (`requireReauth`), `src/components/ui.tsx` (`ReauthModal`) | « exige une réauthentification récente » |
| 6.9 | Contrôles d'accès serveur, chemin back-office non standard, 404 sur les chemins devinables | `server/index.ts` (`RESERVED_ADMIN_PATHS`), `server/lib/rbac.ts` | « renvoie 404 sur /admin », « refuse l'accès au back-office », « matrice : un rédacteur… » |
| 6.10 | Jeton de réinitialisation haché 256 bits, invalide les précédents, ne contourne pas la 2FA | `server/routes/auth.ts` (`/api/auth/password/forgot|reset`), table `password_reset_tokens` | « émet un jeton 30 min… », « conserve l'obligation de 2FA » |
| 6.11 | Sauvegarde chiffrée + restauration vérifiée | `server/lib/backup.ts`, `server/scripts/verifyBackup.ts` | « chiffre la sauvegarde », « détecte une sauvegarde corrompue », `npm run backup:verify` |
| 6.12 | Journal d'audit append-only, 12 mois, IP tronquée après 30 jours | `server/lib/audit.ts`, `src/admin/System.tsx` | « chaîne de hachage valide puis détecte une altération », « tronque l'adresse IP » |
| 6.13 | CSP/HSTS/CSRF/XSS, assainissement, SSRF, interactions Discord Ed25519 | `server/middleware/security.ts`, `server/lib/sanitize.ts`, `server/lib/ssrf.ts`, `server/lib/discord.ts` | « en-têtes de sécurité stricts », « assainit le HTML », « refuse les interactions Discord non signées » |
| 6.14 | Les 11 critères d'acceptation | `server/routes/admin.ts` (`/api/backoffice/criteria`), `src/admin/Security.tsx` | « renvoie onze critères évalués » + 24 tests dédiés |
| 7 | Serveurs communautaires : 3 max, validation d'équipe, SSRF, statut/joueurs, maintenance, alerte 14 j, réauth, tag des 3 derniers validés | `server/routes/servers.ts`, `src/pages/Servers.tsx`, `src/admin/Moderation.tsx` | « refuse les adresses internes », « limite à trois serveurs », « met en avant les trois serveurs… » |
| 8 | Boutique : Standard 25 € TTC, Supporter/Deluxe `[à définir]`, extras sans visuels, achat et wishlist Steam, Epic masqué, DLC | `src/pages/Store.tsx`, `server/routes/public.ts` (`/api/store`) | « n'expose ni paiement ni launcher » |
| 9 | Carte interactive : étages, POI, liens wiki, calcul d'itinéraire multi-niveaux avec habilitations | `src/pages/ZoneMap.tsx`, `server/routes/public.ts` (`/api/map`, `/api/map/route`) | « calcule un itinéraire multi-niveaux » |
| 10 | Wiki : fiches SCP, personnages, classes d'objet, ACS, codes d'habilitation, recherche, catégories, spoilers, CC BY-SA 3.0 | `src/pages/Wiki.tsx`, `src/pages/WikiArticle.tsx`, `/api/wiki/search`, `/api/content/wiki/:slug` | « expose la licence CC BY-SA 3.0 », rendu `/wiki/zone-mirage` |
| 11.1 | Éditeur de blocs, 6 statuts, restauration 30 jours, auteur ≠ vérificateur, passage outre admin motivé et journalisé | `src/admin/ContentEditor.tsx`, `server/lib/content.ts`, `server/lib/rbac.ts` (`checkTransition`) | « séparation auteur / vérificateur », « restaure un contenu supprimé », « empêche un éditeur… de contourner » |
| 11.2 | Six statuts et leur flux | `STATUS_FLOW` (`server/lib/rbac.ts`) | `tests/matrices.test.ts` (2 tests) |
| 11.3 | Matrice 8 rôles × 7 contenus | `CONTENT_MATRIX` (`server/lib/rbac.ts`), `src/admin/Matrices.tsx` | `tests/matrices.test.ts` (cellule par cellule) |
| 11.4 | Matrice des 10 fonctions | `FUNCTION_MATRIX` (`server/lib/rbac.ts`), `src/admin/Matrices.tsx` | `tests/matrices.test.ts`, « restreint le développeur », « limite le Community Manager » |
| 12.1 | i18n fr/en/es/de/it, langues sous seuil masquées + lien Crowdin | `src/i18n/index.tsx`, `server/routes/admin.ts` (`/api/backoffice/i18n`) | « masque les langues sous le seuil de traduction » |
| 12.2 | Thème noir/rouge, scanlines, désactivation du terminal, `prefers-reduced-motion` | `src/styles.css`, `src/components/Layout.tsx` (bascule) | rendu des pages |
| 12.3 | Support : tickets, interactions Discord Ed25519, page de maintenance | `server/routes/support.ts`, `server/lib/discord.ts`, `src/pages/Support.tsx`, `src/pages/Maintenance.tsx` | rendu `/support`, `/maintenance`, « refuse les interactions Discord non signées » |
| 12.4 | Aucune newsletter | aucune route, aucune interface | `tests/security.test.ts` (périmètre boutique) |

## Écarts assumés (placeholders explicites)

| Élément | Statut |
| --- | --- |
| Prix et contenu Supporter / Deluxe | `[prix et contenu à définir]` — affiché tel quel, jamais inventé |
| Catégories d'actualités | Liste servie par l'API, libellés `[catégories à définir]` |
| Titres de réputation | `[titres à définir]` dans les classements et le profil |
| Carte de la Zone Mirage | Plan et graphe **explicitement provisoires** (5 étages, 27 nœuds, 32 arêtes) |
| Logos et illustrations | Aucun logo officiel inventé ; favicon géométrique neutre |
| Passerelle de paiement, launcher, newsletter | Volontairement absents (§3, §12.4) |
| Fournisseurs OAuth réels | Flux PKCE complet côté serveur, callback de démonstration `/oauth/:provider/callback` |
