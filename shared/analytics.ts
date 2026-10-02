/**
 * Analytics primitives shared by the server (which builds the bundles) and the UI
 * (which renders them). Kept free of Node/DOM APIs so both sides can import it.
 */
import type { Row } from './types';

/* ------------------------------------------------------------------ *\
 * Devices
\* ------------------------------------------------------------------ */

export type DeviceKind =
  | 'router' | 'switch' | 'ap' | 'server' | 'nas' | 'computer' | 'phone' | 'tablet'
  | 'printer' | 'camera' | 'tv' | 'media' | 'voip' | 'iot' | 'unknown';

export type LinkKind = 'wired' | 'wifi' | 'tunnel' | 'ppp' | 'virtual';

export interface DeviceRecord {
  id: string;
  name: string;
  hostname?: string;
  ip?: string;
  addresses: string[];
  mac?: string;
  vendor?: string;
  platform?: string;
  board?: string;
  version?: string;
  kind: DeviceKind;
  link: LinkKind;
  interface?: string;
  segment?: string;
  ssid?: string;
  signal?: number;
  uptime?: string;
  active: boolean;
  dhcp: boolean;
  randomised: boolean;
  sources: string[];
  bytesIn?: number;
  bytesOut?: number;
  discoveredBy?: string;
  comment?: string;
  confidence: number;
}

/* ------------------------------------------------------------------ *\
 * Topology
\* ------------------------------------------------------------------ */

export type TopoKind = 'internet' | 'uplink' | 'router' | 'bridge' | 'vlan' | 'segment' | 'tunnel';

export interface TopoNode {
  id: string;
  kind: TopoKind;
  label: string;
  sublabel?: string;
  detail?: string;
  ip?: string;
  cidr?: string;
  interface?: string;
  link?: LinkKind;
  status: 'up' | 'down' | 'warn';
  bytes?: number;
  utilisation?: number;
  /** Current throughput, when the node maps to an interface. */
  rate?: { rx: number; tx: number };
  clients?: number;
  devices?: DeviceRecord[];
  meta?: Row;
}

export interface TopoLink {
  from: string;
  to: string;
  link?: LinkKind;
  label?: string;
  status: 'up' | 'down' | 'warn';
}

export interface Topology {
  mode: string;
  generatedAt: number;
  nodes: TopoNode[];
  links: TopoLink[];
  stats: {
    devices: number; wired: number; wireless: number; tunnels: number;
    segments: number; unidentified: number; vendors: Array<{ name: string; count: number }>;
    kinds: Array<{ name: DeviceKind; count: number }>;
  };
  sources: Array<{ path: string; ok: boolean; rows: number; error?: string }>;
}

/* ------------------------------------------------------------------ *\
 * Traffic classification (flow-based, not payload inspection)
\* ------------------------------------------------------------------ */

export type AppCategory = 'web' | 'media' | 'remote' | 'infra' | 'p2p' | 'vpn' | 'mail' | 'other';

export interface AppClass {
  id: string;
  label: string;
  category: AppCategory;
  color: string;
  /** Destination ports that identify the class. */
  ports: number[];
  protocols?: Array<'tcp' | 'udp'>;
  /** Optional port range (p2p swarms, RTP/STUN blocks). */
  range?: [number, number];
}

export const APP_CATEGORY_COLORS: Record<AppCategory, string> = {
  web: '#22d3ee',
  media: '#a855f7',
  remote: '#f59e0b',
  infra: '#64748b',
  p2p: '#ef4444',
  vpn: '#14b8a6',
  mail: '#f472b6',
  other: '#94a3b8',
};

