/**
 * Configuration change tracking.
 *
 * RouterOS keeps no diff log over REST, so the dashboard fingerprints the
 * interesting menu contents on every analytics read and compares against the
 * previous fingerprint. That turns "what changed since I last looked?" into a
 * first-class answer.
 */
import type { ChangeDiff, ChangeSection } from '../../shared/analytics';
import type { Row } from '../../shared/types';
import type { TableMap } from './collect';

export interface Snapshot {
  at: number;
  connectionId: string;
  sections: Record<string, string[]>;
}

/** Menus worth watching, with the label that identifies one row to an operator. */
const WATCHED: Array<{ section: string; path: string; label: (row: Row) => string }> = [
  { section: 'Firewall rules', path: 'ip/firewall/filter', label: (r) => `${r.chain}/${r.action}${r.comment ? ` (${r.comment})` : ''}${r['dst-port'] ? ` :${r['dst-port']}` : ''}` },
  { section: 'NAT rules', path: 'ip/firewall/nat', label: (r) => `${r.chain}/${r.action} ${r['dst-port'] ? `:${r['dst-port']}` : ''}${r['to-addresses'] ? ` → ${r['to-addresses']}` : ''}` },
  { section: 'Mangle rules', path: 'ip/firewall/mangle', label: (r) => `${r.chain}/${r.action}${r['new-packet-mark'] ? ` mark=${r['new-packet-mark']}` : ''}${r['layer7-protocol'] ? ` l7=${r['layer7-protocol']}` : ''}` },
  { section: 'RAW rules', path: 'ip/firewall/raw', label: (r) => `${r.chain}/${r.action}${r.comment ? ` (${r.comment})` : ''}` },
  { section: 'Address lists', path: 'ip/firewall/address-list', label: (r) => `${r.list}: ${r.address}` },
  { section: 'Layer 7 matchers', path: 'ip/firewall/layer7-protocol', label: (r) => String(r.name ?? '') },
  { section: 'IPv4 addresses', path: 'ip/address', label: (r) => `${r.address} on ${r.interface}` },
  { section: 'Routes', path: 'ip/route', label: (r) => `${r['dst-address']} via ${r.gateway ?? 'n/a'}${r.comment ? ` (${r.comment})` : ''}` },
  { section: 'IP pools', path: 'ip/pool', label: (r) => `${r.name}: ${r.ranges}` },
  { section: 'DHCP networks', path: 'ip/dhcp-server/network', label: (r) => `${r.address}${r.gateway ? ` gw ${r.gateway}` : ''}` },
  { section: 'DHCP servers', path: 'ip/dhcp-server', label: (r) => `${r.name} on ${r.interface}` },
  { section: 'IP services', path: 'ip/service', label: (r) => `${r.name}:${r.port}${r.disabled === true || r.disabled === 'true' ? ' (disabled)' : ''}${r.address ? ` @${r.address}` : ''}` },
  { section: 'Users', path: 'system/user', label: (r) => `${r.name} (${r.group})${r.address ? ` @${r.address}` : ''}` },
  { section: 'Interfaces', path: 'interface', label: (r) => `${r.name}${r.disabled === true || r.disabled === 'true' ? ' (disabled)' : ''}${r.comment ? ` — ${r.comment}` : ''}` },
  { section: 'VLANs', path: 'interface/vlan', label: (r) => `${r.name} (vlan ${r['vlan-id']} on ${r.interface})` },
  { section: 'Bridges', path: 'interface/bridge', label: (r) => `${r.name}${r.comment ? ` — ${r.comment}` : ''}` },
  { section: 'IPsec peers', path: 'ip/ipsec/peer', label: (r) => `${r.name} → ${r.address}` },
  { section: 'Queue trees', path: 'queue/tree', label: (r) => `${r.name ?? r.parent}${r['packet-mark'] ? ` mark=${r['packet-mark']}` : ''}` },
  { section: 'Simple queues', path: 'queue/simple', label: (r) => `${r.name}${r.target ? ` → ${r.target}` : ''}` },
  { section: 'Schedulers', path: 'system/scheduler', label: (r) => `${r.name}${r.interval ? ` every ${r.interval}` : ''}` },
  { section: 'Scripts', path: 'system/script', label: (r) => String(r.name ?? '') },
  { section: 'Certificates', path: 'system/certificate', label: (r) => `${r.name}${r.trusted ? ' (trusted)' : ''}` },
];

let last: Snapshot | null = null;
let changes: ChangeDiff | null = null;

const fingerprint = (rows: Row[], label: (row: Row) => string): string[] =>
  rows.map((row) => label(row).trim()).filter(Boolean).sort();

/**
 * Records a new snapshot and diffs it against the previous one. Called on every
 * insights read; the first call for a connection only establishes a baseline.
 */
export function recordSnapshot(tables: TableMap, connectionId = 'active'): { snapshot: Snapshot; diff: ChangeDiff | null } {
  const sections: Record<string, string[]> = {};
  for (const entry of WATCHED) sections[entry.section] = fingerprint(tables[entry.path] ?? [], entry.label);

  const snapshot: Snapshot = { at: Date.now(), connectionId, sections };
  let nextDiff: ChangeDiff | null = null;

  if (last && last.connectionId === connectionId) {
    const diffSections: ChangeSection[] = [];
    for (const entry of WATCHED) {
      const before = new Set(last.sections[entry.section] ?? []);
      const after = new Set(sections[entry.section] ?? []);
      const added = [...after].filter((v) => !before.has(v));
      const removed = [...before].filter((v) => !after.has(v));
      if (added.length || removed.length) diffSections.push({ section: entry.section, added, removed });
    }
    const flatAdded = diffSections.flatMap((s) => s.added.map((v) => `${s.section}: ${v}`));
    const flatRemoved = diffSections.flatMap((s) => s.removed.map((v) => `${s.section}: ${v}`));
    nextDiff = {
      since: last.at,
      connectionId,
      labels: { added: flatAdded.slice(0, 60), removed: flatRemoved.slice(0, 60) },
      sections: diffSections.slice(0, 40),
    };
  }

  last = snapshot;
  changes = nextDiff;
  return { snapshot, diff: nextDiff };
}

/** The most recent diff (null until two reads have happened). */
export const diffSnapshot = (): ChangeDiff | null => changes;

export function currentSnapshot(): Snapshot | null {
  return last;
}

export function resetSnapshots() {
  last = null;
  changes = null;
}
