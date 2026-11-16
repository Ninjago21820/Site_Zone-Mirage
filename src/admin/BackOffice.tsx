import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import {
  Activity, BookLock, Database, FileText, Gauge, ScrollText, ShieldAlert, ShieldCheck, Users as UsersIcon, Wrench,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useApi } from '../lib/useApi';
import { Badge, LinkButton, Notice, Panel, Spinner } from '../components/ui';
import { cx } from '../lib/format';
import { ADMIN_BASE } from '../App';
import Dashboard from './Dashboard';
import ContentList from './ContentList';
import ContentEditor from './ContentEditor';
import Users from './Users';
import Moderation from './Moderation';
import System from './System';
import Security from './Security';
import Matrices from './Matrices';

const NAV = [
  { to: '', label: 'Tableau de bord', icon: Gauge, exact: true, needs: null },
  { to: 'contenu', label: 'Contenus', icon: FileText, needs: null },
  { to: 'utilisateurs', label: 'Utilisateurs', icon: UsersIcon, needs: 'users_roles' },
  { to: 'moderation', label: 'Modération', icon: ShieldAlert, needs: null },
  { to: 'audit', label: 'Journal d’audit', icon: ScrollText, needs: 'audit_log' },
  { to: 'systeme', label: 'Système', icon: Database, needs: null },
  { to: 'securite', label: 'Sécurité', icon: ShieldCheck, needs: null },
  { to: 'matrices', label: 'Matrices de droits', icon: BookLock, needs: null },
];

