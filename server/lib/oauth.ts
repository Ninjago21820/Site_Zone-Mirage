import { PLATFORM_FIXTURES } from '../config.js';
import { createHash } from 'node:crypto';

/**
 * §5.1 / §6.6 — connexion par fournisseur externe.
 *
 * Le code d'autorisation est **toujours** échangé côté serveur (jamais dans le
 * navigateur) contre un jeton, puis l'identité est lue sur l'endpoint userinfo
 * du fournisseur. Aucune confiance n'est accordée au contenu de l'URL de
 * retour : `state` protège du CSRF et `code_verifier` du détournement de code.
 *
 * Un fournisseur sans identifiants renseignés est simplement inactif : le site
 * répond `503 provider_not_configured` au lieu de rediriger quelque part.
 */

export const OAUTH_PROVIDERS = ['discord', 'steam', 'epic', 'google'] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export interface ProviderEndpoints {
  /** Endpoint d'autorisation (page de consentement du fournisseur). */
  authorize: string;
  /** Endpoint d'échange code → jeton. */
  token: string;
  /** Endpoint de lecture d'identité (userinfo / OpenID). */
  userinfo: string;
  scopes: string;
  /** Steam et Epic utilisent OpenID : PKCE n'y est pas applicable. */
  pkce: boolean;
}

const DEFAULTS: Partial<Record<OAuthProvider, ProviderEndpoints>> = {
  discord: {
    authorize: 'https://discord.com/oauth2/authorize',
    token: 'https://discord.com/api/oauth2/token',
    userinfo: 'https://discord.com/api/users/@me',
    scopes: 'identify email',
    pkce: true,
  },
  google: {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    userinfo: 'https://openidconnect.googleapis.com/v1/userinfo',
    scopes: 'openid email profile',
    pkce: true,
  },
};

function envName(provider: OAuthProvider, suffix: string): string {
  return `${provider.toUpperCase()}_${suffix}`;
}

export interface ProviderConfig {
  provider: OAuthProvider;
  clientId?: string;
  clientSecret?: string;
  endpoints: ProviderEndpoints | null;
  configured: boolean;
  /** Variables à renseigner lorsque le fournisseur est incomplet (message d'erreur). */
  missing: string[];
}

export function providerConfig(provider: OAuthProvider): ProviderConfig {
  const base = DEFAULTS[provider];
  const endpoints: ProviderEndpoints | null = base
    ? {
        authorize: process.env[envName(provider, 'AUTHORIZE_URL')] ?? base.authorize,
        token: process.env[envName(provider, 'TOKEN_URL')] ?? base.token,
        userinfo: process.env[envName(provider, 'USERINFO_URL')] ?? base.userinfo,
        scopes: process.env[envName(provider, 'SCOPES')] ?? base.scopes,
        pkce: base.pkce,
      }
    : (() => {
        // Steam (OpenID 2.0) et Epic (EOS) ne suivent pas OAuth2 : ils sont
        // activables uniquement via des endpoints explicites.
        const authorize = process.env[envName(provider, 'AUTHORIZE_URL')];
        const token = process.env[envName(provider, 'TOKEN_URL')];
        const userinfo = process.env[envName(provider, 'USERINFO_URL')];
        if (!authorize || !token || !userinfo) return null;
        return { authorize, token, userinfo, scopes: process.env[envName(provider, 'SCOPES')] ?? 'openid profile', pkce: false };
      })();

  const clientId = process.env[envName(provider, 'CLIENT_ID')] || undefined;
  const clientSecret = process.env[envName(provider, 'CLIENT_SECRET')] || undefined;

  const missing: string[] = [];
  if (!clientId) missing.push(envName(provider, 'CLIENT_ID'));
  if (!clientSecret) missing.push(envName(provider, 'CLIENT_SECRET'));
  if (!endpoints) missing.push(envName(provider, 'AUTHORIZE_URL'), envName(provider, 'TOKEN_URL'), envName(provider, 'USERINFO_URL'));

  const configured = missing.length === 0;
  return { provider, clientId, clientSecret, endpoints, configured, missing };
}

