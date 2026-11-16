import { useSearchParams } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { Button, Notice, Panel } from '../components/ui';

const PROVIDER_LABELS: Record<string, string> = {
  discord: 'Discord',
  steam: 'Steam',
  epic: 'Epic Games',
  google: 'Google',
};

export default function OAuthMock() {
  const [params] = useSearchParams();
  const provider = params.get('provider') ?? 'discord';
  const state = params.get('state') ?? '';
  const redirectUri = params.get('redirect_uri') ?? '/';

  function authorize() {
    const code = `mock_code_${Math.random().toString(36).slice(2, 12)}`;
    const url = new URL(redirectUri, window.location.origin);
    url.searchParams.set('code', code);
    url.searchParams.set('state', state);
    window.location.href = url.toString();
  }

  return (
    <div className="mx-auto max-w-lg px-4 sm:px-6 py-14">
      <p className="zm-label mb-2">OAuth2 / OIDC — PKCE</p>
      <h1 className="text-xl mb-2">Consentement — {PROVIDER_LABELS[provider] ?? provider}</h1>
      <p className="text-[13px] text-bone-400 mb-6">
        Écran de substitution utilisé lorsqu’aucun identifiant fournisseur n’est configuré. Les paramètres <code className="font-mono text-[11px]">state</code>, <code className="font-mono text-[11px]">nonce</code> et <code className="font-mono text-[11px]">code_challenge</code> (S256) sont néanmoins validés de bout en bout.
      </p>
      <Panel className="p-6 space-y-4">
        <div className="font-mono text-[10.5px] text-bone-500 space-y-1">
          <p>state : <span className="text-bone-300 break-all">{state.slice(0, 24)}…</span></p>
          <p>redirect_uri : <span className="text-bone-300 break-all">{redirectUri}</span></p>
        </div>
        <Notice tone="warn" title="Aucune liaison automatique">
          <span className="flex gap-2">
            <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden />
            Un compte existant n’est jamais associé par correspondance d’adresse électronique. La liaison exige une session authentifiée et une réauthentification de moins de 5 minutes.
          </span>
        </Notice>
        <Button variant="primary" className="w-full" onClick={authorize}>Autoriser l’accès</Button>
      </Panel>
    </div>
  );
}
