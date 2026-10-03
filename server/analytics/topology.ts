/**
 * Builds a network map from RouterOS menus.
 *
 *   internet ── uplink ── router ── (bridge | vlan | wifi | tunnel) ── segment ── devices
 *
 * Everything is derived: bridges come from /interface/bridge, segments from the
 * /ip/address list (cross-referenced with DHCP servers, pools, links and the
 * device inventory), tunnels from the interface tables and uplinks from the
 * default routes.
 */
import {
  DEVICE_KIND_ICON, cidrInfo, parseRate, type DeviceRecord, type LinkKind, type TopoLink,
  type TopoNode, type Topology,
} from '../../shared/analytics';
import type { Row } from '../../shared/types';
import { list, reports, type Fetched, type TableMap } from './collect';
import { buildDevices, devicesInSubnet } from './devices';

const text = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : String(v));

const inCidrFor = (cidr: NonNullable<ReturnType<typeof cidrInfo>>, ip: string) => {
  const bits = Number(cidr.cidr.split('/')[1]);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  const toInt = (v: string) => v.split('.').reduce((acc, p) => ((acc << 8) >>> 0) + (Number(p) & 255), 0) >>> 0;
  return ((toInt(ip) & mask) >>> 0) === toInt(cidr.network);
};
const num = (v: unknown, fallback = 0) => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : fallback;
};
const truthy = (v: unknown) => v === true || v === 'true' || v === 'yes';

const TUNNEL_OF: Record<string, LinkKind> = {
  wireguard: 'tunnel', gre: 'tunnel', eoip: 'tunnel', vxlan: 'tunnel', ipip: 'tunnel',
  'l2tp-ether': 'tunnel', ovpn: 'tunnel', sstp: 'tunnel', pppoe: 'ppp', ppp: 'ppp', lte: 'tunnel',
};

const INTERFACE_LABEL: Record<string, string> = {
  bridge: 'Bridge', vlan: 'VLAN', bonding: 'Bond', ether: 'Ethernet', wifi: 'Wi-Fi',
  wireless: 'Wi-Fi', wireguard: 'WireGuard', gre: 'GRE', eoip: 'EoIP', vxlan: 'VXLAN',
  lte: 'LTE', vrrp: 'VRRP', macsec: 'MACsec', ipip: 'IPIP', l2tp: 'L2TP', ovpn: 'OpenVPN',
};

/* ------------------------------------------------------------------ *
 * Segments (IPAM)
 * ------------------------------------------------------------------ */

export function buildSegments(tables: TableMap, devices: DeviceRecord[]) {
  const addresses = list(tables, 'ip/address');
  const leases = list(tables, 'ip/dhcp-server/lease');
  const arps = list(tables, 'ip/arp');
  const neighbors = list(tables, 'ip/neighbor');
  const pools = list(tables, 'ip/pool');
  const dhcpServers = list(tables, 'ip/dhcp-server');

  const inCidr = (cidr: ReturnType<typeof cidrInfo>, ip?: unknown) => {
    if (!cidr) return false;
    const address = String(ip ?? '');
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) return false;
    const bits = Number(cidr.cidr.split('/')[1]);
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    const toInt = (v: string) => v.split('.').reduce((acc, p) => ((acc << 8) >>> 0) + (Number(p) & 255), 0) >>> 0;
    return ((toInt(address) & mask) >>> 0) === toInt(cidr.network);
  };

  return addresses.map((row) => {
    const cidr = cidrInfo(row.address);
    if (!cidr) return null;
    const iface = text(row.interface);
    const live = new Set<string>();
    for (const l of leases) if (inCidr(cidr, l.address)) live.add(String(l.address));
    for (const a of arps) if (inCidr(cidr, a.address)) live.add(String(a.address));
    for (const n of neighbors) if (inCidr(cidr, n.address)) live.add(String(n.address));
    const pool = pools.find((p) => inCidr(cidr, String(p.ranges ?? '').split('-')[0]));
    const server = dhcpServers.find((s) => text(s.interface) === iface);

    return {
      cidr: cidr.cidr,
      address: cidr.address,
      interface: iface,
      gateway: cidr.address,
      total: Math.max(cidr.usable, live.size),
      used: live.size,
      free: Math.max(0, cidr.usable - live.size),
      utilisation: cidr.usable ? Math.min(100, Math.round((live.size / cidr.usable) * 100)) : 0,
      sources: ['ip/address'],
      pool: text(pool?.name),
      dhcpServer: text(server?.name),
      dynamic: truthy(row.dynamic),
      disabled: truthy(row.disabled),
      devices: devicesInSubnet(devices, cidr.network, Number(cidr.cidr.split('/')[1])),
      comment: text(row.comment),
    };
  }).filter(Boolean) as Array<{
    cidr: string; address: string; interface?: string; gateway?: string; total: number; used: number;
    free: number; utilisation: number; sources: string[]; pool?: string; dhcpServer?: string;
    dynamic: boolean; disabled: boolean; devices: DeviceRecord[]; comment?: string;
  }>;
}

