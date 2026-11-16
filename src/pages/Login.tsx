import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { KeyRound, ShieldCheck, Fingerprint } from 'lucide-react';
import { useI18n } from '../i18n';
import { apiGet, apiPost, ApiError } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { getPasskeyAssertion, passkeysSupported } from '../lib/passkeys';
import { Badge, Button, Field, Notice, Panel, TextInput } from '../components/ui';

interface DemoAccount { username: string; role: string; staff: boolean }

export default function Login() {
  const { t } = useI18n();
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [step, setStep] = useState<'password' | 'mfa' | 'enroll'>(params.get('step') === '2fa' ? 'mfa' : 'password');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [useBackup, setUseBackup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<{ token: string; required: boolean } | null>(null);
  const [demo, setDemo] = useState<any>(null);
  const [methods, setMethods] = useState<{ totp: boolean; passkey: boolean; backupCodes: boolean } | null>(null);

  async function loadDemo() {
    if (demo) { setDemo(null); return; }
    try {
      const data = await apiGet<any>('/api/auth/demo');
      setDemo(data);
    } catch {
      setDemo(null);
    }
  }

  async function fillDemo(account: DemoAccount) {
    setIdentifier(account.username);
    setPassword(account.staff ? demo?.password?.staff : demo?.password?.player);
    setError(null);
  }

  async function fillTotp(username: string) {
    try {
      const data = await apiGet<any>(`/api/auth/demo/totp?username=${encodeURIComponent(username)}`);
      setCode(data.code);
    } catch {
      setError('Code de démonstration indisponible.');
    }
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await apiPost<any>('/api/auth/login', {
        identifier, password,
        ...(challenge ? { challengeToken: challenge.token, challengeRequired: true } : {}),
      });
      if (result.mfaRequired) {
        setMethods(result.methods);
        setStep(result.enrollmentRequired ? 'enroll' : 'mfa');
        if (result.enrollmentRequired) {
          setError('Aucun facteur enregistré : configurez la double authentification pour continuer.');
        }
      } else {
        await refresh();
        navigate('/account');
      }
    } catch (err) {
      const apiError = err as ApiError;
      if (apiError.code === 'challenge_required') {
        const issued = await apiGet<any>('/api/auth/challenge');
        setChallenge({ token: issued.token, required: true });
        setError('Vérification anti-robot demandée. Validez puis relancez la connexion.');
      } else if (apiError.code === 'rate_limited') {
        setError(apiError.message);
      } else {
        setError(apiError.message || 'Identifiants invalides.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitMfa(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = useBackup ? { backupCode: code } : { code };
      const result = await apiPost<any>('/api/auth/login/2fa', body);
      await refresh();
      navigate(result.user?.username ? '/account' : '/account');
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function loginWithPasskey() {
    setBusy(true);
    setError(null);
    try {
      const options = await apiPost<any>('/api/auth/webauthn/login/options', { identifier });
      const assertion = await getPasskeyAssertion(options.options);
      const result = await apiPost<any>('/api/auth/login/2fa', { passkey: assertion });
      if (result.mfaVerified) {
        await refresh();
        navigate('/account');
        return;
      }
    } catch (err) {
      const apiError = err as ApiError;
      if (apiError instanceof ApiError) setError(apiError.message);
      else setError('Passkey non disponible sur cet appareil.');
    } finally {
      setBusy(false);
    }
  }

  async function startOAuth(provider: string) {
    try {
      const data = await apiGet<any>(`/api/auth/oauth/${provider}/start`);
      window.location.href = data.url;
    } catch {
      setError('Fournisseur indisponible.');
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 py-14">
      <div className="grid gap-8 lg:grid-cols-[1fr_360px] items-start">
        <div>
          <p className="zm-label mb-2">§5.1 — Accès au compte</p>
          <h1 className="text-2xl mb-2">{t('auth.login')}</h1>
          <p className="text-[13px] text-bone-400 mb-7">{t('auth.loginIntro')}</p>

          <Panel className="p-6">
            {step === 'password' && (
              <form onSubmit={submitPassword} className="space-y-4">
                <Field label={t('auth.identifier')} htmlFor="login-identifier" required>
                  <TextInput id="login-identifier" name="username" autoComplete="username" value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)} required autoFocus />
                </Field>
                <Field label={t('auth.password')} htmlFor="login-password" required>
                  <TextInput id="login-password" name="password" type="password" autoComplete="current-password"
                    value={password} onChange={(e) => setPassword(e.target.value)} required />
                </Field>
                {challenge?.required && (
                  <Notice tone="warn" title="Vérification anti-robot">
                    Après plusieurs échecs, une vérification est demandée. Elle est validée automatiquement par ce formulaire.
                  </Notice>
                )}
                {error && <Notice tone="danger">{error}</Notice>}
                <Button type="submit" variant="primary" className="w-full" disabled={busy}>
                  {busy ? t('label.loading') : t('auth.submitLogin')}
                </Button>
                <div className="flex items-center justify-between text-[11.5px]">
                  <Link to="/forgot-password" className="text-bone-400 hover:text-bone-100">{t('auth.forgot')}</Link>
                  <Link to="/register" className="text-alert-300 hover:text-alert-200">{t('auth.register')}</Link>
                </div>
              </form>
            )}

            {(step === 'mfa' || step === 'enroll') && (
              <form onSubmit={submitMfa} className="space-y-4">
                <Notice tone="info" title={t('auth.twoFactor')}>
                  {step === 'enroll'
                    ? 'Votre rôle exige la double authentification dès la première connexion.'
                    : t('auth.twoFactorIntro')}
                </Notice>
                {methods && (
                  <div className="flex flex-wrap gap-1.5">
                    {methods.totp && <Badge tone="neutral">TOTP</Badge>}
                    {methods.passkey && <Badge tone="neutral">Passkey</Badge>}
                    {methods.backupCodes && <Badge tone="neutral">Codes de secours</Badge>}
                  </div>
                )}
                <Field label={useBackup ? t('auth.backupCode') : t('auth.code')} htmlFor="login-code" required>
                  <TextInput id="login-code" inputMode={useBackup ? 'text' : 'numeric'} autoComplete="one-time-code"
                    value={code} onChange={(e) => setCode(e.target.value)} required autoFocus
                    placeholder={useBackup ? 'XXXXX-XXXXX' : '000000'} />
                </Field>
                {error && <Notice tone="danger">{error}</Notice>}
                <Button type="submit" variant="primary" className="w-full" disabled={busy}>
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> {busy ? t('label.loading') : t('auth.verify')}
                </Button>
                <div className="flex flex-wrap items-center gap-3 text-[11px]">
                  <button type="button" onClick={() => { setUseBackup(!useBackup); setCode(''); }} className="text-bone-400 hover:text-bone-100 underline underline-offset-2">
                    {useBackup ? t('auth.useCode') : t('auth.backupCode')}
                  </button>
                  {methods?.passkey && passkeysSupported() && (
                    <button type="button" onClick={loginWithPasskey} className="text-alert-300 hover:text-alert-200 flex items-center gap-1">
                      <Fingerprint className="h-3 w-3" aria-hidden /> {t('auth.usePasskey')}
                    </button>
                  )}
                </div>
              </form>
            )}
          </Panel>

          <div className="mt-6">
            <div className="flex items-center gap-3 mb-4">
              <span className="h-px flex-1 bg-ink-700" />
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-bone-500">{t('auth.or')}</span>
              <span className="h-px flex-1 bg-ink-700" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {['discord', 'steam', 'epic', 'google'].map((provider) => (
                <Button key={provider} variant="subtle" size="sm" onClick={() => startOAuth(provider)} type="button">
                  {provider}
                </Button>
              ))}
            </div>
            <p className="mt-3 font-mono text-[10px] leading-relaxed text-bone-500">{t('auth.oauthNote')}</p>
            <p className="mt-1 font-mono text-[10px] leading-relaxed text-bone-500">{t('auth.staffNoSocial')}</p>
          </div>
        </div>

        <aside className="space-y-4">
          <Panel className="p-5">
            <div className="flex items-center gap-2 mb-2">
              <KeyRound className="h-4 w-4 text-alert-400" aria-hidden />
              <h2 className="zm-label">{t('auth.demoPanel')}</h2>
            </div>
            <p className="text-[11.5px] text-bone-400 leading-relaxed">{t('auth.demoBody')}</p>
            <Button size="sm" variant="outline" className="mt-3 w-full" onClick={loadDemo} type="button">
              {demo ? 'Masquer les comptes' : 'Afficher les comptes de démonstration'}
            </Button>
            {demo && (
              <div className="mt-3 space-y-2">
                <p className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-bone-500">
                  Mot de passe joueur : <span className="text-bone-300">{demo.password.player}</span><br />
                  Mot de passe personnel : <span className="text-bone-300">{demo.password.staff}</span>
                </p>
                <ul className="space-y-1 max-h-64 overflow-y-auto">
                  {demo.accounts.map((account: DemoAccount) => (
                    <li key={account.username} className="flex items-center gap-2">
                      <button type="button" onClick={() => fillDemo(account)}
                        className="flex-1 text-left px-2 py-1.5 border border-ink-600 rounded-[2px] hover:border-alert-600">
                        <span className="block font-mono text-[11px] text-bone-200">{account.username}</span>
                        <span className="block font-mono text-[9px] text-bone-500">{account.role}</span>
                      </button>
                      {account.staff && (
                        <button type="button" onClick={() => fillTotp(account.username)} title="Obtenir un code TOTP courant"
                          className="px-2 py-1.5 border border-ink-600 rounded-[2px] font-mono text-[9px] text-alert-300 hover:border-alert-600">
                          TOTP
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="font-mono text-[9px] text-bone-600 leading-relaxed">{demo.note}</p>
              </div>
            )}
          </Panel>

          <Panel className="p-5">
            <h2 className="zm-label mb-2">Sécurité de connexion</h2>
            <ul className="space-y-1.5 text-[11.5px] text-bone-400 leading-relaxed">
              <li>• Délai progressif après 5 échecs, sans verrouillage définitif.</li>
              <li>• Réponses identiques pour les comptes inexistants.</li>
              <li>• Session régénérée à chaque connexion.</li>
            </ul>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
