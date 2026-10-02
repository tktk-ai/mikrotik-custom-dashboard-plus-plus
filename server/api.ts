import express, { type Request, type Response } from 'express';
import { getEndpoint } from '../shared/catalog';
import type { Row } from '../shared/types';
import type { InsightBundle } from '../shared/analytics';
import { DemoError, getDeviceInfo, getMetrics, handleDemo, listEndpointPaths, pushLog, resetDemo, resolveEndpoint } from './demo/engine';
import {
  INSIGHT_PATHS, TOPOLOGY_PATHS, TRAFFIC_PATHS, fetchPaths, reports, toTables,
} from './analytics/collect';
import { buildTopology } from './analytics/topology';
import { buildInsights } from './analytics/insights';
import { buildDevices } from './analytics/devices';
import { runSweep, sweepTargets } from './analytics/sweep';
import {
  clearEvents, createRule, deleteRule, deliverReport, evaluateAlerts, getSchedule,
  listEvents, listRules, reportDue, setSchedule, testWebhook, updateRule,
} from './analytics/alerts';
import { list } from './analytics/collect';
import { buildTraffic } from './analytics/traffic';
import { isRandomisedMac, vendorForMac } from '../shared/oui';
import { resetSnapshots } from './analytics/snapshot';
import { latestLinkRates, readLinkHistory, readScoreTrend, recordInterfaceCounters, resetScoreHistory } from './analytics/history';
import { insightsReportMarkdown } from './analytics/report';
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
    analytics: { insightPaths: INSIGHT_PATHS.length, topologyPaths: TOPOLOGY_PATHS.length, trafficPaths: TRAFFIC_PATHS.length },
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

/* --------------------------- analytics ---------------------------- */

const activeKey = () => getActiveConnection()?.id ?? 'none';
const analyticsMode = () => (getActiveConnection()?.demo ? 'demo' : 'live');

