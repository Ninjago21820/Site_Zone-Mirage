// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import type { Express } from 'express';
import type { Server } from 'node:http';
import App, { ADMIN_BASE } from '../src/App';
import { I18nProvider } from '../src/i18n';
import { AuthProvider } from '../src/context/AuthContext';
import { harness, newClient, extractCookie, resetTotp } from './helpers';
import type { DB } from '../server/db.js';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let app: Express;
let db: DB;
let server: Server;
let base: string;
let authCookie = '';
const realFetch = globalThis.fetch;

beforeAll(async () => {
  const h = await harness();
  app = h.app;
  db = h.db;
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(3311, '127.0.0.1', () => resolve(s));
  });
  base = 'http://127.0.0.1:3311';
  // Browser code only ever talks to relative URLs; the harness resolves them
  // against the live Express instance.
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const target = typeof input === 'string' && input.startsWith('/') ? `${base}${input}` : input;
    return realFetch(target as RequestInfo, init);
  }) as typeof fetch;
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function render(path: string): string {
  return renderToString(
    <MemoryRouter initialEntries={[path]}>
      <I18nProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </I18nProvider>
    </MemoryRouter>,
  );
}

const PUBLIC_ROUTES = [
  '/', '/news', '/news/ouverture-du-site-officiel', '/roadmap', '/map',
  '/wiki', '/wiki/zone-mirage', '/store', '/servers', '/leaderboards', '/faq',
  '/support', '/maintenance', '/legal/mentions-legales', '/legal/politique-confidentialite',
  '/legal/cookies', '/legal/cgu', '/legal/licence-cc-by-sa', '/login', '/register',
  '/forgot-password', '/reset-password', '/account',
  '/profile/MIRAGE:2.26.000000000000000000', ADMIN_BASE, '/route-inexistante',
];

const FRENCH_ALIASES = [
  '/actualites', '/actualites/ouverture-du-site-officiel', '/carte', '/boutique',
  '/serveurs', '/classements', '/connexion', '/inscription', '/mot-de-passe-oublie',
  '/reinitialisation', '/compte', '/profil/MIRAGE:2.26.000000000000000000',
  '/mentions-legales', '/confidentialite', '/cookies', '/cgu', '/licence-cc-by-sa',
];

describe('Rendu des pages publiques', () => {
  for (const route of PUBLIC_ROUTES) {
    it(`rend ${route} sans erreur`, () => {
      const html = render(route);
      expect(html.length).toBeGreaterThan(500);
      expect(html).not.toContain('Something went wrong');
      expect(html.toLowerCase()).not.toContain('cannot read');
      expect(html).not.toContain('undefined</');
    });
  }
});

async function signInAsStaff(username: string): Promise<void> {
  const client = await newClient(app);
  resetTotp(db, username);
  const first = await client.post('/api/auth/login', { identifier: username, password: 'Mirage-Staff-2026' });
  const second = await client.post('/api/auth/login/2fa', {
    code: (await import('../server/lib/totp.js')).totpAt('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'),
  });
  if (second.status !== 200) throw new Error(`staff login failed: ${second.status} ${JSON.stringify(second.body)}`);
  const session = extractCookie(first, 'zm_sid') ?? extractCookie(second, 'zm_sid');
  const csrf = extractCookie(second, 'zm_csrf') ?? extractCookie(first, 'zm_csrf') ?? client.csrf;
  if (!session) throw new Error('no session cookie issued');
  authCookie = `zm_sid=${session}; zm_csrf=${csrf}`;
  // Cookies are a forbidden header in the Fetch standard, so the browser test
  // sets them on the document instead — exactly how a real browser carries them.
  document.cookie = `zm_sid=${session}; path=/`;
  document.cookie = `zm_csrf=${csrf}; path=/`;
}

async function renderClient(path: string): Promise<string> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root | undefined;
  const paint = async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(
        <MemoryRouter initialEntries={[path]}>
          <I18nProvider>
            <AuthProvider>
              <App />
            </AuthProvider>
          </I18nProvider>
        </MemoryRouter>,
      );
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
  };
  await paint();
  for (let i = 0; i < 25 && (container.textContent ?? '').length < 200; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
  }
  const text = container.textContent ?? '';
  if (process.env.DUMP) console.log('TEXT', path, text.slice(0, 600));
  await act(async () => {
    root?.unmount();
  });
  container.remove();
  return text;
}

describe('Alias français', () => {
  for (const route of FRENCH_ALIASES) {
    it(`redirige ${route} vers la page canonique`, async () => {
      const text = await renderClient(route);
      expect(text.length).toBeGreaterThan(500);
      if (!route.startsWith('/profil/')) {
        expect(text).not.toContain('Page introuvable');
      }
    });
  }
});

describe('Hydratation avec les vraies données de l’API', () => {
  it('affiche le contenu chargé depuis le serveur', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    let root: Root | undefined;
    await act(async () => {
      root = createRoot(container);
      root.render(
        <MemoryRouter initialEntries={['/']}>
          <I18nProvider>
            <AuthProvider>
              <App />
            </AuthProvider>
          </I18nProvider>
        </MemoryRouter>,
      );
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    const text = container.textContent ?? '';
    expect(text).toContain('Mirage');
    expect(text).not.toContain('Cannot read');
    await act(async () => {
      root?.unmount();
    });
    container.remove();
  });

  it('rend le classement avec les temps du serveur', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    let root: Root | undefined;
    await act(async () => {
      root = createRoot(container);
      root.render(
        <MemoryRouter initialEntries={['/classements']}>
          <I18nProvider>
            <AuthProvider>
              <App />
            </AuthProvider>
          </I18nProvider>
        </MemoryRouter>,
      );
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    const text = container.textContent ?? '';
    expect(text).toMatch(/joueur|Classement|Aucun/i);
    await act(async () => {
      root?.unmount();
    });
    container.remove();
  });
});

describe('Back-office authentifié', () => {
  beforeAll(async () => {
    await import('../src/admin/BackOffice');
    await signInAsStaff('admin');
  });

  const ADMIN_ROUTES = [
    ADMIN_BASE,
    `${ADMIN_BASE}/contenu`,
    `${ADMIN_BASE}/audit`,
    `${ADMIN_BASE}/utilisateurs`,
    `${ADMIN_BASE}/moderation`,
    `${ADMIN_BASE}/matrices`,
    `${ADMIN_BASE}/systeme`,
    `${ADMIN_BASE}/securite`,
  ];

  for (const route of ADMIN_ROUTES) {
    it(`affiche ${route} pour un administrateur`, async () => {
      const text = await renderClient(route);
      expect(text.length).toBeGreaterThan(100);
      expect(text).not.toMatch(/Cannot read|is not a function|Uncaught/i);
      expect(text).not.toContain('Accès réservé');
    });
  }

  it('bloque le back-office sans session staff', async () => {
    authCookie = '';
    document.cookie = 'zm_sid=; path=/; max-age=0';
    const text = await renderClient(ADMIN_BASE);
    expect(text).toMatch(/réserv|connexion|Authentification/i);
    await signInAsStaff('admin');
  });
});
