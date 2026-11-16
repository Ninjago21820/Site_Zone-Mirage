import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useI18n } from '../i18n';
import { apiPost, ApiError } from '../lib/api';
import { Button, Field, Notice, Panel, TextInput } from '../components/ui';

export default function ResetPassword() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [token, setToken] = useState(params.get('token') ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError('Les deux mots de passe ne correspondent pas.');
      return;
    }
    setBusy(true);
    setError(null);
    setIssues([]);
    try {
      await apiPost('/api/auth/password/reset', { token, password });
      navigate('/login?reset=1');
    } catch (err) {
      const apiError = err as ApiError;
      setIssues(apiError.data?.issues ?? []);
      setError(apiError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 sm:px-6 py-14">
      <h1 className="text-2xl mb-2">{t('auth.newPasswordTitle')}</h1>
      <p className="text-[13px] text-bone-400 mb-7">
        Le lien est à usage unique et expire après 30 minutes. La double authentification reste obligatoire après la réinitialisation.
      </p>
      <Panel className="p-6">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Jeton de réinitialisation" htmlFor="reset-token" required hint="Fourni par le lien reçu.">
            <TextInput id="reset-token" value={token} required onChange={(e) => setToken(e.target.value)} />
          </Field>
          <Field label={t('auth.newPassword')} htmlFor="reset-password" required hint={t('auth.passwordHelp')}>
            <TextInput id="reset-password" type="password" autoComplete="new-password" value={password} required minLength={12}
              onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label={t('auth.confirmPassword')} htmlFor="reset-confirm" required>
            <TextInput id="reset-confirm" type="password" autoComplete="new-password" value={confirm} required
              aria-invalid={confirm.length > 0 && confirm !== password}
              onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          {issues.length > 0 && <Notice tone="danger">Le mot de passe ne respecte pas la politique : {issues.join(', ')}.</Notice>}
          {error && !issues.length && <Notice tone="danger">{error}</Notice>}
          <Button type="submit" variant="primary" className="w-full" disabled={busy}>
            {busy ? t('label.loading') : 'Réinitialiser le mot de passe'}
          </Button>
        </form>
      </Panel>
    </div>
  );
}