export function authorizeUrl(provider: OAuthProvider, options: {
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
}): string | null {
  const config = providerConfig(provider);
  if (!config.configured || !config.endpoints) {
    // Jeu de test hors production (PLATFORM_MODE=fixture) : le parcours reste
    // exerçable sans identifiants réels. Jamais actif en production.
    if (!PLATFORM_FIXTURES) return null;
    const fixture = new URL('https://fixture.invalid/oauth/authorize');
    fixture.searchParams.set('provider', provider);
    fixture.searchParams.set('state', options.state);
    fixture.searchParams.set('code_challenge', options.codeChallenge);
    return fixture.toString();
  }
  const url = new URL(config.endpoints.authorize);
  url.searchParams.set('client_id', config.clientId!);
  url.searchParams.set('redirect_uri', options.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', config.endpoints.scopes);
  url.searchParams.set('state', options.state);
  if (config.endpoints.pkce) {
    url.searchParams.set('nonce', options.nonce);
    url.searchParams.set('code_challenge', options.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }
  return url.toString();
}

export interface OAuthIdentity {
  /** Identifiant stable côté fournisseur (jamais une adresse e-mail). */
  subject: string;
  email?: string;
  emailVerified: boolean;
  displayName?: string;
}

export class OAuthError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
    this.name = 'OAuthError';
  }
}

function fixtureIdentity(provider: OAuthProvider, code: string, verifier: string): OAuthIdentity {
  // Déterminisme réservé aux tests hors production (PLATFORM_MODE=fixture).
  return {
    subject: `ext_${createHash('sha256').update(`${provider}:${code}:${verifier}`).digest('hex').slice(0, 40)}`,
    emailVerified: false,
    displayName: 'Compte de test',
  };
}

async function readJson(response: Response, label: string): Promise<Record<string, any>> {
  if (!response.ok) throw new OAuthError(`Échec ${label} (HTTP ${response.status}).`);
  try {
    return (await response.json()) as Record<string, any>;
  } catch {
    throw new OAuthError(`Réponse ${label} illisible.`);
  }
}

/**
 * Échange le code d'autorisation côté serveur puis lit l'identité.
 * Toute anomalie lève une `OAuthError` : la connexion est refusée.
 */
export async function exchangeOAuthCode(
  provider: OAuthProvider,
  input: { code: string; redirectUri: string; verifier: string },
): Promise<OAuthIdentity> {
  if (PLATFORM_FIXTURES) return fixtureIdentity(provider, input.code, input.verifier);

  const config = providerConfig(provider);
  if (!config.configured || !config.endpoints) throw new OAuthError('Fournisseur non configuré.', 503);

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: config.clientId!,
    client_secret: config.clientSecret!,
  });
  if (config.endpoints.pkce) body.set('code_verifier', input.verifier);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.OAUTH_TIMEOUT_MS ?? 8000));
  let token: Record<string, any>;
  try {
    const response = await fetch(config.endpoints.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
      signal: controller.signal,
    });
    token = await readJson(response, 'de l’échange de jeton');
  } catch (error) {
    if (error instanceof OAuthError) throw error;
    throw new OAuthError('Le fournisseur est injoignable.');
  } finally {
    clearTimeout(timer);
  }
  if (!token.access_token) throw new OAuthError('Aucun jeton d’accès retourné.');

  const userinfoResponse = await fetch(config.endpoints.userinfo, {
    headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(Number(process.env.OAUTH_TIMEOUT_MS ?? 8000)),
  }).catch(() => {
    throw new OAuthError('Le fournisseur est injoignable.');
  });
  const profile = await readJson(userinfoResponse, 'de lecture du profil');

  const subject = profile.sub ?? profile.id ?? profile.steamid ?? profile.account_id;
  if (!subject) throw new OAuthError('Profil sans identifiant exploitable.');
  const email = typeof profile.email === 'string' && profile.email.includes('@') ? profile.email : undefined;
  const verifiedFlag = profile.email_verified ?? profile.verified_email ?? profile.verified;
  return {
    subject: String(subject),
    email,
    // Sans indicateur explicite de vérification, l'adresse n'est pas considérée
    // comme vérifiée : elle ne peut donc jamais servir à rattacher un compte.
    emailVerified: email ? verifiedFlag === true : false,
    displayName: typeof profile.username === 'string' ? profile.username : typeof profile.name === 'string' ? profile.name : undefined,
  };
}
