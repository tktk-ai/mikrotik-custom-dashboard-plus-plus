import express, { type Request, type Response } from 'express';
import { getEndpoint } from '../shared/catalog';
import type { Row } from '../shared/types';
import { DemoError, getDeviceInfo, getMetrics, handleDemo, listEndpointPaths, pushLog, resetDemo, resolveEndpoint } from './demo/engine';
import { RosError, normalizeList, rosRequest } from './routeros';
import { clearCapabilities, getCapabilities, testConnection } from './probe';
import {
  addConnection, getActiveConnection, getConnection, listConnections, publicConnection,
  removeConnection, setActiveConnection, updateConnection, type Connection,
} from './store';

/** HTTP API consumed by the dashboard UI. */

const router = express.Router();

const ok = (res: Response, data: unknown) => res.json({ data });
const fail = (res: Response, status: number, kind: string, message: string, hint?: string, detail?: unknown) =>
  res.status(status).json({ error: { kind, message, hint, detail } });

/* ------------------------------ meta ------------------------------ */

router.get('/health', (_req, res) => {
  const conn = getActiveConnection();
  ok(res, {
    ok: true,
    mode: conn?.demo ? 'demo' : 'live',
    connection: conn ? publicConnection(conn) : null,
    endpoints: listEndpointPaths().length,
    uptime: process.uptime(),
    node: process.version,
  });
});

/* -------------------------- connections -------------------------- */

router.get('/connections', (_req, res) => {
  const active = getActiveConnection();
  ok(res, { connections: listConnections().map(publicConnection), activeId: active?.id ?? null });
});

router.post('/connections', async (req, res) => {
  const body = req.body ?? {};
  if (!body.host) return fail(res, 400, 'validation', 'A host or IP address is required.');
  let conn = addConnection(body as Partial<Connection>);
  if (body.test !== false && !conn.demo) {
    const result = await testConnection(conn);
    clearCapabilities();
    return ok(res, { connection: publicConnection(conn), test: result });
  }
  clearCapabilities();
  ok(res, { connection: publicConnection(conn), test: null });
});

router.patch('/connections/:id', (req, res) => {
  const updated = updateConnection(req.params.id, req.body ?? {});
  if (!updated) return fail(res, 404, 'notfound', 'Connection not found.');
  clearCapabilities();
  ok(res, publicConnection(updated));
});

router.delete('/connections/:id', (req, res) => {
  const removed = removeConnection(req.params.id);
  clearCapabilities();
  ok(res, { removed });
});

router.post('/connections/:id/activate', (req, res) => {
  const conn = setActiveConnection(req.params.id);
  if (!conn) return fail(res, 404, 'notfound', 'Connection not found.');
  clearCapabilities();
  ok(res, publicConnection(conn));
});

router.post('/connections/:id/test', async (req, res) => {
  const conn = getConnection(req.params.id) ?? getActiveConnection();
  if (!conn) return fail(res, 404, 'notfound', 'No connection configured.');
  if (conn.demo) {
    const caps = await getCapabilities(true);
    return ok(res, { ok: true, latencyMs: 1, identity: caps.device?.identity ?? 'Demo lab', board: caps.device?.board ?? '', note: 'Simulated device — every menu is available.' });
  }
  const result = await testConnection(conn);
  ok(res, result);
});

/* -------------------------- capabilities -------------------------- */

router.get('/capabilities', async (_req, res) => {
  const caps = await getCapabilities(false);
  ok(res, caps);
});

router.post('/capabilities/refresh', async (_req, res) => {
  const caps = await getCapabilities(true);
  ok(res, caps);
});

/* ---------------------------- dashboard --------------------------- */

