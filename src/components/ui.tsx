import { useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Link } from 'react-router-dom';
import { cx } from '../lib/format';
import { useAuth } from '../context/AuthContext';

/* ---------------------------------- Buttons --------------------------------- */

type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger' | 'subtle';

export function Button({
  variant = 'outline',
  size = 'md',
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md' | 'lg' }) {
  const base = 'inline-flex items-center justify-center gap-2 font-mono uppercase tracking-[0.12em] transition-colors disabled:opacity-45 disabled:cursor-not-allowed border rounded-[2px] whitespace-nowrap';
  const sizes = {
    sm: 'px-2.5 py-1.5 text-[10px]',
    md: 'px-4 py-2.5 text-[11px]',
    lg: 'px-6 py-3 text-xs',
  } as const;
  const variants = {
    primary: 'bg-alert-500 text-white border-alert-500 hover:bg-alert-400 hover:border-alert-400',
    outline: 'bg-transparent text-bone-200 border-ink-500 hover:border-alert-500 hover:text-bone-100',
    ghost: 'bg-transparent text-bone-300 border-transparent hover:text-bone-100 hover:bg-ink-800',
    danger: 'bg-transparent text-alert-300 border-alert-600 hover:bg-alert-500 hover:text-white',
    subtle: 'bg-ink-800 text-bone-200 border-ink-600 hover:border-ink-400',
  } as const;
  return (
    <button className={cx(base, sizes[size], variants[variant], className)} {...rest}>
      {children}
    </button>
  );
}

export function LinkButton({
  to, children, variant = 'outline', size = 'md', className,
}: { to: string; children: ReactNode; variant?: ButtonVariant; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const base = 'inline-flex items-center justify-center gap-2 font-mono uppercase tracking-[0.12em] transition-colors border rounded-[2px] whitespace-nowrap';
  const sizes = { sm: 'px-2.5 py-1.5 text-[10px]', md: 'px-4 py-2.5 text-[11px]', lg: 'px-6 py-3 text-xs' } as const;
  const variants = {
    primary: 'bg-alert-500 text-white border-alert-500 hover:bg-alert-400',
    outline: 'text-bone-200 border-ink-500 hover:border-alert-500 hover:text-bone-100',
    ghost: 'text-bone-300 border-transparent hover:text-bone-100',
    danger: 'text-alert-300 border-alert-600 hover:bg-alert-500 hover:text-white',
    subtle: 'bg-ink-800 text-bone-200 border-ink-600 hover:border-ink-400',
  } as const;
  return <Link to={to} className={cx(base, sizes[size], variants[variant], className)}>{children}</Link>;
}

/* ---------------------------------- Surfaces -------------------------------- */

export function Panel({ children, className, as: Tag = 'div' }: { children: ReactNode; className?: string; as?: any }) {
  return <Tag className={cx('zm-panel rounded-[3px]', className)}>{children}</Tag>;
}

export function SectionTitle({
  kicker, title, action, className,
}: { kicker?: string; title: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex items-end justify-between gap-4 mb-5', className)}>
      <div>
        {kicker && <p className="zm-label mb-1.5">{kicker}</p>}
        <h2 className="text-lg sm:text-xl">{title}</h2>
      </div>
      {action}
    </div>
  );
}

export function Badge({
  children, tone = 'neutral', className,
}: { children: ReactNode; tone?: 'neutral' | 'red' | 'amber' | 'green' | 'blue'; className?: string }) {
  const tones = {
    neutral: 'border-ink-500 text-bone-300 bg-ink-800/60',
    red: 'border-alert-600 text-alert-300 bg-alert-500/10',
    amber: 'border-signal-500/60 text-signal-400 bg-signal-500/10',
    green: 'border-emerald-700 text-emerald-300 bg-emerald-500/10',
    blue: 'border-sky-800 text-sky-300 bg-sky-500/10',
  } as const;
  return (
    <span className={cx('inline-flex items-center gap-1.5 border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] rounded-[2px]', tones[tone], className)}>
      {children}
    </span>
  );
}

export function Notice({
  tone = 'info', title, children, className,
}: { tone?: 'info' | 'warn' | 'danger' | 'ok'; title?: string; children: ReactNode; className?: string }) {
  const tones = {
    info: 'border-ink-500 bg-ink-800/50 text-bone-300',
    warn: 'border-signal-500/50 bg-signal-500/[0.07] text-bone-200',
    danger: 'border-alert-600 bg-alert-500/[0.07] text-bone-200',
    ok: 'border-emerald-800 bg-emerald-500/[0.06] text-bone-200',
  } as const;
  const marks = { info: 'i', warn: '!', danger: '×', ok: '✓' } as const;
  const colors = { info: 'text-bone-400', warn: 'text-signal-400', danger: 'text-alert-400', ok: 'text-emerald-400' } as const;
  return (
    <div className={cx('border-l-2 border rounded-[2px] px-4 py-3 text-[13px] leading-relaxed', tones[tone], className)} role={tone === 'danger' ? 'alert' : undefined}>
      <div className="flex gap-3">
        <span className={cx('font-mono text-xs mt-0.5 shrink-0', colors[tone])}>{marks[tone]}</span>
        <div className="min-w-0">
          {title && <p className="font-medium text-bone-100 mb-1">{title}</p>}
          <div className="space-y-1.5">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="border border-dashed border-ink-600 rounded-[3px] px-6 py-12 text-center">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-bone-400">{title}</p>
      {body && <p className="mt-2 text-sm text-bone-500 max-w-md mx-auto">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 py-10 justify-center text-bone-400">
      <span className="h-3 w-3 border border-alert-500 border-t-transparent rounded-full animate-spin" />
      <span className="font-mono text-[11px] uppercase tracking-[0.16em]">{label ?? 'Chargement…'}</span>
    </div>
  );
}

/* ----------------------------------- Forms ---------------------------------- */

export function Field({
  label, hint, error, children, htmlFor, required, optionalLabel,
}: {
  label: string; hint?: ReactNode; error?: string | null; children: ReactNode;
  htmlFor?: string; required?: boolean; optionalLabel?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className="zm-label text-bone-300">
          {label} {required && <span className="text-alert-400" aria-hidden>*</span>}
        </label>
        {optionalLabel && <span className="font-mono text-[10px] text-bone-500">{optionalLabel}</span>}
      </div>
      {children}
      {hint && !error && <p className="text-[11px] text-bone-500 leading-relaxed">{hint}</p>}
      {error && <p className="text-[11px] text-alert-300" role="alert">{error}</p>}
    </div>
  );
}

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx('zm-input', className)} {...rest} />;
}

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx('zm-input min-h-[100px] resize-y', className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx('zm-input appearance-none pr-8', className)} {...rest}>{children}</select>;
}

