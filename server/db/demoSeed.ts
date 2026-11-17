/**
 * Jeu de données de démonstration — **jamais exécuté en production**.
 * Il n'est chargé que par `npm run db:seed:demo` pour peupler un
 * environnement de développement ou de recette.
 */
import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import type { DB } from '../db.js';
import { mirageIdFor } from './ids.js';

export const DEMO_PASSWORD = 'Mirage-Demo-2026';
export const DEMO_STAFF_PASSWORD = 'Mirage-Staff-2026';
export const DEMO_TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

const ph = '[À définir]';

type SeedNode = {
  id: string;
  floor: string;
  code: string;
  label: string;
  kind: string;
  x: number;
  y: number;
  restricted?: boolean;
  clearance?: string;
  wiki?: string;
};

function seedMap(db: DB) {
  const floors = [
    ['f0', 'Niveau 0 — Accueil & Sécurité', 0, 0],
    ['f1', 'Niveau 1 — Laboratoires', 1, 1],
    ['f2', 'Niveau 2 — Confinement', 2, 2],
    ['f3', 'Niveau 3 — Logistique & Archives', 3, 3],
    ['b1', 'Sous-sol 1 — Énergie', -1, 4],
  ] as const;
  const insFloor = db.prepare('INSERT INTO map_floors (id,label,level,order_index) VALUES (?,?,?,?)');
  for (const f of floors) insFloor.run(...f);

  const nodes: SeedNode[] = [
    { id: 'n0-1', floor: 'f0', code: 'ZM-000', label: 'Sas d’entrée principal', kind: 'entrance', x: 50, y: 88 },
    { id: 'n0-2', floor: 'f0', code: 'ZM-001', label: 'Hall d’accueil', kind: 'public', x: 50, y: 74 },
    { id: 'n0-3', floor: 'f0', code: 'ZM-002', label: 'Poste de sécurité', kind: 'security', x: 26, y: 62, restricted: true, clearance: 'N2' },
    { id: 'n0-4', floor: 'f0', code: 'ZM-003', label: 'Infirmerie', kind: 'medical', x: 72, y: 62 },
    { id: 'n0-5', floor: 'f0', code: 'ZM-004', label: 'Ascenseur A', kind: 'elevator', x: 50, y: 52 },
    { id: 'n0-6', floor: 'f0', code: 'ZM-005', label: 'Escalier Nord', kind: 'stairs', x: 20, y: 44 },
    { id: 'n0-7', floor: 'f0', code: 'ZM-006', label: 'Salle de briefing', kind: 'room', x: 78, y: 46 },

    { id: 'n1-1', floor: 'f1', code: 'ZM-100', label: 'Ascenseur A — palier 1', kind: 'elevator', x: 50, y: 88 },
    { id: 'n1-2', floor: 'f1', code: 'ZM-101', label: 'Escalier Nord — palier 1', kind: 'stairs', x: 20, y: 80 },
    { id: 'n1-3', floor: 'f1', code: 'ZM-102', label: 'Laboratoire d’analyses', kind: 'lab', x: 42, y: 66, wiki: 'scp-xxx-exemple' },
    { id: 'n1-4', floor: 'f1', code: 'ZM-103', label: 'Salle blanche', kind: 'lab', x: 70, y: 66, restricted: true, clearance: 'N3', wiki: 'scp-yyy-exemple' },
    { id: 'n1-5', floor: 'f1', code: 'ZM-104', label: 'Bureau des chercheurs', kind: 'office', x: 22, y: 48 },
    { id: 'n1-6', floor: 'f1', code: 'ZM-105', label: 'Sas de décontamination', kind: 'airlock', x: 55, y: 40, restricted: true, clearance: 'N3' },
    { id: 'n1-7', floor: 'f1', code: 'ZM-106', label: 'Ascenseur B', kind: 'elevator', x: 84, y: 52 },

    { id: 'n2-1', floor: 'f2', code: 'ZM-200', label: 'Ascenseur A — palier 2', kind: 'elevator', x: 50, y: 88 },
    { id: 'n2-2', floor: 'f2', code: 'ZM-201', label: 'Couloir de confinement', kind: 'corridor', x: 50, y: 68, restricted: true, clearance: 'N3' },
    { id: 'n2-3', floor: 'f2', code: 'ZM-202', label: 'Cellule de confinement 01', kind: 'cell', x: 22, y: 66, restricted: true, clearance: 'N4', wiki: 'scp-zzz-exemple' },
    { id: 'n2-4', floor: 'f2', code: 'ZM-203', label: 'Cellule de confinement 02', kind: 'cell', x: 78, y: 66, restricted: true, clearance: 'N4' },
    { id: 'n2-5', floor: 'f2', code: 'ZM-204', label: 'Salle de contrôle', kind: 'control', x: 50, y: 48, restricted: true, clearance: 'N3' },
    { id: 'n2-6', floor: 'f2', code: 'ZM-205', label: 'Ascenseur B — palier 2', kind: 'elevator', x: 84, y: 52 },

    { id: 'n3-1', floor: 'f3', code: 'ZM-300', label: 'Ascenseur B — palier 3', kind: 'elevator', x: 84, y: 52 },
    { id: 'n3-2', floor: 'f3', code: 'ZM-301', label: 'Archives', kind: 'archive', x: 58, y: 58, restricted: true, clearance: 'N3' },
    { id: 'n3-3', floor: 'f3', code: 'ZM-302', label: 'Quai de logistique', kind: 'logistics', x: 34, y: 42 },
    { id: 'n3-4', floor: 'f3', code: 'ZM-303', label: 'Salle serveurs', kind: 'tech', x: 66, y: 32, restricted: true, clearance: 'N3' },

    { id: 'b1-1', floor: 'b1', code: 'ZM-400', label: 'Ascenseur A — sous-sol', kind: 'elevator', x: 50, y: 52 },
    { id: 'b1-2', floor: 'b1', code: 'ZM-401', label: 'Générateurs', kind: 'utility', x: 30, y: 62, restricted: true, clearance: 'N3' },
    { id: 'b1-3', floor: 'b1', code: 'ZM-402', label: 'Local technique', kind: 'utility', x: 70, y: 62 },
  ];
  const insNode = db.prepare(
    'INSERT INTO map_nodes (id,floor_id,code,label,kind,x,y,restricted,clearance,wiki_slug) VALUES (?,?,?,?,?,?,?,?,?,?)',
  );
  for (const n of nodes)
    insNode.run(n.id, n.floor, n.code, n.label, n.kind, n.x, n.y, n.restricted ? 1 : 0, n.clearance ?? null, n.wiki ?? null);

  const edges: [string, string, string, number, boolean][] = [
    ['n0-1', 'n0-2', 'corridor', 1, false],
    ['n0-2', 'n0-3', 'corridor', 1, false],
    ['n0-2', 'n0-4', 'corridor', 1, false],
    ['n0-2', 'n0-5', 'corridor', 1, false],
    ['n0-3', 'n0-6', 'corridor', 1, false],
    ['n0-5', 'n0-7', 'corridor', 1, false],
    ['n0-6', 'n0-5', 'corridor', 1.4, false],
    ['n0-5', 'n1-1', 'elevator', 1, false],
    ['n0-6', 'n1-2', 'stairs', 1, false],
    ['n1-1', 'n1-3', 'corridor', 1, false],
    ['n1-3', 'n1-4', 'corridor', 1.2, true],
    ['n1-3', 'n1-2', 'corridor', 1, false],
    ['n1-2', 'n1-5', 'corridor', 1, false],
    ['n1-3', 'n1-6', 'door', 1, true],
    ['n1-3', 'n1-7', 'corridor', 1.3, false],
    ['n1-1', 'n2-1', 'elevator', 1, false],
    ['n1-7', 'n2-6', 'elevator', 1, false],
    ['n2-1', 'n2-2', 'door', 1, true],
    ['n2-2', 'n2-3', 'door', 1, true],
    ['n2-2', 'n2-4', 'door', 1, true],
    ['n2-2', 'n2-5', 'corridor', 1, true],
    ['n2-5', 'n2-6', 'corridor', 1, true],
    ['n2-5', 'n1-6', 'elevator', 1.5, true],
    ['n2-6', 'n3-1', 'elevator', 1, false],
    ['n3-1', 'n3-2', 'corridor', 1, true],
    ['n3-2', 'n3-3', 'corridor', 1.2, false],
    ['n3-1', 'n3-4', 'corridor', 1, true],
    ['n3-3', 'n3-4', 'corridor', 1.6, false],
    ['b1-1', 'n0-5', 'elevator', 1, false],
    ['b1-1', 'b1-2', 'door', 1, true],
    ['b1-1', 'b1-3', 'corridor', 1, false],
    ['n1-6', 'n2-5', 'elevator', 1.5, true],
  ];
  const insEdge = db.prepare('INSERT INTO map_edges (id,from_node,to_node,kind,distance,restricted) VALUES (?,?,?,?,?,?)');
  edges.forEach(([a, b, kind, d, r], i) => insEdge.run(`e${i + 1}-f`, a, b, kind, d, r ? 1 : 0));
}