router.get('/dashboard', async (_req, res) => {
  const conn = getActiveConnection();
  if (conn?.demo) {
    const metrics = getMetrics();
    return ok(res, { ...metrics, mode: 'demo', device: getDeviceInfo() });
  }
  if (!conn) return fail(res, 400, 'validation', 'No Device Connection Configured');
  try {
    const [resource, identity, routerboard, health, ifaces, leases, conns, logs] = await Promise.all([
      rosRequest(conn, 'system/resource', 'GET'),
      rosRequest(conn, 'system/identity', 'GET'),
      rosRequest(conn, 'system/routerboard', 'GET').catch(() => null),
      rosRequest(conn, 'system/health', 'GET').catch(() => null),
      rosRequest(conn, 'interface', 'GET'),
      rosRequest(conn, 'ip/dhcp-server/lease', 'GET').catch(() => null),
      rosRequest(conn, 'ip/firewall/connection', 'GET').catch(() => null),
      rosRequest(conn, 'log', 'GET').catch(() => null),
    ]);
    const r = normalizeList(resource.data)[0] ?? {};
    const num = (v: unknown) => Number(v ?? 0);
    const ifaceRows = normalizeList(ifaces.data);
    const up = ifaceRows.filter((i) => i.running === 'true' || i.running === true).length;
    const leaseRows = normalizeList(leases?.data);
    const connRows = normalizeList(conns?.data);
    const payload = {
      mode: 'live',
      identity: normalizeList(identity.data)[0]?.name ?? conn.host,
      version: r.version ?? '',
      board: normalizeList(routerboard?.data)[0]?.model ?? r['board-name'] ?? '',
      uptime: r.uptime ?? '',
      cpuLoad: num(r['cpu-load']),
      cpuCores: num(r['cpu-count']) || 1,
      cpuSeries: [num(r['cpu-load'])],
      memory: { used: num(r['total-memory']) - num(r['free-memory']), total: num(r['total-memory']) },
      disk: { used: num(r['total-hdd-space']) - num(r['free-hdd-space']), total: num(r['total-hdd-space']) },
      temperature: num(normalizeList(health?.data).find?.((h) => h.name === 'temperature')?.value) || null,
      interfaces: { total: ifaceRows.length, up, down: ifaceRows.length - up, rxRate: 0, txRate: 0 },
      clients: { dhcp: leaseRows.length, hotspot: 0, wifi: 0, ppp: 0, arp: 0 },
      firewall: { rules: 0, connections: connRows.length, blocked: 0, drops: 0 },
      routing: { routes: 0, bgpEstablished: 0, ospfNeighbors: 0, vpnPeers: 0 },
      queues: { count: 0, shaped: 0 },
      alerts: [],
      series: [],
      topTalkers: [],
      hotspot: { active: 0, users: 0, loginBy: {} },
      leases: leaseRows.slice(0, 5).map((l) => ({ name: l['host-name'], address: l.address, mac: l['mac-address'], expires: l['expires-after'], server: l.server })),
      logTail: normalizeList(logs?.data).slice(-8).reverse(),
      device: { identity: normalizeList(identity.data)[0]?.name, board: r['board-name'], version: r.version, uptime: r.uptime },
      ts: Date.now(),
    };
    ok(res, payload);
  } catch (err) {
    sendError(res, err);
  }
});

/* ------------------------------ SSE ------------------------------- */