router.get('/topology', async (_req, res) => {
  const conn = getActiveConnection();
  if (!conn) return fail(res, 400, 'validation', 'No device connection configured.');
  try {
    const fetched = await fetchPaths([...TOPOLOGY_PATHS]);
    const topology = buildTopology(fetched, analyticsMode());
    // Feed the throughput series and attach live rates to the nodes that map to an
    // interface, so the map's link drill-down has history without a visit to Insights.
    const interfaceRows = list(toTables(fetched), 'interface').map((row) => ({
      name: String(row.name ?? ''),
      rxBytes: Number(row['rx-byte'] ?? 0),
      txBytes: Number(row['tx-byte'] ?? 0),
    })).filter((row) => row.name);
    const rates = interfaceRows.length
      ? recordInterfaceCounters(interfaceRows, analyticsMode(), activeKey())
      : latestLinkRates(activeKey());
    for (const node of topology.nodes) {
      const iface = node.interface ?? (node.id.startsWith('if:') ? node.id.slice(3) : undefined);
      if (iface && rates[iface]) node.rate = rates[iface];
    }
    ok(res, topology);
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/insights', async (req, res) => {
  const conn = getActiveConnection();
  if (!conn) return fail(res, 400, 'validation', 'No device connection configured.');
  try {
    const fetched = await fetchPaths([...INSIGHT_PATHS]);
    const includeTraffic = req.query.traffic === 'true';
    const bundle = buildInsights(fetched, analyticsMode(), includeTraffic, activeKey());
    ok(res, bundle);
    // Fire-and-forget: the response must not wait on a webhook.
    void evaluateAlerts(bundle, { device: conn.name }).catch(() => undefined);
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * Bulk probe: streams a result per host over SSE so the UI can show progress while
 * the sweep is still running. Reachability is ICMP through the router; the flow
 * counts come from conntrack, not from scanning ports (RouterOS cannot).
 */
router.get('/devices/sweep', async (req, res) => {
  const conn = getActiveConnection();
  if (!conn) return fail(res, 400, 'validation', 'No device connection configured.');

  const scope = String(req.query.scope ?? 'all');
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 60) || 60));
  const concurrency = Math.min(12, Math.max(1, Number(req.query.concurrency ?? 6) || 6));
  const includeTraffic = req.query.traffic !== 'false';
  const demo = analyticsMode() === 'demo';

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (event: string, payload: unknown) => {
    if (res.writableEnded || res.destroyed) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    send('status', { stage: 'collecting', scope });
    const [topologyFetched, trafficFetched] = await Promise.all([
      fetchPaths([...TOPOLOGY_PATHS]),
      includeTraffic ? fetchPaths([...TRAFFIC_PATHS]) : Promise.resolve(new Map()),
    ]);
    const tables = toTables(topologyFetched);
    const devices = buildDevices(tables, { interfaceLink: undefined });

    // Observed conversations per address — honest "services seen", not a port scan.
    const conversationByIp: Record<string, { flows: number; bytes: number; topService: string }> = {};
    if (trafficFetched.size) {
      const conversation = list(toTables(trafficFetched), 'ip/firewall/connection');
      const byAddress = new Map<string, { flows: number; bytes: number; ports: Map<string, number> }>();
      for (const row of conversation) {
        const address = String(row['src-address'] ?? '').split(':')[0];
        if (!address) continue;
        const entry = byAddress.get(address) ?? { flows: 0, bytes: 0, ports: new Map<string, number>() };
        entry.flows += 1;
        entry.bytes += Number(row['orig-bytes'] ?? 0) + Number(row['repl-bytes'] ?? 0);
        const port = String(row['dst-port'] ?? '');
        if (port) entry.ports.set(port, (entry.ports.get(port) ?? 0) + 1);
        byAddress.set(address, entry);
      }
      for (const [address, entry] of byAddress) {
        const top = [...entry.ports.entries()].sort((a, b) => b[1] - a[1])[0];
        conversationByIp[address] = { flows: entry.flows, bytes: entry.bytes, topService: top ? `tcp/${top[0]}` : '—' };
      }
    }

    const targets = sweepTargets(devices, scope, conversationByIp);
    const summary = await runSweep(targets, conn, demo, {
      scope,
      limit,
      concurrency,
      onStart: (total) => send('start', { scope, total, limit, concurrency }),
      onResult: (result, index) => send('result', { ...result, index }),
    });
    send('done', summary);
  } catch (err) {
    send('error', { message: err instanceof Error ? err.message : 'sweep failed' });
  } finally {
    res.end();
  }
});

/* ------------------------------------------------------------------ *
 * DPI tooling — the write side of the traffic story.
 *
 * Everything here stays inside what RouterOS can actually do: create a layer7
 * matcher, attach it to a mangle rule with a packet mark, run the sniffer, and
 * list the capture files it produced. Payload decoding still happens off-box.
 * ------------------------------------------------------------------ */

/** Performs a REST write in whichever mode is active (demo mutates its own tables). */
const restWrite = async (conn: NonNullable<ReturnType<typeof getActiveConnection>>, path: string, body: Row, method: 'POST' | 'PATCH' | 'PUT' = 'POST'): Promise<Row> => {
  if (conn.demo) {
    const result = handleDemo({ method, path, body, query: new URLSearchParams() });
    const list = Array.isArray(result) ? result : [result];
    return (list.at(-1) ?? {}) as Row;
  }
  const response = await rosRequest(conn, path, method, body);
  return (Array.isArray(response.data) ? (response.data.at(-1) ?? {}) : response.data ?? {}) as Row;
};

const NAME_RE = /^[A-Za-z0-9._-]{1,63}$/;

/** Creates a layer7 matcher — the closest thing to on-box application detection. */
router.post('/traffic/l7', async (req, res) => {
  const conn = getActiveConnection();
  if (!conn) return fail(res, 400, 'validation', 'No device connection configured.');
  const body = (req.body ?? {}) as Row;
  const name = String(body.name ?? '').trim();
  const regexp = String(body.regexp ?? '').trim();
  if (!NAME_RE.test(name)) return fail(res, 400, 'validation', 'Name must be 1-63 characters of letters, digits, dot, dash or underscore.');
  if (!regexp || regexp.length > 512) return fail(res, 400, 'validation', 'Provide a regular expression (1-512 characters).');
  try {
    // Sanity check only: RouterOS uses its own regex engine, but a pattern that is
    // not valid in any common dialect is almost certainly a typo.
    new RegExp(regexp);
  } catch {
    return fail(res, 400, 'validation', 'That regular expression does not compile — check for unbalanced groups or brackets.');
  }

  try {
    const row = await restWrite(conn, 'ip/firewall/layer7-protocol', {
      name,
      regexp,
      comment: body.comment ? String(body.comment) : 'created from dashboard',
    });
    ok(res, { created: true, row, mode: analyticsMode() });
  } catch (err) {
    sendError(res, err);
  }
});

/** Attaches a matcher to a mangle rule that marks the matching packets. */
router.post('/traffic/mangle', async (req, res) => {
  const conn = getActiveConnection();
  if (!conn) return fail(res, 400, 'validation', 'No device connection configured.');
  const body = (req.body ?? {}) as Row;
  const matcher = String(body.matcher ?? '').trim();
  const chain = String(body.chain ?? 'prerouting');
  if (!NAME_RE.test(matcher)) return fail(res, 400, 'validation', 'Pick a layer7 matcher to reference.');
  if (!['prerouting', 'forward', 'output', 'postrouting', 'input'].includes(chain)) return fail(res, 400, 'validation', 'Unsupported chain.');

  try {
    const fetched = await fetchPaths(['ip/firewall/layer7-protocol']);
    const matchers = list(toTables(fetched), 'ip/firewall/layer7-protocol').map((row) => String(row.name ?? ''));
    if (matchers.length && !matchers.includes(matcher)) {
      return fail(res, 400, 'validation', `No layer7 matcher named "${matcher}" on the device — create it first.`);
    }

    const row = await restWrite(conn, 'ip/firewall/mangle', {
      chain,
      action: 'mark-packet',
      'new-packet-mark': body.mark ? String(body.mark) : matcher,
      'layer7-protocol': matcher,
      ...(body.srcAddress ? { 'src-address': String(body.srcAddress) } : {}),
      ...(body.dstAddress ? { 'dst-address': String(body.dstAddress) } : {}),
      ...(body.passthrough === false ? { passthrough: false } : {}),
      comment: body.comment ? String(body.comment) : `l7 ${matcher} (dashboard)`,
    });
    ok(res, { created: true, row, mode: analyticsMode() });
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * Starts or stops a sniffer capture. Capture-to-file is the only on-box payload
 * path; the resulting pcap has to be pulled off the device over SCP/FTP because the
 * REST API does not stream binary files.
 */
router.post('/traffic/sniffer', async (req, res) => {
  const conn = getActiveConnection();
  if (!conn) return fail(res, 400, 'validation', 'No device connection configured.');
  const body = (req.body ?? {}) as Row;
  const running = body.running === true || body.running === 'true';

  try {
    const settings: Row = {};
    if (body.filter) settings['filter-interface'] = String(body.filter);
    if (body.file) settings['file-name'] = String(body.file);
    if (body.duration) settings['file-limit'] = String(body.duration);
    if (body.onlyHeaders !== undefined) settings['only-headers'] = body.onlyHeaders === true || body.onlyHeaders === 'true';

    if (conn.demo) {
      // The demo device has no real sniffer: patch the singleton, then keep the
      // capture list consistent so the UI has something to show.
      const row = await restWrite(conn, 'tool/sniffer', {
        running,
        ...(running ? { 'filter-interface': String(body.filter ?? 'ether1'), 'file-name': String(body.file ?? `capture-${Date.now()}.pcap`) } : {}),
        ...settings,
      }, 'PATCH');
      if (running) {
        await restWrite(conn, 'file', {
          name: String(row['file-name'] ?? 'capture.pcap'),
          size: 1_048_576 + Math.round(Math.random() * 8_000_000),
          type: 'file',
        });
      }
      return ok(res, { running, row, mode: 'demo', note: 'Demo capture is simulated; no payloads are decoded.' });
    }

    if (Object.keys(settings).length) await restWrite(conn, 'tool/sniffer', settings, 'PATCH');
    const response = await rosRequest(conn, running ? 'tool/sniffer/start' : 'tool/sniffer/stop', 'POST', {});
    ok(res, { running, result: response.data ?? null, mode: 'live' });
  } catch (err) {
    sendError(res, err);
  }
});

/** Capture files sitting on the device (pcap/pcapng), newest first. */
router.get('/traffic/captures', async (_req, res) => {
  const conn = getActiveConnection();
  if (!conn) return fail(res, 400, 'validation', 'No device connection configured.');
  try {
    const fetched = await fetchPaths(['file']);
    const files = list(toTables(fetched), 'file')
      .map((row) => ({ name: String(row.name ?? ''), size: Number(row.size ?? 0), type: String(row.type ?? 'file') }))
      .filter((file) => /\.pcapn?g?$/i.test(file.name) || /\.cap$/i.test(file.name))
      .sort((a, b) => b.size - a.size);
    ok(res, {
      files,
      mode: analyticsMode(),
      // REST returns JSON only, so the dashboard cannot proxy a binary download.
      downloadHint: 'Pull captures with SCP/FTP (or stream the sniffer straight to a sensor); the REST API cannot transfer binary files.',
    });
  } catch (err) {
    sendError(res, err);
  }
});

/* ------------------------------------------------------------------ *
 * Alerts & scheduled reports
 * ------------------------------------------------------------------ */

const alertDeviceName = () => getActiveConnection()?.name ?? 'RouterOS device';

/** Builds a bundle the way /insights does, for rule evaluation and reports. */
const analyseNow = async (includeTraffic: boolean): Promise<InsightBundle> => {
  const fetched = await fetchPaths(includeTraffic ? [...INSIGHT_PATHS, ...TRAFFIC_PATHS] : [...INSIGHT_PATHS]);
  return buildInsights(fetched, analyticsMode(), includeTraffic, activeKey());
};

router.get('/alerts', (_req, res) => {
  ok(res, { rules: listRules(), events: listEvents(), schedule: getSchedule() });
});

router.post('/alerts/rules', (req, res) => {
  try {
    ok(res, { rule: createRule((req.body ?? {}) as Row) });
  } catch (err) {
    fail(res, 400, 'validation', err instanceof Error ? err.message : 'Could not create rule.');
  }
});

router.patch('/alerts/rules/:id', (req, res) => {
  const rule = updateRule(String(req.params.id), (req.body ?? {}) as Row);
  if (!rule) return fail(res, 404, 'not-found', 'No such rule.');
  ok(res, { rule });
});

router.delete('/alerts/rules/:id', (req, res) => {
  if (!deleteRule(String(req.params.id))) return fail(res, 404, 'not-found', 'No such rule.');
  ok(res, { deleted: true });
});

/** Evaluates the rules right now — and returns what fired, without cooldown filtering. */
router.post('/alerts/check', async (_req, res) => {
  const conn = getActiveConnection();
  if (!conn) return fail(res, 400, 'validation', 'No device connection configured.');
  try {
    const bundle = await analyseNow(false);
    const fired = await evaluateAlerts(bundle, { device: conn.name });
    ok(res, { fired, events: listEvents() });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/alerts/events/clear', (_req, res) => {
  clearEvents();
  ok(res, { cleared: true });
});

router.get('/reports/schedule', (_req, res) => ok(res, { schedule: getSchedule(), due: reportDue() }));

router.post('/reports/schedule', (req, res) => ok(res, { schedule: setSchedule((req.body ?? {}) as Row) }));

/** Renders the report now and delivers it to the configured webhook. */
router.post('/reports/run', async (req, res) => {
  const conn = getActiveConnection();
  if (!conn) return fail(res, 400, 'validation', 'No device connection configured.');
  try {
    const includeTraffic = req.body?.traffic !== false;
    const bundle = await analyseNow(includeTraffic);
    const markdown = insightsReportMarkdown(bundle, {
      connection: conn.name,
      mode: analyticsMode(),
      history: bundle.history ?? readScoreTrend(activeKey()),
    });
    const event = await deliverReport(markdown, { device: conn.name, trigger: 'manual' });
    ok(res, { event, bytes: markdown.length, delivered: event.delivery });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/alerts/test-webhook', async (req, res) => {
  const url = String((req.body ?? {}).url ?? '');
  if (!/^https?:\/\//.test(url)) return fail(res, 400, 'validation', 'Provide an http(s) webhook URL.');
  ok(res, { delivery: await testWebhook(url) });
});

/** Called on a timer: delivers the scheduled report when it is due. */
export async function runScheduledReports(): Promise<void> {
  if (!reportDue()) return;
  try {
    const bundle = await analyseNow(getSchedule().includeTraffic);
    const markdown = insightsReportMarkdown(bundle, {
      connection: alertDeviceName(),
      mode: analyticsMode(),
      history: bundle.history ?? readScoreTrend(activeKey()),
    });
    await deliverReport(markdown, { device: alertDeviceName(), trigger: 'schedule' });
    pushLog('system,info', 'scheduled network health report generated');
  } catch (err) {
    pushLog('system,error', `scheduled report failed: ${err instanceof Error ? err.message : 'unknown error'}`);
  }
}

/** Throughput series for one interface, for the map's link drill-down. */
router.get('/topology/link-history', (req, res) => {
  const iface = String(req.query.interface ?? '').trim();
  if (!iface) return fail(res, 400, 'validation', 'Provide ?interface=<name>.');
  const hours = Math.min(168, Math.max(1, Number(req.query.hours ?? 6) || 6));
  ok(res, readLinkHistory(activeKey(), iface, hours));
});

/** Score history without touching the device — cheap enough for a dashboard poll. */
router.get('/insights/history', (_req, res) => {
  ok(res, readScoreTrend(activeKey()));
});

/**
 * Shareable audit report. `format=md` (default) renders Markdown for a ticket or
 * change request; `format=json` returns the bundle plus its rendered text so other
 * tooling can consume it.
 */
router.get('/insights/report', async (req, res) => {
  const conn = getActiveConnection();
  if (!conn) return fail(res, 400, 'validation', 'No device connection configured.');
  try {
    const includeTraffic = req.query.traffic === 'true';
    const fetched = await fetchPaths(includeTraffic ? [...INSIGHT_PATHS, ...TRAFFIC_PATHS] : [...INSIGHT_PATHS]);
    const bundle = buildInsights(fetched, analyticsMode(), includeTraffic, activeKey());
    const report = insightsReportMarkdown(bundle, {
      connection: conn.name,
      mode: analyticsMode(),
      history: bundle.history ?? readScoreTrend(activeKey()),
    });

    if (req.query.format === 'json') return ok(res, { bundle, report });

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    if (req.query.download === 'true') {
      res.setHeader('Content-Disposition', `attachment; filename="network-health-${stamp}.md"`);
    }
    res.send(report);
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/traffic', async (_req, res) => {
  const conn = getActiveConnection();
  if (!conn) return fail(res, 400, 'validation', 'No device connection configured.');
  try {
    const fetched = await fetchPaths([...TRAFFIC_PATHS]);
    ok(res, buildTraffic(fetched, analyticsMode()));
  } catch (err) {
    sendError(res, err);
  }
});

/** Snapshot the current configuration so the next /insights call can diff it. */
router.post('/insights/snapshot', async (_req, res) => {
  const conn = getActiveConnection();
  if (!conn) return fail(res, 400, 'validation', 'No device connection configured.');
  try {
    const fetched = await fetchPaths([...INSIGHT_PATHS]);
    ok(res, buildInsights(fetched, analyticsMode(), false, activeKey()));
  } catch (err) {
    sendError(res, err);
  }
});

/** Best-effort "who is this device" probe using routing tools. */
router.get('/device/:ip', async (req, res) => {
  const conn = getActiveConnection();
  if (!conn) return fail(res, 400, 'validation', 'No device connection configured.');
  const ip = String(req.params.ip ?? '').trim();
  if (!/^[0-9a-fA-F:.]+$/.test(ip)) return fail(res, 400, 'validation', 'Provide an IP address.');
  try {
    const [arp, neighbors, leases, dns, ipv6] = await Promise.all([
      fetchPaths(['ip/arp']).then((m) => m.get('ip/arp')),
      fetchPaths(['ip/neighbor']).then((m) => m.get('ip/neighbor')),
      fetchPaths(['ip/dhcp-server/lease']).then((m) => m.get('ip/dhcp-server/lease')),
      fetchPaths(['ip/dns']).then((m) => m.get('ip/dns')),
      fetchPaths(['ipv6/neighbor']).then((m) => m.get('ipv6/neighbor')),
    ]);
    const match = (rows: Row[] = []) => rows.filter((r) => String(r.address ?? '') === ip || String(r['last-ip'] ?? '') === ip);
    const table = {
      arp: match(arp?.rows), neighbors: match(neighbors?.rows), leases: match(leases?.rows), ipv6: match(ipv6?.rows),
    } as Record<string, Row[]>;
    const known = [...table.arp, ...table.neighbors, ...table.leases];
    const mac = known.map((r) => String(r['mac-address'] ?? '')).find(Boolean);
    const name = known.map((r) => String(r['host-name'] ?? r.identity ?? '')).find(Boolean);

    // Probe tooling: ping (always) plus a reverse lookup when configured.
    const ping = await fetchPathProbe(ip, conn);
    const reverse = await reverseLookup(ip, String((dns?.rows?.[0]?.servers ?? '').split(',')[0] ?? ''), conn);

    ok(res, {
      ip,
      name,
      mac,
      vendor: mac ? vendorForMac(mac) : undefined,
      randomised: mac ? isRandomisedMac(mac) : undefined,
      platform: table.neighbors[0]?.platform,
      board: table.neighbors[0]?.board,
      version: table.neighbors[0]?.version,
      discoveredBy: table.neighbors[0]?.['discovered-by'],
      interface: known.map((r) => String(r.interface ?? '')).find(Boolean),
      hostname: table.leases[0]?.['host-name'],
      dhcp: table.leases.length > 0,
      status: table.leases[0]?.status,
      ipv6: table.ipv6.map((r) => r.address),
      neighbours: table.neighbors.length,
      evidence: [
        table.leases.length ? `DHCP lease${table.leases.length > 1 ? 's' : ''}: ${table.leases.length}` : null,
        table.arp.length ? 'ARP entry' : null,
        table.neighbors.length ? `Neighbour discovery (${table.neighbors[0]?.['discovered-by'] ?? 'mndp'})` : null,
      ].filter(Boolean),
      ping,
      reverse,
      sources: [arp, neighbors, leases, ipv6].filter(Boolean).map((f) => ({ path: f!.path, ok: f!.ok, rows: f!.rows.length, error: f!.error })),
    });
  } catch (err) {
    sendError(res, err);
  }
});

const fetchPathProbe = async (ip: string, conn: NonNullable<ReturnType<typeof getActiveConnection>>) => {
  try {
    if (conn.demo) {
      const rows = handleDemo({ method: 'POST', path: 'tool/ping', body: { address: ip, count: 3 }, query: new URLSearchParams() });
      const list = Array.isArray(rows) ? rows : [rows];
      const times = list.map((r: Row) => Number(String(r.time ?? '').replace(/[^0-9.]/g, ''))).filter((n) => Number.isFinite(n) && n > 0);
      return {
        ok: list.some((r: Row) => String(r.status ?? '').includes('ok') || r.seq !== undefined),
        sent: list.filter((r: Row) => r.seq !== undefined && r.seq !== 'complete').length,
        avgMs: times.length ? Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 100) / 100 : null,
        raw: list.slice(0, 6),
      };
    }
    const result = await rosRequest(conn, 'tool/ping', 'POST', { address: ip, count: '3' });
    const rows = normalizeList(result.data);
    const times = rows.map((r) => Number(String(r.time ?? '').replace(/[^0-9.]/g, ''))).filter((n) => Number.isFinite(n) && n > 0);
    return {
      ok: rows.some((r) => r.seq !== undefined && r.seq !== 'complete'),
      sent: rows.filter((r) => r.seq !== undefined && r.seq !== 'complete').length,
      avgMs: times.length ? Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 100) / 100 : null,
      raw: rows.slice(0, 6),
    };
  } catch (err) {
    return { ok: false, error: err instanceof RosError ? err.message : (err as Error).message, sent: 0, avgMs: null as number | null, raw: [] as Row[] };
  }
};

/** Reverse DNS via the router itself (/tool dns-lookup reverse), when available. */
const reverseLookup = async (ip: string, server: string, conn: NonNullable<ReturnType<typeof getActiveConnection>>) => {
  try {
    const body = { address: ip, ...(server ? { server } : {}), 'type': 'A' };
    if (conn.demo) {
      const rows = handleDemo({ method: 'POST', path: 'tool/dns-lookup', body, query: new URLSearchParams() });
      const list = Array.isArray(rows) ? rows : [rows];
      return { ok: true, answers: list.map((r: Row) => String(r.address ?? r.name ?? '')).filter(Boolean).slice(0, 5) };
    }
    const result = await rosRequest(conn, 'tool/dns-lookup', 'POST', body);
    return { ok: true, answers: normalizeList(result.data).map((r) => String(r.address ?? r.name ?? '')).filter(Boolean).slice(0, 5) };
  } catch (err) {
    return { ok: false, error: err instanceof RosError ? err.message : (err as Error).message, answers: [] as string[] };
  }
};

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
  resetSnapshots();
  resetScoreHistory();
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