function seedContent(db: DB) {
  const now = NOW();
  const insContent = db.prepare(`INSERT INTO content
    (id,type,status,slug,category,author_id,verifier_id,published_at,spoiler,acs_level,clearance,seo_title,seo_desc,featured,order_index,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insTr = db.prepare(
    'INSERT INTO content_translations (content_id,locale,title,summary,body) VALUES (?,?,?,?,?)',
  );
  const news = [
    {
      slug: 'ouverture-du-site-officiel',
      title: 'Ouverture du site officiel',
      summary: 'Le site officiel de SCP: Mirage Protocol est en ligne. Le jeu reste en développement, sans date de sortie annoncée.',
      body: `## Un site officiel pour la Zone Mirage\n\nBienvenue sur le site officiel de **SCP: Mirage Protocol**. Ce portail regroupe les actualités du développement, la feuille de route, la carte interactive de la Zone Mirage, le wiki communautaire encadré par l’équipe, ainsi que les serveurs et classements.\n\n> Le jeu est en cours de développement. **Aucune date de sortie n’est annoncée à ce jour.**\n\n### Ce qui est disponible dès maintenant\n\n- Les actualités et la feuille de route de développement\n- La carte interactive multi-niveaux de la Zone Mirage\n- Le wiki officiel (rédaction réservée à l’équipe)\n- L’inscription, la gestion de compte et de profil\n- Le référencement des serveurs communautaires\n\n### Ce qui n’est pas disponible\n\nAucun launcher téléchargeable, aucun paiement et aucune boutique transactionnelle ne sont proposés sur ce site. La vitrine (§8) présente uniquement l’édition standard à 25 € TTC ; les éditions Supporter et Deluxe restent ${ph}.`,
      category: 'site',
      featured: 1,
    },
    {
      slug: 'note-de-developpement-jalon-courant',
      title: 'Note de développement — état du jalon en cours',
      summary: 'Point d’avancement générique sur le jalon courant. Le contenu détaillé sera publié par l’équipe.',
      body: `## État d’avancement\n\nCette note est un **gabarit éditorial**. Le contenu détaillé de la note de développement sera rédigé et publié par l’équipe via le back-office.\n\n- Jalon courant : ${ph}\n- Prochaines étapes : ${ph}\n- Date de sortie : **non annoncée**\n\nToute information de calendrier publiée sur ce site est indicative et ne constitue pas un engagement de date de sortie.`,
      category: 'devlog',
    },
    {
      slug: 'carte-interactive-disponible',
      title: 'La carte interactive de la Zone Mirage est disponible',
      summary: 'Explorez les niveaux de la Zone Mirage, consultez les points d’intérêt et calculez un itinéraire multi-niveaux.',
      body: `## Carte interactive\n\nLa carte interactive présente les **niveaux de la Zone Mirage** sous forme de plans schématiques. Chaque point d’intérêt est relié à sa fiche wiki lorsqu’elle existe.\n\n### Calcul d’itinéraire\n\nLe calculateur d’itinéraire prend en compte :\n\n- les couloirs ;\n- les escaliers ;\n- les ascenseurs ;\n- les accès restreints (selon le niveau d’habilitation).\n\n> Les plans affichés sont des **plans de substitution explicites**. Les plans définitifs seront fournis par l’équipe de level design (${ph}).`,
      category: 'carte',
    },
    {
      slug: 'serveurs-communautaires-cadre',
      title: 'Serveurs communautaires : le cadre de référencement',
      summary: 'Trois serveurs maximum par compte, validation par l’équipe, contrôle anti-SSRF des adresses et gestion de la maintenance.',
      body: `## Référencement des serveurs communautaires\n\nChaque compte peut référencer **au maximum trois serveurs**. Toute inscription est soumise à une validation par l’équipe avant publication.\n\n### Contrôles techniques\n\n- L’adresse \`IP:port\` fournie est validée côté serveur.\n- Les adresses internes, réservées ou de bouclage sont **refusées** (protection SSRF).\n- L’équipe peut suspendre un serveur à tout moment.\n\n### Mise en avant\n\nLes **trois serveurs les plus récemment créés ou validés** portent une étiquette spéciale et occupent les trois premières places du classement des serveurs. Les autres serveurs sont triés par nombre moyen de joueurs.`,
      category: 'communaute',
    },
    {
      slug: 'wiki-charte-de-redaction',
      title: 'Wiki : charte de rédaction et licence CC BY-SA 3.0',
      summary: 'Le wiki est rédigé uniquement par l’équipe. Chaque page porte sa propre attribution de licence.',
      body: `## Charte du wiki\n\nLe wiki officiel est **exclusivement rédigé par l’équipe**. Les propositions de la communauté sont étudiées via le support, sans accès direct à la rédaction.\n\n### Structure d’une fiche\n\nChaque fiche SCP comporte un en-tête **ACS** (Anomaly Classification System) et un niveau d’habilitation requis.\n\n### Licence\n\nChaque page est publiée sous **CC BY-SA 3.0**. L’attribution est affichée en pied de page de chaque article.`,
      category: 'wiki',
    },
    {
      slug: 'maintenance-planifiee-gabarit',
      title: 'Maintenance planifiée — gabarit',
      summary: 'Communication type en cas de maintenance. Les créneaux seront renseignés par l’équipe technique.',
      body: `## Maintenance planifiée\n\n> **Créneau :** ${ph}\n> **Services concernés :** ${ph}\n> **Durée estimée :** ${ph}\n\nDurant la maintenance, l’accès au site peut être interrompu. Les services de jeu ne sont pas concernés par les opérations sur ce site.\n\nConsultez la page [Maintenance](/maintenance) pour l’état courant.`,
      category: 'technique',
    },
  ];

  const base = now - 1000 * 60 * 60 * 24 * 20;
  news.forEach((n, i) => {
    const id = `news-${i + 1}`;
    const at = base + i * 1000 * 60 * 60 * 26;
    insContent.run(
      id, 'news', 'published', n.slug, n.category, 'u-admin', 'u-admin', at,
      0, null, null, n.title, n.summary, n.featured ?? 0, i, at, at,
    );
    insTr.run(id, 'fr', n.title, n.summary, n.body);
    insTr.run(id, 'en', n.title, n.summary, `> English translation pending (Crowdin).\n\n${n.body}`);
  });

  const roadmap: [string, string, string, string][] = [
    ['J1 — Fondations', 'in_progress', 'Cadrage technique, architecture du site, socle de sécurité (authentification, sessions, journal d’audit).', ph],
    ['J2 — Comptes & Mirage ID', 'in_progress', 'Comptes joueurs, Mirage ID immuable, 2FA, passkeys, gestion des appareils.', ph],
    ['J3 — Contenus publics', 'planned', 'Actualités, feuille de route, FAQ, pages légales et wiki encadré.', ph],
    ['J4 — Carte interactive', 'planned', 'Plans multi-niveaux, points d’intérêt, calcul d’itinéraire.', ph],
    ['J5 — Serveurs & classements', 'planned', 'Référencement des serveurs communautaires et classements synchronisés.', ph],
    ['J6 — Back-office', 'planned', 'Éditeur de blocs, workflow éditorial à six statuts, matrices de droits.', ph],
    ['J7 — API jeu & plateforme', 'planned', 'Vérification de licence, tickets de session, synchronisation des statistiques.', ph],
    ['J8 — Durcissement & livraison', 'planned', 'Tests de sécurité, sauvegardes vérifiées, accessibilité, internationalisation.', ph],
  ];
  roadmap.forEach(([title, status, summary, body], i) => {
    const id = `road-${i + 1}`;
    insContent.run(id, 'roadmap', 'published', `jalon-${i + 1}`, status, 'u-admin', 'u-admin', now, 0, null, null, title, summary, 0, i, now, now);
    insTr.run(id, 'fr', title, summary, `${summary}\n\nDétail du jalon : ${body}`);
  });

  const wiki: {
    slug: string; title: string; summary: string; acs: string; clearance: string; cat: string; spoiler?: number;
  }[] = [
    {
      slug: 'scp-xxx-exemple',
      title: 'SCP-XXX — [À définir]',
      summary: 'Fiche de gabarit. L’identifiant définitif, la classe d’objet et le contenu seront fournis par l’équipe de rédaction.',
      acs: 'pending',
      clearance: 'N2',
      cat: 'scp',
    },
    {
      slug: 'scp-yyy-exemple',
      title: 'SCP-YYY — [À définir]',
      summary: 'Seconde fiche de gabarit utilisée pour valider la structure ACS, les niveaux d’habilitation et les liens vers la carte.',
      acs: 'pending',
      clearance: 'N3',
      cat: 'scp',
    },
    {
      slug: 'scp-zzz-exemple',
      title: 'SCP-ZZZ — [À définir]',
      summary: 'Fiche de gabarit associée à une cellule de confinement sur la carte interactive.',
      acs: 'pending',
      clearance: 'N4',
      cat: 'scp',
      spoiler: 1,
    },
    {
      slug: 'zone-mirage',
      title: 'Zone Mirage',
      summary: 'Présentation générale du site principal. Les éléments de lore définitifs restent à fournir.',
      acs: 'none',
      clearance: 'N1',
      cat: 'lieux',
    },
    {
      slug: 'systeme-acs',
      title: 'Système ACS — Anomaly Classification System',
      summary: 'Référentiel des en-têtes de classification affichés sur les fiches.',
      acs: 'none',
      clearance: 'N1',
      cat: 'referentiel',
    },
    {
      slug: 'codes-d-habilitation',
      title: 'Codes d’habilitation',
      summary: 'Niveaux d’habilitation utilisés par le wiki et la carte interactive.',
      acs: 'none',
      clearance: 'N2',
      cat: 'referentiel',
    },
    {
      slug: 'personnages',
      title: 'Personnages — [À définir]',
      summary: 'Fiches de personnages. Aucun nom, aucune biographie définitive n’est inventée à ce stade.',
      acs: 'none',
      clearance: 'N2',
      cat: 'personnages',
    },
    {
      slug: 'classes-d-objets',
      title: 'Classes d’objets',
      summary: 'Référentiel des classes d’objet utilisées pour les fiches SCP.',
      acs: 'none',
      clearance: 'N1',
      cat: 'referentiel',
    },
  ];
  const acsBodies: Record<string, string> = {
    pending: `## En-tête ACS\n\n| Champ | Valeur |\n| --- | --- |\n| Classe d’objet | ${ph} |\n| Niveau de perturbation | ${ph} |\n| Niveau de risque | ${ph} |\n| Procédures de confinement | ${ph} |\n\n> Cette fiche est un **gabarit**. L’équipe de rédaction doit fournir le contenu définitif. Aucune donnée de lore n’est inventée par le site.`,
    none: `## Contenu\n\nCette page est un **gabarit de structure**. Le contenu définitif sera fourni par l’équipe (${ph}).\n\n- Section 1 : ${ph}\n- Section 2 : ${ph}`,
  };
  wiki.forEach((w, i) => {
    const id = `wiki-${i + 1}`;
    insContent.run(id, 'wiki', 'published', w.slug, w.cat, 'u-admin', 'u-admin', now, w.spoiler ?? 0, w.acs, w.clearance, w.title, w.summary, 0, i, now, now);
    insTr.run(id, 'fr', w.title, w.summary, `## ${w.title}\n\n${w.summary}\n\n${acsBodies[w.acs] ?? acsBodies.none}`);
  });

  const faq = [
    ['Quelle est la date de sortie ?', 'Aucune date de sortie n’est annoncée. SCP: Mirage Protocol est en cours de développement.'],
    ['Sur quelles plateformes le jeu sera-t-il disponible ?', `PC. Les configurations minimales et recommandées seront publiées ultérieurement (${ph}).`],
    ['Le jeu est-il solo ou multijoueur ?', 'Les deux. Les modes Histoire et Multijoueur se déroulent sur la même carte, la Zone Mirage.'],
    ['Puis-je télécharger un launcher depuis ce site ?', 'Non. Ce site ne propose ni launcher ni téléchargement ; ces éléments ont été retirés du périmètre.'],
    ['Puis-je acheter le jeu sur ce site ?', 'Non. Le site ne gère aucun paiement. La vitrine renvoie vers les boutiques des plateformes.'],
    ['Comment obtenir ma clé de licence ?', 'La licence est vérifiée automatiquement par le jeu auprès de la plateforme (Steam ou Epic Games Store). Aucune clé manuelle n’est demandée.'],
    ['Le partage familial Steam est-il pris en charge ?', 'Oui. Un compte en partage familial est marqué comme « partagé » et l’accès aux fonctionnalités en ligne est accepté.'],
    ['Puis-je jouer hors ligne aux modes Histoire ?', 'Une période de grâce hors ligne est prévue pour le mode Histoire (proposition, 7 jours). Le mode Multijoueur nécessite une connexion.'],
    ['Comment fonctionne mon Mirage ID ?', 'Il est généré à la création du compte, ne change jamais et reste réservé définitivement, même après suppression du compte.'],
    ['Mon profil est-il public par défaut ?', 'Non. Le profil est privé par défaut. Le pseudo et le Mirage ID restent visibles ; les statistiques ne le sont que si vous rendez le profil public.'],
    ['Comment fonctionne la double authentification ?', 'Elle est obligatoire pour tout le personnel dès la première connexion. Pour les joueuses et joueurs elle est optionnelle, avec un rappel.'],
    ['Puis-je référencer mon serveur communautaire ?', 'Oui, dans la limite de trois serveurs par compte, après validation par l’équipe.'],
    ['Comment signaler un problème ?', 'Via la page Support. Les signalements concernant la sécurité sont traités en priorité.'],
    ['Le wiki est-il ouvert aux contributions ?', 'Non. Le wiki est rédigé exclusivement par l’équipe. Les propositions peuvent être transmises via le support.'],
  ];
  faq.forEach(([q, a], i) => {
    const id = `faq-${i + 1}`;
    insContent.run(id, 'faq', 'published', `question-${i + 1}`, 'general', 'u-admin', 'u-admin', now, 0, null, null, q, a, 0, i, now, now);
    insTr.run(id, 'fr', q, a, a);
  });

  const legal: [string, string, string][] = [
    ['mentions-legales', 'Mentions légales', 'Éditeur du site, hébergeur et coordonnées de contact. Les informations d’identification de la société restent à fournir par la structure éditrice.'],
    ['politique-confidentialite', 'Politique de confidentialité (RGPD)', 'Traitement des données personnelles, base légale, durées de conservation, droits des personnes concernées et contact du délégué à la protection des données.'],
    ['cookies', 'Cookies', 'Le site n’utilise que des cookies strictement nécessaires au fonctionnement des sessions et de la protection CSRF. Aucun cookie publicitaire ni traceur tiers n’est déposé.'],
    ['cgu', 'Conditions générales d’utilisation', 'Règles d’usage du site, du wiki et du référencement des serveurs communautaires, ainsi que les modalités de sanction des comptes.'],
    ['licence-cc-by-sa', 'Licence CC BY-SA 3.0', 'Le contenu du wiki est publié sous licence Creative Commons Attribution – Partage dans les mêmes conditions 3.0.'],
  ];
  legal.forEach(([slug, title, summary], i) => {
    const id = `legal-${i + 1}`;
    insContent.run(id, 'legal', 'published', slug, 'legal', 'u-admin', 'u-admin', now, 0, null, null, title, summary, 0, i, now, now);
    insTr.run(id, 'fr', title, summary, `## ${title}\n\n${summary}\n\n### Détail\n\n${ph}\n\n> Gabarit juridique de substitution. Le texte définitif doit être validé par le service juridique avant publication.`);
  });

  const extras: [string, string, string][] = [
    ['schematics', 'Schémas', 'Schémas techniques réservés aux acheteurs (aucun visuel fourni à ce stade).'],
    ['artwork', 'Illustrations', 'Galerie d’illustrations réservée aux acheteurs (visuels à fournir).'],
    ['making-of', 'Making-of', 'Contenus de production réservés aux acheteurs (à fournir).'],
  ];
  extras.forEach(([slug, title, summary], i) => {
    const id = `extra-${i + 1}`;
    insContent.run(id, 'buyer_extras', 'published', slug, 'extras', 'u-admin', 'u-admin', now, 0, null, null, title, summary, 0, i, now, now);
    insTr.run(id, 'fr', title, summary, `${summary}\n\n> Contenu réservé aux acheteurs. Aucun fichier n’est distribué depuis ce site.\n\nDétail : ${ph}`);
  });

  const mapContent: [string, string, string][] = [
    ['zone-mirage-carte', 'Zone Mirage — carte', 'Plan schématique multi-niveaux de la Zone Mirage.'],
    ['legende', 'Légende de la carte', 'Couloirs, escaliers, ascenseurs et accès restreints.'],
  ];
  mapContent.forEach(([slug, title, summary], i) => {
    const id = `mapdoc-${i + 1}`;
    insContent.run(id, 'map', 'published', slug, 'carte', 'u-admin', 'u-admin', now, 0, null, null, title, summary, 0, i, now, now);
    insTr.run(id, 'fr', title, summary, summary);
  });

  // Editorial workflow sample: draft + review + scheduled to exercise the back-office
  const sample = [
    ['news', 'gabarit-article-en-brouillon', 'Gabarit — article en brouillon', 'draft', 'writer'],
    ['news', 'gabarit-article-en-verification', 'Gabarit — article en vérification', 'review', 'writer'],
    ['roadmap', 'gabarit-jalon-planifie', 'Gabarit — jalon planifié', 'scheduled', 'dev'],
  ] as const;
  sample.forEach(([type, slug, title, status, authorRole], i) => {
    const id = `sample-${i + 1}`;
    const author = `u-${authorRole}`;
    insContent.run(id, type, status, slug, 'gabarit', author, null, null, 0, null, null, title, 'Gabarit de démonstration du workflow éditorial.', 0, 90 + i, now, now);
    insTr.run(id, 'fr', title, 'Gabarit de démonstration du workflow éditorial.', `## ${title}\n\nContenu de démonstration destiné à illustrer le workflow éditorial à six statuts. Texte définitif : ${ph}.`);
  });
}

