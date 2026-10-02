/**
 * Bulk device sweep.
 *
 * The per-device probe answers "who is this one box?"; a sweep answers "what is
 * actually alive on this subnet right now?". It runs ping probes against every known
 * address with bounded concurrency and streams results as they land.
 *
 * Honest scope: this is reachability plus *passively observed* service usage (the
 * conversations conntrack has seen for that address). RouterOS has no REST port
 * scanner — `tool/ip-scan` only populates the ARP table, and `tool/netwatch` is a
 * monitor, not a scan — so nothing here claims to have probed TCP ports.
 */
import type { DeviceRecord, SweepResult, SweepSummary } from '../../shared/analytics';
import type { Connection } from '../store';
import { normalizeList, rosRequest } from '../routeros';

/** Compact bps formatter for the summary line (the UI re-formats for display). */
const fmtRate = (bytesPerSecond: number): string => {
  const units = ['bps', 'Kbps', 'Mbps', 'Gbps'];
  let value = Math.max(0, bytesPerSecond) * 8;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) { value /= 1000; unit++; }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
};

export interface SweepTarget {
  ip: string;
  name?: string;
  mac?: string;
  vendor?: string;
  kind?: string;
  link?: string;
  interfaces?: string;
  lastSeen?: string;
  /** Conversations conntrack has seen for this address. */
  flows?: number;
  bytes?: number;
  topService?: string;
}

export const inCidr = (ip: string, cidr: string): boolean => {
  const [network, bitsRaw] = cidr.split('/');
  const bits = Number(bitsRaw ?? 32);
  if (!network || !Number.isFinite(bits)) return false;
  const toInt = (value: string) => value.split('.').reduce((acc, part) => ((acc << 8) >>> 0) + (Number(part) & 255), 0) >>> 0;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (toInt(ip) & mask) === (toInt(network) & mask);
};

/** Device inventory → sweep targets, optionally narrowed to a subnet. */
export function sweepTargets(devices: DeviceRecord[], scope: string, conversationByIp: Record<string, { flows: number; bytes: number; topService: string }> = {}): SweepTarget[] {
  const wanted = scope && scope !== 'all'
    ? devices.filter((device) => device.addresses.some((address) => inCidr(address, scope)))
    : devices;
  const targets: SweepTarget[] = [];
  const seen = new Set<string>();
  for (const device of wanted) {
    const ip = device.ip ?? device.addresses[0];
    if (!ip || seen.has(ip)) continue;
    seen.add(ip);
    const observed = conversationByIp[ip];
    targets.push({
      ip,
      // A device with no hostname is identified by its MAC in the inventory; that is
      // not a name, so leave it out and let the UI show the address instead.
      name: device.name && device.name.toUpperCase() !== String(device.mac ?? '').toUpperCase() ? device.name : undefined,
      mac: device.mac,
      vendor: device.vendor,
      kind: device.kind,
      link: device.link,
      interfaces: device.interface,
      lastSeen: device.uptime,
      flows: observed?.flows,
      bytes: observed?.bytes,
      topService: observed?.topService,
    });
  }
  return targets;
}

const pingOnce = async (target: SweepTarget, conn: Connection | undefined, demo: boolean): Promise<SweepResult> => {
  const base: SweepResult = {
    ip: target.ip,
    name: target.name,
    mac: target.mac,
    vendor: target.vendor,
    kind: target.kind,
    link: target.link,
    reachable: false,
    rttMs: null,
    method: 'ping',
    flows: target.flows,
    bytes: target.bytes,
    topService: target.topService,
  };

  try {
    if (demo || !conn) {
      // The demo device answers for everything it has a record of, with a
      // deterministic latency, and drops the deliberately-offline addresses.
      const offline = /unknown-laptop|legacy-camera|192\.168\.88\.18[0-9]/.test(`${target.name ?? ''} ${target.ip}`);
      if (offline) return { ...base, reachable: false, rttMs: null, method: 'arp' };
      const seed = target.ip.split('.').reduce((sum, part) => sum + Number(part), 0);
      return { ...base, reachable: true, rttMs: Math.round((0.4 + (seed % 37) / 10) * 10) / 10, method: target.mac ? 'arp' : 'ping' };
    }
    const result = await rosRequest(conn, 'tool/ping', 'POST', { address: target.ip, count: '2' });
    const rows = normalizeList(result.data);
    const times = rows
      .map((row) => Number(String(row.time ?? '').replace(/[^0-9.]/g, '')))
      .filter((value) => Number.isFinite(value) && value > 0);
    const answered = rows.some((row) => row.seq !== undefined && row.seq !== 'complete');
    return {
      ...base,
      reachable: answered,
      rttMs: times.length ? Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 100) / 100 : null,
    };
  } catch (err) {
    return { ...base, reachable: false, error: err instanceof Error ? err.message : 'probe failed' };
  }
};

export interface SweepOptions {
  scope: string;
  concurrency?: number;
  limit?: number;
  onResult?: (result: SweepResult, index: number) => void;
  onStart?: (total: number) => void;
}

/** Runs the probes with bounded concurrency, reporting each result as it lands. */
export async function runSweep(
  targets: SweepTarget[],
  conn: Connection | undefined,
  demo: boolean,
  options: SweepOptions,
): Promise<SweepSummary> {
  const concurrency = Math.min(12, Math.max(1, options.concurrency ?? 6));
  const queue = targets.slice(0, Math.min(options.limit ?? 60, targets.length));
  const startedAt = Date.now();
  const results: SweepResult[] = [];
  let cursor = 0;
  options.onStart?.(queue.length);

  const worker = async () => {
    while (cursor < queue.length) {
      const index = cursor++;
      const result = await pingOnce(queue[index], conn, demo);
      results.push(result);
      options.onResult?.(result, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }).map(worker));

  const reachable = results.filter((result) => result.reachable);
  const rtts = reachable.map((result) => result.rttMs ?? 0).filter((value) => value > 0);
  const observed = results.reduce((sum, result) => sum + (result.bytes ?? 0), 0);
  return {
    scope: options.scope,
    total: queue.length,
    reachable: reachable.length,
    unreachable: results.length - reachable.length,
    averageRttMs: rtts.length ? Math.round((rtts.reduce((a, b) => a + b, 0) / rtts.length) * 100) / 100 : null,
    status: 'complete',
    elapsedMs: Date.now() - startedAt,
    observedTraffic: fmtRate(observed / Math.max(1, (Date.now() - startedAt) / 1000)),
    results: results.sort((a, b) => Number(b.reachable) - Number(a.reachable) || a.ip.localeCompare(b.ip, undefined, { numeric: true })),
  };
}