router.get('/stream', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 4000\n\n');
  const conn = getActiveConnection();
  const send = () => {
    try {
      if (conn?.demo) {
        res.write(`event: metrics\ndata: ${JSON.stringify(getMetrics())}\n\n`);
      } else {
        res.write(`event: ping\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
      }
    } catch { /* client went away */ }
  };
  send();
  const interval = setInterval(send, 2500);
  const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 20000);
  req.on('close', () => { clearInterval(interval); clearInterval(keepAlive); res.end(); });
});

/* --------------------------- REST proxy --------------------------- */

const proxyRos = async (req: Request, res: Response) => {
  const raw = (req.params as Record<string, string>)[0] ?? '';
  const path = raw.replace(/^\/+/, '');
  if (!path) return fail(res, 400, 'validation', 'Missing menu path.');
  const conn = getActiveConnection();
  if (!conn) return fail(res, 400, 'validation', 'No device connection configured.');

  const method = req.method.toUpperCase() as 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  const body: Row = req.body && Object.keys(req.body).length ? req.body : {};
  const query: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.query)) query[k] = Array.isArray(v) ? String(v[0]) : (v as string | undefined);

  try {
    if (conn.demo) {
      const started = Date.now();
      const data = handleDemo({ method, path, body, query: new URLSearchParams(query as Record<string, string>) });
      return ok(res, { rows: normalizeList(data), ms: Date.now() - started, mode: 'demo' });
    }
    const rosMethod = method === 'POST' && isCommandish(conn, path) ? 'POST' : method;
    const result = await rosRequest(conn, path, rosMethod, Object.keys(body).length ? body : undefined, method === 'GET' ? query : undefined);
    ok(res, { rows: normalizeList(result.data), raw: typeof result.data === 'string' ? result.data : undefined, ms: result.ms, mode: 'live' });
  } catch (err) {
    sendError(res, err);
  }
};

const isCommandish = (conn: Connection, path: string) => {
  const resolved = resolveEndpoint(path);
  if (resolved && resolved.commandPath) return true;
  const ep = resolved?.endpoint ?? getEndpoint(path);
  return Boolean(ep?.commands?.some((c) => !c.path)) || path.includes('/');
};

router.all(/^\/ros\/(.*)$/, (req, res) => { void proxyRos(req, res); });
router.all('/ros', (req, res) => { void proxyRos(req, res); });

/* ---------------------------- console ----------------------------- */

router.post('/console', async (req, res) => {
  const script = String(req.body?.script ?? '');
  if (!script.trim()) return fail(res, 400, 'validation', 'Provide a command to execute.');
  const conn = getActiveConnection();
  if (!conn) return fail(res, 400, 'validation', 'No device connection configured.');
  try {
    if (conn.demo) {
      const started = Date.now();
      const result = handleDemo({ method: 'POST', path: 'execute', body: { script }, query: new URLSearchParams() });
      return ok(res, { rows: normalizeList(result), ms: Date.now() - started, mode: 'demo' });
    }
    const result = await rosRequest(conn, 'execute', 'POST', { script });
    ok(res, { rows: normalizeList(result.data), raw: typeof result.data === 'string' ? result.data : undefined, ms: result.ms, mode: 'live' });
  } catch (err) {
    sendError(res, err);
  }
});

/* ----------------------------- demo ------------------------------- */

router.post('/demo/reset', (_req, res) => {
  resetDemo();
  pushLog('system,info', 'demo device reset from dashboard');
  ok(res, { reset: true });
});

router.get('/menus', (_req, res) => {
  ok(res, { menus: listEndpointPaths() });
});

/* ---------------------------- errors ------------------------------ */

function sendError(res: Response, err: unknown): void {
  if (err instanceof RosError) { fail(res, err.status === 502 ? 502 : err.status, err.kind, err.message, hintFor(err.kind), err.detail); return; }
  if (err instanceof DemoError) { fail(res, err.status, err.kind, err.message, err.hint); return; }
  const e = err as Error;
  console.error('[api] unexpected error:', e?.stack ?? e);
  fail(res, 500, 'device', e?.message ?? 'Unexpected server error.');
}

const hintFor = (kind: string): string | undefined => {
  switch (kind) {
    case 'auth': return 'Use a RouterOS user with the `rest-api`, `read` and `write` policies, and verify the password.';
    case 'notfound': return 'This menu does not exist on the connected RouterOS version.';
    case 'network': return 'Verify the address, port, service enablement (www/www-ssl) and firewall rules.';
    case 'timeout': return 'The device did not answer in time — check routing/firewall between this host and the router.';
    case 'validation': return 'The router rejected the values — check required fields and formats.';
    default: return undefined;
  }
};

export default router;