export async function seedDemo(db: DB) {
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number };
  if (count.c > 0) return;

  const now = NOW();
  const playerHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const staffHash = await argon2.hash(DEMO_STAFF_PASSWORD, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });

  const insUser = db.prepare(`INSERT INTO users
    (id,mirage_id,username,email,password_hash,role,status,email_verified,locale,profile_public,show_socials,socials_json,bio,
     totp_secret,webauthn_required,created_at,updated_at)
    VALUES (@id,@mirage_id,@username,@email,@password_hash,@role,'active',1,@locale,@public,@socials,@socials_json,@bio,@totp,@wa,@created,@updated)`);

  const users: { id: string; username: string; role: Role; staff: boolean; public?: number }[] = [
    { id: 'u-admin', username: 'admin', role: 'admin', staff: true },
    { id: 'u-moderator', username: 'moderator', role: 'moderator', staff: true },
    { id: 'u-translator', username: 'translator', role: 'translator', staff: true },
    { id: 'u-writer', username: 'writer', role: 'writer', staff: true },
    { id: 'u-game_designer', username: 'game_designer', role: 'game_designer', staff: true },
    { id: 'u-animator', username: 'animator', role: 'animator', staff: true },
    { id: 'u-dev', username: 'dev', role: 'dev', staff: true },
    { id: 'u-community_manager', username: 'community_manager', role: 'community_manager', staff: true },
    { id: 'u-player', username: 'joueur', role: 'player', staff: false, public: 1 },
    { id: 'u-player2', username: 'recrue', role: 'player', staff: false, public: 0 },
  ];

  for (const u of users) {
    insUser.run({
      id: u.id,
      mirage_id: mirageIdFor(db, now - 86400000 * (30 - users.indexOf(u))),
      username: u.username,
      email: `${u.username}@mirage-protocol.example`,
      password_hash: u.staff ? staffHash : playerHash,
      role: u.role,
      locale: 'fr',
      public: u.public ?? 0,
      socials: 0,
      socials_json: u.id === 'u-player' ? JSON.stringify({ discord: 'https://discord.gg/exemple', steam: 'https://steamcommunity.com/id/exemple' }) : '{}',
      bio: u.id === 'u-player' ? 'Profil de démonstration. Les données de jeu sont fictives.' : '',
      totp: u.staff ? DEMO_TOTP_SECRET : null,
      wa: u.role === 'admin' ? 1 : 0,
      created: now - 86400000 * 30,
      updated: now,
    });
  }

  // A handful of backup codes for the demo accounts (hashed, single use).
  const insCode = db.prepare('INSERT INTO backup_codes (id,user_id,code_hash,created_at) VALUES (?,?,?,?)');
  for (const u of users) {
    for (let i = 0; i < 10; i++) {
      insCode.run(`bc-${u.id}-${i}`, u.id, await argon2.hash(`MIRAGE-${i}${randomBytes(4).toString('hex').toUpperCase()}`, { type: argon2.argon2id, memoryCost: 8192, timeCost: 1, parallelism: 1 }), now);
    }
  }

  seedContent(db);
  seedMap(db);

  const insServer = db.prepare(`INSERT INTO servers
    (id,owner_id,name,description,host,port,region,tag,status,maintenance,current_players,avg_players,max_players,validated_at,validated_by,last_online_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const servers: [string, string, string, string, string, number, string, string, string, number, number, number, number, string][] = [
    ['srv-1', 'u-player', 'Serveur communautaire — gabarit 01', 'Serveur de démonstration. Données fictives.', '198.51.100.10', 7777, 'EU', 'tag-recent', 'active', 0, 18, 21.4, 32, '2026-11-10'],
    ['srv-2', 'u-player2', 'Serveur communautaire — gabarit 02', 'Serveur de démonstration. Données fictives.', '198.51.100.11', 7777, 'EU', 'tag-recent', 'active', 0, 12, 14.9, 24, '2026-11-12'],
    ['srv-3', 'u-player', 'Serveur communautaire — gabarit 03', 'Serveur de démonstration. Données fictives.', '198.51.100.12', 27015, 'NA', 'tag-recent', 'active', 0, 9, 11.2, 20, '2026-11-14'],
    ['srv-4', 'u-player2', 'Serveur communautaire — gabarit 04', 'Serveur de démonstration. Données fictives.', '198.51.100.13', 7777, 'EU', '', 'active', 0, 22, 26.8, 32, '2026-10-02'],
    ['srv-5', 'u-player', 'Serveur communautaire — gabarit 05', 'Serveur de démonstration. Données fictives.', '198.51.100.14', 7777, 'EU', '', 'active', 1, 0, 4.1, 16, '2026-09-18'],
  ];
  servers.forEach(([id, owner, name, desc, host, port, region, tag, status, maint, cur, avg, max, date], i) => {
    insServer.run(id, owner, name, desc, host, port, region, tag, status, maint, cur, avg, max, NOW() - (5 - i) * 86400000, 'u-moderator', NOW() - 60000, NOW() - (40 - i * 5) * 86400000);
  });

  const insStat = db.prepare(`INSERT INTO stat_entries
    (id,user_id,display_name,mode,operation_code,ending_code,best_time_ms,deaths,reputation,playtime_ms,score,hidden,verified_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const ops = ['OP-001', 'OP-002', 'OP-003'];
  const endings = ['FIN-A', 'FIN-B', 'FIN-C'];
  let n = 0;
  for (const u of users) {
    for (const [oi, op] of ops.entries()) {
      n++;
      insStat.run(
        `st-${n}`, u.id, u.username, 'story', op, endings[oi % endings.length],
        420000 + ((n * 37219) % 900000), (n * 7) % 23, 100 + ((n * 13) % 900),
        3600000 * (2 + (n % 9)), 1000 - ((n * 7919) % 900), 0, NOW() - 3600000, NOW() - 1800000,
      );
    }
    n++;
    insStat.run(`st-mp-${u.id}`, u.id, u.username, 'multiplayer', 'MP-ALL', null, null, (n * 11) % 40, 50 + (n % 400), 7200000 * (1 + (n % 5)), 500 - (n % 400), 0, NOW() - 3600000, NOW() - 1800000);
  }

  const insTicket = db.prepare('INSERT INTO support_tickets (id,ref,user_id,email,subject,category,status,priority,assigned_to,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  const insMsg = db.prepare('INSERT INTO ticket_messages (id,ticket_id,author_id,author_label,body,internal,created_at) VALUES (?,?,?,?,?,?,?)');
  insTicket.run('tkt-1', 'SUP-0001', 'u-player', 'joueur@mirage-protocol.example', 'Signalement de sécurité — gabarit', 'security', 'open', 'high', null, NOW() - 7200000, NOW() - 7200000);
  insMsg.run('msg-1', 'tkt-1', 'u-player', 'joueur', 'Message de démonstration concernant un signalement de sécurité.', 0, NOW() - 7200000);
  insTicket.run('tkt-2', 'SUP-0002', null, 'anonyme@example.org', 'Question sur la date de sortie', 'game', 'open', 'normal', null, NOW() - 3600000, NOW() - 3600000);
  insMsg.run('msg-2', 'tkt-2', null, 'anonyme', 'Question de démonstration : le jeu a-t-il une date de sortie ?', 0, NOW() - 3600000);

  const insSetting = db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)');
  insSetting.run('site.version', '1.3');
  insSetting.run('site.release_date', 'undisclosed');
  insSetting.run('i18n.threshold', '0.85');
  insSetting.run('i18n.progress', JSON.stringify({ fr: 1, en: 1, es: 0.12, de: 0.08, it: 0.05 }));

  // First entry of the hash chain — must be hashed like every other row so
  // that verifyAuditChain() succeeds on a freshly seeded database.
  const seedMeta = '{}';
  const seedHash = createHash('sha256')
    .update([now, '', 'system', 'system.seed', 'system', 'bootstrap', '', seedMeta, 'GENESIS'].join('|'))
    .digest('hex');
  db.prepare(
    'INSERT INTO audit_log (at,actor_id,actor_role,action,target_type,target_id,ip_trunc,meta_json,prev_hash,hash) VALUES (?,?,?,?,?,?,?,?,?,?)',
  ).run(now, null, 'system', 'system.seed', 'system', 'bootstrap', '', seedMeta, 'GENESIS', seedHash);
}

export { DEMO_PASSWORD, DEMO_STAFF_PASSWORD };
