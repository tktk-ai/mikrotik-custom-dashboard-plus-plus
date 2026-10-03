/**
 * Reads RouterOS menus for the analytics layer.
 *
 * The same code path serves the demo device and a real router: in demo mode the
 * simulated engine answers, in live mode the REST proxy does. Failures are
 * returned per path instead of thrown so a single missing menu (firmware,
 * licence, package) never breaks the whole bundle.
 */
import type { Row } from '../../shared/types';
import { handleDemo } from '../demo/engine';
import { RosError, normalizeList, rosRequest } from '../routeros';
import { getActiveConnection } from '../store';

export interface Fetched {
  path: string;
  rows: Row[];
  ok: boolean;
  ms: number;
  error?: string;
}

export interface SourceReport {
  path: string;
  ok: boolean;
  rows: number;
  error?: string;
}

export type TableMap = Record<string, Row[]>;

const encodePath = (path: string) =>
  path.split('/').filter(Boolean).map(encodeURIComponent).join('/');

export async function fetchPath(path: string): Promise<Fetched> {
  const started = Date.now();
  const conn = getActiveConnection();
  if (!conn) return { path, rows: [], ok: false, ms: 0, error: 'No device connection configured.' };

  try {
    if (conn.demo) {
      const rows = normalizeList(handleDemo({ method: 'GET', path, body: {}, query: new URLSearchParams() }));
      return { path, rows, ok: true, ms: Date.now() - started };
    }
    const result = await rosRequest(conn, path, 'GET');
    return { path, rows: normalizeList(result.data), ok: true, ms: Date.now() - started };
  } catch (err) {
    const message = err instanceof RosError
      ? `${err.kind}: ${err.message}`
      : (err as Error)?.message ?? 'Request failed';
    return { path, rows: [], ok: false, ms: Date.now() - started, error: message };
  }
}

/** Fetch many menus with bounded concurrency, preserving the requested order. */
export async function fetchPaths(paths: string[], concurrency = 6): Promise<Map<string, Fetched>> {
  const out = new Map<string, Fetched>();
  const queue = [...paths];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }).map(async () => {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      out.set(encodePath(next), await fetchPath(next));
    }
  });
  await Promise.all(workers);
  return out;
}

export function toTables(fetched: Map<string, Fetched>): TableMap {
  const tables: TableMap = {};
  for (const entry of fetched.values()) tables[entry.path] = entry.rows;
  return tables;
}

export function reports(fetched: Map<string, Fetched>): SourceReport[] {
  return [...fetched.values()].map(({ path, ok, rows, error }) => ({ path, ok, rows: rows.length, error }));
}

/** `list(tables, 'ip/dhcp-server/lease')` — never undefined, always a fresh array. */
export const list = (tables: TableMap, path: string): Row[] => tables[path] ?? [];

/* ------------------------------------------------------------------ *
 * Menu groups used by the analytics pages
 * ------------------------------------------------------------------ */

