import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';
import { apiPost, ApiError } from '../lib/api';
import { Button, Field, Notice, Panel, TextInput } from '../components/ui';

export default function ForgotPassword() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await apiPost<any>('/api/auth/password/forgot', { email });
      setSent(result);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 sm:px-6 py-14">
      <p className="zm-label mb-2">§6.10 — Réinitialisation</p>
      <h1 className="text-2xl mb-2">{t('auth.resetTitle')}</h1>
      <p className="text-[13px] text-bone-400 mb-7">
        Un lien à usage unique valable 30 minutes est généré. La réponse est identique que le compte existe ou non.
      </p>

      <Panel className="p-6">
        {sent ? (
          <div className="space-y-4">
            <Notice tone="ok" title={t('auth.resetSent')}>
              <p>Aucune information sur l’existence du compte n’est révélée.</p>
            </Notice>
            {sent.demoToken && (
              <Notice tone="warn" title="Environnement de démonstration">
                <p className="font-mono text-[10.5px] break-all">{sent.demoToken}</p>
                <Link to={`/reset-password?token=${encodeURIComponent(sent.demoToken)}`}
                  className="mt-2 inline-block font-mono text-[10.5px] uppercase tracking-[0.12em] text-alert-300 hover:text-alert-200">
                  Ouvrir le lien de réinitialisation ↗
                </Link>
              </Notice>
            )}
            <Link to="/login" className="block font-mono text-[10.5px] uppercase tracking-[0.12em] text-bone-400 hover:text-bone-100">
              Retour à la connexion
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <Field label={t('auth.email')} htmlFor="forgot-email" required>
              <TextInput id="forgot-email" type="email" autoComplete="email" value={email} required
                onChange={(e) => setEmail(e.target.value)} />
            </Field>
            {error && <Notice tone="danger">{error}</Notice>}
            <Button type="submit" variant="primary" className="w-full" disabled={busy}>
              {busy ? t('label.loading') : 'Générer un lien'}
            </Button>
            <p className="text-center text-[11.5px] text-bone-500">
              <Link to="/login" className="hover:text-bone-100">{t('auth.login')}</Link>
            </p>
          </form>
        )}
      </Panel>
    </div>
  );
}
