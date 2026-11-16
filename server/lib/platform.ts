import { DEMO_MODE } from '../config.js';

/**
 * §5.4 — platform ownership verification.
 *
 * The real Steam / Epic calls need publisher credentials and are performed
 * server-to-server only. The contract below is what the game consumes:
 *   - owned    -> normal licence
 *   - shared   -> Steam Family Sharing, accepted but flagged `shared`
 *   - unowned  -> refused neutrally, never an automatic ban
 *   - timeout / error -> NO sanction, Story grace is granted
 */

export type PlatformProvider = 'steam' | 'epic';

export interface OwnershipResult {
  status: 'owned' | 'shared' | 'unowned' | 'unavailable';
  provider: PlatformProvider;
  accountId?: string;
  displayName?: string;
  appId?: string;
  error?: string;
}

const APP_IDS: Record<PlatformProvider, string> = {
  steam: process.env.STEAM_APP_ID ?? '000000',
  epic: process.env.EPIC_APP_ID ?? '000000',
};

async function postForm(url: string, body: Record<string, string>, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      body: new URLSearchParams(body),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: controller.signal,
    });
    return { ok: res.ok, status: res.status, json: (await res.json()) as Record<string, unknown> };
  } finally {
    clearTimeout(timer);
  }
}

export async function verifyOwnership(provider: PlatformProvider, proof: string): Promise<OwnershipResult> {
  const appId = APP_IDS[provider];
  const timeoutMs = Number(process.env.PLATFORM_TIMEOUT_MS ?? 4000);

  if (DEMO_MODE || process.env.PLATFORM_MODE === 'demo') {
    // Deterministic demo proofs keep the integration testable end-to-end.
    // `demo-authored-<account>` is never accepted as a valid ownership proof.
    const value = String(proof ?? '');
    if (!value.startsWith('demo-proof-')) {
      return { status: 'unowned', provider, appId, error: 'invalid_proof' };
    }
    if (value.includes('unowned')) return { status: 'unowned', provider, appId, error: 'not_owned' };
    if (value.includes('timeout')) return { status: 'unavailable', provider, appId, error: 'platform_timeout' };
    const shared = value.includes('shared');
    return {
      status: shared ? 'shared' : 'owned',
      provider,
      accountId: `demo-${provider}-${value.slice(-6)}`,
      displayName: 'Compte de démonstration',
      appId,
    };
  }

  try {
    if (provider === 'steam') {
      const key = process.env.STEAM_WEB_API_KEY;
      if (!key) return { status: 'unavailable', provider, appId, error: 'verifier_not_configured' };
      const res = await postForm(
        'https://partner.steam-api.com/ISteamUserAuth/AuthenticateUserTicket/v1/',
        { key, appid: appId, ticket: proof },
        timeoutMs,
      );
      if (!res.ok) return { status: 'unavailable', provider, appId, error: `http_${res.status}` };
      const response = res.json.response as Record<string, any> | undefined;
      const params = response?.params as Record<string, any> | undefined;
      if (response?.error) return { status: 'unavailable', provider, appId, error: 'steam_error' };
      const owner = String(params?.ownersteamid ?? '');
      const steamId = String(params?.steamid ?? '');
      if (!params?.result || params.result !== 'OK') return { status: 'unowned', provider, appId };
      const shared = !!(owner && steamId && owner !== steamId);
      return { status: shared ? 'shared' : 'owned', provider, accountId: steamId, appId };
    }
    const url = process.env.EPIC_VERIFIER_URL;
    if (!url) return { status: 'unavailable', provider, appId, error: 'verifier_not_configured' };
    const res = await postForm(url, { token: proof, appId }, timeoutMs);
    if (!res.ok) return { status: 'unavailable', provider, appId, error: `http_${res.status}` };
    if (res.json.owned !== true) return { status: 'unowned', provider, appId };
    return { status: 'owned', provider, appId, accountId: String(res.json.accountId ?? '') };
  } catch {
    // Never sanction on a platform failure (§5.4).
    return { status: 'unavailable', provider, appId, error: 'platform_unreachable' };
  }
}

export const platformAppIds = () => APP_IDS;