export const APP_CLASSES: AppClass[] = [
  { id: 'dns', label: 'DNS', category: 'infra', color: '#64748b', ports: [53] },
  { id: 'dot', label: 'DNS-over-TLS', category: 'infra', color: '#475569', ports: [853] },
  { id: 'dhcp', label: 'DHCP', category: 'infra', color: '#526071', ports: [67, 68] },
  { id: 'ntp', label: 'NTP', category: 'infra', color: '#5b6b7c', ports: [123] },
  { id: 'snmp', label: 'SNMP', category: 'infra', color: '#6b7b8c', ports: [161, 162] },
  { id: 'syslog', label: 'Syslog', category: 'infra', color: '#7b8b9c', ports: [514] },
  { id: 'ldap', label: 'LDAP / AD', category: 'infra', color: '#8b9bac', ports: [389, 636, 3268, 3269] },
  { id: 'web', label: 'HTTP', category: 'web', color: '#22d3ee', ports: [80, 8080, 8000, 8081] },
  { id: 'https', label: 'HTTPS / TLS', category: 'web', color: '#38bdf8', ports: [443, 8443, 9443] },
  { id: 'quic', label: 'QUIC / HTTP3', category: 'web', color: '#0ea5e9', ports: [443], protocols: ['udp'] },
  { id: 'ssh', label: 'SSH', category: 'remote', color: '#f59e0b', ports: [22, 2222] },
  { id: 'telnet', label: 'Telnet', category: 'remote', color: '#fb923c', ports: [23] },
  { id: 'rdp', label: 'RDP', category: 'remote', color: '#f97316', ports: [3389] },
  { id: 'vnc', label: 'VNC', category: 'remote', color: '#fdba74', ports: [5900, 5901] },
  { id: 'winbox', label: 'Winbox', category: 'remote', color: '#fbbf24', ports: [8291] },
  { id: 'smb', label: 'SMB / CIFS', category: 'infra', color: '#94a3b8', ports: [445, 139] },
  { id: 'nfs', label: 'NFS', category: 'infra', color: '#a1a1aa', ports: [2049] },
  { id: 'afp', label: 'AFP', category: 'infra', color: '#cbd5e1', ports: [548] },
  { id: 'print', label: 'Printing (IPP)', category: 'infra', color: '#cbd5e1', ports: [515, 631, 9100] },
  { id: 'smtp', label: 'Mail (SMTP)', category: 'mail', color: '#f472b6', ports: [25, 465, 587] },
  { id: 'imap', label: 'Mail (IMAP)', category: 'mail', color: '#ec4899', ports: [143, 993] },
  { id: 'pop3', label: 'Mail (POP3)', category: 'mail', color: '#db2777', ports: [110, 995] },
  { id: 'sip', label: 'SIP / VoIP', category: 'media', color: '#a855f7', ports: [5060, 5061] },
  { id: 'stun', label: 'STUN / WebRTC', category: 'media', color: '#c084fc', ports: [], range: [3478, 3481] },
  { id: 'rtsp', label: 'RTSP / IP camera', category: 'media', color: '#d8b4fe', ports: [554, 8554] },
  { id: 'rtmp', label: 'RTMP', category: 'media', color: '#e9d5ff', ports: [1935] },
  { id: 'cast', label: 'Chromecast', category: 'media', color: '#f0abfc', ports: [8008, 8009] },
  { id: 'plex', label: 'Plex', category: 'media', color: '#e879f9', ports: [32400] },
  { id: 'mdns', label: 'mDNS / SSDP', category: 'media', color: '#f5d0fe', ports: [5353, 1900] },
  { id: 'openvpn', label: 'OpenVPN', category: 'vpn', color: '#14b8a6', ports: [1194] },
  { id: 'wireguard', label: 'WireGuard', category: 'vpn', color: '#0d9488', ports: [51820] },
  { id: 'ipsec', label: 'IPsec IKE', category: 'vpn', color: '#10b981', ports: [500, 4500], protocols: ['udp'] },
  { id: 'l2tp', label: 'L2TP', category: 'vpn', color: '#34d399', ports: [1701] },
  { id: 'pptp', label: 'PPTP', category: 'vpn', color: '#6ee7b7', ports: [1723] },
  { id: 'sstp', label: 'SSTP', category: 'vpn', color: '#059669', ports: [443], protocols: ['tcp'] },
  { id: 'radius', label: 'RADIUS', category: 'infra', color: '#7dd3fc', ports: [1812, 1813, 1645, 1646] },
  { id: 'torrent', label: 'BitTorrent', category: 'p2p', color: '#ef4444', ports: [51413], range: [6881, 6889] },
  { id: 'gpush', label: 'Google Push (Android)', category: 'infra', color: '#a3e635', ports: [5228, 5229, 5230] },
  { id: 'apns', label: 'Apple Push (APNs)', category: 'infra', color: '#bef264', ports: [5223] },
  { id: 'xmpp', label: 'XMPP', category: 'other', color: '#84cc16', ports: [5222, 5269] },
  { id: 'ftp', label: 'FTP', category: 'other', color: '#facc15', ports: [20, 21] },
  { id: 'mysql', label: 'MySQL', category: 'other', color: '#60a5fa', ports: [3306] },
  { id: 'postgres', label: 'PostgreSQL', category: 'other', color: '#3b82f6', ports: [5432] },
  { id: 'redis', label: 'Redis', category: 'other', color: '#f87171', ports: [6379] },
  { id: 'mongo', label: 'MongoDB', category: 'other', color: '#4ade80', ports: [27017] },
];

