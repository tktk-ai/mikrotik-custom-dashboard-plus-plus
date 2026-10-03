/**
 * Device inventory: merges everything the router knows about a device into one
 * record — neighbour discovery (LLDP/MNDP/CDP), DHCP leases, ARP, wireless
 * registrations, hotspot sessions, PPP sessions and WireGuard peers — then
 * enriches it with vendor (MAC OUI), device class and observed traffic.
 */
import {
  DEVICE_KIND_LABEL, inferDeviceKind, parseBytes, parseSignal,
  type DeviceKind, type DeviceRecord, type LinkKind,
} from '../../shared/analytics';
import { isRandomisedMac, normaliseMac, vendorForMac } from '../../shared/oui';
import type { Row } from '../../shared/types';
import { list, type TableMap } from './collect';

interface Source {
  path: string;
  rows: Row[];
}

const text = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : String(v));

/* ------------------------------------------------------------------ *
 * Per-source extraction
 * ------------------------------------------------------------------ */

function fromNeighbors(rows: Row[]): Partial<DeviceRecord>[] {
  return rows.map((r) => ({
    name: text(r.identity) ?? text(r['system-name']) ?? text(r.address) ?? 'discovered device',
    hostname: text(r.identity),
    ip: text(r.address),
    mac: text(r['mac-address']),
    interface: text(r.interface),
    platform: text(r.platform),
    board: text(r.board),
    version: text(r.version),
    discoveredBy: text(r['discovered-by']),
    sources: ['ip/neighbor'],
    confidence: 3,
    active: true,
  }));
}

function fromLeases(rows: Row[]): Partial<DeviceRecord>[] {
  return rows.map((r) => {
    const status = text(r.status);
    return {
      name: text(r['host-name']) ?? text(r.address) ?? 'dhcp client',
      hostname: text(r['host-name']),
      ip: text(r.address),
      mac: text(r['mac-address']),
      dhcp: true,
      active: status ? status === 'bound' : true,
      sources: ['ip/dhcp-server/lease'],
      confidence: 2,
      comment: text(r.comment),
    };
  });
}

function fromArp(rows: Row[]): Partial<DeviceRecord>[] {
  return rows
    .filter((r) => r['mac-address'])
    .map((r) => ({
      name: text(r.comment) ?? text(r['mac-address']) ?? 'arp entry',
      ip: text(r.address),
      mac: text(r['mac-address']),
      interface: text(r.interface),
      active: true,
      sources: ['ip/arp'],
      confidence: 1,
    }));
}

function fromWifi(rows: Row[]): Partial<DeviceRecord>[] {
  return rows.map((r) => ({
    name: text(r['last-ip']) ?? text(r['mac-address']) ?? 'wifi client',
    ip: text(r['last-ip']),
    mac: text(r['mac-address']),
    interface: text(r.interface),
    ssid: text(r.ssid),
    signal: Number.isFinite(parseSignal(r.signal ?? r['rx-signal'])) ? parseSignal(r.signal ?? r['rx-signal']) : undefined,
    uptime: text(r.uptime),
    link: 'wifi' as LinkKind,
    bytesIn: parseBytes(r.bytes),
    bytesOut: r['tx-bytes'] !== undefined ? parseBytes(r['tx-bytes']) : undefined,
    active: r.authorized === undefined ? true : r.authorized === true || r.authorized === 'true',
    sources: ['interface/wifi/registration-table'],
    confidence: 3,
  }));
}

function fromHotspot(rows: Row[]): Partial<DeviceRecord>[] {
  return rows.map((r) => ({
    name: text(r.user) ?? text(r['mac-address']) ?? 'hotspot session',
    ip: text(r.address),
    mac: text(r['mac-address']),
    uptime: text(r.uptime),
    active: true,
    bytesIn: parseBytes(r['bytes-in']),
    bytesOut: parseBytes(r['bytes-out']),
    sources: ['ip/hotspot/active'],
    confidence: 3,
    comment: text(r.server) ? `hotspot ${text(r.server)}` : undefined,
  }));
}

function fromPpp(rows: Row[]): Partial<DeviceRecord>[] {
  return rows.map((r) => ({
    name: text(r.name) ?? 'ppp session',
    ip: text(r.address),
    interface: text(r.interface),
    uptime: text(r.uptime),
    link: 'ppp' as LinkKind,
    active: true,
    bytesIn: parseBytes(r['bytes-in']),
    bytesOut: parseBytes(r['bytes-out']),
    sources: ['ppp/active'],
    confidence: 3,
    comment: text(r.service) ? `${text(r.service)} session` : undefined,
  }));
}

