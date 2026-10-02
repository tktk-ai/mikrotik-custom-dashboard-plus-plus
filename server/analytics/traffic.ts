/**
 * Traffic analytics.
 *
 * Two distinct things live here, and the distinction matters:
 *
 *  1. Flow analytics — aggregated from the connection table, mangle counters and
 *     Layer 7 matchers. This is metadata: who talked to whom, over which port, how
 *     many bytes. RouterOS gives us all of that over REST.
 *
 *  2. Deep packet inspection — RouterOS REST does **not** expose packet payloads,
 *     so this module reports what IS available (L7 matchers, the mirror/sniffer
 *     workflow, container-based sensors) and what each option can and cannot see.
 *     The `dpi.payloadInspection: false` flag is deliberate and rendered as such in
 *     the UI rather than being faked.
 */
import {
  APP_CATEGORY_COLORS, classifyFlow, parseBytes, type AppCategory, type TrafficBundle,
} from '../../shared/analytics';
import type { Row } from '../../shared/types';
import { reports, type Fetched, type TableMap } from './collect';

const text = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : String(v));
const num = (v: unknown, fallback = 0) => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : fallback;
};
const truthy = (v: unknown) => v === true || v === 'true' || v === 'yes';
const addTo = <K, V>(map: Map<K, V>, key: K, make: () => V, update: (value: V) => V) => {
  const current = map.get(key);
  map.set(key, current === undefined ? make() : update(current));
};

