import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Locale = 'fr' | 'en';
export const ACTIVE_LOCALES: Locale[] = ['fr', 'en'];
export const MASKED_LOCALES = [
  { code: 'es', label: 'Español', progress: 0.12 },
  { code: 'de', label: 'Deutsch', progress: 0.08 },
  { code: 'it', label: 'Italiano', progress: 0.05 },
];
export const CROWDIN_URL = 'https://crowdin.com/project/scp-mirage-protocol';

type Entry = [fr: string, en: string];

const DICT: Record<string, Entry> = {
  // Navigation & chrome
  'nav.home': ['Accueil', 'Home'],
  'nav.news': ['Actualités', 'News'],
  'nav.roadmap': ['Feuille de route', 'Roadmap'],
  'nav.map': ['Carte Zone Mirage', 'Zone Mirage map'],
  'nav.wiki': ['Wiki', 'Wiki'],
  'nav.store': ['Boutique', 'Store'],
  'nav.servers': ['Serveurs', 'Servers'],
  'nav.leaderboards': ['Classements', 'Leaderboards'],
  'nav.faq': ['FAQ', 'FAQ'],
  'nav.support': ['Support', 'Support'],
  'nav.account': ['Compte', 'Account'],
  'nav.login': ['Connexion', 'Sign in'],
  'nav.logout': ['Déconnexion', 'Sign out'],
  'nav.register': ['Créer un compte', 'Create account'],
  'nav.maintenance': ['Maintenance', 'Maintenance'],
  'nav.legal': ['Pages légales', 'Legal'],
  'nav.backoffice': ['Back-office', 'Back office'],
  'nav.openMenu': ['Ouvrir le menu', 'Open menu'],
  'nav.closeMenu': ['Fermer le menu', 'Close menu'],

  // Global labels
  'app.name': ['SCP: Mirage Protocol', 'SCP: Mirage Protocol'],
  'app.tagline': ['Site officiel — jeu PC en développement', 'Official site — PC game in development'],
  'app.release': ['Date de sortie non annoncée', 'Release date not announced'],
  'app.inDevelopment': ['En développement', 'In development'],
  'label.terminalEffect': ['Effet terminal', 'Terminal effect'],
  'label.scanlines': ['Lignes de balayage', 'Scanlines'],
  'label.language': ['Langue', 'Language'],
  'label.loading': ['Chargement…', 'Loading…'],
  'label.error': ['Erreur', 'Error'],
  'label.retry': ['Réessayer', 'Retry'],
  'label.save': ['Enregistrer', 'Save'],
  'label.saving': ['Enregistrement…', 'Saving…'],
  'label.cancel': ['Annuler', 'Cancel'],
  'label.close': ['Fermer', 'Close'],
  'label.confirm': ['Confirmer', 'Confirm'],
  'label.delete': ['Supprimer', 'Delete'],
  'label.edit': ['Modifier', 'Edit'],
  'label.create': ['Créer', 'Create'],
  'label.search': ['Rechercher', 'Search'],
  'label.all': ['Tous', 'All'],
  'label.none': ['Aucun', 'None'],
  'label.optional': ['facultatif', 'optional'],
  'label.required': ['obligatoire', 'required'],
  'label.back': ['Retour', 'Back'],
  'label.next': ['Suivant', 'Next'],
  'label.copy': ['Copier', 'Copy'],
  'label.copied': ['Copié', 'Copied'],
  'label.download': ['Télécharger', 'Download'],
  'label.status': ['Statut', 'Status'],
  'label.actions': ['Actions', 'Actions'],
  'label.date': ['Date', 'Date'],
  'label.author': ['Auteur', 'Author'],
  'label.verifier': ['Vérificateur', 'Verifier'],
  'label.type': ['Type', 'Type'],
  'label.title': ['Titre', 'Title'],
  'label.category': ['Catégorie', 'Category'],
  'label.updated': ['Mis à jour', 'Updated'],
  'label.placeholderNotice': ['Donnée à fournir par l’équipe', 'Data to be provided by the team'],
  'label.private': ['Privé', 'Private'],
  'label.public': ['Public', 'Public'],
  'label.readMore': ['Lire la suite', 'Read more'],
  'label.viewAll': ['Tout voir', 'View all'],
  'label.clearance': ['Habilitation', 'Clearance'],
  'label.spoiler': ['Spoiler', 'Spoiler'],
  'label.reveal': ['Afficher', 'Reveal'],
  'label.hide': ['Masquer', 'Hide'],

  // Home
  'home.heroKicker': ['Anomalie classifiée — accès public', 'Classified anomaly — public access'],
  'home.heroTitle': ['La Zone Mirage ne figure sur aucune carte officielle.', 'The Mirage Zone appears on no official map.'],
  'home.heroBody': [
    'SCP: Mirage Protocol est un jeu PC se déroulant dans l’univers SCP. Les modes Histoire et Multijoueur partagent une même carte : la Zone Mirage. Le jeu est en cours de développement et aucune date de sortie n’est annoncée.',
    'SCP: Mirage Protocol is a PC game set in the SCP universe. Story and Multiplayer modes share a single map: the Mirage Zone. The game is in development and no release date has been announced.',
  ],
  'home.modesTitle': ['Deux modes, une seule zone', 'Two modes, one zone'],
  'home.story': ['Mode Histoire', 'Story mode'],
  'home.storyBody': [
    'Campagne scénarisée, progression et fins multiples. Une période de grâce hors ligne est prévue pour l’accès hors connexion.',
    'Scripted campaign, progression and multiple endings. An offline grace period is planned for offline access.',
  ],
  'home.multiplayer': ['Mode Multijoueur', 'Multiplayer mode'],
  'home.multiplayerBody': [
    'Parties en ligne sur la même carte, hébergées par la communauté et référencées sur ce site. Seul le temps de jeu est suivi.',
    'Online sessions on the same map, community-hosted and listed on this site. Only playtime is tracked.',
  ],
  'home.latestNews': ['Dernières actualités', 'Latest news'],
  'home.serverSpotlight': ['Serveurs en vedette', 'Featured servers'],
  'home.quickAccess': ['Accès rapides', 'Quick access'],
  'home.noRelease': [
    'Aucune date de sortie annoncée. Aucun launcher ni paiement n’est proposé sur ce site.',
    'No release date announced. No launcher or payment is offered on this site.',
  ],
  'home.numbers': ['Le site en chiffres', 'The site in numbers'],

  // News / roadmap
  'news.title': ['Actualités', 'News'],
  'news.intro': [
    'Communiqués de l’équipe. Les catégories éditoriales sont à définir avec la rédaction.',
    'Team announcements. Editorial categories are to be defined with the writing team.',
  ],
  'news.empty': ['Aucune actualité publiée.', 'No published news.'],
  'roadmap.title': ['Feuille de route', 'Roadmap'],
  'roadmap.intro': [
    'Jalons de développement. Aucun engagement de date de sortie n’est associé à ces jalons.',
    'Development milestones. No release-date commitment is attached to these milestones.',
  ],
  'roadmap.inProgress': ['En cours', 'In progress'],
  'roadmap.planned': ['Planifié', 'Planned'],
  'roadmap.done': ['Terminé', 'Done'],

  // Map
  'map.title': ['Carte Zone Mirage', 'Zone Mirage map'],
  'map.intro': [
    'Plans schématiques multi-niveaux. Les plans définitifs seront fournis par l’équipe de level design.',
    'Multi-floor schematic plans. Final plans will be provided by the level design team.',
  ],
  'map.floors': ['Niveaux', 'Floors'],
  'map.points': ['Points d’intérêt', 'Points of interest'],
  'map.route': ['Calculer un itinéraire', 'Plot a route'],
  'map.from': ['Départ', 'From'],
  'map.to': ['Arrivée', 'To'],
  'map.compute': ['Calculer', 'Compute'],
  'map.clearance': ['Niveau d’habilitation', 'Clearance level'],
  'map.restricted': ['Accès restreint', 'Restricted access'],
  'map.steps': ['Étapes', 'Steps'],
  'map.legend': ['Légende', 'Legend'],
  'map.elevator': ['Ascenseur', 'Elevator'],
  'map.stairs': ['Escaliers', 'Stairs'],
  'map.corridor': ['Couloir', 'Corridor'],
  'map.noRoute': ['Aucun itinéraire praticable.', 'No passable route.'],

  // Wiki
  'wiki.title': ['Wiki officiel', 'Official wiki'],
  'wiki.intro': [
    'Rédaction réservée à l’équipe. Chaque page est publiée sous licence CC BY-SA 3.0.',
    'Team-only writing. Every page is published under the CC BY-SA 3.0 licence.',
  ],
  'wiki.searchPlaceholder': ['Rechercher une fiche, un lieu, un personnage…', 'Search a file, location or character…'],
  'wiki.categories': ['Catégories', 'Categories'],
  'wiki.noResults': ['Aucun résultat.', 'No results.'],
  'wiki.acs': ['En-tête ACS', 'ACS header'],
  'wiki.objectClass': ['Classe d’objet', 'Object class'],
  'wiki.license': ['Licence', 'Licence'],
  'wiki.attribution': ['Attribution requise', 'Attribution required'],
  'wiki.spoilerWarning': [
    'Cette page contient des éléments révélant l’intrigue.',
    'This page contains plot-revealing elements.',
  ],
  'wiki.teamOnly': [
    'Le wiki est rédigé exclusivement par l’équipe. Les propositions passent par le support.',
    'The wiki is written exclusively by the team. Suggestions go through support.',
  ],

  // Store
  'store.title': ['Boutique', 'Store'],
  'store.intro': [
    'Vitrine uniquement. Aucun paiement n’est traité sur ce site.',
    'Showcase only. No payment is processed on this site.',
  ],
  'store.editions': ['Éditions', 'Editions'],
  'store.buy': ['Acheter sur Steam', 'Buy on Steam'],
  'store.wishlist': ['Ajouter à la liste de souhaits', 'Add to wishlist'],
  'store.buyerExtras': ['Contenus acheteurs', 'Buyer extras'],
  'store.noVisuals': ['Aucun visuel fourni à ce stade.', 'No visuals provided at this stage.'],
  'store.placeholderPrice': ['[prix et contenu à définir]', '[price and content to be defined]'],
  'store.platformMemory': [
    'Votre plateforme préférée est mémorisée sur cet appareil.',
    'Your preferred platform is remembered on this device.',
  ],
  'store.epicHidden': [
    'Le bouton Epic Games Store reste masqué jusqu’à la mise en ligne de la page du jeu.',
    'The Epic Games Store button stays hidden until the game page goes live.',
  ],
  'store.dlc': [
    'La possession des DLC est vérifiée via l’API de la plateforme.',
    'DLC ownership is checked through the platform API.',
  ],

  // Servers
  'servers.title': ['Serveurs communautaires', 'Community servers'],
  'servers.intro': [
    'Trois serveurs maximum par compte. Toute inscription est validée par l’équipe.',
    'Three servers maximum per account. Every listing is validated by the team.',
  ],
  'servers.featured': ['Nouveaux serveurs', 'New servers'],
  'servers.players': ['Joueurs', 'Players'],
  'servers.average': ['Moyenne', 'Average'],
  'servers.maintenance': ['Maintenance', 'Maintenance'],
  'servers.online': ['En ligne', 'Online'],
  'servers.offline': ['Hors ligne', 'Offline'],
  'servers.pending': ['En attente de validation', 'Pending validation'],
  'servers.suspended': ['Suspendu', 'Suspended'],
  'servers.add': ['Référencer un serveur', 'List a server'],
  'servers.mine': ['Mes serveurs', 'My servers'],
  'servers.address': ['Adresse IP:port', 'IP:port address'],
  'servers.current': ['Joueurs actuels', 'Current players'],
  'servers.maxPlayers': ['Joueurs maximum', 'Max players'],
  'servers.region': ['Région', 'Region'],
  'servers.name': ['Nom du serveur', 'Server name'],
  'servers.description': ['Description', 'Description'],
  'servers.rules': ['Règles de référencement', 'Listing rules'],
  'servers.limit': ['Limite de 3 serveurs par compte atteinte.', 'Maximum of 3 servers per account reached.'],

  // Leaderboards
  'lb.title': ['Classements', 'Leaderboards'],
  'lb.intro': [
    'Meilleurs temps par opération et par fin. Seuls les profils publics apparaissent.',
    'Best times per operation and per ending. Only public profiles appear.',
  ],
  'lb.byOperation': ['Par opération', 'By operation'],
  'lb.byEnding': ['Par fin', 'By ending'],
  'lb.byScore': ['Par score', 'By score'],
  'lb.deaths': ['Morts', 'Deaths'],
  'lb.storyMode': ['Mode Histoire', 'Story mode'],
  'lb.multiplayerMode': ['Mode Multijoueur', 'Multiplayer mode'],
  'lb.rank': ['Rang', 'Rank'],
  'lb.player': ['Joueur', 'Player'],
  'lb.time': ['Temps', 'Time'],
  'lb.operation': ['Opération', 'Operation'],
  'lb.reputation': ['Réputation', 'Reputation'],
  'lb.reputationTitles': ['Titres de réputation', 'Reputation titles'],
  'lb.syncNote': [
    'Synchronisation au plus toutes les 24 h, validée côté serveur.',
    'Synced at most every 24h, validated server-side.',
  ],

  // FAQ / support
  'faq.title': ['Questions fréquentes', 'Frequently asked questions'],
  'faq.intro': ['Réponses de l’équipe. Les questions restées ouvertes sont marquées.', 'Team answers. Open questions are flagged.'],
  'support.title': ['Support', 'Support'],
  'support.intro': [
    'Ouvrez une demande : aucun compte n’est requis, mais il permet de suivre son traitement.',
    'Open a request: no account is required, but it lets you track progress.',
  ],
  'support.subject': ['Objet', 'Subject'],
  'support.message': ['Message', 'Message'],
  'support.email': ['Adresse électronique', 'Email address'],
  'support.category': ['Catégorie', 'Category'],
  'support.send': ['Envoyer la demande', 'Send request'],
  'support.tracking': ['Suivi de mes demandes', 'My requests'],
  'support.ref': ['Référence', 'Reference'],
  'support.sent': ['Demande enregistrée. Conservez la référence.', 'Request recorded. Keep the reference.'],
  'support.securityNote': [
    'Les signalements de sécurité sont traités sous 24 h.',
    'Security reports are handled within 24h.',
  ],

  // Auth
  'auth.login': ['Connexion', 'Sign in'],
  'auth.loginIntro': ['Accédez à votre compte et à votre profil public.', 'Access your account and public profile.'],
  'auth.identifier': ['Pseudonyme, Mirage ID ou adresse électronique', 'Username, Mirage ID or email'],
  'auth.password': ['Mot de passe', 'Password'],
  'auth.currentPassword': ['Mot de passe actuel', 'Current password'],
  'auth.newPassword': ['Nouveau mot de passe', 'New password'],
  'auth.confirmPassword': ['Confirmer le mot de passe', 'Confirm password'],
  'auth.username': ['Pseudonyme', 'Username'],
  'auth.email': ['Adresse électronique', 'Email address'],
  'auth.submitLogin': ['Se connecter', 'Sign in'],
  'auth.submitRegister': ['Créer mon compte', 'Create my account'],
  'auth.forgot': ['Mot de passe oublié ?', 'Forgot password?'],
  'auth.noAccount': ['Pas encore de compte ?', 'No account yet?'],
  'auth.hasAccount': ['Déjà un compte ?', 'Already have an account?'],
  'auth.twoFactor': ['Double authentification', 'Two-factor authentication'],
  'auth.twoFactorIntro': [
    'Saisissez le code à 6 chiffres de votre application d’authentification.',
    'Enter the 6-digit code from your authenticator app.',
  ],
  'auth.code': ['Code à 6 chiffres', '6-digit code'],
  'auth.backupCode': ['Code de secours', 'Backup code'],
  'auth.verify': ['Vérifier', 'Verify'],
  'auth.usePasskey': ['Utiliser une passkey', 'Use a passkey'],
  'auth.useCode': ['Utiliser un code', 'Use a code'],
  'auth.or': ['ou', 'or'],
  'auth.social': ['Continuer avec', 'Continue with'],
  'auth.oauthNote': [
    'Aucune liaison automatique par adresse électronique. La liaison exige une session et une réauthentification.',
    'No automatic linking by email. Linking requires a session and reauthentication.',
  ],
  'auth.staffNoSocial': [
    'Le personnel ne peut pas se connecter uniquement via un fournisseur externe.',
    'Staff cannot sign in with an external provider alone.',
  ],
  'auth.reauth': ['Réauthentification', 'Reauthentication'],
  'auth.reauthIntro': [
    'Cette action sensible exige une confirmation de moins de cinq minutes.',
    'This sensitive action requires confirmation younger than five minutes.',
  ],
  'auth.resetTitle': ['Réinitialiser le mot de passe', 'Reset password'],
  'auth.resetSent': [
    'Si un compte correspond, un lien valable 30 minutes a été généré.',
    'If an account matches, a 30-minute link has been generated.',
  ],
  'auth.newPasswordTitle': ['Nouveau mot de passe', 'New password'],
  'auth.registerIntro': [
    'Un Mirage ID immuable est généré à la création du compte.',
    'An immutable Mirage ID is generated when the account is created.',
  ],
  'auth.passwordHelp': [
    '12 caractères minimum, sans votre pseudonyme ni votre adresse, et absent des fuites connues.',
    'At least 12 characters, without your username or email, and absent from known breaches.',
  ],
  'auth.strength': ['Robustesse', 'Strength'],
  'auth.policyError': ['Le mot de passe ne respecte pas la politique.', 'The password does not meet the policy.'],

  // Account
  'account.title': ['Mon compte', 'My account'],
  'account.profile': ['Profil', 'Profile'],
  'account.security': ['Sécurité', 'Security'],
  'account.sessions': ['Appareils et sessions', 'Devices and sessions'],
  'account.stats': ['Statistiques', 'Statistics'],
  'account.licenses': ['Licences', 'Licences'],
  'account.data': ['Données personnelles', 'Personal data'],
  'account.bio': ['Présentation', 'About'],
  'account.publicProfile': ['Profil public', 'Public profile'],
  'account.publicProfileHelp': [
    'Privé par défaut. Le pseudonyme et le Mirage ID restent toujours visibles.',
    'Private by default. Username and Mirage ID always remain visible.',
  ],
  'account.showSocials': ['Afficher mes liens sociaux', 'Show my social links'],
  'account.socials': ['Liens sociaux', 'Social links'],
  'account.mirageId': ['Mirage ID', 'Mirage ID'],
  'account.mirageIdHelp': [
    'Immuable et réservé définitivement, même après suppression du compte.',
    'Immutable and reserved forever, even after account deletion.',
  ],
  'account.totp': ['Application d’authentification', 'Authenticator app'],
  'account.passkeys': ['Passkeys', 'Passkeys'],
  'account.addPasskey': ['Ajouter une passkey', 'Add a passkey'],
  'account.backupCodes': ['Codes de secours', 'Backup codes'],
  'account.regenerate': ['Régénérer', 'Regenerate'],
  'account.enable2fa': ['Activer la double authentification', 'Enable two-factor authentication'],
  'account.disable2fa': ['Désactiver', 'Disable'],
  'account.staff2fa': [
    'La double authentification est obligatoire pour tout le personnel et ne peut pas être désactivée.',
    'Two-factor authentication is mandatory for all staff and cannot be disabled.',
  ],
  'account.adminPasskey': [
    'Les administrateurs doivent enregistrer au moins deux facteurs, dont une passkey.',
    'Administrators must register at least two factors, including a passkey.',
  ],
  'account.revoke': ['Révoquer', 'Revoke'],
  'account.revokeOthers': ['Révoquer les autres sessions', 'Revoke other sessions'],
  'account.currentSession': ['Session actuelle', 'Current session'],
  'account.changePassword': ['Changer le mot de passe', 'Change password'],
  'account.exportData': ['Exporter mes données', 'Export my data'],
  'account.deleteAccount': ['Supprimer mon compte', 'Delete my account'],
  'account.deleteWarning': [
    'Suppression après un délai de rétractation de 7 jours. Le Mirage ID reste réservé définitivement.',
    'Deletion after a 7-day retraction window. The Mirage ID stays reserved forever.',
  ],
  'account.cancelDeletion': ['Annuler la suppression', 'Cancel deletion'],
  'account.pendingDeletion': ['Suppression programmée', 'Deletion scheduled'],
  'account.playtimeStory': ['Temps de jeu — Histoire', 'Playtime — Story'],
  'account.playtimeMp': ['Temps de jeu — Multijoueur', 'Playtime — Multiplayer'],
  'account.totalDeaths': ['Morts (global)', 'Deaths (global)'],
  'account.needsEmail': [
    'Votre compte a été créé via une plateforme. Ajoutez une adresse électronique pour sécuriser l’accès.',
    'Your account was created through a platform. Add an email address to secure access.',
  ],
  'account.identities': ['Fournisseurs externes', 'External providers'],
  'account.link': ['Lier', 'Link'],
  'account.unlink': ['Délier', 'Unlink'],

  // Profile
  'profile.title': ['Profil', 'Profile'],
  'profile.privateNotice': [
    'Ce profil est privé : seuls le pseudonyme et le Mirage ID sont visibles.',
    'This profile is private: only the username and Mirage ID are visible.',
  ],
  'profile.recentSessions': ['Dernières opérations', 'Recent operations'],

  // Legal
  'legal.title': ['Pages légales', 'Legal pages'],
  'legal.intro': [
    'Mentions légales, confidentialité, cookies, CGU et licence du wiki.',
    'Legal notice, privacy, cookies, terms and wiki licence.',
  ],
  'legal.placeholder': [
    'Gabarit juridique. Le texte définitif doit être validé par le service juridique.',
    'Legal template. The final text must be validated by legal counsel.',
  ],

  // Maintenance
  'maintenance.title': ['Maintenance', 'Maintenance'],
  'maintenance.none': ['Aucune maintenance planifiée.', 'No scheduled maintenance.'],

  // Misc / errors
  'error.notFound': ['Page introuvable', 'Page not found'],
  'error.notFoundBody': [
    'La ressource demandée n’existe pas ou n’est plus accessible.',
    'The requested resource does not exist or is no longer available.',
  ],
  'error.forbidden': ['Accès refusé', 'Access denied'],
  'error.generic': ['Une erreur est survenue.', 'An error occurred.'],
  'error.network': ['Connexion impossible au serveur.', 'Unable to reach the server.'],
  'error.reauthRequired': [
    'Réauthentification requise pour cette action.',
    'Reauthentication required for this action.',
  ],
  'masked.title': ['Langue non disponible', 'Language unavailable'],
  'masked.body': [
    'Cette langue n’est pas encore publiée : la couverture de traduction est inférieure au seuil de 85 %.',
    'This language is not published yet: translation coverage is below the 85% threshold.',
  ],
  'masked.help': ['Aider la traduction sur Crowdin', 'Help translate on Crowdin'],

  // Footer
  'footer.legal': ['Mentions légales', 'Legal notice'],
  'footer.privacy': ['Confidentialité (RGPD)', 'Privacy (GDPR)'],
  'footer.cookies': ['Cookies', 'Cookies'],
  'footer.terms': ['CGU', 'Terms'],
  'footer.license': ['Licence CC BY-SA 3.0', 'CC BY-SA 3.0 licence'],
  'footer.wikiLicense': [
    'Le contenu du wiki est publié sous licence CC BY-SA 3.0, attribution requise.',
    'Wiki content is published under the CC BY-SA 3.0 licence, attribution required.',
  ],
  'footer.built': [
    'Site officiel. Jeu en développement — aucune date de sortie annoncée.',
    'Official site. Game in development — no release date announced.',
  ],
};

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  maskedNotice: { label: string; progress: number } | null;
  showMaskedNotice: (label: string, progress: number) => void;
  clearMaskedNotice: () => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('zm.locale') : null;
    if (stored === 'en' || stored === 'fr') return stored;
    return 'fr';
  });
  const [maskedNotice, setMaskedNotice] = useState<{ label: string; progress: number } | null>(null);

  const setLocale = useCallback((next: Locale) => {
    if (!ACTIVE_LOCALES.includes(next)) return;
    setLocaleState(next);
    try {
      localStorage.setItem('zm.locale', next);
    } catch {
      /* storage may be unavailable */
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    setLocale,
    t: (key, vars) => {
      const entry = DICT[key];
      const raw = entry ? entry[locale === 'en' ? 1 : 0] : key;
      if (!vars) return raw;
      return Object.entries(vars).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)), raw);
    },
    maskedNotice,
    showMaskedNotice: (label, progress) => setMaskedNotice({ label, progress }),
    clearMaskedNotice: () => setMaskedNotice(null),
  }), [locale, setLocale, maskedNotice]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}

export function translate(key: string, locale: Locale): string {
  const entry = DICT[key];
  return entry ? entry[locale === 'en' ? 1 : 0] : key;
}