function fromWireguard(rows: Row[]): Partial<DeviceRecord>[] {
  return rows.map((r) => ({
    name: text(r.comment) ?? text(r.name) ?? `wg-peer-${String(r['public-key'] ?? '').slice(0, 6)}`,
    ip: text(r['current-endpoint-address']) ?? text(r['allowed-address']),
    interface: text(r.interface),
    link: 'tunnel' as LinkKind,
    active: text(r['last-handshake']) !== undefined && text(r['last-handshake']) !== 'never',
    uptime: text(r['last-handshake']),
    bytesIn: parseBytes(r['rx'] ?? r['rx-byte']),
    bytesOut: parseBytes(r['tx'] ?? r['tx-byte']),
    sources: ['interface/wireguard/peers'],
    confidence: 3,
    comment: text(r['allowed-address']) ? `allowed ${text(r['allowed-address'])}` : undefined,
  }));
}

function fromRemoteCaps(rows: Row[]): Partial<DeviceRecord>[] {
  return rows.map((r) => ({
    name: text(r.identity) ?? text(r['base-mac']) ?? 'capsman client',
    ip: text(r.address),
    mac: text(r['base-mac']),
    interface: text(r.interface),
    link: 'tunnel' as LinkKind,
    active: text(r.connected) === undefined ? true : r.connected === true || r.connected === 'true',
    sources: ['interface/wifi/capsman/remote-cap'],
    confidence: 2,
  }));
}

/** Vendors whose discovered boxes are plausibly switches rather than end-user devices. */
const NETWORK_VENDORS = /mikrotik|cisco|ubiquiti|aruba|hpe|huawei|tp-link|netgear|d-link|zyxel|juniper|extreme|ruckus|brocade|mellanox|edge-?core|tenda|linksys|meraki/i;

/* ------------------------------------------------------------------ *
 * Merge
 * ------------------------------------------------------------------ */

type Draft = Partial<DeviceRecord> & { sources: string[] };

const MERGE_FIELDS: Array<keyof DeviceRecord> = [
  'hostname', 'ip', 'mac', 'vendor', 'platform', 'board', 'version', 'interface', 'ssid',
  'signal', 'uptime', 'discoveredBy', 'comment', 'bytesIn', 'bytesOut', 'link',
];

function mergeInto(target: DeviceRecord, incoming: Draft) {
  for (const field of MERGE_FIELDS) {
    const value = incoming[field];
    if (value === undefined || value === null || value === '') continue;
    const current = target[field];
    if (current === undefined || current === null || current === '' || (typeof current === 'number' && !Number.isFinite(current))) {
      (target as unknown as Record<string, unknown>)[field] = value;
    }
  }
  if (incoming.name && target.name === '') target.name = incoming.name;
  if (incoming.dhcp) target.dhcp = true;
  if (incoming.active) target.active = true;
  for (const source of incoming.sources) if (!target.sources.includes(source)) target.sources.push(source);
  target.confidence = Math.max(target.confidence, incoming.confidence ?? 1);
}

function blank(): DeviceRecord {
  return {
    id: '', name: '', addresses: [], kind: 'unknown', link: '' as LinkKind, active: false,
    dhcp: false, randomised: false, sources: [], confidence: 0,
  };
}

export interface DeviceBuildOptions {
  /** Interface name → cable/wireless kind, so segments can classify links. */
  interfaceLink?: Record<string, LinkKind>;
  /** src-address → bytes observed in conntrack. */
  trafficByIp?: Record<string, number>;
}

