import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n';
import { apiPost, ApiError } from '../lib/api';
import { Badge, Button, Checkbox, Field, Notice, Panel, TextInput } from '../components/ui';
import { cx } from '../lib/format';

function strengthOf(password: string): number {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 12) score++;
  if (password.length >= 16) score++;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  if (classes >= 3) score++;
  if (classes === 4) score++;
  if (/(.)\1{3,}/.test(password)) score--;
  return Math.max(0, Math.min(4, score));
}

const ISSUE_LABELS: Record<string, string> = {
  too_short: 'au moins 12 caractères',
  contains_identifier: 'ne pas contenir votre pseudonyme ou votre adresse',
  pwned: 'absent des fuites de données connues',
  too_weak: 'majuscules, minuscules, chiffres et symboles',
  repeated: 'éviter les caractères répétés',
};

export default function Register() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', email: '', password: '', confirm: '' });
  const [accept, setAccept] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const strength = useMemo(() => strengthOf(form.password), [form.password]);
  const labels = ['Très faible', 'Faible', 'Moyen', 'Bon', 'Excellent'];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form.password !== form.confirm) {
      setError('Les deux mots de passe ne correspondent pas.');
      return;
    }
    if (!accept) {
      setError('Vous devez accepter les conditions d’utilisation.');
      return;
    }
    setBusy(true);
    setError(null);
    setIssues([]);
    try {
      await apiPost('/api/auth/register', { username: form.username, email: form.email, password: form.password, locale });
      navigate('/login?registered=1');
    } catch (err) {
      const apiError = err as ApiError;
      setIssues(apiError.data?.issues ?? []);
      setError(apiError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 sm:px-6 py-14">
      <p className="zm-label mb-2">§5.2 — Mirage ID</p>
      <h1 className="text-2xl mb-2">{t('nav.register')}</h1>
      <p className="text-[13px] text-bone-400 mb-7">{t('auth.registerIntro')}</p>

      <Panel className="p-6">
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('auth.username')} htmlFor="reg-username" required hint="3 à 20 caractères : lettres, chiffres, - et _">
              <TextInput id="reg-username" name="username" autoComplete="username" value={form.username} required
                minLength={3} maxLength={20} pattern="[A-Za-z0-9_-]{3,20}"
                onChange={(e) => setForm({ ...form, username: e.target.value })} />
            </Field>
            <Field label={t('auth.email')} htmlFor="reg-email" required>
              <TextInput id="reg-email" name="email" type="email" autoComplete="email" value={form.email} required
                onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
          </div>

          <Field label={t('auth.password')} htmlFor="reg-password" required hint={t('auth.passwordHelp')}>
            <TextInput id="reg-password" name="new-password" type="password" autoComplete="new-password"
              value={form.password} required minLength={12}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              aria-describedby="strength-meter" />
          </Field>
          <div id="strength-meter" aria-live="polite">
            <div className="flex gap-1 h-1.5" aria-hidden>
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className={cx('flex-1 transition-colors',
                  strength > i ? (strength >= 3 ? 'bg-emerald-500' : strength === 2 ? 'bg-signal-500' : 'bg-alert-500') : 'bg-ink-700')} />
              ))}
            </div>
            <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-bone-500">
              {t('auth.strength')} : <span className="text-bone-300">{labels[strength]}</span> · {form.password.length} caractères
            </p>
          </div>

          <Field label={t('auth.confirmPassword')} htmlFor="reg-confirm" required>
            <TextInput id="reg-confirm" name="confirm-password" type="password" autoComplete="new-password"
              value={form.confirm} required
              aria-invalid={form.confirm.length > 0 && form.confirm !== form.password}
              onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
          </Field>

          {issues.length > 0 && (
            <Notice tone="danger" title={t('auth.policyError')}>
              <ul className="list-disc pl-4 space-y-0.5">
                {issues.map((issue) => <li key={issue}>{ISSUE_LABELS[issue] ?? issue}</li>)}
              </ul>
            </Notice>
          )}
          {error && !issues.length && <Notice tone="danger">{error}</Notice>}

          <Checkbox id="reg-accept" checked={accept} onChange={setAccept}
            label="J’accepte les conditions générales d’utilisation et la politique de confidentialité."
            hint="Le contenu du wiki est sous licence CC BY-SA 3.0." />

          <Button type="submit" variant="primary" className="w-full" disabled={busy}>
            {busy ? 'Création en cours…' : t('auth.submitRegister')}
          </Button>
          <p className="text-center text-[11.5px] text-bone-500">
            {t('auth.hasAccount')} <Link to="/login" className="text-alert-300 hover:text-alert-200">{t('auth.login')}</Link>
          </p>
        </form>
      </Panel>

      <div className="mt-4 flex flex-wrap gap-2">
        <Badge tone="neutral">Argon2id</Badge>
        <Badge tone="neutral">Vérification k-anonymity</Badge>
        <Badge tone="neutral">2FA optionnelle pour les joueurs</Badge>
      </div>
    </div>
  );
}