/** Everything the insights engine wants to see. */
export const INSIGHT_PATHS = [
  // system / identity
  'system/resource', 'system/identity', 'system/health', 'system/routerboard',
  'system/clock', 'system/ntp/client', 'system/package', 'system/package/update',
  'system/license', 'system/user', 'system/user/active', 'system/user/group',
  'system/scheduler', 'system/script', 'system/certificate', 'system/note',
  // services & exposure
  'ip/service', 'ip/cloud', 'ip/socks', 'ip/upnp', 'ip/upnp/interfaces',
  'ip/settings', 'ipv6/settings', 'ip/smb', 'ip/dns',
  // addressing / IPAM
  'ip/address', 'ip/pool', 'ip/dhcp-server', 'ip/dhcp-server/lease', 'ip/dhcp-server/network',
  'ip/dhcp-server/alert', 'ip/dhcp-client', 'ip/arp', 'ip/neighbor', 'ip/route',
  'ipv6/address', 'ipv6/neighbor', 'ipv6/route',
  // firewall / security
  'ip/firewall/filter', 'ip/firewall/nat', 'ip/firewall/mangle', 'ip/firewall/raw',
  'ip/firewall/address-list', 'ip/firewall/connection', 'ip/firewall/connection/tracking',
  'ip/firewall/layer7-protocol', 'ip/kid-control', 'ip/kid-control/device',
  // interfaces / L2
  'interface', 'interface/ethernet', 'interface/bridge', 'interface/bridge/port',
  'interface/bridge/vlan', 'interface/vlan', 'interface/bonding', 'interface/list',
  'interface/list/member', 'interface/ethernet/switch/port', 'interface/detect-internet',
  'interface/vrrp',
  // wireless
  'interface/wifi', 'interface/wifi/registration-table', 'interface/wifi/security',
  'interface/wifi/datapath', 'interface/wifi/channel', 'interface/wifi/capsman',
  'interface/wifi/capsman/remote-cap', 'interface/wireless/registration-table',
  // routed / tunnelled
  'routing/table', 'routing/rip', 'routing/ospf/instance', 'routing/ospf/neighbor',
  'routing/ospf/interface-template', 'routing/bgp/session', 'routing/bgp/connection',
  'routing/igmp-proxy', 'routing/pimsm', 'ip/vrf',
  // VPN / remote access
  'interface/wireguard', 'interface/wireguard/peers', 'interface/ovpn/server',
  'interface/ovpn/server/connection', 'interface/sstp-server', 'ip/ipsec/peer',
  'ip/ipsec/active-peers', 'ip/ipsec/policy', 'ppp/active', 'ppp/secret', 'ppp/profile',
  // services on top
  'ip/hotspot', 'ip/hotspot/active', 'ip/hotspot/user', 'ip/hotspot/profile',
  'radius', 'user-manager/user', 'user-manager/session',
  // routing policy / QoS
  'queue/simple', 'queue/tree', 'queue/type', 'queue/interface',
  // platforms
  'container', 'container/config', 'iot/leds', 'iot/mqtt', 'mpls/ldp',
  'ip/traffic-flow', 'ip/traffic-flow/target', 'system/logging', 'log',
  'system/backup', 'file', 'tool/sniffer', 'tool/sniffer/host', 'tool/sniffer/connection',
] as const;

/** Menus that describe the physical/logical layout for the map. */
export const TOPOLOGY_PATHS = [
  'interface', 'interface/ethernet', 'interface/bridge', 'interface/bridge/port',
  'interface/bridge/vlan', 'interface/vlan', 'interface/bonding', 'interface/list',
  'interface/list/member', 'interface/wifi', 'interface/wifi/registration-table',
  'interface/wifi/capsman/remote-cap', 'interface/wireguard', 'interface/wireguard/peers',
  'interface/gre', 'interface/eoip', 'interface/vxlan', 'interface/l2tp-ether',
  'interface/vrrp', 'interface/detect-internet', 'ip/address', 'ip/pool', 'ip/route',
  'ip/dhcp-server/lease', 'ip/arp', 'ip/neighbor', 'ip/dhcp-server',
  'ip/hotspot/active', 'ppp/active', 'ip/cloud', 'system/identity', 'system/resource',
  'system/routerboard', 'interface/lte', 'interface/ethernet/switch/port',
] as const;

/** Menus that describe traffic for the flow-analytics page. */
export const TRAFFIC_PATHS = [
  'ip/firewall/connection', 'ip/firewall/connection/tracking', 'ip/firewall/mangle',
  'ip/firewall/layer7-protocol', 'ip/firewall/filter', 'ip/firewall/address-list',
  'interface', 'interface/ethernet', 'ip/dhcp-server/lease', 'ip/arp', 'ip/neighbor',
  'tool/sniffer', 'tool/sniffer/host', 'tool/sniffer/connection', 'container',
  'ip/traffic-flow', 'ip/traffic-flow/target', 'system/logging', 'system/resource',
] as const;
