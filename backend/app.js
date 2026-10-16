import path from 'node:path';
import express from 'express';
import { config, ROOT } from './config.js';
import { sessionMiddleware, csrfMiddleware } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { rateLimit, startCleanupTimer } from './middleware/rateLimit.js';
import { authRouter } from './routes/auth.js';
import { publicRouter } from './routes/public.js';
import { requestsRouter } from './routes/requests.js';
import { staffRouter } from './routes/staff.js';
import { gateRouter } from './routes/gate.js';
import { adminRouter } from './routes/admin.js';
import { notificationsRouter } from './routes/notifications.js';
import { purgeExpiredSessions } from './services/auth.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // CORS: the static frontend (e.g. GitHub Pages) runs on a different origin
  // than the API, so allowed origins are configured explicitly with credentials.
  app.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin && config.allowedOrigins.includes(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Access-Control-Allow-Credentials', 'true');
      res.set('Vary', 'Origin');
      res.set('Access-Control-Allow-Headers', 'content-type,x-csrf-token,idempotency-key');
      res.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
      res.set('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });

  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    res.set('X-Frame-Options', 'DENY');
    next();
  });

  app.use(express.json({ limit: '64kb' }));
  app.use(sessionMiddleware);
  app.use(csrfMiddleware);

  app.use('/api', rateLimit({ windowMs: 60 * 1000, max: config.rateLimits.apiPerMinute, prefix: 'api' }));
  app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, max: config.rateLimits.loginPerIp, prefix: 'login-ip' }));
  app.use('/api', publicRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/requests', requestsRouter);
  app.use('/api/staff', staffRouter);
  app.use('/api/gate', gateRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

  // --- Static frontend (development convenience; production uses GitHub Pages) ---
  const staticHeaders = { extensions: ['html'], etag: true, maxAge: config.isProduction ? '1h' : 0 };
  app.use('/public', express.static(path.join(ROOT, 'public'), staticHeaders));
  app.use('/src', express.static(path.join(ROOT, 'src'), { ...staticHeaders, immutable: false }));
  app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'index.html')));
  app.get('/config.js', (req, res) => res.sendFile(path.join(ROOT, 'config.js')));
  // SPA fallback (Express 5 syntax): serve the app shell for any other page URL.
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api') || req.path.startsWith('/src') || req.path.startsWith('/public')) return next();
    res.sendFile(path.join(ROOT, 'index.html'));
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  const timer = setInterval(() => {
    try {
      purgeExpiredSessions();
    } catch {
      /* ignore */
    }
  }, 30 * 60 * 1000);
  timer.unref?.();
  startCleanupTimer();

  return app;
}