export function Checkbox({
  label, checked, onChange, hint, id,
}: { label: string; checked: boolean; onChange: (next: boolean) => void; hint?: string; id?: string }) {
  return (
    <label htmlFor={id} className="flex items-start gap-3 cursor-pointer group">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 border border-ink-500 bg-ink-900 checked:bg-alert-500 checked:border-alert-500 rounded-[2px]"
        style={{ accentColor: '#e11d2e' }}
      />
      <span className="text-[13px] text-bone-300 group-hover:text-bone-200">
        {label}
        {hint && <span className="block text-[11px] text-bone-500 mt-0.5">{hint}</span>}
      </span>
    </label>
  );
}

/* ----------------------------------- Misc ----------------------------------- */

export function Placeholder({ label }: { label?: string }) {
  return (
    <span className="font-mono text-[11px] text-signal-400/90 border border-signal-500/40 bg-signal-500/[0.06] px-1.5 py-0.5 rounded-[2px]">
      {label ?? '[À définir]'}
    </span>
  );
}

export function Tabs<T extends string>({
  tabs, value, onChange, className,
}: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (id: T) => void; className?: string }) {
  return (
    <div className={cx('flex flex-wrap gap-1 border-b border-ink-700', className)} role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={value === tab.id}
          onClick={() => onChange(tab.id)}
          className={cx(
            'px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] border-b-2 -mb-px transition-colors',
            value === tab.id
              ? 'border-alert-500 text-bone-100'
              : 'border-transparent text-bone-500 hover:text-bone-300',
          )}
        >
          {tab.label}
          {tab.count !== undefined && <span className="ml-2 text-bone-500">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; tone: 'neutral' | 'red' | 'amber' | 'green' | 'blue' }> = {
    draft: { label: 'Brouillon', tone: 'neutral' },
    review: { label: 'Vérification', tone: 'amber' },
    scheduled: { label: 'Planification', tone: 'blue' },
    published: { label: 'Publié', tone: 'green' },
    archived: { label: 'Archivé', tone: 'neutral' },
    deleted: { label: 'Supprimé', tone: 'red' },
    active: { label: 'Actif', tone: 'green' },
    pending: { label: 'En attente', tone: 'amber' },
    suspended: { label: 'Suspendu', tone: 'red' },
    open: { label: 'Ouvert', tone: 'amber' },
    in_progress: { label: 'En cours', tone: 'blue' },
    waiting: { label: 'En attente client', tone: 'neutral' },
    closed: { label: 'Fermé', tone: 'neutral' },
  };
  const entry = map[status] ?? { label: status, tone: 'neutral' as const };
  return <Badge tone={entry.tone}>{entry.label}</Badge>;
}

export function Table({ head, children, className }: { head: ReactNode[]; children: ReactNode; className?: string }) {
  return (
    <div className={cx('overflow-x-auto border border-ink-700 rounded-[2px]', className)}>
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="border-b border-ink-700 bg-ink-850">
            {head.map((cell, i) => (
              <th key={i} className="px-3 py-2 zm-label font-normal whitespace-nowrap">{cell}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-800">{children}</tbody>
      </table>
    </div>
  );
}

export function Modal({
  open, onClose, title, children, footer, wide,
}: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-start sm:items-center justify-center p-4 bg-black/75 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={title}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={cx('zm-panel w-full rounded-[3px] max-h-[88vh] overflow-y-auto zm-rise', wide ? 'max-w-3xl' : 'max-w-md')}>
        <div className="flex items-center justify-between gap-4 border-b border-ink-700 px-5 py-3.5">
          <h3 className="text-sm font-medium">{title}</h3>
          <button onClick={onClose} className="text-bone-500 hover:text-bone-100 font-mono text-xs" aria-label="Fermer">ESC ×</button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="border-t border-ink-700 px-5 py-3.5 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

/** Global reauthentication modal, triggered by any sensitive action. */
export function ReauthModal() {
  const { reauthOpen, closeReauth, reauth } = useAuth();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await reauth(password, code || undefined);
      setPassword('');
      setCode('');
    } catch (err: any) {
      setError(err?.message ?? 'Réauthentification refusée.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={reauthOpen} onClose={closeReauth} title="Réauthentification requise">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-[13px] text-bone-400 leading-relaxed">
          Cette action sensible exige une confirmation de moins de cinq minutes (mot de passe et, si activé, code de double authentification).
        </p>
        <Field label="Mot de passe" htmlFor="reauth-password" required>
          <TextInput id="reauth-password" type="password" autoComplete="current-password" value={password}
            onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <Field label="Code à 6 chiffres" htmlFor="reauth-code" optionalLabel="si 2FA activée">
          <TextInput id="reauth-code" inputMode="numeric" autoComplete="one-time-code" value={code}
            onChange={(e) => setCode(e.target.value)} />
        </Field>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={closeReauth}>Annuler</Button>
          <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Vérification…' : 'Confirmer'}</Button>
        </div>
      </form>
    </Modal>
  );
}

