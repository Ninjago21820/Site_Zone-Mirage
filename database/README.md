# Base de données

Le site utilise **MySQL 8 ou MariaDB 10.6+** en production, via `mysql2`. Le
schéma complet (26 tables, index, contraintes, énumérations) est défini dans
**`server/db/schema.ts`** — source de vérité unique, déclinée pour MySQL et pour
SQLite par `schemaStatements(dialect)`.

| Élément | Emplacement |
| --- | --- |
| Connexion production | `DATABASE_URL` ou `MYSQL_HOST` / `MYSQL_PORT` / `MYSQL_USER` / `MYSQL_PASSWORD` / `MYSQL_DATABASE` |
| TLS de la connexion | `DB_SSL=true` |
| Taille du pool | `DB_POOL_SIZE` (10 par défaut) |
| Application du schéma | `npm run db:migrate` (idempotent, aussi exécuté à l'ouverture) |
| Premier administrateur | `npm run admin:create` |
| Sauvegardes chiffrées AES-256-GCM | `BACKUP_DIR` (par défaut `data/backups/`) |
| Vérification d'une sauvegarde | `npm run backup:verify` |
| Base SQLite locale (dev/tests) | `DB_PATH` (par défaut `data/mirage.db`) |

La base de production démarre **vide** : le schéma est créé, aucun compte, aucun
contenu et aucune donnée de démonstration ne sont insérés. Le premier
administrateur est créé par la commande `npm run admin:create` ; les autres
comptes du personnel le sont ensuite depuis le back-office.

SQLite n'est jamais utilisé en production : il sert au développement local, à la
suite de tests (`:memory:`) et à la restauration vérifiée des sauvegardes. Un
chemin de fichier explicitement demandé force SQLite, même si `DATABASE_URL` est
défini dans l'environnement.

Le fichier SQLite local, ses journaux et les sauvegardes ne sont **jamais**
versionnés (voir `.gitignore`). Aucun identifiant de production, aucune clé privée
de signature et aucune donnée personnelle réelle ne figurent dans ce dépôt : les
clés Ed25519 de signature des licences sont générées au premier démarrage et
stockées dans `data/`.

## Contrat de la couche d'accès

- Toutes les méthodes sont asynchrones : `get`, `all`, `run`, `exec`,
  `transaction`, `upsert`, `insertIgnore`, `tableNames`, `snapshot`, `close`.
- Les paramètres acceptent la forme positionnelle (`?`) **et** nommée (`@nom`) :
  `bind()` traduit vers le dialecte courant.
- `transaction(fn)` réutilise la connexion concernée (MySQL via
  `AsyncLocalStorage`) : aucune requête concurrente ne partage un état de
  transaction.
- Les types de colonnes sont normalisés (entiers, booléens 0/1, dates en
  millisecondes epoch) afin que le même code serveur fonctionne sur les deux
  dialectes.