const UNKNOWN_APP: AppClass = { id: 'other', label: 'Unclassified', category: 'other', color: '#94a3b8', ports: [] };

/** Best-effort application label from protocol + ports. Not payload inspection. */
export function classifyFlow(protocol?: unknown, dstPort?: unknown, srcPort?: unknown): AppClass {
  const proto = String(protocol ?? '').toLowerCase();
  const dst = Number(dstPort) || 0;
  const src = Number(srcPort) || 0;

  const matches = (port: number) => port === dst || port === src;
  const inRange = (range: [number, number]) =>
    (dst >= range[0] && dst <= range[1]) || (src >= range[0] && src <= range[1]);

  for (const app of APP_CLASSES) {
    if (app.protocols && !app.protocols.includes(proto as 'tcp' | 'udp')) continue;
    if (app.range && inRange(app.range)) return app;
    if (app.ports.some(matches)) return app;
  }
  // ESP/AH and other non-TCP/UDP protocol numbers.
  if (proto === 'gre') return { id: 'gre', label: 'GRE tunnel', category: 'vpn', color: '#5eead4', ports: [] };
  if (proto === 'icmp' || proto === 'icmpv6') return { id: 'icmp', label: 'ICMP', category: 'infra', color: '#94a3b8', ports: [] };
  if (proto === 'esp') return { id: 'esp', label: 'IPsec ESP', category: 'vpn', color: '#10b981', ports: [] };
  return UNKNOWN_APP;
}

/* ------------------------------------------------------------------ *\
 * Insights
\* ------------------------------------------------------------------ */

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

export const SEVERITY_SCORE: Record<Severity, number> = { critical: 16, high: 9, medium: 5, low: 2, info: 0 };

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  category: 'security' | 'capacity' | 'reliability' | 'hygiene' | 'observability';
  remediation?: string;
  evidence?: string;
  /** Menus the operator should look at to act on this. */
  menus?: string[];
}

export interface CapacityRow {
  interface: string;
  type?: string;
  speedBps: number;
  /** Cumulative counters as reported by the device (bytes since last reset). */
  rxBytes: number;
  txBytes: number;
  rxRate: number;
  txRate: number;
  utilisation: number;
  rxErrors: number;
  rxDrops: number;
  txErrors: number;
  txDrops: number;
  trend?: number[];
  status: 'ok' | 'watch' | 'hot' | 'down';
}

export interface SubnetRow {
  network: string;
  cidr: string;
  interface?: string;
  gateway?: string;
  total: number;
  used: number;
  free: number;
  utilisation: number;
  sources: string[];
  pool?: string;
}

export interface WirelessRow {
  interface: string;
  ssid: string;
  band?: string;
  frequency?: string;
  channelWidth?: string;
  clients: number;
  avgSignal: number;
  worstSignal: number;
  weakestClient?: string;
  congestion: 'low' | 'medium' | 'high';
}

