import { ENDPOINTS, getEndpoint } from '../../shared/catalog';
import type { CommandDef, EndpointDef, Row } from '../../shared/types';
import { buildState, type DemoState } from './data';
import { chance, dateTimeString, hash, int, mac, pick, rng, timeString } from './random';

/** A simulated RouterOS device — full CRUD, commands and live counters, all in memory. */

export class DemoError extends Error {
  constructor(public kind: string, message: string, public status = 400, public hint?: string) {
    super(message);
  }
}

export interface DemoRequest { method: string; path: string; body: Row; query: URLSearchParams }

const state: DemoState = buildState();
const lastTick: Record<string, number> = {};
const liveLog: Row[] = [];

const PATH_ALIASES: Record<string, string> = {
  'system/board-name': 'system/routerboard',
  'system/identity/print': 'system/identity',
  'tool/snmp': 'system/snmp',
  'system/device-mode/print': 'system/device-mode',
};

/** Longest catalogued endpoint that prefixes the requested path. */
export function resolveEndpoint(path: string): { endpoint: EndpointDef; commandPath: string } | null {
  let best: EndpointDef | null = null;
  for (const ep of ENDPOINTS) {
    if (path === ep.path || path.startsWith(ep.path + '/')) {
      if (!best || ep.path.length > best.path.length) best = ep;
    }
  }
  if (!best) {
    const alias = PATH_ALIASES[path];
    if (alias) return resolveEndpoint(alias);
    return null;
  }
  return { endpoint: best, commandPath: path === best.path ? '' : path.slice(best.path.length + 1) };
}

export function listEndpointPaths(): string[] {
  return ENDPOINTS.map((e) => e.path);
}

/* ------------------------------------------------------------------ *
 * Read
 * ------------------------------------------------------------------ */

export function handleDemo(req: DemoRequest): any {
  const { endpoint, commandPath } = resolveEndpoint(req.path) ?? { endpoint: null, commandPath: '' };
  if (!endpoint) {
    throw new DemoError('unsupported', `Unsupported menu \`/${req.path}\` on this device.`, 404, 'The REST path is not part of the demo device. Connect a real router to query it directly.');
  }
  const path = endpoint.path;
  const table = (state.tables[path] ||= []);

  // RouterOS also addresses a single entry through the URL — PATCH/DELETE
  // /rest/ip/address/*3 — so honour that form alongside .id/numbers in the body.
  const itemSegment = commandPath && !hasCommand(endpoint, commandPath) && !commandPath.includes('/')
    ? decodeURIComponent(commandPath)
    : '';
  const itemTarget = itemSegment ? itemSelector(table, itemSegment) : null;
  const body: Row = itemTarget ? { ...req.body, numbers: undefined, ...itemTarget } : req.body;

  if (req.method === 'GET') {
    tick(path, table);
    if (itemTarget) {
      const found = matchRows(table, itemTarget)[0];
      if (!found) throw new DemoError('notfound', 'Entry not found.', 404);
      return [found];
    }
    let rows = applyQuery(table, req.query);
    if (endpoint.kind === 'singleton' && rows.length === 0) rows = [{}];
    return rows;
  }

  if (req.method === 'POST') {
    if (commandPath && !hasCommand(endpoint, commandPath)) {
      // Sub-path may itself be a data menu (e.g. bridge/port) resolved above; otherwise unsupported.
      throw new DemoError('unsupported', `Command \`${commandPath}\` is not available on /${path}.`, 404);
    }
    if (commandPath) {
      const cmd = endpoint.commands?.find((c) => c.path === commandPath);
      return runCommand(endpoint, cmd ?? { id: commandPath, label: commandPath, path: commandPath }, req.body, table);
    }
    // POST directly on the endpoint: a command defined with path '' or a create.
    const inline = endpoint.commands?.find((c) => !c.path);
    const looksLikeCreate = endpoint.kind !== 'command' && (endpoint.kind !== 'singleton');
    if (endpoint.kind === 'command' && inline) return runCommand(endpoint, inline, req.body, table);
    if (endpoint.kind === 'singleton' && inline) return runCommand(endpoint, inline, req.body, table);
    if (looksLikeCreate && !endpoint.readOnly && !endpoint.noCreate && Object.keys(req.body).length && !('numbers' in req.body) && !('.id' in req.body)) {
      const row = createRow(path, req.body);
      pushLog('system,info', `dashboard: added entry to /${path} (${describe(row)})`);
      return row;
    }
    if (inline) return runCommand(endpoint, inline, req.body, table);
    throw new DemoError('validation', `Nothing to do — POST /${path} requires a body.`, 400);
  }

  if (req.method === 'PATCH' || req.method === 'PUT') {
    // Singletons (settings menus) have a single unnamed row.
    const targets = endpoint.kind === 'singleton'
      ? (table.length ? table : (table.push({ '.id': '*1' }), table))
      : matchRows(table, body);
    if (!targets.length) throw new DemoError('notfound', 'Entry not found.', 404);
    const patch = { ...body };
    delete patch['.id']; delete patch.numbers; delete patch.number;
    for (const row of targets) Object.assign(row, patch);
    pushLog('system,info', `dashboard: updated /${path} (${describe(patch)})`);
    return targets.length === 1 ? targets[0] : targets;
  }

  if (req.method === 'DELETE') {
    const targets = matchRows(table, req.query.has('id') ? { '.id': req.query.get('id') } : body);
    if (!targets.length) throw new DemoError('notfound', 'Entry not found.', 404);
    for (const row of targets) {
      const i = table.indexOf(row);
      if (i >= 0) table.splice(i, 1);
    }
    pushLog('system,info', `dashboard: removed ${targets.length} entr${targets.length === 1 ? 'y' : 'ies'} from /${path}`);
    return { removed: targets.length };
  }

  throw new DemoError('validation', `Method ${req.method} not supported.`, 405);
}