/* ------------------------------------------------------------------ *
 * Topology
 * ------------------------------------------------------------------ */

/** Default route → egress interface. Gateways are usually next-hop IPs, so map
 *  the address back to whichever interface owns that subnet. */
export function resolveWanInterface(tables: TableMap, interfaces?: Row[]): string | undefined {
  const routes = list(tables, 'ip/route');
  const addresses = list(tables, 'ip/address');
  const ifaces = interfaces ?? list(tables, 'interface');
  const names = new Set(ifaces.map((i) => String(i.name)));
  const route = routes.find((r) => String(r['dst-address']) === '0.0.0.0/0' && truthy(r.active))
    ?? routes.find((r) => String(r['dst-address']) === '0.0.0.0/0');
  if (!route) return undefined;

  const gateway = text(route.gateway);
  if (gateway && names.has(gateway)) return gateway;
  if (gateway && /^[0-9.]+$/.test(gateway)) {
    const owner = addresses.find((a) => {
      const info = cidrInfo(a.address);
      return info ? inCidrFor(info, gateway) : false;
    });
    if (owner) return text(owner.interface);
  }
  const pref = text(route['pref-src']);
  if (pref) return text(addresses.find((a) => String(a.address ?? '').split('/')[0] === pref)?.interface);
  return text(route['immediate-gw']);
}

