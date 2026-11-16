import request from 'supertest';
import type { Express } from 'express';
import { openDb, seed, type DB, DEMO_TOTP_SECRET } from '../server/db.js';
import { createApp } from '../server/index.js';
import { totpAt } from '../server/lib/totp.js';

export const STAFF_PASSWORD = 'Mirage-Staff-2026';
export const PLAYER_PASSWORD = 'Mirage-Demo-2026';
export { DEMO_TOTP_SECRET };

export interface Harness {
  db: DB;
  app: Express;
}

export async function harness(): Promise<Harness> {
  const db = openDb(':memory:');
  await seed(db);
  const app = await createApp(db, { frontend: 'none' });
  return { db, app };
}

export function extractCookie(res: request.Response, name: string): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  if (!raw) return undefined;
  for (const line of raw) {
    const [pair] = line.split(';');
    const [key, value] = pair.split('=');
    if (key === name) return value;
  }
  return undefined;
}

export interface Client {
  agent: ReturnType<typeof request.agent>;
  csrf: string;
  sync: (res: request.Response) => void;
  get: (path: string) => request.Test;
  post: (path: string, body?: unknown) => Promise<request.Response>;
  patch: (path: string, body?: unknown) => Promise<request.Response>;
  put: (path: string, body?: unknown) => Promise<request.Response>;
  del: (path: string, body?: unknown) => Promise<request.Response>;
}

export async function newClient(app: Express): Promise<Client> {
  const agent = request.agent(app);
  const boot = await agent.get('/api/site');
  const state = { csrf: extractCookie(boot, 'zm_csrf') ?? '' };
  const withCsrf = (req: request.Test) => req.set('X-CSRF-Token', state.csrf);
  const send = async (req: request.Test): Promise<request.Response> => {
    const res = await req;
    const fresh = extractCookie(res, 'zm_csrf');
    if (fresh) state.csrf = fresh;
    return res;
  };
  const client: Client = {
    agent,
    get csrf() {
      return state.csrf;
    },
    sync(res) {
      const fresh = extractCookie(res, 'zm_csrf');
      if (fresh) state.csrf = fresh;
    },
    get: (path) => agent.get(path),
    post: (path, body) => send(withCsrf(agent.post(path)).send(body ?? {})),
    patch: (path, body) => send(withCsrf(agent.patch(path)).send(body ?? {})),
    put: (path, body) => send(withCsrf(agent.put(path)).send(body ?? {})),
    del: (path, body) => send(withCsrf(agent.delete(path)).send(body ?? {})),
  };
  return client;
}

/** Clears the TOTP anti-replay marker so a test can log in again immediately. */
export function resetTotp(db: DB, username: string) {
  db.prepare('UPDATE users SET totp_last_step = NULL WHERE username = ?').run(username);
}

export async function loginStaff(client: Client, db: DB, username: string): Promise<request.Response> {
  resetTotp(db, username);
  const first = await client.post('/api/auth/login', { identifier: username, password: STAFF_PASSWORD });
  client.sync(first);
  if (first.body?.mfaRequired) {
    const secret = (db.prepare('SELECT totp_secret FROM users WHERE username = ?').get(username) as { totp_secret: string }).totp_secret;
    const second = await client.post('/api/auth/login/2fa', { code: totpAt(secret) });
    client.sync(second);
    return second;
  }
  return first;
}

export async function loginPlayer(client: Client, username = 'joueur'): Promise<request.Response> {
  const res = await client.post('/api/auth/login', { identifier: username, password: PLAYER_PASSWORD });
  client.sync(res);
  return res;
}

export const rid = () =>
  Math.random().toString(36).slice(2, 10);
