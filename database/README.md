# Base de données

Le site utilise **SQLite** via `better-sqlite3`. Le schéma complet (tables, index,
contraintes, énumérations) est défini dans **`server/db.ts`** — c'est la source de
vérité unique, il n'y a pas de migrations séparées pour cette version.

| Élément | Emplacement |
| --- | --- |
| Fichier de base (développement) | `data/mirage.db` |
| Sauvegardes chiffrées AES-256-GCM | `data/backups/` |
| Vérification d'une sauvegarde | `npm run backup:verify` |
| Réinitialisation complète | supprimer `data/mirage.db*` puis relancer `npm run dev` |

Le fichier de base, le journal WAL et les sauvegardes ne sont **jamais** versionnés
(voir `.gitignore`). Au démarrage, `seed()` insère un jeu de démonstration :
contenus éditoriaux, serveurs communautaires, tickets, statistiques, comptes staff
et joueurs, ainsi que la première entrée du journal d'audit.

Aucun identifiant de production, aucune clé privée de signature et aucune donnée
personnelle réelle ne figurent dans ce dépôt : les clés Ed25519 sont générées au
premier démarrage et stockées dans `data/`.
