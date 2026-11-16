import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Fingerprint, KeyRound, Laptop, ShieldCheck, Trash2, Download, Copy } from 'lucide-react';
import { useI18n } from '../i18n';
import { useApi } from '../lib/useApi';
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { createPasskey, passkeysSupported } from '../lib/passkeys';
import {
  Badge, Button, Checkbox, EmptyState, Field, LinkButton, Notice, Panel, SectionTitle, Select, Spinner, StatusPill,
  Tabs, TextArea, TextInput,
} from '../components/ui';
import { formatDate, formatDateTime, playtime, relativise } from '../lib/accountHelpers';
import { duration } from '../lib/format';

type Tab = 'profile' | 'security' | 'devices' | 'stats' | 'licenses' | 'data';

const SOCIAL_KEYS = ['discord', 'steam', 'epic', 'youtube', 'twitch', 'x', 'google'];

export default function Account() {
  const { t } = useI18n();
  const { me, refresh, openReauth, logout } = useAuth();
  const { data, loading, error, reload } = useApi<any>(me.authenticated ? '/api/account' : null, [me.authenticated]);
  const sessionList = useApi<any>(me.authenticated ? '/api/auth/sessions' : null, [me.authenticated]);
  const [tab, setTab] = useState<Tab>('profile');
  const [flash, setFlash] = useState<{ tone: 'ok' | 'danger' | 'warn'; message: string } | null>(null);

  const [profile, setProfile] = useState<any>(null);
  const [socials, setSocials] = useState<Record<string, string>>({});
  const [savingProfile, setSavingProfile] = useState(false);

  const [totpSetup, setTotpSetup] = useState<{ secret: string; qr: string; otpauth: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [passwordForm, setPasswordForm] = useState({ current: '', next: '', confirm: '' });
  const [passkeyLabel, setPasskeyLabel] = useState('Passkey');
  const [deletePassword, setDeletePassword] = useState('');

  useEffect(() => {
    if (data?.profile) {
      setProfile({
        username: data.profile.username,
        bio: data.profile.bio ?? '',
        profilePublic: !!data.profile.profilePublic,
        showSocials: !!data.profile.showSocials,
        locale: data.locale ?? 'fr',
      });
      setSocials(data.socials ?? {});
    }
  }, [data]);

  function handleError(err: unknown) {
    const apiError = err as ApiError;
    if (apiError.code === 'reauth_required') {
      openReauth();
      setFlash({ tone: 'warn', message: 'Réauthentification requise : validez la fenêtre puis relancez l’action.' });
      return;
    }
    setFlash({ tone: 'danger', message: apiError.message || t('error.generic') });
  }

  if (!me.authenticated) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center">
        <EmptyState title="Connexion requise" body="Connectez-vous pour accéder à votre compte."
          action={<LinkButton to="/login" variant="primary">{t('nav.login')}</LinkButton>} />
      </div>
    );
  }
  if (loading || !data) return <Spinner />;
  if (error) return <Notice tone="danger" className="m-8">{t('error.generic')}</Notice>;

  const twoFactor = data.twoFactor;
  const isStaff = data.role !== 'player';

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    setFlash(null);
    try {
      await apiPatch('/api/account/profile', { ...profile, socials });
      await Promise.all([reload(), refresh()]);
      setFlash({ tone: 'ok', message: 'Profil mis à jour.' });
    } catch (err) {
      handleError(err);
    } finally {
      setSavingProfile(false);
    }
  }

  async function startTotp() {
    setFlash(null);
    try {
      const result = await apiPost<any>('/api/auth/2fa/totp/setup');
      setTotpSetup(result);
    } catch (err) {
      handleError(err);
    }
  }

  async function enableTotp(e: React.FormEvent) {
    e.preventDefault();
    try {
      const result = await apiPost<any>('/api/auth/2fa/totp/enable', { code: totpCode });
      setBackupCodes(result.backupCodes);
      setTotpSetup(null);
      setTotpCode('');
      await reload();
      setFlash({ tone: 'ok', message: 'Double authentification activée. Conservez vos codes de secours.' });
    } catch (err) {
      handleError(err);
    }
  }

  async function disableTotp() {
    const code = window.prompt('Code à 6 chiffres de votre application :') ?? '';
    const password = window.prompt('Mot de passe actuel :') ?? '';
    if (!code || !password) return;
    try {
      await apiPost('/api/auth/2fa/disable', { code, password });
      await reload();
      setFlash({ tone: 'ok', message: 'Double authentification désactivée. Les autres sessions ont été révoquées.' });
    } catch (err) {
      handleError(err);
    }
  }

  async function addPasskey() {
    setFlash(null);
    if (!passkeysSupported()) {
      setFlash({ tone: 'danger', message: 'Cet appareil ne prend pas en charge les passkeys.' });
      return;
    }
    try {
      const options = await apiPost<any>('/api/auth/webauthn/register/options');
      const credential = await createPasskey(options.options);
      await apiPost('/api/auth/webauthn/register/verify', { flowId: options.flowId, label: passkeyLabel, ...credential });
      await reload();
      setFlash({ tone: 'ok', message: 'Passkey enregistrée.' });
    } catch (err) {
      handleError(err);
    }
  }

  async function removePasskey(id: string) {
    try {
      await apiDelete(`/api/auth/webauthn/credentials/${id}`);
      await reload();
    } catch (err) {
      handleError(err);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (passwordForm.next !== passwordForm.confirm) {
      setFlash({ tone: 'danger', message: 'Les deux mots de passe ne correspondent pas.' });
      return;
    }
    try {
      const result = await apiPost<any>('/api/auth/password/change', {
        currentPassword: passwordForm.current, newPassword: passwordForm.next,
      });
      setPasswordForm({ current: '', next: '', confirm: '' });
      setFlash({ tone: 'ok', message: `Mot de passe modifié. ${result.revokedSessions} autre(s) session(s) révoquée(s).` });
    } catch (err) {
      handleError(err);
    }
  }

  async function revokeSession(id: string) {
    try {
      await apiPost(`/api/auth/sessions/${id}/revoke`);
      await reload();
    } catch (err) {
      handleError(err);
    }
  }

  async function revokeOthers() {
    try {
      const result = await apiPost<any>('/api/auth/sessions/revoke-others');
      setFlash({ tone: 'ok', message: `${result.revoked} session(s) révoquée(s).` });
      sessionList.reload();
      await reload();
    } catch (err) {
      handleError(err);
    }
  }

  async function requestDeletion() {
    if (!window.confirm('Programmer la suppression du compte ? Un délai de rétractation de 7 jours s’applique.')) return;
    try {
      const result = await apiPost<any>('/api/account/delete', { password: deletePassword });
      setFlash({ tone: 'ok', message: `Suppression programmée. Mirage ID réservé définitivement : ${result.mirageIdReservedForever}` });
      await logout();
    } catch (err) {
      handleError(err);
    }
  }

  async function cancelDeletion() {
    try {
      await apiPost('/api/account/delete/cancel');
      await Promise.all([reload(), refresh()]);
      setFlash({ tone: 'ok', message: 'Suppression annulée.' });
    } catch (err) {
      handleError(err);
    }
  }

  const sessions = data.sessions;

  return (
    <div className="mx-auto max-w-[1100px] px-4 sm:px-6 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <p className="zm-label mb-2">Compte</p>
          <h1 className="text-2xl">{data.profile.username}</h1>
          <p className="font-mono text-[11px] text-bone-500 mt-1">{data.profile.mirageId}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">{data.role}</Badge>
          {data.profile.profilePublic ? <Badge tone="green">{t('label.public')}</Badge> : <Badge tone="neutral">{t('label.private')}</Badge>}
          {twoFactor.totp ? <Badge tone="green">2FA</Badge> : <Badge tone="amber">2FA inactive</Badge>}
          <LinkButton to={`/profile/${data.profile.mirageId}`} size="sm" variant="outline">{t('profile.title')}</LinkButton>
        </div>
      </div>

      {data.needsEmail && (
        <Notice tone="warn" className="mb-5" title="Adresse électronique manquante">
          {t('account.needsEmail')}
        </Notice>
      )}
      {data.pendingDeletion && (
        <Notice tone="danger" className="mb-5" title={t('account.pendingDeletion')}>
          Suppression prévue le {formatDate(data.pendingDeletion.purgeAfter)}. Le Mirage ID reste réservé.
          <div className="mt-3"><Button size="sm" variant="outline" onClick={cancelDeletion}>{t('account.cancelDeletion')}</Button></div>
        </Notice>
      )}
      {flash && <Notice tone={flash.tone} className="mb-5">{flash.message}</Notice>}

      <Tabs
        tabs={[
          { id: 'profile' as Tab, label: t('account.profile') },
          { id: 'security' as Tab, label: t('account.security') },
          { id: 'devices' as Tab, label: t('account.sessions') },
          { id: 'stats' as Tab, label: t('account.stats') },
          { id: 'licenses' as Tab, label: t('account.licenses') },
          { id: 'data' as Tab, label: t('account.data') },
        ]}
        value={tab}
        onChange={setTab}
        className="mb-6"
      />

      {/* --------------------------------- PROFILE -------------------------------- */}
      {tab === 'profile' && profile && (
        <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr] items-start">
          <Panel className="p-6">
            <form onSubmit={saveProfile} className="space-y-4">
              <Field label={t('auth.username')} htmlFor="acc-username" required>
                <TextInput id="acc-username" value={profile.username} minLength={3} maxLength={20}
                  onChange={(e) => setProfile({ ...profile, username: e.target.value })} />
              </Field>
              <Field label={t('account.bio')} htmlFor="acc-bio" optionalLabel={`${profile.bio.length}/600`}>
                <TextArea id="acc-bio" value={profile.bio} maxLength={600}
                  onChange={(e) => setProfile({ ...profile, bio: e.target.value })} />
              </Field>
              <Field label={t('label.language')} htmlFor="acc-locale">
                <Select id="acc-locale" value={profile.locale} onChange={(e) => setProfile({ ...profile, locale: e.target.value })}>
                  <option value="fr">Français</option>
                  <option value="en">English</option>
                  <option value="es" disabled>Español — 12 % (masqué)</option>
                  <option value="de" disabled>Deutsch — 8 % (masqué)</option>
                  <option value="it" disabled>Italiano — 5 % (masqué)</option>
                </Select>
              </Field>

              <div className="space-y-3 border-t border-ink-700 pt-4">
                <Checkbox id="acc-public" checked={profile.profilePublic}
                  onChange={(next) => setProfile({ ...profile, profilePublic: next })}
                  label={t('account.publicProfile')} hint={t('account.publicProfileHelp')} />
                <Checkbox id="acc-socials" checked={profile.showSocials}
                  onChange={(next) => setProfile({ ...profile, showSocials: next })}
                  label={t('account.showSocials')} hint="Masqués par défaut, y compris en profil public." />
              </div>

              <div className="border-t border-ink-700 pt-4">
                <p className="zm-label mb-3">{t('account.socials')}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {SOCIAL_KEYS.filter((k) => ['discord', 'steam', 'twitch', 'youtube'].includes(k)).map((key) => (
                    <Field key={key} label={key} htmlFor={`social-${key}`}>
                      <TextInput id={`social-${key}`} value={socials[key] ?? ''} placeholder="https://…"
                        onChange={(e) => setSocials({ ...socials, [key]: e.target.value })} />
                    </Field>
                  ))}
                </div>
              </div>

              <Button type="submit" variant="primary" disabled={savingProfile}>
                {savingProfile ? t('label.saving') : t('label.save')}
              </Button>
            </form>
          </Panel>

          <div className="space-y-4">
            <Panel className="p-5">
              <p className="zm-label mb-2">{t('account.mirageId')}</p>
              <p className="font-mono text-[13px] text-bone-100 break-all">{data.profile.mirageId}</p>
              <p className="mt-2 text-[11.5px] text-bone-500 leading-relaxed">{t('account.mirageIdHelp')}</p>
            </Panel>
            <Panel className="p-5">
              <p className="zm-label mb-2">Visibilité</p>
              <ul className="space-y-1.5 text-[11.5px] text-bone-400 leading-relaxed">
                <li>• Pseudonyme et Mirage ID : toujours visibles.</li>
                <li>• Statistiques : visibles uniquement si le profil est public.</li>
                <li>• Liens sociaux : masqués si profil privé, et masqués par défaut en public.</li>
                <li>• Adresse, licences et sécurité : visibles par vous seul.</li>
              </ul>
            </Panel>
            <Panel className="p-5">
              <p className="zm-label mb-2">{t('account.identities')}</p>
              {data.oauthIdentities.length === 0 && <p className="text-[12px] text-bone-500">Aucun fournisseur lié.</p>}
              <ul className="space-y-2">
                {data.oauthIdentities.map((identity: any) => (
                  <li key={identity.provider} className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11.5px] text-bone-200 capitalize">{identity.provider}</span>
                    <div className="flex gap-1.5">
                      <span className="font-mono text-[9.5px] text-bone-500">{formatDate(identity.linkedAt)}</span>
                      <Button size="sm" variant="ghost" onClick={async () => {
                        try {
                          await apiPost(`/api/account/oauth/${identity.provider}/unlink`);
                          await reload();
                        } catch (err) { handleError(err); }
                      }}>Délier</Button>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-2 font-mono text-[9.5px] text-bone-500">La liaison exige une réauthentification &lt; 5 min.</p>
            </Panel>
          </div>
        </div>
      )}

      {/* --------------------------------- SECURITY ------------------------------- */}
      {tab === 'security' && (
        <div className="grid gap-6 lg:grid-cols-2 items-start">
          <Panel className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-alert-400" aria-hidden />
              <h3 className="text-sm">{t('account.totp')}</h3>
            </div>
            {isStaff && (
              <Notice tone="warn">{t('account.staff2fa')}</Notice>
            )}
            {data.role === 'admin' && <Notice tone="info">{t('account.adminPasskey')}</Notice>}

            {twoFactor.totp ? (
              <div className="space-y-3">
                <p className="text-[12.5px] text-emerald-300 flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden /> Activée</p>
                {!isStaff && (
                  <Button variant="danger" size="sm" onClick={disableTotp}>{t('account.disable2fa')}</Button>
                )}
                <div className="border-t border-ink-700 pt-3">
                  <p className="zm-label mb-2">{t('account.backupCodes')}</p>
                  <p className="text-[11.5px] text-bone-400">Codes restants : <span className="font-mono text-bone-100">{twoFactor.backupCodesLeft}</span> / 10</p>
                  {!isStaff && (
                    <Button variant="outline" size="sm" className="mt-2" onClick={async () => {
                      const code = window.prompt('Code à 6 chiffres :') ?? '';
                      if (!code) return;
                      try {
                        const result = await apiPost<any>('/api/auth/2fa/backup-codes/regenerate', { code });
                        setBackupCodes(result.backupCodes);
                        await reload();
                      } catch (err) { handleError(err); }
                    }}>{t('account.regenerate')}</Button>
                  )}
                </div>
              </div>
            ) : totpSetup ? (
              <form onSubmit={enableTotp} className="space-y-3">
                <div className="flex gap-4 items-start">
                  <img src={totpSetup.qr} alt="QR code d’enrôlement TOTP" className="h-32 w-32 border border-ink-600 bg-white p-1" />
                  <div className="min-w-0">
                    <p className="zm-label mb-1">Clé manuelle</p>
                    <p className="font-mono text-[10.5px] text-bone-200 break-all">{totpSetup.secret}</p>
                    <button type="button" onClick={() => { void navigator.clipboard?.writeText(totpSetup.secret); }}
                      className="mt-1 inline-flex items-center gap-1 font-mono text-[9.5px] uppercase tracking-[0.1em] text-bone-500 hover:text-bone-200">
                      <Copy className="h-2.5 w-2.5" aria-hidden /> copier
                    </button>
                  </div>
                </div>
                <Field label="Code à 6 chiffres" htmlFor="enable-totp" required>
                  <TextInput id="enable-totp" inputMode="numeric" autoComplete="one-time-code" value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)} required />
                </Field>
                <div className="flex gap-2">
                  <Button type="submit" variant="primary" size="sm">Valider l’enrôlement</Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setTotpSetup(null)}>Annuler</Button>
                </div>
              </form>
            ) : (
              <Button variant="primary" size="sm" onClick={startTotp}>{t('account.enable2fa')}</Button>
            )}

            {backupCodes && (
              <div className="border border-signal-500/40 bg-signal-500/[0.06] p-4">
                <p className="zm-label mb-2 text-signal-400">Codes de secours — affichés une seule fois</p>
                <div className="grid grid-cols-2 gap-1 font-mono text-[11px] text-bone-100">
                  {backupCodes.map((code) => <span key={code}>{code}</span>)}
                </div>
                <p className="mt-2 text-[10.5px] text-bone-400">Stockés hachés, à usage unique. Conservez-les hors ligne.</p>
                <Button size="sm" variant="ghost" className="mt-2" onClick={() => setBackupCodes(null)}>J’ai conservé mes codes</Button>
              </div>
            )}

            {!isStaff && !twoFactor.totp && (
              <div className="border-t border-ink-700 pt-3">
                <p className="zm-label mb-1">Récupération</p>
                <p className="text-[11.5px] text-bone-400 leading-relaxed">
                  Une récupération en libre-service est possible après un délai de 72 h, uniquement pour les joueurs.
                </p>
                {twoFactor.recoveryAvailableAt ? (
                  <p className="mt-2 font-mono text-[10.5px] text-signal-400">
                    Demande enregistrée le {formatDateTime(twoFactor.recoveryAvailableAt)} — délai de 72 h.
                  </p>
                ) : (
                  <Button size="sm" variant="outline" className="mt-2" onClick={async () => {
                    try {
                      const result = await apiPost<any>('/api/auth/2fa/recovery');
                      setFlash({ tone: 'ok', message: `Récupération disponible le ${formatDateTime(result.availableAt)}.` });
                      await reload();
                    } catch (err) { handleError(err); }
                  }}>Demander une récupération</Button>
                )}
              </div>
            )}
          </Panel>

          <div className="space-y-4">
            <Panel className="p-6 space-y-3">
              <div className="flex items-center gap-2">
                <Fingerprint className="h-4 w-4 text-alert-400" aria-hidden />
                <h3 className="text-sm">{t('account.passkeys')}</h3>
              </div>
              <ul className="space-y-2">
                {twoFactor.passkeys.length === 0 && <li className="text-[12px] text-bone-500">Aucune passkey enregistrée.</li>}
                {twoFactor.passkeys.map((passkey: any) => (
                  <li key={passkey.id} className="flex items-center justify-between gap-2 border border-ink-600 rounded-[2px] px-3 py-2">
                    <div>
                      <p className="text-[12.5px] text-bone-200">{passkey.label}</p>
                      <p className="font-mono text-[9.5px] text-bone-500">ajoutée le {formatDate(passkey.createdAt)}</p>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => removePasskey(passkey.id)}>
                      <Trash2 className="h-3 w-3" aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex-1 min-w-[8rem]">
                  <Field label="Libellé" htmlFor="pk-label">
                    <TextInput id="pk-label" value={passkeyLabel} maxLength={60} onChange={(e) => setPasskeyLabel(e.target.value)} />
                  </Field>
                </div>
                <Button size="sm" variant="primary" onClick={addPasskey} disabled={!passkeysSupported()}>
                  {t('account.addPasskey')}
                </Button>
              </div>
              {!passkeysSupported() && <p className="font-mono text-[10px] text-bone-500">WebAuthn indisponible sur cet appareil.</p>}
            </Panel>

            <Panel className="p-6">
              <div className="flex items-center gap-2 mb-3">
                <KeyRound className="h-4 w-4 text-alert-400" aria-hidden />
                <h3 className="text-sm">{t('account.changePassword')}</h3>
              </div>
              <form onSubmit={changePassword} className="space-y-3">
                <Field label={t('auth.currentPassword')} htmlFor="pw-current" required>
                  <TextInput id="pw-current" type="password" autoComplete="current-password" value={passwordForm.current}
                    onChange={(e) => setPasswordForm({ ...passwordForm, current: e.target.value })} required />
                </Field>
                <Field label={t('auth.newPassword')} htmlFor="pw-next" required
                  hint={isStaff ? '14 caractères minimum pour le personnel.' : '12 caractères minimum.'}>
                  <TextInput id="pw-next" type="password" autoComplete="new-password" value={passwordForm.next}
                    onChange={(e) => setPasswordForm({ ...passwordForm, next: e.target.value })} required minLength={12} />
                </Field>
                <Field label={t('auth.confirmPassword')} htmlFor="pw-confirm" required>
                  <TextInput id="pw-confirm" type="password" autoComplete="new-password" value={passwordForm.confirm}
                    onChange={(e) => setPasswordForm({ ...passwordForm, confirm: e.target.value })} required />
                </Field>
                <Button type="submit" variant="primary" size="sm">{t('label.save')}</Button>
                <p className="font-mono text-[9.5px] text-bone-500">Révoque toutes les autres sessions (§6.8).</p>
              </form>
            </Panel>
          </div>
        </div>
      )}

      {/* --------------------------------- DEVICES -------------------------------- */}
      {tab === 'devices' && (
        <div className="space-y-4">
          <Panel className="p-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="zm-label mb-1">Politique de session</p>
              <p className="font-mono text-[11px] text-bone-300">
                {sessions.staffPolicy ? 'Personnel : 15 min d’inactivité / 8 h maximum' : 'Joueur : 30 jours d’inactivité / 90 jours maximum'}
              </p>
              <p className="font-mono text-[10px] text-bone-500 mt-1">Sessions actives : {sessions.active}</p>
            </div>
            <Button size="sm" variant="outline" onClick={revokeOthers}>{t('account.revokeOthers')}</Button>
          </Panel>
          <Panel>
            <ul className="divide-y divide-ink-800">
              {(sessionList.data?.sessions ?? []).map((session: any) => (
                <li key={session.id} className="px-4 py-3 flex items-start gap-3">
                  <Laptop className="h-4 w-4 text-bone-500 mt-0.5 shrink-0" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[12.5px] text-bone-100">{session.device}</p>
                      {session.current && <Badge tone="red">{t('account.currentSession')}</Badge>}
                      {session.revoked && <Badge tone="neutral">révoquée</Badge>}
                      {session.mfa && <Badge tone="green">2FA</Badge>}
                    </div>
                    <p className="font-mono text-[10px] text-bone-500 mt-0.5">
                      {session.ip} · dernière activité {relativise(session.lastSeen)} · expire {formatDate(session.expiresAt)}
                    </p>
                  </div>
                  {!session.current && !session.revoked && (
                    <Button size="sm" variant="ghost" onClick={async () => {
                      await revokeSession(session.id);
                      sessionList.reload();
                    }}>
                      {t('account.revoke')}
                    </Button>
                  )}
                </li>
              ))}
              {sessionList.loading && <li className="px-4 py-4"><Spinner label="Chargement des sessions…" /></li>}
              {!sessionList.loading && !sessionList.data?.sessions?.length && (
                <li className="px-4 py-4 text-[12px] text-bone-500">Aucune session enregistrée.</li>
              )}
            </ul>
          </Panel>
        </div>
      )}

      {/* ---------------------------------- STATS --------------------------------- */}
      {tab === 'stats' && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            {[
              [t('account.playtimeStory'), playtime(data.stats.storyPlaytimeMs)],
              [t('account.playtimeMp'), playtime(data.stats.multiplayerPlaytimeMs)],
              [t('account.totalDeaths'), String(data.stats.deaths)],
              [t('lb.reputation'), String(data.stats.reputation)],
            ].map(([label, value]) => (
              <Panel key={label} className="p-4">
                <p className="font-mono text-xl text-bone-100">{value}</p>
                <p className="zm-label mt-1 text-[9.5px]">{label}</p>
              </Panel>
            ))}
          </div>
          <Panel>
            <div className="border-b border-ink-700 px-4 py-2.5 flex items-center justify-between">
              <h3 className="zm-label">Meilleurs temps</h3>
              <span className="font-mono text-[9.5px] text-bone-500">synchronisation ≤ 24 h</span>
            </div>
            {data.stats.bestTimes.length === 0 ? <p className="px-4 py-4 text-[12px] text-bone-500">Aucune donnée de jeu.</p> : (
              <ul className="divide-y divide-ink-800">
                {data.stats.bestTimes.map((row: any, i: number) => (
                  <li key={i} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="font-mono text-[11px] text-bone-400 w-16">{row.operation}</span>
                    <span className="font-mono text-[10px] text-bone-500 w-14">{row.ending ?? '—'}</span>
                    <span className="flex-1 font-mono text-[12px] text-bone-100 text-right">{duration(row.bestTimeMs)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel className="p-4">
            <p className="zm-label mb-2">Morts par opération</p>
            <div className="flex flex-wrap gap-3">
              {data.stats.deathsByOperation.map((row: any) => (
                <span key={row.operation} className="font-mono text-[11px] text-bone-300 border border-ink-600 px-2 py-1">
                  {row.operation} : <span className="text-alert-300">{row.deaths}</span>
                </span>
              ))}
            </div>
            <p className="mt-3 font-mono text-[9.5px] text-bone-500">Réputation — titres : [titres à définir]</p>
          </Panel>
        </div>
      )}

      {/* -------------------------------- LICENSES -------------------------------- */}
      {tab === 'licenses' && (
        <div className="space-y-4">
          <Panel className="p-5">
            <p className="zm-label mb-3">Licences vérifiées</p>
            {data.licenses.length === 0 ? (
              <p className="text-[12.5px] text-bone-400">
                Aucune licence liée. La vérification est effectuée par le jeu auprès de la plateforme, jamais depuis le navigateur.
              </p>
            ) : (
              <ul className="space-y-2">
                {data.licenses.map((license: any) => (
                  <li key={license.provider} className="flex items-center justify-between border border-ink-600 rounded-[2px] px-3 py-2">
                    <div>
                      <p className="font-mono text-[12px] text-bone-100 capitalize">{license.provider}</p>
                      <p className="text-[10.5px] text-bone-500">{license.note}</p>
                    </div>
                    <Badge tone="green">{license.ownership}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <div className="grid gap-2 sm:grid-cols-4">
            {['steam', 'epic', 'discord', 'google'].map((provider) => (
              <Button key={provider} variant="subtle" size="sm" onClick={async () => {
                try {
                  const result = await apiGet<any>(`/api/auth/oauth/${provider}/start?link=1`);
                  window.location.href = result.url;
                } catch (err) { handleError(err); }
              }}>Lier {provider}</Button>
            ))}
          </div>
          <Notice tone="info">{data.licenses[0]?.note ?? 'Le partage familial Steam est accepté et marqué « shared ».'}</Notice>
        </div>
      )}

      {/* ---------------------------------- DATA ---------------------------------- */}
      {tab === 'data' && (
        <div className="grid gap-6 lg:grid-cols-2 items-start">
          <Panel className="p-6">
            <h3 className="text-sm mb-2">{t('account.exportData')}</h3>
            <p className="text-[12.5px] text-bone-400 leading-relaxed mb-4">
              Export JSON de vos données (compte, statistiques, sessions, tickets, journal d’audit vous concernant).
            </p>
            <a href="/api/account/export" className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-alert-300 hover:text-alert-200">
              <Download className="h-3.5 w-3.5" aria-hidden /> Télécharger l’export
            </a>
          </Panel>

          <Panel className="p-6 border-alert-700/50">
            <h3 className="text-sm mb-2 text-alert-300">{t('account.deleteAccount')}</h3>
            <p className="text-[12.5px] text-bone-400 leading-relaxed">{t('account.deleteWarning')}</p>
            <div className="mt-4 space-y-3">
              <Field label={t('auth.password')} htmlFor="del-password" hint="Confirmez votre mot de passe pour programmer la suppression.">
                <TextInput id="del-password" type="password" autoComplete="current-password" value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)} />
              </Field>
              <Button variant="danger" size="sm" onClick={requestDeletion} disabled={!deletePassword}>
                {t('account.deleteAccount')}
              </Button>
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}