export function buildTopology(fetched: Map<string, Fetched>, mode: string): Topology {
  const tables: TableMap = {};
  for (const entry of fetched.values()) tables[entry.path] = entry.rows;

  const interfaces = list(tables, 'interface');
  const ethernets = list(tables, 'interface/ethernet');
  const bridges = list(tables, 'interface/bridge');
  const bridgePorts = list(tables, 'interface/bridge/port');
  const wifi = list(tables, 'interface/wifi');
  const wifiClients = list(tables, 'interface/wifi/registration-table');
  const wgPeers = list(tables, 'interface/wireguard/peers');
  const routes = list(tables, 'ip/route');
  const leases = list(tables, 'ip/dhcp-server/lease');
  const lte = list(tables, 'interface/lte');

  const ifaceByName = new Map(interfaces.map((i) => [String(i.name), i]));
  const runningOf = (name?: string) => {
    const row = name ? ifaceByName.get(name) : undefined;
    if (!row) return 'up' as const;
    return truthy(row.disabled) ? 'down' as const : truthy(row.running) ? 'up' as const : 'down' as const;
  };

  // Which interfaces carry wireless clients / tunnels — used to classify links.
  const interfaceLink: Record<string, LinkKind> = {};
  for (const row of wifiClients) {
    const name = text(row.interface);
    if (name) interfaceLink[name] = 'wifi';
  }

  const trafficByIp: Record<string, number> = {};
  for (const row of list(tables, 'ip/firewall/connection')) {
    const address = text(row['src-address']);
    if (!address) continue;
    trafficByIp[address] = (trafficByIp[address] ?? 0) + num(row['orig-bytes']);
  }

  const devices = buildDevices(tables, { interfaceLink, trafficByIp });
  const segments = buildSegments(tables, devices);

  const nodes: TopoNode[] = [];
  const links: TopoLink[] = [];

  // ---- internet + uplink -------------------------------------------------
  const identity = text(list(tables, 'system/identity')[0]?.name) ?? 'Router';
  const resource = list(tables, 'system/resource')[0] ?? {};
  const routerboard = list(tables, 'system/routerboard')[0] ?? {};
  const boardName = text(routerboard.model) ?? text(resource['board-name']) ?? 'RouterOS';
  const serial = text(routerboard['serial-number']);
  const defaultRoutes = routes.filter((r) => String(r['dst-address']) === '0.0.0.0/0');
  const activeDefault = defaultRoutes.find((r) => truthy(r.active)) ?? defaultRoutes[0];
  const addresses = list(tables, 'ip/address');

  const wanInterface = resolveWanInterface(tables, interfaces);
  const wanIfaceRow = interfaces.find((i) => i.name === wanInterface);
  const wanEthernet = ethernets.find((e) => String(e.name) === wanInterface);
  const wanAddress = addresses.find((a) => text(a.interface) === wanInterface);
  const lteRow = lte[0];
  const isLte = Boolean(lteRow) && (lteRow['registration-status'] === 'registered') && (!wanIfaceRow || !truthy(wanIfaceRow.running));

  const cloud = list(tables, 'ip/cloud')[0] ?? {};
  const publicAddress = text(cloud['public-address']) ?? text(wanAddress?.address)?.split('/')[0];

  nodes.push({
    id: 'internet',
    kind: 'internet',
    label: 'Internet',
    sublabel: text(cloud['dns-name']) ?? (publicAddress ? `public ${publicAddress}` : 'upstream'),
    status: 'up',
    detail: [
      publicAddress ? `public address ${publicAddress}` : null,
      text(activeDefault?.gateway) ? `gateway ${text(activeDefault?.gateway)}` : null,
      text(cloud['dns-name']) ? `ddns ${text(cloud['dns-name'])}` : null,
    ].filter(Boolean).join(' · '),
    ip: publicAddress,
    meta: cloud as Row,
  });

  if (wanInterface || isLte) {
    const uplinkId = `uplink:${wanInterface ?? 'lte1'}`;
    const rx = num(wanIfaceRow?.['rx-byte']);
    const speed = parseRate(wanEthernet?.speed ?? (isLte ? '150Mbps' : '1Gbps'));
    nodes.push({
      id: uplinkId,
      kind: 'uplink',
      label: wanInterface ?? 'lte1',
      sublabel: isLte
        ? `LTE · ${text(lteRow?.['current-operator']) ?? 'mobile'}`
        : `${text(wanEthernet?.speed) ?? 'link'} · ${text(wanAddress?.address) ?? 'no address'}${text(wanEthernet?.['mac-address']) ? ` · ${text(wanEthernet?.['mac-address'])}` : ''}`,
      detail: isLte
        ? `signal ${text(lteRow?.['signal-strength']) ?? 'n/a'} · ${text(lteRow?.['access-technology']) ?? 'LTE'}${text(lteRow?.['current-operator']) ? ` · ${text(lteRow?.['current-operator'])}` : ''}`
        : `${text(wanEthernet?.speed) ?? 'link'} · mtu ${text(wanIfaceRow?.mtu) ?? '1500'}${text(wanEthernet?.['flow-control'] ?? '') ? '' : ''}`.trim(),
      interface: wanInterface ?? 'lte1',
      link: isLte ? 'tunnel' : 'wired',
      status: runningOf(wanInterface),
      bytes: rx,
      utilisation: speed ? Math.min(100, Math.round((rx / speed) * 100)) : undefined,
      meta: { ...wanIfaceRow, ...(isLte ? lteRow : {}) } as Row,
    });
    links.push({ from: 'internet', to: uplinkId, link: isLte ? 'tunnel' : 'wired', label: isLte ? 'LTE' : text(wanIfaceRow?.speed) ?? '', status: runningOf(wanInterface) });
  }

  // ---- router ------------------------------------------------------------
  nodes.push({
    id: 'router',
    kind: 'router',
    label: identity,
    sublabel: `${boardName} · RouterOS ${text(resource.version) ?? ''}`.trim(),
    detail: [
      `uptime ${text(resource.uptime) ?? 'n/a'}`,
      `cpu ${text(resource['cpu-load']) ?? '0'}% (${text(resource['cpu-count']) ?? '?'} cores)`,
      serial ? `serial ${serial}` : null,
    ].filter(Boolean).join(' · '),
    status: 'up',
    meta: resource as Row,
  });

  if (wanInterface || isLte) {
    links.push({ from: `uplink:${wanInterface ?? 'lte1'}`, to: 'router', link: isLte ? 'tunnel' : 'wired', label: 'WAN', status: runningOf(wanInterface) });
  } else {
    links.push({ from: 'internet', to: 'router', label: 'WAN', status: 'warn' });
  }

  // ---- L2: bridges, vlans, tunnels, wifi APs -----------------------------
  const bridgeIds = new Map<string, string>();
  for (const bridge of bridges) {
    const name = String(bridge.name);
    const id = `bridge:${name}`;
    bridgeIds.set(name, id);
    const ports = bridgePorts.filter((p) => text(p.bridge) === name);
    const vlanFiltering = truthy(bridge['vlan-filtering']);
    nodes.push({
      id,
      kind: 'bridge',
      label: name,
      sublabel: `${ports.length} ports · ${text(bridge['protocol-mode']) ?? 'rstp'}${vlanFiltering ? ' · vlan-aware' : ''}`,
      detail: text(bridge.comment),
      status: runningOf(name),
      link: 'wired',
      meta: bridge as Row,
    });
    links.push({ from: 'router', to: id, link: 'wired', label: 'bridge', status: runningOf(name) });
  }

  const l3Interfaces = new Set(segments.map((s) => s.interface).filter(Boolean) as string[]);
  const l2Ids = new Set<string>(bridgeIds.values());

  const addInterfaceNode = (name: string, kind: TopoNode['kind'], label: string, sublabel?: string, status: TopoNode['status'] = 'up', link?: LinkKind) => {
    const id = `if:${name}`;
    if (l2Ids.has(id)) return id;
    const row = ifaceByName.get(name) ?? {};
    nodes.push({
      id, kind, label: name, sublabel,
      detail: text(row.comment),
      ip: text(list(tables, 'ip/address').find((a) => text(a.interface) === name)?.address),
      interface: name,
      link,
      status,
      meta: row as Row,
    });
    l2Ids.add(id);
    return id;
  };

  const linkToL2 = (name: string): { parent: string; parentKind: string } => {
    const bridgePort = bridgePorts.find((p) => text(p.interface) === name);
    const bridgeName = text(bridgePort?.bridge);
    if (bridgeName && bridgeIds.has(bridgeName)) return { parent: bridgeIds.get(bridgeName)!, parentKind: 'bridge' };
    return { parent: 'router', parentKind: 'router' };
  };

  // VLANs and physical L3 interfaces
  for (const segment of segments) {
    const name = segment.interface;
    if (!name) continue;
    if (bridgeIds.has(name)) continue;
    const row = ifaceByName.get(name) ?? {};
    const type = String(row.type ?? '');
    const isVlan = type === 'vlan' || name.startsWith('vlan');
    const isWifi = type === 'wifi' || type === 'wireless' || name.startsWith('wifi') || name.startsWith('wlan');
    const isTunnel = TUNNEL_OF[type] !== undefined;
    const kind: TopoNode['kind'] = isTunnel ? 'tunnel' : isVlan ? 'vlan' : 'segment';
    const sublabel = isTunnel
      ? `${INTERFACE_LABEL[type] ?? type}${text(row['remote-address']) ? ` → ${text(row['remote-address'])}` : ''}`
      : `${segment.used}/${segment.total} addresses`;
    const status = runningOf(name) === 'down' ? 'down' : segment.utilisation > 85 ? 'warn' : 'up';
    addInterfaceNode(name, kind, name, sublabel, status, isTunnel ? 'tunnel' : isWifi ? 'wifi' : 'wired');
    const { parent } = linkToL2(name);
    links.push({ from: parent, to: `if:${name}`, link: isTunnel ? 'tunnel' : 'wired', label: text(row.vlanId ?? row['vlan-id']) ? `vlan ${text(row.vlanId ?? row['vlan-id'])}` : '', status });
  }

  // Wireless radios (they carry clients even without an L3 address)
  for (const radio of wifi) {
    const name = String(radio.name);
    if (l2Ids.has(`if:${name}`)) continue;
    const clients = wifiClients.filter((c) => text(c.interface) === name).length;
    const id = addInterfaceNode(name, 'segment', name, `${text(radio.ssid) ?? 'ssid'} · ${clients} clients`, runningOf(name), 'wifi');
    const { parent } = linkToL2(name);
    links.push({ from: parent, to: id, link: 'wifi', label: 'wifi', status: runningOf(name) });
  }

  // Tunnels that don't hold an L3 address (GRE/EoIP/VXLAN/WireGuard servers)
  for (const row of interfaces) {
    const name = String(row.name);
    const type = String(row.type ?? '');
    if (!['wireguard', 'gre', 'eoip', 'vxlan', 'ipip', 'l2tp-ether', 'ovpn', 'vrrp'].includes(type)) continue;
    if (l2Ids.has(`if:${name}`)) continue;
    const peers = type === 'wireguard' ? wgPeers.filter((p) => text(p.interface) === name).length : 0;
    const id = addInterfaceNode(name, 'tunnel', name, `${INTERFACE_LABEL[type] ?? type}${peers ? ` · ${peers} peers` : ''}`, runningOf(name), 'tunnel');
    links.push({ from: 'router', to: id, link: 'tunnel', label: INTERFACE_LABEL[type] ?? type, status: runningOf(name) });
  }

  // ---- segments + their devices -----------------------------------------
  for (const segment of segments) {
    const name = segment.interface;
    const id = `seg:${segment.cidr}`;
    const inBridge = Boolean(name && bridgeIds.has(name));
    const parent = name ? (bridgeIds.get(name) ?? (l2Ids.has(`if:${name}`) ? `if:${name}` : 'router')) : 'router';
    const subnetDevices = segment.devices;
    const status: TopoNode['status'] = segment.utilisation > 90 ? 'warn' : segment.disabled ? 'down' : 'up';
    nodes.push({
      id,
      kind: 'segment',
      label: segment.cidr,
      sublabel: `${segment.used}/${segment.total} used · ${segment.dhcpServer ?? segment.pool ?? 'no dhcp'} · ${subnetDevices.length} devices`,
      detail: `gateway ${segment.gateway}${segment.pool ? ` · pool ${segment.pool}` : ''}${segment.comment ? ` · ${segment.comment}` : ''}`,
      cidr: segment.cidr,
      interface: name,
      ip: segment.gateway,
      link: interfaceLink[name ?? ''] ?? 'wired',
      status,
      utilisation: segment.utilisation,
      clients: subnetDevices.length,
      devices: subnetDevices,
      meta: { pool: segment.pool, dhcpServer: segment.dhcpServer, dynamic: segment.dynamic } as Row,
    });
    links.push({
      from: parent,
      to: id,
      link: interfaceLink[name ?? ''] ?? 'wired',
      label: inBridge ? 'vlan/port' : 'subnet',
      status,
    });
  }

  // ---- stats -------------------------------------------------------------
  const vendors = new Map<string, number>();
  const kinds = new Map<string, number>();
  for (const device of devices) {
    const vendor = device.vendor ?? (device.randomised ? 'Randomised MAC' : 'Unidentified');
    vendors.set(vendor, (vendors.get(vendor) ?? 0) + 1);
    kinds.set(device.kind, (kinds.get(device.kind) ?? 0) + 1);
  }

  return {
    mode,
    generatedAt: Date.now(),
    nodes,
    links,
    stats: {
      devices: devices.length,
      wired: devices.filter((d) => d.link === 'wired').length,
      wireless: devices.filter((d) => d.link === 'wifi').length,
      tunnels: devices.filter((d) => d.link === 'tunnel' || d.link === 'ppp').length,
      segments: segments.length,
      unidentified: devices.filter((d) => !d.vendor).length,
      vendors: [...vendors.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 8),
      kinds: [...kinds.entries()].map(([name, count]) => ({ name: name as DeviceRecord['kind'], count })).sort((a, b) => b.count - a.count),
    },
    sources: reports(fetched),
  };
}

export const deviceIcon = DEVICE_KIND_ICON;
