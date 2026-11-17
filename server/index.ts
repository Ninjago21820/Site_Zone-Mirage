import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import path from 'node:path';
import type { DB } from './db.js';
import { openDb } from './db.js';
import {
  HOST, IS_PROD, PORT, ADMIN_PATH, DATA_DIR, DELETION_GRACE_MS,
} from './config.js';
import { securityHeaders, requestContext, csrfProtection, ensureCsrfCookie, originCheck, clientIp } from './middleware/security.js';
import { sessionLoader } from './middleware/auth.js';
import { authRoutes } from './routes/auth.js';
import { publicRoutes } from './routes/public.js';
import { accountRoutes } from './routes/account.js';
import { serverRoutes } from './routes/servers.js';
import { supportRoutes } from './routes/support.js';
import { adminRoutes } from './routes/admin.js';
import { apiV1Routes } from './routes/api.v1.js';
import { purgeAudit } from './lib/audit.js';
import { revokeAllForUser } from './lib/sessions.js';
import { ensureSigningKey } from './lib/licenses.js';

export interface AppOptions {
  frontend?: 'vite' | 'static' | 'none';
}

const RESERVED_ADMIN_PATHS = [
  '/admin', '/administrator', '/administration', '/wp-admin', '/wp-login.php',
  '/backoffice', '/back-office', '/console', '/cpanel', '/admin.php',
];

export async function createApp(db: DB, options: AppOptions = {}): Promise<Express> {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(securityHeaders());
  app.use(requestContext());
  app.use(cookieParser());
  app.use(express.json({
    limit: '512kb',
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
    },
  }));
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));
  app.use(originCheck());
  app.use(ensureCsrfCookie());
  app.use(sessionLoader(db));
  app.use(csrfProtection());

  // §6.9.3 — the back-office never lives on a guessable path.
  app.use((req, res, next) => {
    const pathname = req.path.replace(/\/+$/, '').toLowerCase() || '/';
    const blocked = RESERVED_ADMIN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
    if (blocked) return res.status(404).type('txt').send('Not Found');
    next();
  });

  app.use('/api/auth', authRoutes(db));
  app.use('/api/account', accountRoutes(db));
  app.use('/api/servers', serverRoutes(db));
  app.use('/api/support', supportRoutes(db));
  app.use('/api/v1', apiV1Routes(db));
  app.use('/api/backoffice', adminRoutes(db));
  app.use('/api', publicRoutes(db));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));

  // Health for the platform preview and uptime checks.
  app.get('/healthz', (_req, res) => res.status(200).json({ status: 'ok' }));

  if (options.frontend === 'vite') {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true, allowedHosts: true },
      appType: 'custom',
    });
    app.use(vite.middlewares);
    app.use('*splat', async (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      try {
        const template = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');
        const html = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).set('Content-Type', 'text/html').end(html);
      } catch (error) {
        vite.ssrFixStacktrace(error as Error);
        next(error);
      }
    });
  } else if (options.frontend === 'static') {
    const clientDir = path.join(process.cwd(), 'dist', 'client');
    app.use(express.static(clientDir, { index: false, maxAge: '1h', etag: true }));
    app.use('*splat', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      const file = path.join(clientDir, 'index.html');
      if (!fs.existsSync(file)) return res.status(500).send('Application non compilée.');
      res.sendFile(file);
    });
  }

  app.use((err: Error & { status?: number }, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = err.status ?? 500;
    if (status >= 500) console.error('[error]', err.message, process.env.DEBUG_ERR ? err.stack : '');
    res.status(status).json({
      error: status >= 500 ? 'internal_error' : 'request_error',
      message: status >= 500 && IS_PROD ? 'Erreur interne.' : err.message,
    });
  });

  return app;
}

/** Housekeeping: account purge after the 7-day window, audit retention. */
async function startHousekeeping(db: DB) {
  const run = async () => {
    try {
      await purgeAudit(db);
      const now = Date.now();
      const expired = await db.all("SELECT id FROM users WHERE status = 'pending_deletion' AND purge_after IS NOT NULL AND purge_after < ?", [now]) as { id: string }[];
      for (const user of expired) {
        await revokeAllForUser(db, user.id, null, 'account_purged');
        // The Mirage ID row in reserved_mirage_ids is intentionally kept forever.
        await db.run('DELETE FROM users WHERE id = ?', [user.id]);
      }
      await db.run('DELETE FROM login_attempts WHERE at < ?', [now - 30 * 86400000]);
      await db.run('DELETE FROM sessions WHERE absolute_expires_at < ?', [now - 7 * 86400000]);
    } catch (error) {
      console.error('[housekeeping]', (error as Error).message);
    }
  };
  await run();
  const timer = setInterval(run, 60 * 60 * 1000);
  timer.unref();
  void DELETION_GRACE_MS;
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const isDirectRun = process.argv[1] && /server[\\/]index\.(ts|js)$/.test(process.argv[1]);

if (isDirectRun) {
  const db = await openDb();
  await ensureSigningKey(db);
  await startHousekeeping(db);
  const app = await createApp(db, { frontend: IS_PROD ? 'static' : 'vite' });
  app.listen(PORT, HOST, async () => {
    console.log(`\n  SCP: Mirage Protocol — serveur démarré`);
    console.log(`  → http://${HOST}:${PORT}`);
    console.log(`  → Back-office : ${ADMIN_PATH}`);
    console.log(`  → Environnement : ${IS_PROD ? 'production' : 'développement'}`);
    console.log(`  → Journal d'audit : ${(await db.get('SELECT COUNT(*) AS c FROM audit_log') as { c: number }).c} entrées\n`);
    void clientIp;
  });
}

export { startHousekeeping };