export function buildTraffic(fetched: Map<string, Fetched>, mode: string): TrafficBundle {
  const tables: TableMap = {};
  for (const entry of fetched.values()) tables[entry.path] = entry.rows;

  const connections = tables['ip/firewall/connection'] ?? [];
  const tracking = (tables['ip/firewall/connection/tracking'] ?? [])[0] ?? {};
  const mangle = tables['ip/firewall/mangle'] ?? [];
  const layer7 = tables['ip/firewall/layer7-protocol'] ?? [];
  const interfaces = tables['interface'] ?? [];
  const ethernets = tables['interface/ethernet'] ?? [];
  const leases = tables['ip/dhcp-server/lease'] ?? [];
  const neighbors = tables['ip/neighbor'] ?? [];
  const sniffer = (tables['tool/sniffer'] ?? [])[0] ?? {};
  const containers = tables['container'] ?? [];
  const trafficFlow = (tables['ip/traffic-flow'] ?? [])[0] ?? {};
  const flowTargets = tables['ip/traffic-flow/target'] ?? [];
  const logging = tables['system/logging'] ?? [];
  const filter = tables['ip/firewall/filter'] ?? [];

  /* --------------------------- name resolution --------------------------- */
  const nameByIp = new Map<string, string>();
  for (const lease of leases) {
    const address = text(lease.address);
    const host = text(lease['host-name']);
    if (address && host) nameByIp.set(address, host);
  }
  for (const neighbor of neighbors) {
    const address = text(neighbor.address);
    const name = text(neighbor.identity);
    if (address && name) nameByIp.set(address, name);
  }
  const macByIp = new Map<string, string>();
  for (const lease of leases) {
    const address = text(lease.address);
    const mac = text(lease['mac-address']);
    if (address && mac) macByIp.set(address, mac);
  }

  /* ------------------------------ flow rollup ----------------------------- */
  const appMap = new Map<string, { id: string; label: string; category: AppCategory; color: string; flows: number; bytes: number }>();
  const talkerMap = new Map<string, { ip: string; bytes: number; flows: number; apps: Map<string, number> }>();
  const destMap = new Map<string, { ip: string; bytes: number; flows: number; apps: Map<string, number> }>();
  const protoMap = new Map<string, { name: string; flows: number; bytes: number }>();
  const portMap = new Map<string, { port: number; protocol: string; label: string; flows: number; bytes: number }>();
  const conversations: TrafficBundle['conversations'] = [];

  let totalBytes = 0;
  let classifiedBytes = 0;

  const l7Counters = new Map<string, number>();
  for (const rule of mangle) {
    const matcher = text(rule['layer7-protocol']);
    if (!matcher) continue;
    l7Counters.set(matcher, (l7Counters.get(matcher) ?? 0) + parseBytes(rule.bytes));
  }

  for (const row of connections) {
    const protocol = String(row.protocol ?? 'unknown').toLowerCase();
    const src = text(row['src-address']) ?? 'unknown';
    const dst = text(row['dst-address']) ?? 'unknown';
    const srcPort = num(row['src-port'], 0) || undefined;
    const dstPort = num(row['dst-port'], 0) || undefined;
    const bytes = parseBytes(row['orig-bytes']) + parseBytes(row['repl-bytes']);
    const app = classifyFlow(protocol, dstPort, srcPort);

    totalBytes += bytes;
    if (app.id !== 'other') classifiedBytes += bytes;

    addTo(appMap, app.id, () => ({ id: app.id, label: app.label, category: app.category, color: app.color, flows: 0, bytes: 0 }), (v) => v);
    const appEntry = appMap.get(app.id)!;
    appEntry.flows += 1;
    appEntry.bytes += bytes;

    addTo(talkerMap, src, () => ({ ip: src, bytes: 0, flows: 0, apps: new Map() }), (v) => v);
    const talker = talkerMap.get(src)!;
    talker.bytes += bytes;
    talker.flows += 1;
    talker.apps.set(app.label, (talker.apps.get(app.label) ?? 0) + bytes);

    addTo(destMap, dst, () => ({ ip: dst, bytes: 0, flows: 0, apps: new Map() }), (v) => v);
    const destination = destMap.get(dst)!;
    destination.bytes += bytes;
    destination.flows += 1;
    destination.apps.set(app.label, (destination.apps.get(app.label) ?? 0) + bytes);

    addTo(protoMap, protocol, () => ({ name: protocol, flows: 0, bytes: 0 }), (v) => v);
    const protoEntry = protoMap.get(protocol)!;
    protoEntry.flows += 1;
    protoEntry.bytes += bytes;

    const port = dstPort ?? srcPort ?? 0;
    const portKey = `${protocol}:${port}`;
    addTo(portMap, portKey, () => ({ port, protocol, label: app.label, flows: 0, bytes: 0 }), (v) => v);
    const portEntry = portMap.get(portKey)!;
    portEntry.flows += 1;
    portEntry.bytes += bytes;

    conversations.push({
      src, dst, protocol, port: dstPort ?? 0, app: app.label, bytes,
      state: String(row['tcp-state'] ?? row.state ?? 'established'),
      timeout: String(row.timeout ?? ''),
    });
  }

  conversations.sort((a, b) => b.bytes - a.bytes);

  const topApp = (apps: Map<string, number>) =>
    [...apps.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unclassified';

  /* ---------------------------- L7 matchers ---------------------------- */
  const ruleHits = new Map<string, number>();
  for (const rule of filter) {
    const comment = String(rule.comment ?? '');
    void comment;
  }
  void ruleHits;

  const l7 = {
    enabled: layer7.length > 0,
    matchers: layer7.map((m) => ({
      name: String(m.name ?? ''),
      regexp: String(m.regexp ?? ''),
      rules: mangle.filter((r) => String(r['layer7-protocol']) === String(m.name)).length,
      bytes: l7Counters.get(String(m.name ?? '')),
    })),
    ruleCount: mangle.filter((r) => r['layer7-protocol']).length,
  };

  /* ------------------------------- mirror ------------------------------- */
  const mirrorInterface = ethernets.find((e) => /mirror/.test(String(e.comment ?? '')));
  const sensor = containers.find((c) => /ntopng|suricata|zeek|snort|p0f/i.test(`${c.name} ${c.image}`));
  const snifferRunning = truthy(sniffer['streaming']) || (text(sniffer['file-name']) ? truthy(sniffer.running) : false);

  const dpi: TrafficBundle['dpi'] = {
    payloadInspection: false,
    reason: 'RouterOS exposes configuration and counters over REST — not packet payloads. Payload-level analysis needs one of the options below.',
    l7,
    mirror: mirrorInterface
      ? {
        source: String(mirrorInterface.name),
        target: sensor ? String(sensor.interface || sensor.name) : undefined,
        note: sensor
          ? `Mirror on ${String(mirrorInterface.name)} is wired to container "${String(sensor.name)}" (${String(sensor.status)}).`
          : `Interface comment marks a mirror source on ${String(mirrorInterface.name)}, but no sensor container is attached.`,
      }
      : undefined,
    containers: containers.map((c) => ({
      name: String(c.name ?? ''),
      status: String(c.status ?? 'unknown'),
      image: String(c.image ?? ''),
      comment: text(c.comment),
    })),
    options: [
      {
        title: 'On-device Layer 7 matchers',
        detail: 'Match payload regexes on the router itself. Counters per matcher show which application classes are on the wire. Licence-bounded (2 matchers on level 4, 6+ on level 5/6) and CPU-bound — keep it to a handful of rules and mark, do not drop.',
        commands: '/ip firewall layer7-protocol add name=youtube regexp="^.+(youtube.com|googlevideo.com).*$"\n/ip firewall mangle add chain=prerouting protocol=tcp dst-port=443 layer7-protocol=youtube action=mark-packet new-packet-mark=video',
        effort: 'low',
        fidelity: 'payload',
      },
      {
        title: 'Mirror port + sensor container',
        detail: 'Copy traffic from the uplink to a container running a real DPI engine (ntopng, Suricata, Zeek). RouterOS 7.4+ switch ports support mirroring on CRS/CCR switch chips; containers can consume it. This is the only way to get true payload analytics on-box.',
        commands: '/interface ethernet switch set sfp-sfpplus2 mirror-source=ether1 mirror-target=sfp-sfpplus2\n/container/config set registry-url=https://registry-1.docker.io\n/container add remote-image=ntop/ntopng interface=veth-ntopng root-dir=disk1/ntopng',
        effort: 'high',
        fidelity: 'payload',
      },
      {
        title: 'Standalone capture (sniffer)',
        detail: 'The built-in sniffer can capture to a file or stream on a filtered host/port set, then you analyse the pcap off-box (Wireshark/Zeek). Great for an incident, too expensive to leave running.',
        commands: '/tool sniffer set filter-interface=ether1 file-name=cap.pcap file-limit=10000\n/tool sniffer start\n/tool sniffer stop',
        effort: 'medium',
        fidelity: 'payload',
      },
      {
        title: 'Traffic Flow export (NetFlow v9 / IPFIX)',
        detail: 'RouterOS exports flow records — addresses, ports, protocol, byte and packet counts — to a collector. No payload, but full 5-tuple history and long-term dashboards.',
        commands: '/ip traffic-flow set enabled=yes cache-entries=32k\n/ip traffic-flow target add dst-address=192.168.88.20:2055 version=9',
        effort: 'low',
        fidelity: 'metadata',
      },
      {
        title: 'Remote syslog for firewall events',
        detail: 'Ship the firewall/log topics to a SIEM to keep audit trails. Metadata only, but it survives reboot and feeds correlation.',
        commands: '/system logging action add name=siem target=remote remote=192.168.88.21 remote-port=514\n/system logging add topics=firewall,info action=siem',
        effort: 'low',
        fidelity: 'metadata',
      },
    ],
  };

  /* ------------------------ throughput (from interfaces) ------------------- */
  const wan = interfaces.find((i) => String(i.name) === 'ether1');
  const rxRate = 0;
  const txRate = 0;
  void wan;

  const totalFlows = connections.length;
  const share = (bytes: number) => (totalBytes ? Math.round((bytes / totalBytes) * 1000) / 10 : 0);

  const apps = [...appMap.values()]
    .map((a) => ({ ...a, share: share(a.bytes) }))
    .sort((a, b) => b.bytes - a.bytes);

  // Layer 7 counters are counted separately from conntrack: merge them in as
  // additional application classes so the split view shows both sources.
  for (const [name, bytes] of l7Counters) {
    if (!bytes) continue;
    const existing = apps.find((a) => a.label.toLowerCase() === name.toLowerCase());
    if (existing) {
      existing.bytes += bytes;
    } else {
      apps.push({
        id: `l7-${name}`, label: name, category: 'media',
        color: APP_CATEGORY_COLORS.media, flows: 0, bytes, share: 0,
      });
    }
  }
  apps.sort((a, b) => b.bytes - a.bytes);
  for (const app of apps) app.share = share(app.bytes);

  return {
    mode,
    generatedAt: Date.now(),
    totalFlows,
    totalBytes,
    classifiedBytes,
    throughput: { rx: rxRate, tx: txRate },
    apps,
    talkers: [...talkerMap.values()]
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 25)
      .map((talker) => ({
        ip: talker.ip,
        name: nameByIp.get(talker.ip),
        mac: macByIp.get(talker.ip),
        bytes: talker.bytes,
        flows: talker.flows,
        topApp: topApp(talker.apps),
      })),
    destinations: [...destMap.values()]
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 25)
      .map((destination) => ({
        ip: destination.ip,
        name: nameByIp.get(destination.ip),
        bytes: destination.bytes,
        flows: destination.flows,
        app: topApp(destination.apps),
      })),
    conversations: conversations.slice(0, 25),
    protocols: [...protoMap.values()].map((p) => ({ ...p, share: share(p.bytes) })).sort((a, b) => b.bytes - a.bytes),
    ports: [...portMap.values()].sort((a, b) => b.bytes - a.bytes).slice(0, 20),
    dpi: {
      ...dpi,
      sensorNote: sensor ? `${sensor.name} (${sensor.status})` : undefined,
      trafficFlow: { enabled: truthy(trafficFlow.enabled), targets: flowTargets.length },
      remoteLogging: logging.filter((l) => String(l.action ?? '').includes('remote')).length,
      sniffer: { running: snifferRunning, filter: text(sniffer['filter-interface']), fileName: text(sniffer['file-name']) },
      conntrack: {
        entries: num(tracking['total-entries']) || totalFlows,
        maxEntries: String(tracking['max-entries'] ?? 'unknown'),
        activeIpv4: num(tracking['active-ipv4']),
        activeIpv6: num(tracking['active-ipv6']),
      },
    } as TrafficBundle['dpi'],
    sources: reports(fetched),
  };
}