const hasCommand = (ep: EndpointDef, commandPath: string) =>
  (ep.commands ?? []).some((c) => c.path === commandPath) || commandPath === 'print';

function describe(row: Row): string {
  const key = ['name', 'address', 'interface', 'target', 'list', 'chain', 'host', 'topic', 'prefix', 'mac-address']
    .map((k) => (row[k] ? `${k}=${row[k]}` : ''))
    .filter(Boolean)
    .join(' ');
  return key || Object.keys(row).slice(0, 3).join(',');
}

function applyQuery(rows: Row[], query: URLSearchParams): Row[] {
  let out = rows;
  for (const [key, value] of query.entries()) {
    if (key === '.proplist' || key === '.query') continue;
    out = out.filter((r) => String(r[key] ?? '') === value || (value === 'true' && r[key] === true) || (value === 'false' && r[key] === false));
  }
  return out.map((r) => ({ ...r }));
}

/** Resolve `/rest/<menu>/<segment>` item addressing (`*id`, index or unique name) to a target spec. */
function itemSelector(table: Row[], segment: string): Row | null {
  if (!segment) return null;
  if (segment.startsWith('*')) return { '.id': segment };
  if (/^\d+$/.test(segment)) {
    const row = table[Number(segment)];
    if (row) return { '.id': String(row['.id']) };
  }
  const named = table.find((r) => String(r.name ?? '') === segment || String(r.interface ?? '') === segment);
  return named ? { '.id': String(named['.id']) } : null;
}

export function matchRows(table: Row[], spec: Row = {}): Row[] {
  const ids: string[] = [];
  if (Array.isArray(spec.numbers)) ids.push(...spec.numbers.map(String));
  else if (typeof spec.numbers === 'string' && spec.numbers) ids.push(...spec.numbers.split(',').map((s) => s.trim()));
  if (spec['.id']) ids.push(String(spec['.id']));
  if (spec.number !== undefined && spec.number !== null && spec.number !== '') ids.push(String(spec.number));
  if (!ids.length) return [];
  return table.filter((row, index) =>
    ids.some((id) => row['.id'] === id || String(index) === id || String(row.name ?? '') === id || String(row.interface ?? '') === id));
}

function createRow(path: string, body: Row): Row {
  const table = (state.tables[path] ||= []);
  const id = `*${(Math.max(0, ...table.map((r) => parseInt(String(r['.id']).slice(1), 16) || 0)) + 0x40 + table.length).toString(16).toUpperCase()}`;
  const row: Row = { '.id': id, ...body };
  table.push(row);
  (state.bornAt[path] ||= {})[id] = Math.floor(Date.now() / 1000);
  return row;
}

/* ------------------------------------------------------------------ *
 * Live counters
 * ------------------------------------------------------------------ */

const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : fallback;
};