export interface TrafficBundle {
  mode: string;
  generatedAt: number;
  totalFlows: number;
  totalBytes: number;
  classifiedBytes: number;
  throughput: { rx: number; tx: number };
  apps: Array<{ id: string; label: string; category: AppCategory; color: string; flows: number; bytes: number; share: number }>;
  talkers: Array<{ ip: string; name?: string; mac?: string; vendor?: string; bytes: number; flows: number; topApp: string }>;
  destinations: Array<{ ip: string; name?: string; bytes: number; flows: number; app: string }>;
  conversations: Array<{ src: string; dst: string; protocol: string; port: number; app: string; bytes: number; state: string; timeout: string }>;
  protocols: Array<{ name: string; flows: number; bytes: number; share: number }>;
  ports: Array<{ port: number; protocol: string; label: string; flows: number; bytes: number }>;
  dpi: {
    payloadInspection: false;
    reason: string;
    l7: { enabled: boolean; matchers: Array<{ name: string; regexp: string; rules: number; bytes?: number }>; ruleCount: number };
    mirror?: { source?: string; target?: string; note: string };
    containers: Array<{ name: string; status: string; image: string; comment?: string }>;
    options: Array<{ title: string; detail: string; commands?: string; effort: 'low' | 'medium' | 'high'; fidelity: 'metadata' | 'headers' | 'payload' }>;
    /** Runtime state of the on-box capture paths. */
    sensorNote?: string;
    trafficFlow?: { enabled: boolean; targets: number };
    remoteLogging?: number;
    sniffer?: { running: boolean; filter?: string; fileName?: string };
    conntrack?: { entries: number; maxEntries: string; activeIpv4: number; activeIpv6: number };
  };
  sources: Array<{ path: string; ok: boolean; rows: number; error?: string }>;
}

export interface ChangeSection {
  section: string;
  added: string[];
  removed: string[];
}

export interface ChangeDiff {
  since: number;
  connectionId: string;
  labels: { added: string[]; removed: string[] };
  sections: ChangeSection[];
}

/** One stored score reading — see `server/analytics/history.ts`. */
export interface ScoreSample {
  at: number;
  overall: number;
  grade: string;
  components: Record<string, number>;
  findings: { critical: number; high: number; medium: number; low: number; info: number };
  devices: number;
  /** `demo` samples are simulated history; `live` ones were really observed. */
  source: 'demo' | 'live';
}

export interface ScoreTrend {
  connectionId: string;
  samples: ScoreSample[];
  source: 'demo' | 'live';
  total: number;
  first: ScoreSample | null;
  last: ScoreSample | null;
  delta: number | null;
  deltaDays: number | null;
  delta24h: number | null;
  direction: 'up' | 'down' | 'flat';
  components: Array<{ id: string; label: string; now: number; before: number; delta: number }>;
  newFindings: number;
}

/* ------------------------------ alerting ------------------------------ */

export type AlertRuleType = 'score-below' | 'severity-count' | 'new-findings';

export interface AlertRule {
  id: string;
  name: string;
  enabled: boolean;
  type: AlertRuleType;
  /** Used by `severity-count`: count findings at this severity or worse. */
  severity?: Severity;
  /** Score (score-below) or count (severity-count / new-findings). */
  threshold: number;
  channel: 'log' | 'webhook';
  url?: string;
  cooldownMinutes: number;
  createdAt: number;
  lastTriggeredAt?: number;
}

export interface AlertEvent {
  id: string;
  at: number;
  ruleId: string;
  ruleName: string;
  severity: Severity;
  message: string;
  value: number | string;
  delivery: 'logged' | 'webhook-ok' | 'webhook-failed';
}

export interface ReportSchedule {
  enabled: boolean;
  everyHours: number;
  lastRunAt?: number;
  webhookUrl?: string;
  includeTraffic: boolean;
}

/** One host's answer to a sweep probe. */
export interface SweepResult {
  ip: string;
  name?: string;
  mac?: string;
  vendor?: string;
  kind?: string;
  link?: string;
  reachable: boolean;
  rttMs: number | null;
  /** `ping` = answered ICMP; `arp` = known to the device but not answering directly. */
  method: 'ping' | 'arp';
  /** Conversations conntrack has observed for this address (passive, not a port scan). */
  flows?: number;
  bytes?: number;
  topService?: string;
  error?: string;
}

export interface SweepSummary {
  scope: string;
  total: number;
  reachable: number;
  unreachable: number;
  averageRttMs: number | null;
  status: 'running' | 'complete' | 'error';
  elapsedMs: number;
  observedTraffic: string;
  results: SweepResult[];
}

/** Throughput series for one interface, derived from successive counter reads. */
export interface LinkHistory {
  interface: string;
  hours: number;
  points: Array<{ at: number; rx: number; tx: number }>;
  peak: number;
  average: number;
  source: 'demo' | 'live';
}

