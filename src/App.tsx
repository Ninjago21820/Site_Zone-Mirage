import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ReauthModal, Spinner } from './components/ui';
import Home from './pages/Home';
import News from './pages/News';
import NewsArticle from './pages/NewsArticle';
import Roadmap from './pages/Roadmap';
import ZoneMap from './pages/ZoneMap';
import Wiki from './pages/Wiki';
import WikiArticle from './pages/WikiArticle';
import Store from './pages/Store';
import Servers from './pages/Servers';
import Leaderboards from './pages/Leaderboards';
import Faq from './pages/Faq';
import Support from './pages/Support';
import Maintenance from './pages/Maintenance';
import LegalPage from './pages/LegalPage';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import OAuthMock from './pages/OAuthMock';
import Account from './pages/Account';
import Profile from './pages/Profile';
import NotFound from './pages/NotFound';

const BackOffice = lazy(() => import('./admin/BackOffice'));

export const ADMIN_BASE = '/console-mirage';

function RouteFallback() {
  return (
    <div className="min-h-[50vh] grid place-items-center">
      <Spinner label="Chargement du module sécurisé…" />
    </div>
  );
}

/**
 * French URLs are the primary language of the specification: every French
 * alias permanently redirects to its canonical (english) route so that both
 * spellings work without duplicating content.
 */
function AliasRedirect({ base }: { base: string }) {
  const { slug } = useParams();
  const { search } = useLocation();
  return <Navigate to={`${base}${slug ? `/${slug}` : ''}${search}`} replace />;
}

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Layout><Home /></Layout>} />
        <Route path="/news" element={<Layout><News /></Layout>} />
        <Route path="/news/:slug" element={<Layout><NewsArticle /></Layout>} />
        <Route path="/roadmap" element={<Layout><Roadmap /></Layout>} />
        <Route path="/map" element={<Layout><ZoneMap /></Layout>} />
        <Route path="/wiki" element={<Layout><Wiki /></Layout>} />
        <Route path="/wiki/:slug" element={<Layout><WikiArticle /></Layout>} />
        <Route path="/store" element={<Layout><Store /></Layout>} />
        <Route path="/servers" element={<Layout><Servers /></Layout>} />
        <Route path="/leaderboards" element={<Layout><Leaderboards /></Layout>} />
        <Route path="/faq" element={<Layout><Faq /></Layout>} />
        <Route path="/support" element={<Layout><Support /></Layout>} />
        <Route path="/maintenance" element={<Layout><Maintenance /></Layout>} />
        <Route path="/legal/:slug" element={<Layout><LegalPage /></Layout>} />
        <Route path="/login" element={<Layout><Login /></Layout>} />
        <Route path="/register" element={<Layout><Register /></Layout>} />
        <Route path="/forgot-password" element={<Layout><ForgotPassword /></Layout>} />
        <Route path="/reset-password" element={<Layout><ResetPassword /></Layout>} />
        <Route path="/oauth/mock" element={<Layout><OAuthMock /></Layout>} />
        <Route path="/account" element={<Layout><Account /></Layout>} />
        <Route path="/profile/:mirageId" element={<Layout><Profile /></Layout>} />
        <Route path="/admin/*" element={<Navigate to="/404" replace />} />
        <Route
          path={`${ADMIN_BASE}/*`}
          element={
            <Suspense fallback={<Layout><RouteFallback /></Layout>}>
              <BackOffice />
            </Suspense>
          }
        />
        {/* Alias français → routes canoniques */}
        <Route path="/actualites" element={<AliasRedirect base="/news" />} />
        <Route path="/actualites/:slug" element={<AliasRedirect base="/news" />} />
        <Route path="/carte" element={<AliasRedirect base="/map" />} />
        <Route path="/boutique" element={<AliasRedirect base="/store" />} />
        <Route path="/serveurs" element={<AliasRedirect base="/servers" />} />
        <Route path="/classements" element={<AliasRedirect base="/leaderboards" />} />
        <Route path="/connexion" element={<AliasRedirect base="/login" />} />
        <Route path="/inscription" element={<AliasRedirect base="/register" />} />
        <Route path="/mot-de-passe-oublie" element={<AliasRedirect base="/forgot-password" />} />
        <Route path="/reinitialisation" element={<AliasRedirect base="/reset-password" />} />
        <Route path="/compte" element={<AliasRedirect base="/account" />} />
        <Route path="/profil/:mirageId" element={<AliasRedirect base="/profile" />} />
        <Route path="/mentions-legales" element={<AliasRedirect base="/legal/mentions-legales" />} />
        <Route path="/confidentialite" element={<AliasRedirect base="/legal/politique-confidentialite" />} />
        <Route path="/cookies" element={<AliasRedirect base="/legal/cookies" />} />
        <Route path="/cgu" element={<AliasRedirect base="/legal/cgu" />} />
        <Route path="/licence-cc-by-sa" element={<AliasRedirect base="/legal/licence-cc-by-sa" />} />
        <Route path="/404" element={<Layout><NotFound /></Layout>} />
        <Route path="*" element={<Layout><NotFound /></Layout>} />
      </Routes>
      <ReauthModal />
    </>
  );
}