const secsOf = (v: unknown): number => {
  const m = String(v ?? '').match(/(?:(\d+)w)?(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
  if (!m) return 0;
  return (+(m[1] || 0) * 604800) + (+(m[2] || 0) * 86400) + (+(m[3] || 0) * 3600) + (+(m[4] || 0) * 60) + +(m[5] || 0);
};

const fmtSecs = (s: number) => {
  s = Math.max(0, Math.floor(s));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (d) return `${d}d${h}h${m}m${sec}s`;
  if (h) return `${h}h${m}m${sec}s`;
  if (m) return `${m}m${sec}s`;
  return `${sec}s`;
};

const rateFor = (key: string, scale = 1): number => {
  const r = rng(hash(key));
  return (0.4 + r() * 8) * 1_000_000 * scale;
};

function tick(path: string, table: Row[]): void {
  const now = Math.floor(Date.now() / 1000);
  const last = lastTick[path] ?? now;
  const dt = Math.min(600, Math.max(0, now - last));
  lastTick[path] = now;
  if (dt <= 0) return;

  const bump = (row: Row, field: string, key: string, scale = 1) => {
    if (typeof row[field] !== 'number') return;
    row[field] += Math.round(rateFor(key, scale) * dt * (0.6 + Math.random() * 0.8));
  };

  switch (path) {
    case 'interface':
      for (const row of table) {
        bump(row, 'rx-byte', row.name + 'rx', 1.2);
        bump(row, 'tx-byte', row.name + 'tx', 0.9);
        bump(row, 'rx-packet', row.name + 'rp', 0.02);
        bump(row, 'tx-packet', row.name + 'tp', 0.02);
      }
      break;
    case 'queue/simple': case 'queue/tree':
      for (const row of table) {
        const base = rateFor(row.name + 'q');
        const wave = 0.55 + 0.45 * Math.sin(now / 47 + hash(row.name) % 100);
        const mbps = Math.min(95, (base / 1_000_000) * 8 * wave);
        row.rate = `${mbps.toFixed(1)}Mbps`;
        row['packet-rate'] = `${Math.round(mbps * 82)}`;
        if (typeof row.bytes === 'number') row.bytes += Math.round((mbps * 1_000_000 / 8) * dt);
      }
      break;
    case 'ip/firewall/filter': case 'ip/firewall/nat': case 'ip/firewall/mangle': case 'ip/firewall/raw':
    case 'ipv6/firewall/filter':
      for (const row of table) {
        bump(row, 'bytes', row.chain + row.action + row['.id'], 0.35);
        bump(row, 'packets', row.chain + row.action + 'p' + row['.id'], 0.006);
      }
      break;
    case 'ip/firewall/connection': {
      const tracking = state.tables['ip/firewall/connection/tracking']?.[0];
      if (tracking) {
        const total = num(tracking['total-entries'], 4000);
        tracking['total-entries'] = Math.max(200, total + int(-45, 55, rng(now % 997)));
      }
      for (const row of table) {
        bump(row, 'orig-bytes', row['.id'] + 'o', 0.4);
        bump(row, 'repl-bytes', row['.id'] + 'r', 0.9);
        const t = secsOf(row.timeout) - dt;
        row.timeout = fmtSecs(t);
      }
      // churn: retire old flows, inject new ones
      for (let i = 0; i < 3; i++) {
        if (table.length > 12 && chance(0.6, rng(now + i))) {
          const idx = int(0, table.length - 1, rng(now * 3 + i));
          if (!['established'].includes(String(table[idx].state))) table.splice(idx, 1);
        }
      }
      break;
    }
    case 'interface/wifi/registration-table':
      for (const row of table) {
        bump(row, 'bytes', row['.id'] + 'wb', 0.5);
        bump(row, 'packets', row['.id'] + 'wp', 0.01);
        if (row.uptime) {
          const born = state.bornAt[path]?.[row['.id']];
          if (born) row.uptime = fmtSecs(now - born);
        }
      }
      break;
    case 'ip/hotspot/active': case 'ip/hotspot/host': case 'ip/hotspot/user':
      for (const row of table) {
        bump(row, 'bytes-in', row['.id'] + 'hi', 0.3);
        bump(row, 'bytes-out', row['.id'] + 'ho', 0.3);
        const born = state.bornAt[path]?.[row['.id']];
        if (born && path !== 'ip/hotspot/user') row.uptime = fmtSecs(now - born);
      }
      break;
    case 'ip/dhcp-server/lease':
      for (const row of table) {
        if (row['expires-after'] && row['expires-after'] !== 'never') {
          const left = secsOf(row['expires-after']) - dt;
          if (left <= 0) {
            const r = rng(now + hash(row['.id']));
            row.address = `${pick(['192.168.88', '10.10.10'], r)}.${int(100, 240, r)}`;
            row['expires-after'] = '10m0s';
            row['last-seen'] = '0s';
            row.status = 'bound';
          } else row['expires-after'] = fmtSecs(left);
        }
        if (row['last-seen']) {
          const l = secsOf(row['last-seen']) + dt;
          row['last-seen'] = l > 300 ? '5m' + (l % 60) + 's' : fmtSecs(l);
        }
      }
      break;
    case 'ip/arp':
      for (const row of table) {
        if (row.dynamic && chance(0.05, rng(now + hash(row['.id'])))) row.complete = !row.complete;
      }
      break;
    case 'ipsec/active-peers': case 'ip/ipsec/active-peers':
      for (const row of table) { bump(row, 'rx', row['.id'] + 'ir', 0.6); bump(row, 'tx', row['.id'] + 'it', 0.6); }
      break;
    case 'interface/wireguard/peers':
      for (const row of table) { bump(row, 'rx', row['.id'] + 'wr', 0.5); bump(row, 'tx', row['.id'] + 'wt', 0.5); }
      break;
    case 'container':
      for (const row of table) {
        if (row.status !== 'running') continue;
        const r = rng(now + hash(row.name));
        row['cpu-usage'] = Math.max(0, Math.min(99, num(row['cpu-usage'], 2) + int(-2, 2, r)));
        row['memory-usage'] = Math.max(1, num(row['memory-usage'], 1e5) + int(-400, 900, r) * 1024);
      }
      break;
    case 'tool/sniffer/host': case 'tool/sniffer/connection':
      for (const row of table) {
        const r = rng(now + hash(row['.id']));
        if (row.rate) row.rate = `${int(1, 900, r)}kbps`;
        if (typeof row.bytes === 'number') row.bytes += int(1000, 400000, r);
      }
      break;
    case 'tool/traffic-generator/stats':
      for (const row of table) {
        const r = rng(now + hash(row.name));
        row['tx-rate'] = `${int(700, 999, r)}Mbps`;
        row['rx-rate'] = `${int(700, 998, r)}Mbps`;
        row['tx-packet'] = num(row['tx-packet']) + int(1000, 40000, r);
        row['rx-packet'] = num(row['rx-packet']) + int(1000, 40000, r);
        row.latency = `${int(90, 260, r)}us`;
      }
      break;
    case 'system/resource': {
      const r = rng(Math.floor(now / 5) * 31 + 7);
      const row = table[0];
      if (row) {
        row['cpu-load'] = Math.max(2, Math.min(96, Math.round(9 + 12 * Math.sin(now / 53) + int(-4, 6, r))));
        row['free-memory'] = Math.max(1.2e8, num(row['free-memory'], 9e8) + int(-9, 9, r) * 1_048_576);
      }
      break;
    }
    default: break;
  }

  // Generic uptime tick for rows born during this session.
  const born = state.bornAt[path];
  if (born) {
    for (const row of table) {
      const t = born[row['.id']];
      if (!t) continue;
      if (typeof row.uptime === 'string' && /^(\d+[dhms])+$/.test(row.uptime) && path !== 'ip/hotspot/active') row.uptime = fmtSecs(now - t);
      if (typeof row.since === 'string' && /^(\d+[dhms])+$/.test(row.since) && row.since !== 'never') row.since = fmtSecs(now - t);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Commands
 * ------------------------------------------------------------------ */

export function runCommand(ep: EndpointDef, cmd: CommandDef, body: Row, table: Row[]): any {
  const targets = matchRows(table, body);
  const label = cmd.label || cmd.id;
  const logIt = (topics: string, message: string) => pushLog(topics, message);

  switch (cmd.id) {
    case 'enable': case 'disable': {
      const on = cmd.id === 'enable';
      for (const row of targets) row.disabled = !on;
      logIt('system,info', `${ep.path}: ${label.toLowerCase()} ${
        targets.length ? targets.map((t) => t.name ?? t['.id']).join(', ') : 'all'}`);
      return targets;
    }
    case 'remove': {
      for (const row of targets) {
        const i = table.indexOf(row);
        if (i >= 0) table.splice(i, 1);
      }
      const n = targets.length;
      logIt('system,info', `${ep.path}: removed ${n} entr${n === 1 ? 'y' : 'ies'}`);
      if (!n) throw new DemoError('notfound', 'Nothing matched — select a row first.', 404);
      return { removed: n };
    }
    case 'move': case 'move-up': case 'move-down': {
      const row = targets[0];
      if (!row) throw new DemoError('notfound', 'Select a rule to move.', 404);
      const i = table.indexOf(row);
      const delta = cmd.id === 'move-down' ? 1 : cmd.id === 'move-up' ? -1 : 1;
      const j = Math.min(table.length - 1, Math.max(0, i + delta));
      table.splice(i, 1);
      table.splice(j, 0, row);
      table.forEach((r, idx) => { r.index = idx; });
      return row;
    }
    case 'reset-counters': {
      for (const row of (targets.length ? targets : table)) {
        if ('bytes' in row) row.bytes = 0;
        if ('packets' in row) row.packets = 0;
      }
      logIt('system,info', `${ep.path}: counters reset`);
      return { status: 'ok' };
    }
    case 'make-static': {
      for (const row of targets) { row.dynamic = false; row['expires-after'] = 'never'; }
      logIt('dhcp,info', `lease ${targets.map((t) => t.address).join(',')} made static`);
      return targets;
    }
    case 'unset': {
      const field = String(body['value-name'] ?? '');
      for (const row of targets) if (field) delete row[field];
      return { status: 'ok' };
    }
    case 'run': {
      for (const row of targets) {
        row['run-count'] = String(num(row['run-count']) + 1);
        row['last-started'] = dateTimeString(0);
        if (!row['run-count'] && row.name) row['run-count'] = '1';
      }
      logIt('script,info', `executed ${targets[0]?.name ?? ep.label}`);
      return { status: 'ok', output: [`executed ${targets[0]?.name ?? ep.label}`] };
    }
    case 'kill': {
      for (const row of targets) {
        const i = table.indexOf(row);
        if (i >= 0) table.splice(i, 1);
      }
      logIt('system,info', 'connection killed');
      return { status: 'ok' };
    }
    case 'flush': {
      table.splice(0, table.length);
      if (ep.path === 'ip/dns/cache') logIt('dns,info', 'DNS: cache flushed from dashboard');
      else logIt('ipsec,info', 'IPsec: all SAs flushed from dashboard');
      return { status: 'ok' };
    }
    case 'backup': case 'save': case 'export': {
      const name = String(body.name ?? body.file ?? 'dashboard-backup');
      const ext = cmd.id === 'backup' ? 'backup' : cmd.id === 'export' ? 'rsc' : 'rsc';
      const file = name.includes('.') ? name : `${name}.${ext}`;
      (state.tables['file'] ||= []).unshift({
        '.id': `*F${(hash(file) % 0xffff).toString(16).toUpperCase()}`,
        name: file, type: ext, size: int(80000, 260000, rng(hash(file))), 'creation-time': dateTimeString(0),
      });
      (state.tables['system/backup'] ||= []).unshift({ '.id': `*B${(hash(file) % 0xffff).toString(16).toUpperCase()}`, name: file, size: int(80000, 260000, rng(hash(file))), 'creation-time': dateTimeString(0) });
      logIt('system,info', `${cmd.id}: ${file} created (${body['show-sensitive'] ? 'including' : 'excluding'} sensitive data)`);
      return { status: 'ok', file, message: `${file} saved` };
    }
    case 'load':
      logIt('system,warning', `backup ${body.name} loaded — router rebooting`);
      resetUptime();
      return { status: 'ok', message: 'Router is rebooting with the loaded backup.' };
    case 'print': {
      if (body.file) {
        const f = (state.tables['file'] ?? []).find((r) => r.name === body.file);
        return `# ${body.file}\n# ${f?.size ?? 0} bytes, created ${f?.['creation-time'] ?? 'now'}\n/interface bridge add name=bridge1\n/ip address add address=192.168.88.1/24 interface=bridge1\n`;
      }
      return table;
    }
    case 'sign': {
      for (const row of targets) {
        row.ca = true; row.trusted = true; row['expires-after'] = `${int(200, 900, rng(hash(String(row.name))))}d`;
      }
      logIt('certificate,info', `certificate ${targets[0]?.name} signed`);
      return targets;
    }
    case 'import': case 'create-certificate-request': {
      const name = String(body.name ?? body['file-name'] ?? `cert-${int(100, 999, rng(Date.now()))}`);
      const row = createRow('system/certificate', { name, 'common-name': body['common-name'] ?? name, ca: false, trusted: false, 'expires-after': '364d', 'key-usage': 'digital-signature,key-encipherment' });
      logIt('certificate,info', `certificate ${name} imported/created`);
      return row;
    }
    case 'pull': {
      const image = String(body.image ?? 'docker.io/library/alpine:latest');
      const row = createRow('container/image', { tag: image, arch: 'arm64', os: 'linux', size: int(5e6, 2e8, rng(hash(image))), 'repo-digest': `sha256:${hash(image).toString(16).padStart(64, '0')}` });
      logIt('container,info', `image ${image} pulled`);
      return row;
    }
    case 'check-for-updates':
      return { status: 'New version is available', 'installed-version': '7.16.2', 'latest-version': '7.17.1', channel: 'stable' };
    case 'update': case 'firmware-upgrade': case 'upgrade-firmware':
      logIt('system,info', `${cmd.id}: upgrade started`);
      resetUptime();
      return { status: 'ok', message: 'Upgrade started — the router will reboot.' };
    case 'reboot': case 'shutdown': case 'reset-configuration':
      logIt('system,info', `${label.toLowerCase()} requested from dashboard`);
      if (cmd.id === 'reboot') resetUptime();
      return { status: 'ok', message: `${label} requested.` };
    case 'ddns-update': case 'force-update':
      return { status: 'updated', 'public-address': '102.176.94.21', 'dns-name': 'a1b2c3d4e5f6.sn.mynetname.net' };
    case 'monitor': {
      if (ep.path === 'interface') {
        const name = String(body.name ?? targets[0]?.name ?? 'ether1');
        return [{ name, 'rx-bits-per-second': `${int(1, 900, rng(hash(name))) }Mbps`, 'tx-bits-per-second': `${int(1, 900, rng(hash(name) + 1))}Mbps`, 'rx-packets-per-second': int(100, 90000, rng(hash(name) + 2)), 'tx-packets-per-second': int(100, 90000, rng(hash(name) + 3)), 'rx-drops-per-second': int(0, 40, rng(hash(name) + 4)) }];
      }
      if (ep.path === 'interface/lte') {
        return [{ 'current-operator': 'MTN GH', 'access-technology': 'LTE', 'signal-strength': '-71dBm', rsrp: '-98dBm', rsrq: '-11dB', sinr: '14dB', 'frame-number': 1823, 'session-uptime': '3h41m', 'data-usage': int(1e8, 9e9, rng(4)) }];
      }
      if (ep.path === 'container') {
        return [{ name: targets[0]?.name ?? 'container', 'cpu-usage': int(1, 12, rng(5)), 'memory-usage': int(4e7, 2e8, rng(6)), 'memory-shared': 4194304, 'memory-buffers': 1048576 }];
      }
      if (ep.path === 'system/ntp/client') {
        return [{ enabled: true, status: 'synchronized', 'server': 'time.cloudflare.com', 'last-adjustment': '12s', 'freq-drift': '3.211' }];
      }
      if (ep.path.includes('ppp')) return [{ name: targets[0]?.name ?? 'pppoe-out1', status: 'connected', 'uptime': '14d2h11m', encoding: 'MPPE128 stateless' }];
      if (ep.path === 'interface/wifi') return [{ name: targets[0]?.name ?? 'wifi1', 'registered-clients': int(1, 30, rng(7)), 'rx-rate': '866Mbps', 'tx-rate': '866Mbps', 'channel': '5180/20/40/80mhz' }];
      return [{ status: 'ok' }];
    }
    case 'at-chat':
      return { output: 'OK' };
    case 'scan': {
      const r = rng(Date.now() % 100000);
      if (ep.path === 'tool/ip-scan') {
        const found = (state.tables['tool/ip-scan'] ||= []);
        for (let i = 0; i < 6; i++) found.push({ '.id': `*S${hash(String(i) + Date.now())}`, address: `192.168.88.${int(2, 250, r)}`, 'mac-address': mac(r), interface: String(body.interface ?? 'bridge1'), timeout: '1s' });
        return { scanned: found.length, hosts: found.length };
      }
      if (ep.path === 'tool/macscan') {
        const found = (state.tables['tool/macscan'] ||= []);
        for (let i = 0; i < 5; i++) found.push({ '.id': `*M${hash(String(i) + Date.now())}`, 'mac-address': mac(r), address: `192.168.88.${int(2, 250, r)}`, interface: String(body.interface ?? 'bridge1'), age: `${int(1, 20, r)}s` });
        return { scanned: 254, found: found.length };
      }
      if (ep.path === 'interface/wifi') {
        return Array.from({ length: 7 }).map((_, i) => ({
          'mac-address': mac(r), ssid: pick(['Accra-Office', 'Accra-Guest', 'Neighbour-2G', 'CafeWiFi', 'MTN-Home', 'Vodafone-4G', 'CoreBackhaul'], r),
          channel: pick(['2412/20mhz', '2437/20mhz', '2462/20mhz', '5180/20/40/80mhz', '5500/20/40/80mhz'], r),
          signal: `-${int(30, 92, r)}dBm`, security: pick(['wpa2-psk', 'wpa3-psk', 'open', 'wpa2-psk'], r), 'channel-width': '20mhz',
        }));
      }
      return [{ status: 'done' }];
    }
    case 'frequency-monitor':
      return Array.from({ length: 12 }).map((_, i) => ({ 'interference': `${int(2, 60, rng(i + 11))}dBm`, 'frequency': `${2400 + i * 5}`, 'load': `${int(2, 90, rng(i + 21))}%` }));
    case 'ping': {
      const address = String(body.address ?? '8.8.8.8');
      const count = Math.min(20, Number(body.count ?? 4) || 4);
      const r = rng(hash(address));
      return Array.from({ length: count }).map((_, i) => ({
        seq: i, host: address, size: Number(body.size ?? 56), ttl: Number(body.ttl ?? 64),
        time: `${(0.4 + r() * 14).toFixed(1)}ms`, status: i === count - 1 ? 'complete' : 'ok',
      }));
    }
    case 'traceroute': {
      const address = String(body.address ?? '1.1.1.1');
      const r = rng(hash(address));
      const hops = [];
      for (let i = 1; i <= 7; i++) {
        hops.push({ hop: i, address: i === 1 ? '100.64.12.1' : `${int(10, 210, r)}.${int(1, 250, r)}.${int(1, 250, r)}.${int(1, 250, r)}`, loss: `${i === 5 ? 40 : 0}%`, 'sent': 3, 'last': i === 5 ? '' : `${(2 + r() * 30).toFixed(1)}ms`, status: 'ok' });
      }
      hops.push({ hop: 8, address, loss: '0%', sent: 3, last: `${(18 + r() * 20).toFixed(1)}ms`, status: 'ok' });
      return hops;
    }
    case 'flood-ping': {
      const count = Number(body.count ?? 100);
      return [{ status: 'complete', 'sent': count, 'received': count, 'loss': '0%', 'min-rtt': '0.3ms', 'avg-rtt': '0.7ms', 'max-rtt': '4.1ms' }];
    }
    case 'wol':
      return { status: 'sent', mac: String(body.mac), interface: String(body.interface) };
    case 'torch': {
      const r = rng(Date.now() % 99991);
      return Array.from({ length: 10 }).map(() => ({
        'src-address': `192.168.88.${int(2, 250, r)}`, 'dst-address': pick(['142.250.190.14', '104.16.132.229', '140.82.121.4', '1.1.1.1', '20.42.65.90'], r),
        protocol: pick(['tcp', 'udp', 'icmp'], r), port: pick([443, 80, 53, 5228], r),
        tx: `${int(1, 900, r)}kbps`, rx: `${int(1, 900, r)}kbps`, 'tx-packets': int(1, 9000, r), 'rx-packets': int(1, 9000, r),
      }));
    }
    case 'run-profiler': case 'run-profile': {
      return state.tables['tool/profile'] ?? [];
    }
    case 'fetch': {
      const url = String(body.url ?? '');
      logIt('script,info', `fetch: ${url}`);
      return { status: 'finished', 'downloaded': int(200, 900000, rng(hash(url))), 'total': int(200, 900000, rng(hash(url) + 1)), duration: '1s420ms', url, 'http-status': 200 };
    }
    case 'bandwidth-test': case 'speed-test': {
      const r = rng(Date.now() % 7777);
      return [{ status: 'done', 'tx-avg': `${int(120, 940, r)}Mbps`, 'rx-avg': `${int(120, 940, r)}Mbps`, 'tx-size': int(1e8, 9e9, r), 'rx-size': int(1e8, 9e9, r), 'tx-packets': int(1e5, 9e6, r), 'rx-packets': int(1e5, 9e6, r), 'remote-cpu-load': `${int(4, 60, r)}%`, 'local-cpu-load': `${int(4, 60, r)}%` }];
    }
    case 'send': {
      logIt('script,info', `notification sent to ${body.to ?? body['phone-number'] ?? 'recipient'}`);
      return { status: 'sent' };
    }
    case 'tracking':
      return [{ 'total-entries': num(state.tables['ip/firewall/connection/tracking']?.[0]?.['total-entries'], 4128), 'active-ipv4': 2688, 'active-ipv6': 12, 'max-entries': '1M' }];
    case 'dump':
      logIt('system,info', `connection table dumped to ${body.file ?? 'connection-dump.txt'}`);
      return { status: 'ok', file: String(body.file ?? 'connection-dump.txt') };
    case 'check': case 'check-status': case 'test':
      return [{ status: 'ok', address: String(body.address ?? targets[0]?.address ?? ''), 'time': `${int(1, 40, rng(Date.now() % 999))}ms` }];
    case 'renew': case 'release':
      logIt('dhcp,info', `DHCP ${cmd.id} on ${targets[0]?.interface ?? ep.label}`);
      if (cmd.id === 'renew' && targets[0]) targets[0]['expires-after'] = '10m0s';
      return { status: 'ok' };
    case 'discover':
      return Array.from({ length: 5 }).map((_, i) => ({ 'mac-address': mac(rng(i + 31)), identity: `neighbour-${i + 1}`, 'address': `192.168.88.${60 + i}`, 'board': 'CRS326-24G-2S+', version: '7.16.2' }));
    case 'exec':
      return { output: `(demo) executed: ${String(body.command ?? '')}\n`, status: 'ok' };
    case 'execute': {
      const script = String(body.script ?? '');
      logIt('script,info', `console: ${script.split('\n')[0].slice(0, 120)}`);
      if (/reboot/i.test(script)) { resetUptime(); return { output: 'system will reboot' }; }
      if (/identity/i.test(script)) return { output: state.tables['system/identity'][0].name };
      if (/resource/i.test(script)) return { output: `cpu-load: ${state.tables['system/resource'][0]['cpu-load']}%` };
      if (/:put|:return|:local/i.test(script)) return { output: '(demo) command executed successfully' };
      return { output: '(demo) ok' };
    }
    case 'set': {
      for (const row of targets) {
        if (body.value !== undefined) row[String(body.field ?? 'value')] = body.value;
        if (cmd.id === 'set' && ep.path === 'iot/gpio') row.output = String(body.value) === '1';
        if (ep.path === 'iot/leds') row.status = String(body.state ?? 'auto');
      }
      return { status: 'ok' };
    }
    case 'start': case 'stop': case 'restart': case 'killing':
      for (const row of targets) row.status = cmd.id === 'start' ? 'running' : cmd.id === 'stop' ? 'stopped' : cmd.id === 'restart' ? 'running' : 'stopped';
      logIt('container,info', `container ${cmd.id} for ${targets.map((t) => t.name).join(', ')}`);
      return targets;
    case 'restart-image':
      return { status: 'ok' };
    case 'make-binding':
      for (const row of targets) {
        (state.tables['ip/hotspot/ip-binding'] ||= []).unshift({ '.id': `*H${hash(String(row['.id']) + Date.now()).toString(16).slice(0, 6).toUpperCase()}`, address: row.address, 'mac-address': row['mac-address'], type: 'bypassed', server: row.server, comment: 'created from host list' });
        row.authorized = true;
      }
      return { status: 'ok' };
    case 'kill-connection':
      return { status: 'ok' };
    case 'keygen':
      return [{ 'private-key': `-----BEGIN PRIVATE KEY-----\n(demo ${body['key-size'] ?? 2048}-bit key)\n-----END PRIVATE KEY-----` }];
    case 'reset-html':
      logIt('hotspot,info', 'hotspot HTML directory restored to defaults');
      return { status: 'ok' };
    default:
      logIt('system,info', `${ep.path}: ${label}`);
      return { status: 'ok', command: cmd.id, message: `${label} executed (demo)` };
  }
}

function resetUptime(): void {
  const res = state.tables['system/resource']?.[0];
  if (res) res.uptime = '0s';
}

/** Push a synthetic log line so the Log page reflects dashboard actions. */
export function pushLog(topics: string, message: string): void {
  const row: Row = { '.id': `*L${Math.random().toString(16).slice(2, 8).toUpperCase()}`, time: timeString(0), topics, message };
  (state.tables['log'] ||= []).unshift(row);
  liveLog.unshift(row);
  if (liveLog.length > 200) liveLog.pop();
  if (state.tables['log'].length > 600) state.tables['log'].pop();
}

/* ------------------------------------------------------------------ *
 * Aggregates for the dashboard
 * ------------------------------------------------------------------ */

export interface Series { t: number; rx: number; tx: number }

export function getSeries(points = 60, stepSec = 5): Series[] {
  const now = Math.floor(Date.now() / 1000);
  const out: Series[] = [];
  for (let i = points - 1; i >= 0; i--) {
    const t = now - i * stepSec;
    const base = 42e6 + 16e6 * Math.sin(t / 220) + 7e6 * Math.sin(t / 61 + 1.3);
    const r = rng(Math.floor(t / stepSec) * 2654435761);
    out.push({
      t,
      rx: Math.max(1e6, Math.round(base * (0.82 + r() * 0.36))),
      tx: Math.max(1e6, Math.round(base * 0.36 * (0.75 + r() * 0.5))),
    });
  }
  return out;
}

export function getMetrics(): Row {
  const t = state.tables;
  const res = t['system/resource']?.[0] ?? {};
  const now = Math.floor(Date.now() / 1000);
  const rng5 = rng(Math.floor(now / 5) * 7 + 13);
  const cpu = Array.from({ length: 24 }).map((_, i) => Math.max(2, Math.round(11 + 16 * Math.sin((now - (23 - i) * 5) / 90) + int(-5, 7, rng(hash('cpu' + i + Math.floor(now / 300)))))));

  const ifaces = t['interface'] ?? [];
  const up = ifaces.filter((i) => i.running && !i.disabled).length;
  const wan = ifaces.find((i) => i.name === 'ether1') ?? {};
  const lte = t['interface/lte']?.[0] ?? {};

  const leases = t['ip/dhcp-server/lease'] ?? [];
  const hotspotActive = t['ip/hotspot/active'] ?? [];
  const wifiClients = t['interface/wifi/registration-table'] ?? [];
  const pppActive = t['ppp/active'] ?? [];
  const conns = t['ip/firewall/connection'] ?? [];
  const rules = t['ip/firewall/filter'] ?? [];
  const series = getSeries(24, 5);
  const last = series[series.length - 1];

  const blocked = (t['ip/firewall/address-list'] ?? []).filter((r) => r.list === 'BlockedNets').length;
  const dropHits = rules.filter((r) => String(r.action ?? '').startsWith('drop')).reduce((a, r) => a + num(r.packets), 0);

  const totalMem = num(res['total-memory'], 2e9) || 2e9;
  const freeMem = num(res['free-memory'], 1.2e9);
  const totalHdd = num(res['total-hdd-space'], 1.34e8) || 1.34e8;
  const freeHdd = num(res['free-hdd-space'], 4e7);

  const alerts: Array<Row> = [];
  const downIfaces = ifaces.filter((i) => !i.running && !i.disabled && /ether|sfp/.test(String(i.name)));
  if (downIfaces.length) alerts.push({ id: 'links', severity: 'warning', title: `${downIfaces.length} physical port${downIfaces.length > 1 ? 's' : ''} down`, detail: downIfaces.map((i) => i.name).join(', '), category: 'interfaces' });
  if (num(res['cpu-load']) > 75) alerts.push({ id: 'cpu', severity: 'critical', title: 'High CPU load', detail: `CPU at ${res['cpu-load']}%`, category: 'system' });
  if (freeHdd / totalHdd < 0.35) alerts.push({ id: 'disk', severity: 'warning', title: 'Low disk space', detail: `${Math.round((freeHdd / totalHdd) * 100)}% free on flash`, category: 'system' });
  const certs = (t['system/certificate'] ?? []).filter((c) => /^\d+d/.test(String(c['expires-after'] ?? '')));
  if (certs.length) alerts.push({ id: 'certs', severity: 'warning', title: `${certs.length} certificate${certs.length > 1 ? 's' : ''} expiring`, detail: certs.map((c) => c.name).join(', '), category: 'system' });
  const badContainers = (t['container'] ?? []).filter((c) => c.status === 'error');
  if (badContainers.length) alerts.push({ id: 'containers', severity: 'critical', title: `Container error: ${badContainers.map((c) => c.name).join(', ')}`, detail: 'Container exited and is not restarting.', category: 'containers' });
  const netwatchDown = (t['tool/netwatch'] ?? []).filter((n) => n.status === 'down');
  if (netwatchDown.length) alerts.push({ id: 'netwatch', severity: 'critical', title: `Netwatch down: ${netwatchDown.map((n) => n.name).join(', ')}`, detail: netwatchDown.map((n) => `${n.host}`).join(', '), category: 'tools' });
  const weakLte = lte && /-1[0-9][0-9]/.test(String(lte['signal-strength'] ?? ''));
  if (weakLte) alerts.push({ id: 'lte', severity: 'warning', title: 'Weak LTE signal', detail: `${lte['signal-strength']} on lte1`, category: 'interfaces' });
  const lteRoute = (t['ip/route'] ?? []).find((r) => String(r.comment ?? '').includes('LTE') && r.active);
  if (lteRoute) alerts.push({ id: 'failover', severity: 'critical', title: 'WAN failover active', detail: 'Traffic is using the LTE backup uplink.', category: 'ip' });
  if (blocked > 3) alerts.push({ id: 'abuse', severity: 'info', title: `${blocked} blocked hosts in address list`, detail: `${dropHits.toLocaleString('en-US')} packets dropped by firewall rules.`, category: 'firewall' });

  return {
    identity: t['system/identity']?.[0]?.name ?? 'RouterOS',
    version: res.version ?? '7.16.2',
    board: res['board-name'] ?? '',
    uptime: res.uptime ?? '',
    cpuLoad: num(res['cpu-load']),
    cpuCores: num(res['cpu-count'], 4),
    cpuSeries: cpu,
    memory: { used: totalMem - freeMem, total: totalMem },
    disk: { used: totalHdd - freeHdd, total: totalHdd },
    temperature: num((t['system/health'] ?? []).find((h) => h.name === 'temperature')?.value, 41),
    voltage: num((t['system/health'] ?? []).find((h) => h.name === 'voltage')?.value, 24.1),
    interfaces: { total: ifaces.length, up, down: ifaces.length - up, rxRate: last.rx, txRate: last.tx },
    wan: { address: wan['rx-byte'] ? (t['ip/address'] ?? []).find((a) => a.interface === 'ether1')?.address ?? '' : '', gateway: (t['ip/dhcp-client'] ?? [])[0]?.gateway ?? '', status: (t['ip/dhcp-client'] ?? [])[0]?.status ?? 'bound' },
    lte: { signal: lte['signal-strength'] ?? '', operator: lte['current-operator'] ?? '', active: Boolean(lteRoute) },
    clients: { dhcp: leases.filter((l) => l.status === 'bound' || !l.status).length, hotspot: hotspotActive.length, wifi: wifiClients.length, ppp: pppActive.length, arp: (t['ip/arp'] ?? []).length },
    firewall: { rules: rules.length, connections: Math.max(conns.length, num(t['ip/firewall/connection/tracking']?.[0]?.['total-entries'])), blocked, drops: dropHits },
    routing: { routes: (t['ip/route'] ?? []).length, bgpEstablished: (t['routing/bgp/session'] ?? []).filter((s) => s.state === 'established').length, ospfNeighbors: (t['routing/ospf/neighbor'] ?? []).length, vpnPeers: (t['ip/ipsec/active-peers'] ?? []).length + (t['interface/wireguard/peers'] ?? []).length },
    queues: { count: (t['queue/simple'] ?? []).length, shaped: (t['queue/simple'] ?? []).reduce((a, q) => a + Number(String(q['max-limit'] ?? '0').split('/')[0].replace(/\D/g, '') || 0), 0) },
    alerts,
    series: getSeries(60, 5),
    topTalkers: buildTopTalkers(),
    hotspot: {
      active: hotspotActive.length,
      users: (t['ip/hotspot/user'] ?? []).length,
      loginBy: (t['ip/hotspot/active'] ?? []).reduce<Record<string, number>>((acc, r) => ({ ...acc, [r['login-by']]: (acc[r['login-by']] ?? 0) + 1 }), {}),
    },
    leases: leases.slice(0, 5).map((l) => ({ name: l['host-name'], address: l.address, mac: l['mac-address'], expires: l['expires-after'], server: l.server })),
    logTail: (t['log'] ?? []).slice(0, 8),
    ts: Date.now(),
    jitter: int(0, 999, rng5),
  };
}

function buildTopTalkers(): Row[] {
  const conns = state.tables['ip/firewall/connection'] ?? [];
  const byIp = new Map<string, { address: string; rx: number; tx: number; sessions: number }>();
  for (const c of conns) {
    const key = String(c['src-address'] ?? '');
    if (!key) continue;
    const e = byIp.get(key) ?? { address: key, rx: 0, tx: 0, sessions: 0 };
    e.rx += num(c['repl-bytes']);
    e.tx += num(c['orig-bytes']);
    e.sessions += 1;
    byIp.set(key, e);
  }
  return [...byIp.values()].sort((a, b) => b.rx + b.tx - (a.rx + a.tx)).slice(0, 6);
}

/** Device metadata used by the connection screen and the banner. */
export function getDeviceInfo(): Row {
  const t = state.tables;
  return {
    identity: t['system/identity']?.[0]?.name ?? 'RouterOS',
    board: t['system/routerboard']?.[0]?.model ?? '',
    version: t['system/resource']?.[0]?.version ?? '',
    serial: t['system/routerboard']?.[0]?.['serial-number'] ?? '',
    architecture: t['system/resource']?.[0]?.['architecture-name'] ?? '',
    uptime: t['system/resource']?.[0]?.uptime ?? '',
    mode: t['system/device-mode']?.[0]?.mode ?? 'advanced',
    menus: { total: ENDPOINTS.length, available: ENDPOINTS.length },
  };
}

export function resetDemo(): void {
  const fresh = buildState();
  state.tables = fresh.tables;
  state.bornAt = fresh.bornAt;
}