export interface InsightBundle {
  mode: string;
  generatedAt: number;
  score: { overall: number; grade: string; components: Array<{ id: string; label: string; score: number; tone: string }> };
  findings: Finding[];
  counts: Record<Severity, number>;
  capacity: { interfaces: CapacityRow[]; wan: CapacityRow | null; totalRx: number; totalTx: number; headroom: number };
  ipam: { subnets: SubnetRow[]; conflicts: Array<{ address: string; macs: string[]; hostnames: string[] }>; pools: Array<Row>; totalUsed: number; totalFree: number };
  wireless: { radios: WirelessRow[]; clients: number; bands: Array<{ band: string; count: number }>; weak: Array<{ name: string; signal: number; interface?: string; ssid?: string }> };
  routing: {
    total: number; connected: number; static: number; dynamic: number; defaults: number;
    protocols: Array<{ name: string; count: number }>;
    bgp: { sessions: number; established: number; down: Array<{ name: string; state: string; peer?: string }> };
    ospf: { neighbors: number; full: number };
    unstable: Array<{ name: string; detail: string }>;
  };
  queues: { count: number; shapedBps: number; wanBps: number; oversubscription: number; idle: number };
  changes: ChangeDiff | null;
  traffic: TrafficBundle | null;
  /** Score history — null until the first read has been recorded. */
  history?: ScoreTrend | null;
  notes: string[];
  sources: Array<{ path: string; ok: boolean; rows: number; error?: string }>;
}

/* ------------------------------------------------------------------ *\
 * Parsing / maths helpers
\* ------------------------------------------------------------------ */

export const parseNum = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const n = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : fallback;
};

/** `'1Gbps'`, `'100Mbps'`, `'10M'`, `'512k'`, `'512000'` → bits per second. */
export function parseRate(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const text = String(value ?? '').trim().toLowerCase().replace(/,/g, '');
  if (!text) return 0;
  const match = text.match(/(\d*\.?\d+)\s*([kmg]?)(?:bits?|bps|b\/s)?/);
  if (!match) return 0;
  const n = parseFloat(match[1]);
  if (!Number.isFinite(n)) return 0;
  const unit = (match[2] ?? '').toLowerCase();
  const multiplier = unit === 'g' ? 1e9 : unit === 'm' ? 1e6 : unit === 'k' ? 1e3 : 1;
  return n * multiplier;
}

export const parseBytes = (value: unknown): number => parseNum(value, 0);

/** `'-51dBm'` / `'-51'` → -51. Returns NaN when the value is missing. */
export function parseSignal(value: unknown): number {
  const n = parseNum(value, Number.NaN);
  return Number.isFinite(n) && n !== 0 ? n : Number.NaN;
}

/** `'1M'`, `'4096'`, `'6144'` → number of conntrack entries. */
export const parseCount = (value: unknown): number => {
  const text = String(value ?? '');
  const n = parseFloat(text) || 0;
  return /k$/i.test(text) ? n * 1e3 : /m$/i.test(text) ? n * 1e6 : n;
};

/** Parse RouterOS duration strings (`'1d2h3m4s'`, `'2h14m'`, `'45s'`) into seconds. */
export function parseUptimeSeconds(value: unknown): number | null {
  const text = String(value ?? '').trim();
  if (!text || /^never$/i.test(text)) return null;
  const matches = [...text.matchAll(/(\d+)\s*([wdhms])/gi)];
  if (!matches.length) {
    const bare = Number(text);
    return Number.isFinite(bare) ? bare : null;
  }
  const unit: Record<string, number> = { w: 604800, d: 86400, h: 3600, m: 60, s: 1 };
  return matches.reduce((total, match) => total + Number(match[1]) * (unit[match[2].toLowerCase()] ?? 0), 0);
}

export const isTruthy = (value: unknown): boolean =>
  value === true || value === 'true' || value === 'yes' || value === 'enabled';

/* ------------------------------- IPv4 math ------------------------------- */

export const ipToInt = (ip: string): number =>
  ip.split('.').reduce((acc, part) => ((acc << 8) >>> 0) + (Number(part) & 255), 0) >>> 0;

