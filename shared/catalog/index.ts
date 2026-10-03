import type { CategoryDef, EndpointDef } from '../types';
import { firewallEndpoints, interfaceEndpoints, ipEndpoints, ipv6Endpoints, mplsEndpoints, queueEndpoints, routingEndpoints } from './network';
import { hotspotEndpoints, pppEndpoints, radiusEndpoints, usermanagerEndpoints, vpnEndpoints, wirelessEndpoints } from './services';
import { containerEndpoints, iotEndpoints, systemEndpoints } from './system';
import { commandEndpoints, toolEndpoints } from './tools';

/** Navigation categories. `order` drives the sidebar and the dashboard. */
export const CATEGORIES: CategoryDef[] = [
  { id: 'overview', label: 'Overview', icon: 'LayoutDashboard', accent: 'cyan', order: 0, description: 'Live health, traffic and alerts across the device.' },
  { id: 'interfaces', label: 'Interfaces', icon: 'Network', accent: 'sky', order: 1, description: 'Ports, bridges, VLANs, tunnels and interface lists.' },
  { id: 'ip', label: 'IPv4', icon: 'Globe', accent: 'emerald', order: 2, description: 'Addressing, DHCP, DNS, routes and services.' },
  { id: 'ipv6', label: 'IPv6', icon: 'Globe2', accent: 'teal', order: 3, description: 'IPv6 addressing, DHCPv6, ND and firewall.' },
  { id: 'firewall', label: 'Firewall', icon: 'ShieldCheck', accent: 'rose', order: 4, description: 'Filter, NAT, mangle, RAW, address lists and conntrack.' },
  { id: 'routing', label: 'Routing', icon: 'Route', accent: 'violet', order: 5, description: 'Tables, policy rules, OSPF, BGP, RIP, BFD and filters.' },
  { id: 'queues', label: 'Queues', icon: 'Gauge', accent: 'amber', order: 6, description: 'Bandwidth shaping with live rates and burst settings.' },
  { id: 'wireless', label: 'Wireless', icon: 'Wifi', accent: 'cyan', order: 7, description: 'WiFi interfaces, profiles, clients and access lists.' },
  { id: 'ppp', label: 'PPP', icon: 'Phone', accent: 'indigo', order: 8, description: 'PPPoE clients, profiles, secrets and active sessions.' },
  { id: 'vpn', label: 'VPN', icon: 'ShieldEllipsis', accent: 'fuchsia', order: 9, description: 'WireGuard, OpenVPN, SSTP, IPsec and ZeroTier.' },
  { id: 'hotspot', label: 'Hotspot', icon: 'Flame', accent: 'orange', order: 10, description: 'Captive portal servers, users, sessions and walled garden.' },
  { id: 'radius', label: 'RADIUS', icon: 'Server', accent: 'lime', order: 11, description: 'RADIUS clients and local AAA behaviour.' },
  { id: 'usermanager', label: 'User Manager', icon: 'Users', accent: 'purple', order: 12, description: 'User Manager 5 billing: users, profiles and sessions.' },
  { id: 'system', label: 'System', icon: 'Cog', accent: 'slate', order: 13, description: 'Identity, resources, scheduler, logs, users, files and containers.' },
  { id: 'containers', label: 'Containers', icon: 'Boxes', accent: 'blue', order: 14, description: 'Run OCI containers directly on RouterOS.' },
  { id: 'iot', label: 'IoT', icon: 'Cpu', accent: 'green', order: 15, description: 'GPIO, MQTT, Modbus, serial and LED control.' },
  { id: 'mpls', label: 'MPLS', icon: 'Layers', accent: 'yellow', order: 16, description: 'Label distribution, mappings and forwarding tables.' },
  { id: 'tools', label: 'Tools', icon: 'Wrench', accent: 'pink', order: 17, description: 'Ping, traceroute, sniffer, torch, netwatch, fetch and console.' },
];

/** The endpoint registry — the single source of truth for the whole UI. */
export const ENDPOINTS: EndpointDef[] = [
  ...interfaceEndpoints,
  ...ipEndpoints,
  ...ipv6Endpoints,
  ...firewallEndpoints,
  ...routingEndpoints,
  ...queueEndpoints,
  ...wirelessEndpoints,
  ...pppEndpoints,
  ...vpnEndpoints,
  ...hotspotEndpoints,
  ...radiusEndpoints,
  ...usermanagerEndpoints,
  ...systemEndpoints,
  ...containerEndpoints,
  ...iotEndpoints,
  ...mplsEndpoints,
  ...toolEndpoints,
  ...commandEndpoints,
];

const categoryOrder = new Map(CATEGORIES.map((c) => [c.id, c.order]));
const byPath = new Map(ENDPOINTS.map((e) => [e.path, e]));

export const getEndpoint = (path: string): EndpointDef | undefined => byPath.get(path);

export const getCategory = (id: string): CategoryDef | undefined => CATEGORIES.find((c) => c.id === id);

export const navEndpoints = (): EndpointDef[] =>
  [...ENDPOINTS]
    .filter((e) => !e.hidden)
    .sort((a, b) =>
      (categoryOrder.get(a.category) ?? 99) - (categoryOrder.get(b.category) ?? 99)
      || (a.group ?? '').localeCompare(b.group ?? '')
      || a.label.localeCompare(b.label));

