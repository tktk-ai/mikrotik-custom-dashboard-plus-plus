import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import api, { runScheduledReports } from './api';
import { audit } from './audit';

/**
 * RouterOS Control Plane server.
 *
 * - Serves the built dashboard (dist/) when present.
 * - Exposes /api/* for the UI.
 * - Talks to real devices over the RouterOS REST API, or to the built-in demo device.
 *
 * In development Vite serves the UI and proxies /api here, so this process only
 * needs to listen on the API port.
 */

const app = express();
const PORT = Number(process.env.PORT || process.env.API_PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const DIST = path.resolve(process.cwd(), 'dist');

app.disable('x-powered-by');

// Optional API-key protection for deployments that do not already sit behind an
// authenticated reverse proxy. It is deliberately opt-in so the built-in demo
// remains frictionless, while production operators can fail closed by setting
// DASHBOARD_API_KEY.
const dashboardApiKey = process.env.DASHBOARD_API_KEY?.trim();
if (process.env.NODE_ENV === 'production' && !dashboardApiKey) {
  throw new Error('DASHBOARD_API_KEY is required in production. Put the API behind OIDC or a trusted authenticated reverse proxy.');
}
if (dashboardApiKey) {
  app.use('/api', (req, res, next) => {
    const supplied = String(req.headers['x-api-key'] ?? '').trim()
      || String(req.headers.authorization ?? '').replace(/^Bearer\\s+/i, '').trim();
    if (!supplied || supplied !== dashboardApiKey) {
      res.status(401).json({ error: { kind: 'auth', message: 'Dashboard authentication required.' } });
      return;
    }
    next();
  });
}

// Lightweight process-local protection for expensive or mutating API calls.
// This is not a replacement for a gateway rate limiter, but prevents accidental
// request storms and is useful in single-process deployments.
const requestWindows = new Map<string, { started: number; count: number }>();
app.use('/api', (req, res, next) => {
  const now = Date.now();
  const key = `${req.ip}:${req.method === 'GET' ? 'read' : 'write'}`;
  const limit = req.method === 'GET' ? 240 : 60;
  const current = requestWindows.get(key);
  if (requestWindows.size > 10000) {
    for (const [entryKey, entry] of requestWindows) if (now - entry.started >= 60_000) requestWindows.delete(entryKey);
  }
  if (!current || now - current.started >= 60_000) requestWindows.set(key, { started: now, count: 1 });
  else if (++current.count > limit) {
    res.setHeader('Retry-After', '60');
    res.status(429).json({ error: { kind: 'rate_limit', message: 'Too many requests; retry shortly.' } });
    return;
  }
  next();
});

app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

app.use((req, res, next) => {
  const requestId = String(req.headers['x-request-id'] ?? crypto.randomUUID()).slice(0, 128);
  res.setHeader('X-Request-ID', requestId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store');
  res.on('finish', () => {
    if (req.path.startsWith('/api') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      audit({ method: req.method, path: req.path, status: res.statusCode, actor: String(req.headers['x-actor-id'] ?? 'api-client'), agent: String(req.headers['x-agent-id'] ?? '') || undefined, ip: req.ip, requestId });
    }
  });
  next();
});

app.use('/api', api);

app.get('/api', (_req, res) => res.json({ data: { name: 'routeros-control-plane', version: 1 } }));

// Serve the production build if it exists (npm run build && npm start).
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(DIST, 'index.html')));
} else {
  app.get('/', (_req, res) =>
    res
      .status(200)
      .type('html')
      .send('<!doctype html><title>RouterOS Control Plane</title><body style="font-family:system-ui;background:#0b1220;color:#e2e8f0;padding:2rem">'
        + '<h1>API is running</h1><p>The UI has not been built yet. Run <code>npm run dev</code> for the Vite dev server, '
        + 'or <code>npm run build</code> and restart to serve the dashboard from this port.</p>'
        + `<p>API endpoints: <a style="color:#22d3ee" href="/api/health">/api/health</a>, `
        + '<a style="color:#22d3ee" href="/api/dashboard">/api/dashboard</a>, '
        + '<a style="color:#22d3ee" href="/api/capabilities">/api/capabilities</a></p></body>'));
}

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[server] unhandled:', err?.stack ?? err);
  res.status(500).json({ error: { kind: 'internal', message: err?.message ?? 'Internal error' } });
});

/**
 * Scheduled reports: a five-minute tick is plenty of resolution for an hourly or
 * daily report, and it costs nothing when no schedule is configured.
 */
const REPORT_TICK_MS = 5 * 60 * 1000;
setInterval(() => {
  void runScheduledReports();
}, REPORT_TICK_MS).unref();
// Check once shortly after boot so a restart does not delay a due report by five minutes.
setTimeout(() => {
  void runScheduledReports();
}, 20_000).unref();

const server = app.listen(PORT, HOST, () => {
  const demo = process.env.ROUTEROS_HOST ? 'live + demo' : 'demo device';
  console.log(`\n  RouterOS Control Plane API listening on http://${HOST}:${PORT}  (${demo})`);
  console.log(`  health: http://localhost:${PORT}/api/health`);
  if (fs.existsSync(DIST)) console.log('  serving built UI from dist/');
  console.log('');
});

const shutdown = (signal: string) => {
  console.log(`\n[server] ${signal} received, closing…`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 4000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