export const intToIp = (value: number): string =>
  [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.');

export interface CidrInfo { address: string; network: string; cidr: string; mask: string; size: number; usable: number; gateway?: string }

/** Parse `192.168.88.1/24` (or a bare address, treated as /32). */
export function cidrInfo(address?: unknown): CidrInfo | null {
  const text = String(address ?? '').trim();
  if (!/^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/.test(text)) return null;
  const [ip, bitsRaw] = text.split('/');
  const bits = bitsRaw === undefined ? 32 : Math.max(0, Math.min(32, Number(bitsRaw)));
  const int = ipToInt(ip);
  const maskInt = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  const network = (int & maskInt) >>> 0;
  const size = 2 ** (32 - bits);
  return {
    address: ip,
    network: intToIp(network),
    cidr: `${intToIp(network)}/${bits}`,
    mask: intToIp(maskInt),
    size,
    usable: size > 2 ? size - 2 : size,
    gateway: ip,
  };
}

export function containsIp(cidr: CidrInfo, ip?: string): boolean {
  if (!ip || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return false;
  const bits = Number(cidr.cidr.split('/')[1]);
  const maskInt = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((ipToInt(ip) & maskInt) >>> 0) === ipToInt(cidr.network);
}

export function utilisationOf(rx: number, tx: number, speedBps: number): number {
  if (!speedBps) return 0;
  return Math.min(100, Math.round((Math.max(rx, tx) / speedBps) * 100));
}

/* ---------------------------- device inference ---------------------------- */

const KIND_RULES: Array<{ kind: DeviceKind; re: RegExp }> = [
  { kind: 'camera', re: /hikvision|dahua|axis|reolink|nvr|cctv|ipcam|camera|dvr/i },
  { kind: 'nas', re: /synology|qnap|truenas|freenas|western digital|wd my cloud|nas\b|diskstation/i },
  { kind: 'printer', re: /brother|xerox|lexmark|printer|mfp|e ?studio|laserjet|officejet|deskjet/i },
  { kind: 'voip', re: /yealink|polycom|grandstream|sip[-_ ]?phone|voip|snom|avaya/i },
  { kind: 'ap', re: /\bap\b|access[- ]?point|unifi|airmax|capsman|wifi|wlan/i },
  { kind: 'switch', re: /switch|sw-|crs\d|usw|sg350|catalyst|netgear gs|tl-sg/i },
  { kind: 'router', re: /router|ccr\d|rb\d{3}|routeros|edgerouter|mikrotik/i },
  { kind: 'tv', re: /\btv\b|roku|apple\s?tv|fire\s?tv|smart[- ]?tv|bravia|webos|tizen|chromecast/i },
  { kind: 'media', re: /sonos|echo|alexa|homepod|speaker|media|shield|ps[45]|xbox|playstation/i },
  { kind: 'phone', re: /iphone|pixel|galaxy|oneplus|redmi|phone|android/i },
  { kind: 'tablet', re: /ipad|tablet|tab[-_ ]/i },
  { kind: 'computer', re: /macbook|thinkpad|desktop|windows|laptop|pc-|imac|surface|ubuntu|fedora|debian|raspberry ?pi|rpi/i },
  { kind: 'server', re: /server|proxmox|esxi|docker|k8s|kubernetes|vm-|hypervisor|ubuntu-server/i },
  { kind: 'iot', re: /esp|shelly|tasmota|tuya|smart|plug|bulb|thermostat|sensor|iot|nest|ewelink|zigbee/i },
];

export function inferDeviceKind(input: { vendor?: string; platform?: string; board?: string; hostname?: string; version?: string }): DeviceKind {
  const haystack = [input.vendor, input.platform, input.board, input.hostname, input.version].filter(Boolean).join(' ');
  if (!haystack) return 'unknown';
  for (const rule of KIND_RULES) if (rule.re.test(haystack)) return rule.kind;
  return 'unknown';
}

export const DEVICE_KIND_LABEL: Record<DeviceKind, string> = {
  router: 'Router', switch: 'Switch', ap: 'Access point', server: 'Server', nas: 'NAS',
  computer: 'Computer', phone: 'Phone', tablet: 'Tablet', printer: 'Printer', camera: 'Camera',
  tv: 'Smart TV', media: 'Media device', voip: 'VoIP phone', iot: 'IoT device', unknown: 'Unknown',
};

export const DEVICE_KIND_ICON: Record<DeviceKind, string> = {
  router: 'Router', switch: 'Network', ap: 'Wifi', server: 'Server', nas: 'HardDrive',
  computer: 'Monitor', phone: 'Smartphone', tablet: 'Tablet', printer: 'Printer', camera: 'Camera',
  tv: 'Tv', media: 'Speaker', voip: 'PhoneCall', iot: 'Lightbulb', unknown: 'CircleHelp',
};