export const endpointsByCategory = (): { category: CategoryDef; endpoints: EndpointDef[] }[] =>
  CATEGORIES.map((category) => ({
    category,
    endpoints: navEndpoints().filter((e) => e.category === category.id),
  })).filter((g) => g.endpoints.length > 0);

export interface SearchHit {
  endpoint: EndpointDef;
  score: number;
}

/** Fuzzy-ish search across menu paths, labels, groups, descriptions and field names. */
export const searchEndpoints = (query: string, limit = 12): SearchHit[] => {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const terms = q.split(/\s+/);
  const hits: SearchHit[] = [];
  for (const e of navEndpoints()) {
    const haystack = [
      e.path, e.label, e.group ?? '', e.category, e.description ?? '',
      ...(e.tags ?? []),
      ...(e.fields ?? []).map((f) => f.name),
    ].join(' ').toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (!haystack.includes(t)) { score = -1; break; }
      if (e.label.toLowerCase().startsWith(t)) score += 6;
      if (e.path.toLowerCase().startsWith(t) || e.path.toLowerCase().includes('/' + t)) score += 5;
      if (e.path.toLowerCase().includes(t)) score += 3;
      if (e.label.toLowerCase().includes(t)) score += 2;
      score += 1;
    }
    if (score > 0) hits.push({ endpoint: e, score });
  }
  return hits.sort((a, b) => b.score - a.score || a.endpoint.label.localeCompare(b.endpoint.label)).slice(0, limit);
};

/** Endpoints that should be probed to discover what the device supports. */
export const probeEndpoints = (): string[] => [
  'system/resource', 'system/identity', 'system/board-name', 'interface', 'ip/address', 'ip/route', 'ip/firewall/filter',
  'ip/dhcp-server/lease', 'system/logging', 'log', 'system/package', 'file', 'system/certificate', 'system/user',
  'system/scheduler', 'system/script', 'queue/simple', 'ip/dns/static', 'radius', 'ip/hotspot/user', 'ppp/secret',
  'interface/wireguard', 'routing/table', 'ip/ipsec/policy', 'interface/wifi', 'interface/wireless', 'tool/netwatch',
  'tool/graphing', 'system/ntp/client', 'ip/cloud', 'user-manager/user', 'container', 'iot/mqtt', 'routing/bgp/connection',
  'mpls/ldp', 'tool/snmp', 'system/snmp', 'ip/dhcp-client', 'interface/vlan', 'interface/bridge', 'tool/macscan',
];

export * from './network';
export * from './services';
export * from './system';
export * from './tools';

/** Menu paths that are known to exist on all RouterOS 7 installs. */
export const V7_CORE_PATHS = new Set<string>([
  'system/resource', 'system/identity', 'system/clock', 'system/ntp/client', 'system/routerboard', 'system/package',
  'system/scheduler', 'system/script', 'system/logging', 'system/logging/action', 'log', 'system/user', 'system/user/group',
  'system/user/active', 'system/backup', 'file', 'system/certificate', 'system/snmp', 'interface', 'interface/ethernet',
  'interface/bridge', 'interface/vlan', 'interface/bonding', 'interface/vrrp', 'interface/list', 'interface/list/member',
  'ip/address', 'ip/arp', 'ip/cloud', 'ip/dhcp-client', 'ip/dhcp-server', 'ip/dhcp-server/lease', 'ip/dns', 'ip/dns/static',
  'ip/pool', 'ip/service', 'ip/settings', 'ip/neighbor', 'ip/route', 'ip/firewall/filter', 'ip/firewall/nat',
  'ip/firewall/mangle', 'ip/firewall/raw', 'ip/firewall/address-list', 'ip/firewall/connection', 'ip/firewall/connection/tracking',
  'ip/firewall/service-port', 'ip/firewall/helper', 'ip/kid-control', 'queue/simple', 'queue/tree', 'queue/type',
  'interface/pppoe-client', 'ppp/profile', 'ppp/secret', 'ppp/active', 'ppp/aaa', 'ip/hotspot', 'ip/hotspot/user',
  'ip/hotspot/active', 'ip/hotspot/profile', 'radius', 'user/aaa', 'tool/ping', 'tool/traceroute', 'tool/bandwidth-test',
  'tool/bandwidth-server', 'tool/sniffer', 'tool/torch', 'tool/fetch', 'tool/netwatch', 'tool/graphing', 'tool/sms',
  'tool/email', 'tool/mac-server', 'tool/macscan', 'tool/romon', 'interface/wireguard', 'interface/wireguard/peers',
  'ip/ipsec/peer', 'ip/ipsec/policy', 'ip/ipsec/identity', 'ip/ipsec/proposal', 'ip/ipsec/profile', 'ip/ipsec/active-peers',
  'ip/ipsec/installed-sa', 'ipv6/address', 'ipv6/route', 'ipv6/firewall/filter', 'ipv6/nd', 'ipv6/settings',
  'routing/table', 'routing/rule', 'routing/ospf/instance', 'routing/ospf/area', 'routing/ospf/interface-template',
  'routing/bgp/connection', 'routing/bgp/template', 'routing/bgp/session', 'routing/rip', 'routing/bfd/configuration',
  'routing/filter/rule', 'routing/filter/select-rule', 'system/reboot', 'execute', 'export', 'interface/ethernet/switch/port',
  'interface/ethernet/switch/vlan', 'interface/ethernet/switch/host', 'interface/lte',
]);
