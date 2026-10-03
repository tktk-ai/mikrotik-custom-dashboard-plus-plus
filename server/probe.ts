import { probeEndpoints } from '../shared/catalog';
import { getActiveConnection, touchConnection, type Connection } from './store';
import { rosRequest } from './routeros';
import { getDeviceInfo } from './demo/engine';

/** Caches which REST menus the active device actually supports. */

export interface Capability {
  ok: boolean;
  error?: string;
  kind?: string;
  ms?: number;
  rows?: number;
}

export interface Capabilities {
  mode: 'demo' | 'live';
  connectionId: string | null;
  connectionName: string | null;
  host: string | null;
  device: Record<string, any>;
  probedAt: number;
  probing: boolean;
  endpoints: Record<string, Capability>;
  summary: { supported: number; unsupported: number; failed: number };
}

const TTL_MS = Number(process.env.PROBE_TTL_MS || 5 * 60 * 1000);

let cache: Capabilities | null = null;
let probing = false;
let inflight: Promise<Capabilities> | null = null;

const PATHS = probeEndpoints();

export async function getCapabilities(force = false): Promise<Capabilities> {
  const conn = getActiveConnection();
  if (!conn) {
    return {
      mode: 'demo', connectionId: null, connectionName: null, host: null,
      device: {}, probedAt: Date.now(), probing: false, endpoints: {},
      summary: { supported: 0, unsupported: 0, failed: 0 },
    };
  }
  const fresh = cache && cache.connectionId === conn.id && Date.now() - cache.probedAt < TTL_MS;
  if (fresh && !force) return cache!;
  if (inflight) return inflight;
  inflight = probe(conn).finally(() => { inflight = null; });
  return inflight;
}

async function probe(conn: Connection): Promise<Capabilities> {
  probing = true;
  const endpoints: Record<string, Capability> = {};
  const started = Date.now();

  if (conn.demo) {
    for (const p of PATHS) endpoints[p] = { ok: true };
    cache = {
      mode: 'demo', connectionId: conn.id, connectionName: conn.name, host: conn.host,
      device: getDeviceInfo(), probedAt: Date.now(), probing: false, endpoints,
      summary: { supported: PATHS.length, unsupported: 0, failed: 0 },
    };
    probing = false;
    return cache;
  }

  // Bounded concurrency so we never hammer a production router.
  const queue = [...PATHS];
  const workers = Array.from({ length: 5 }, async () => {
    while (queue.length) {
      const p = queue.shift()!;
      const t0 = Date.now();
      try {
        const res = await rosRequest(conn, p, 'GET');
        const rows = Array.isArray(res.data) ? res.data.length : res.data ? 1 : 0;
        endpoints[p] = { ok: true, ms: Date.now() - t0, rows };
      } catch (err: any) {
        const kind = err?.kind ?? 'device';
        // Auth and network failures affect every path — report them consistently.
        endpoints[p] = { ok: false, kind, error: err?.message ?? 'failed', ms: Date.now() - t0 };
      }
    }
  });
  await Promise.all(workers);

  let device: Record<string, any> = {};
  try {
    const id = await rosRequest(conn, 'system/identity', 'GET');
    const rb = await rosRequest(conn, 'system/routerboard', 'GET');
    const res = await rosRequest(conn, 'system/resource', 'GET');
    device = {
      identity: (Array.isArray(id.data) ? id.data[0]?.name : id.data?.name) ?? conn.host,
      board: (Array.isArray(rb.data) ? rb.data[0]?.model : rb.data?.model) ?? '',
      version: (Array.isArray(res.data) ? res.data[0]?.version : res.data?.version) ?? '',
      uptime: (Array.isArray(res.data) ? res.data[0]?.uptime : res.data?.uptime) ?? '',
      menus: {},
    };
  } catch { /* device info is best-effort */ }

  const values = Object.values(endpoints);
  cache = {
    mode: 'live', connectionId: conn.id, connectionName: conn.name, host: conn.host,
    device, probedAt: Date.now(), probing: false, endpoints,
    summary: {
      supported: values.filter((v) => v.ok).length,
      unsupported: values.filter((v) => !v.ok && (v.kind === 'notfound' || v.kind === 'unsupported')).length,
      failed: values.filter((v) => !v.ok && v.kind !== 'notfound' && v.kind !== 'unsupported').length,
    },
  };
  touchConnection(conn.id);
  probing = false;
  console.log(`[probe] ${conn.name}: ${cache.summary.supported} supported / ${cache.summary.unsupported} unsupported / ${cache.summary.failed} errors in ${Date.now() - started}ms`);
  return cache;
}

export const isProbing = () => probing;
export const clearCapabilities = () => { cache = null; };

/** Quick connectivity test used by the connection screen. */
export async function testConnection(conn: Connection) {
  const t0 = Date.now();
  try {
    const res = await rosRequest(conn, 'system/identity', 'GET');
    const row = Array.isArray(res.data) ? res.data[0] : res.data;
    const rb = await rosRequest(conn, 'system/routerboard', 'GET').catch(() => null);
    const rbRow = rb ? (Array.isArray(rb.data) ? rb.data[0] : rb.data) : null;
    return {
      ok: true,
      latencyMs: Date.now() - t0,
      identity: row?.name ?? '',
      board: rbRow?.model ?? '',
      note: 'REST API reachable.',
    };
  } catch (err: any) {
    return {
      ok: false,
      kind: err?.kind ?? 'device',
      error: err?.message ?? 'Unknown error',
      detail: err?.detail,
      latencyMs: Date.now() - t0,
      hint: err?.kind === 'auth'
        ? 'Create a dedicated user with the `rest-api`, `read` and `write` policies and enable the www-ssl (or www) service.'
        : err?.kind === 'network'
          ? 'Check the IP, port, that the www/www-ssl service is enabled, and the firewall allows access from this host.'
          : undefined,
    };
  }
}