export function buildDevices(tables: TableMap, options: DeviceBuildOptions = {}): DeviceRecord[] {
  const sources: Source[] = [
    { path: 'ip/neighbor', rows: fromNeighbors(list(tables, 'ip/neighbor')) as Row[] },
    { path: 'ip/dhcp-server/lease', rows: fromLeases(list(tables, 'ip/dhcp-server/lease')) as Row[] },
    { path: 'ip/arp', rows: fromArp(list(tables, 'ip/arp')) as Row[] },
    { path: 'interface/wifi/registration-table', rows: fromWifi(list(tables, 'interface/wifi/registration-table')) as Row[] },
    { path: 'ip/hotspot/active', rows: fromHotspot(list(tables, 'ip/hotspot/active')) as Row[] },
    { path: 'ppp/active', rows: fromPpp(list(tables, 'ppp/active')) as Row[] },
    { path: 'interface/wireguard/peers', rows: fromWireguard(list(tables, 'interface/wireguard/peers')) as Row[] },
    { path: 'interface/wifi/capsman/remote-cap', rows: fromRemoteCaps(list(tables, 'interface/wifi/capsman/remote-cap')) as Row[] },
  ];

  const drafts: Draft[] = sources.flatMap((s) => s.rows as unknown as Draft[]);

  // Index merges by MAC, name and address so the same box coming from discovery,
  // DHCP and ARP lands on one record.
  const devices: DeviceRecord[] = [];
  const byMac = new Map<string, DeviceRecord>();
  const byName = new Map<string, DeviceRecord>();
  const byIp = new Map<string, DeviceRecord>();

  const attach = (device: DeviceRecord) => {
    if (device.mac) byMac.set(normaliseMac(device.mac), device);
    if (device.name) byName.set(device.name.toLowerCase(), device);
    for (const address of device.addresses) byIp.set(address, device);
    if (device.ip) byIp.set(device.ip, device);
  };

  for (const draft of drafts) {
    const macKey = draft.mac ? normaliseMac(draft.mac) : '';
    const nameKey = draft.name ? draft.name.toLowerCase() : '';
    const ipKey = draft.ip ?? '';
    const existing = (macKey && byMac.get(macKey)) || (nameKey && byName.get(nameKey)) || (ipKey && byIp.get(ipKey)) || null;

    const target = existing ?? blank();
    if (!existing) {
      devices.push(target);
      target.id = `dev-${devices.length}`;
      target.name = draft.name ?? '';
    }
    mergeInto(target, draft);
    if (draft.ip && !target.addresses.includes(draft.ip)) target.addresses.push(draft.ip);
    if (macKey) byMac.set(macKey, target);
    if (nameKey) byName.set(nameKey, target);
    if (ipKey) byIp.set(ipKey, target);
    attach(target);
  }

  // Addresses discovered after the fact (e.g. ARP adding an IP to a named device).
  for (const device of devices) {
    for (const address of device.addresses) byIp.set(address, device);
    if (device.ip && !device.addresses.includes(device.ip)) device.addresses.push(device.ip);
  }

  /* ---------------------------- enrichment ---------------------------- */

  const wifiMacs = new Set(list(tables, 'interface/wifi/registration-table').map((r) => normaliseMac(r['mac-address'])));
  const wifiByMac = new Map(list(tables, 'interface/wifi/registration-table').map((r) => [normaliseMac(r['mac-address']), r]));

  for (const device of devices) {
    const mac = normaliseMac(device.mac);
    device.randomised = Boolean(device.mac) && isRandomisedMac(device.mac);
    device.vendor = device.vendor ?? vendorForMac(device.mac);

    if (wifiMacs.has(mac) || device.sources.includes('interface/wifi/registration-table')) {
      device.link = 'wifi';
      const wifi = wifiByMac.get(mac);
      if (wifi) {
        device.ssid = device.ssid ?? text(wifi.ssid);
        device.interface = device.interface ?? text(wifi.interface);
        const signal = parseSignal(wifi.signal ?? wifi['rx-signal']);
        if (Number.isFinite(signal)) device.signal = signal;
      }
    } else if (device.link === 'wired' && device.interface && options.interfaceLink?.[device.interface]) {
      device.link = options.interfaceLink[device.interface];
    }

    if (device.kind === 'unknown') {
      device.kind = inferDeviceKind({
        vendor: device.vendor, platform: device.platform, board: device.board,
        hostname: device.hostname ?? device.name, version: device.version,
      });
      // Discovery protocol alone says nothing about the class — MNDP is spoken by
      // phones and laptops too, so only claim "switch" for network-gear vendors.
      if (device.kind === 'unknown' && device.sources.includes('ip/neighbor') && NETWORK_VENDORS.test(device.vendor ?? '')) {
        device.kind = 'switch';
      }
    }

    const observed = device.addresses.reduce((sum, address) => sum + (options.trafficByIp?.[address] ?? 0), 0);
    if (observed) {
      device.bytesIn = Math.max(device.bytesIn ?? 0, observed);
    }

    if (!device.link) device.link = 'wired';
    if (!device.name) device.name = device.hostname ?? device.addresses[0] ?? device.mac ?? 'unknown device';
    device.name = device.name.trim() || 'unknown device';
  }

  return devices.sort((a, b) => {
    const kindOrder = (k: DeviceKind) => (k === 'router' ? 0 : k === 'switch' || k === 'ap' ? 1 : k === 'server' || k === 'nas' ? 2 : k === 'unknown' ? 9 : 3);
    return kindOrder(a.kind) - kindOrder(b.kind) || a.name.localeCompare(b.name);
  });
}

/** Devices whose address falls inside a subnet. */
export function devicesInSubnet(devices: DeviceRecord[], network: string, bits: number): DeviceRecord[] {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  const toInt = (ip: string) => ip.split('.').reduce((acc, part) => ((acc << 8) >>> 0) + (Number(part) & 255), 0) >>> 0;
  const base = toInt(network);
  return devices.filter((d) => d.addresses.some((address) => {
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) return false;
    return ((toInt(address) & mask) >>> 0) === base;
  }));
}

export const deviceKindLabel = (kind: DeviceKind) => DEVICE_KIND_LABEL[kind] ?? 'Device';