export default function BackOffice() {
  const { me, loading } = useAuth();
  const { data, loading: sessionLoading, error } = useApi<any>(me.authenticated && me.staff ? '/api/backoffice/session' : null, [me.authenticated, me.staff]);
  const location = useLocation();

  if (loading) {
    return <div className="min-h-screen bg-ink-950 grid place-items-center"><Spinner label="Vérification de la session…" /></div>;
  }

  if (!me.authenticated) {
    return (
      <div className="min-h-screen bg-ink-950 grid place-items-center px-4">
        <Panel className="max-w-md p-8 text-center">
          <ShieldAlert className="h-6 w-6 text-alert-400 mx-auto mb-4" aria-hidden />
          <h1 className="text-lg mb-2">Accès réservé au personnel</h1>
          <p className="text-[13px] text-bone-400 mb-5">
            Cette console n’est pas accessible publiquement. Connectez-vous avec un compte disposant d’un rôle interne et d’une double authentification validée.
          </p>
          <LinkButton to="/login" variant="primary">Connexion</LinkButton>
        </Panel>
      </div>
    );
  }

  if (!me.staff) {
    return (
      <div className="min-h-screen bg-ink-950 grid place-items-center px-4">
        <Panel className="max-w-md p-8 text-center">
          <ShieldAlert className="h-6 w-6 text-alert-400 mx-auto mb-4" aria-hidden />
          <h1 className="text-lg mb-2">Accès refusé</h1>
          <p className="text-[13px] text-bone-400">Ce compte ne dispose d’aucun rôle interne.</p>
          <LinkButton to="/" className="mt-5">Retour au site</LinkButton>
        </Panel>
      </div>
    );
  }

  if (me.mustEnrollMfa) {
    return (
      <div className="min-h-screen bg-ink-950 grid place-items-center px-4">
        <Panel className="max-w-lg p-8">
          <ShieldCheck className="h-6 w-6 text-signal-400 mx-auto mb-4" aria-hidden />
          <h1 className="text-lg mb-2 text-center">Double authentification requise</h1>
          <p className="text-[13px] text-bone-400 text-center mb-5">
            Le back-office exige une session dont la double authentification a été validée. Enrôlez un facteur puis reconnectez-vous.
          </p>
          <div className="flex justify-center"><LinkButton to="/account" variant="primary">Gérer ma sécurité</LinkButton></div>
        </Panel>
      </div>
    );
  }

  if (sessionLoading || !data) {
    return <div className="min-h-screen bg-ink-950 grid place-items-center">
      {error ? <Notice tone="danger" className="m-6">{error.message}</Notice> : <Spinner label="Chargement de la console…" />}
    </div>;
  }

  const functions = data.permissions.functions as Record<string, boolean>;
  const allowed = NAV.filter((item) => !item.needs || functions[item.needs]);

  return (
    <div className="min-h-screen bg-ink-950 flex flex-col lg:flex-row">
      <aside className="lg:w-60 shrink-0 border-b lg:border-b-0 lg:border-r border-ink-700 bg-ink-900/70">
        <div className="px-4 py-4 border-b border-ink-700">
          <p className="font-mono text-[9.5px] uppercase tracking-[0.24em] text-alert-400">Back-office</p>
          <p className="text-[13.5px] text-bone-100 mt-1">SCP: Mirage Protocol</p>
          <p className="font-mono text-[9.5px] text-bone-500 mt-1">{data.path}</p>
        </div>
        <div className="px-4 py-3 border-b border-ink-700">
          <p className="font-mono text-[11px] text-bone-200 truncate">{data.user.username}</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            <Badge tone="red">{data.user.roleLabel}</Badge>
            <Badge tone="green">2FA</Badge>
          </div>
          <p className="font-mono text-[9px] text-bone-500 mt-1.5">session 15 min / 8 h</p>
        </div>
        <nav className="p-2 space-y-0.5" aria-label="Navigation back-office">
          {allowed.map((item) => (
            <NavLink
              key={item.to}
              to={item.to ? `${ADMIN_BASE}/${item.to}` : ADMIN_BASE}
              end={item.exact}
              className={({ isActive }) => cx(
                'flex items-center gap-2.5 px-2.5 py-2 rounded-[2px] font-mono text-[10.5px] uppercase tracking-[0.1em] transition-colors',
                isActive || (item.to && location.pathname.startsWith(`${ADMIN_BASE}/${item.to}`))
                  ? 'bg-ink-800 text-bone-100 border-l-2 border-alert-500'
                  : 'text-bone-400 hover:bg-ink-850 border-l-2 border-transparent',
              )}
            >
              <item.icon className="h-3.5 w-3.5" aria-hidden />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 mt-auto border-t border-ink-700">
          <LinkButton to="/" size="sm" variant="ghost" className="w-full">← Site public</LinkButton>
          <p className="mt-2 font-mono text-[9px] text-bone-600 text-center">
            {data.security.reauthFresh ? 'réauthentifié < 5 min' : 'réauthentification requise pour les actions sensibles'}
          </p>
        </div>
      </aside>

      <div className="flex-1 min-w-0">
        <div className="border-b border-ink-700 bg-ink-900/40 px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-bone-500">
            <Activity className="h-3 w-3 text-emerald-400" aria-hidden />
            console interne · {data.user.mirageId}
          </div>
          <div className="flex items-center gap-2">
            <Badge tone="neutral"><Wrench className="h-2.5 w-2.5" aria-hidden />{Object.values(functions).filter(Boolean).length} fonctions</Badge>
            <Badge tone="neutral">/admin → 404</Badge>
          </div>
        </div>
        <div className="p-4 sm:p-6">
          <Routes>
            <Route index element={<Dashboard data={data} />} />
            <Route path="contenu" element={<ContentList data={data} />} />
            <Route path="contenu/:id" element={<ContentEditor data={data} />} />
            <Route path="utilisateurs" element={<Users data={data} />} />
            <Route path="moderation" element={<Moderation data={data} />} />
            <Route path="audit" element={<System data={data} view="audit" />} />
            <Route path="systeme" element={<System data={data} view="system" />} />
            <Route path="securite" element={<Security data={data} />} />
            <Route path="matrices" element={<Matrices data={data} />} />
            <Route path="*" element={<Notice tone="warn">Section introuvable.</Notice>} />
          </Routes>
        </div>
      </div>
    </div>
  );
}

export interface BackOfficeProps {
  data: any;
}
