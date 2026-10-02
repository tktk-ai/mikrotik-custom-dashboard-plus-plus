/**
 * Insights: turns RouterOS menu dumps into findings, capacity analysis, IPAM,
 * wireless health and routing posture.
 *
 * Every rule is written as a small function over the table map so rules can be
 * added without touching the aggregation code. Nothing here guesses: when a menu
 * is missing the corresponding checks simply do not fire.
 */
import {
  SEVERITY_ORDER, SEVERITY_SCORE, cidrInfo, isTruthy, parseCount, parseRate, parseSignal, parseUptimeSeconds,
  type CapacityRow, type Finding, type InsightBundle, type Severity, type SubnetRow,
  type WirelessRow,
} from '../../shared/analytics';
import type { Row } from '../../shared/types';
import { list, reports, type Fetched, type TableMap } from './collect';
import { buildSegments, resolveWanInterface } from './topology';
import { buildDevices } from './devices';
import { buildTraffic } from './traffic';
import { recordSnapshot } from './snapshot';

const text = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : String(v));
const num = (v: unknown, fallback = 0) => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : fallback;
};
const pct = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

/* ------------------------------------------------------------------ *
 * Rules
 * ------------------------------------------------------------------ */

type Rule = (t: TableMap) => Finding[];
type AddressConflict = { address: string; macs: string[]; hostnames: string[] };

const finding = (f: Omit<Finding, 'id'> & { id?: string }): Finding => ({
  id: f.id ?? `${f.category}:${f.title}`.toLowerCase().replace(/[^a-z0-9:]+/g, '-'),
  ...f,
});

const hasExport = (t: TableMap, path: string) => list(t, path).length > 0;

const RULES: Rule[] = [
  /* ------------------------------ security ------------------------------ */
  (t) => {
    const out: Finding[] = [];
    const services = list(t, 'ip/service');
    if (services.length) {
      const open = services.filter((s) => !isTruthy(s.disabled));
      const risky = open.filter((s) => ['telnet', 'ftp', 'www', 'api', 'api-ssl', 'winbox'].includes(String(s.name)));
      const worldOpen = risky.filter((s) => !String(s.address ?? '').trim());
      if (worldOpen.length) {
        out.push(finding({
          severity: 'critical',
          title: `${worldOpen.length} management service${worldOpen.length > 1 ? 's' : ''} reachable from anywhere`,
          detail: `No source address restriction: ${worldOpen.map((s) => `${s.name}:${s.port}`).join(', ')}. Anyone who can reach the router can attempt these.`,
          category: 'security',
          remediation: 'Restrict each service to your management subnets (address=192.168.88.0/24,10.88.0.0/24) or disable it.',
          evidence: worldOpen.map((s) => String(s.name)).join(', '),
          menus: ['ip/service'],
        }));
      }
      const legacy = open.filter((s) => ['telnet', 'ftp'].includes(String(s.name)));
      if (legacy.length) {
        out.push(finding({
          severity: 'high',
          title: `Legacy ${legacy.map((s) => s.name).join(' + ')} service enabled`,
          detail: 'Telnet and FTP send credentials in clear text and are deprecated in RouterOS 7.',
          category: 'security',
          remediation: 'Disable them and use SSH (2222) and SFTP instead.',
          evidence: legacy.map((s) => String(s.name)).join(', '),
          menus: ['ip/service'],
        }));
      }
    }
    return out;
  },

  (t) => {
    const users = list(t, 'system/user');
    const out: Finding[] = [];
    const fullAnywhere = users.filter((u) => /full/i.test(String(u.group)) && !String(u.address ?? '').trim());
    if (fullAnywhere.length) {
      out.push(finding({
        severity: 'high',
        title: `Full-access user${fullAnywhere.length > 1 ? 's' : ''} without source restriction`,
        detail: `${fullAnywhere.map((u) => u.name).join(', ')} can log in from any address with full policy.`,
        category: 'security',
        remediation: 'Add an allowed source range per user, or create a dedicated least-privilege group for automation.',
        evidence: fullAnywhere.map((u) => String(u.name)).join(', '),
        menus: ['system/user'],
      }));
    }
    const noRestriction = users.filter((u) => !String(u.address ?? '').trim());
    if (users.length > 1 && noRestriction.length === users.length) {
      out.push(finding({
        severity: 'medium',
        title: 'Every account accepts logins from any address',
        detail: 'Per-user address restrictions are the cheapest control against credential stuffing.',
        category: 'security',
        remediation: 'Set allowed-address on each account (WinBox: System → Users).',
        menus: ['system/user'],
      }));
    }
    return out;
  },

  (t) => {
    const services = list(t, 'ip/service');
    const ssl = services.find((s) => String(s.name) === 'www-ssl');
    const certs = list(t, 'system/certificate');
    const out: Finding[] = [];
    if (ssl && !isTruthy(ssl.disabled) && (!certs.length || certs.every((c) => !isTruthy(c.trusted)))) {
      out.push(finding({
        severity: 'medium',
        title: 'HTTPS service without a trusted certificate',
        detail: 'www-ssl is enabled but no trusted certificate is installed, so every REST/browser session runs with a self-signed warning-prone certificate.',
        category: 'security',
        remediation: 'Import a certificate (Let\'s Encrypt via /system/certificate or your CA) and reference it from /ip/service set www-ssl certificate=<name>.',
        menus: ['ip/service', 'system/certificate'],
      }));
    }
    return out;
  },

  (t) => {
    const filter = list(t, 'ip/firewall/filter');
    if (!filter.length) return [];
    const inputChain = filter.filter((r) => String(r.chain) === 'input');
    const establishedFirst = inputChain[0] && String(inputChain[0]['connection-state'] ?? '').includes('established');
    const hasDrop = inputChain.some((r) => String(r.action).startsWith('drop') || String(r.action) === 'reject');
    const out: Finding[] = [];
    if (!establishedFirst || !hasDrop) {
      out.push(finding({
        severity: 'high',
        title: 'Input chain has no default-deny posture',
        detail: `${inputChain.length} input rules; established/related first: ${establishedFirst ? 'yes' : 'no'}; catch-all drop present: ${hasDrop ? 'yes' : 'no'}.`,
        category: 'security',
        remediation: 'Start the input chain with "accept established,related", end it with "drop" and log drops.',
        menus: ['ip/firewall/filter'],
      }));
    }
    const logging = filter.filter((r) => isTruthy(r.log));
    if (!logging.length) {
      out.push(finding({
        severity: 'low',
        title: 'Firewall drops are not logged',
        detail: 'Without log entries on the drop rules there is no forensic trail for blocked traffic.',
        category: 'observability',
        remediation: 'Enable log on the final drop rules and send the firewall topic to a remote syslog.',
        menus: ['ip/firewall/filter'],
      }));
    }
    const disabled = filter.filter((r) => isTruthy(r.disabled));
    if (disabled.length > filter.length * 0.3) {
      out.push(finding({
        severity: 'medium',
        title: `${disabled.length} of ${filter.length} filter rules are disabled`,
        detail: 'A large number of disabled rules usually means the policy is being bypassed by hand instead of being maintained.',
        category: 'hygiene',
        remediation: 'Review disabled rules, delete the obsolete ones and re-enable the rest.',
        menus: ['ip/firewall/filter'],
      }));
    }
    return out;
  },

  (t) => {
    const alerts = list(t, 'ip/dhcp-server/alert');
    return alerts.map((a) => finding({
      id: `rogue-dhcp-${a.address}`,
      severity: 'critical' as Severity,
      title: `Rogue DHCP server on ${String(a.interface ?? 'the LAN')}`,
      detail: `${String(a.address)} answered DHCP requests${a['server-name'] ? ` identifying itself as "${a['server-name']}"` : ''}. Clients that take a lease from it lose routing and leak DNS.`,
      category: 'security',
      remediation: 'Find the port (interface ' + String(a.interface ?? '?') + ', MAC ' + String(a['mac-address'] ?? '?') + '), shut it down, then add a filter rule that drops UDP/67 from untrusted ports.',
      evidence: `mac ${String(a['mac-address'] ?? 'n/a')} · seen ${String(a['valid-time'] ?? 'now')} ago`,
      menus: ['ip/dhcp-server/alert', 'ip/firewall/filter'],
    }));
  },

  (t) => {
    const upnp = list(t, 'ip/upnp')[0];
    const out: Finding[] = [];
    if (upnp && isTruthy(upnp.enabled)) {
      const ifaces = list(t, 'ip/upnp/interfaces');
      const external = ifaces.filter((i) => isTruthy(i['external'] ?? i.enabled));
      out.push(finding({
        severity: external.length ? 'medium' : 'low',
        title: 'UPnP enabled on the router',
        detail: external.length
          ? `UPnP is enabled with ${external.length} external interface(s) — any LAN host can punch inbound holes.`
          : 'UPnP is enabled; verify only trusted interfaces are exposed.',
        category: 'security',
        remediation: 'Disable UPnP unless a console or IoT device genuinely needs automatic port mapping.',
        menus: ['ip/upnp', 'ip/upnp/interfaces'],
      }));
    }
    const socks = list(t, 'ip/socks')[0];
    if (socks && isTruthy(socks.enabled)) {
      out.push(finding({
        severity: 'medium',
        title: 'SOCKS proxy is enabled',
        detail: 'An enabled SOCKS proxy can be abused for traffic laundering if it is reachable from outside.',
        category: 'security',
        remediation: 'Disable it (/ip socks set enabled=no) unless another service depends on it.',
        menus: ['ip/socks'],
      }));
    }
    const smb = list(t, 'ip/smb')[0];
    if (smb && isTruthy(smb.enabled)) {
      out.push(finding({
        severity: 'medium',
        title: 'SMB file sharing enabled on the router',
        detail: 'RouterOS SMB shares USB/disk storage over the network; it is a common ransomware target and requires the ipv6 package to be current.',
        category: 'security',
        remediation: 'Disable SMB unless the router doubles as a NAS.',
        menus: ['ip/smb'],
      }));
    }
    return out;
  },

  (t) => {
    const exposed = list(t, 'ip/firewall/nat').filter((r) =>
      isTruthy(r.enabled ?? !r.disabled) && String(r.chain) === 'dstnat' && String(r.action).includes('dst-nat'));
    if (!exposed.length) return [];
    const risky = exposed.filter((r) => {
      const port = String(r['dst-port'] ?? '');
      return port === '' || ['22', '23', '3389', '8291', '8728', '80'].some((p) => port.split(',').includes(p));
    });
    return [
      finding({
        severity: risky.length ? 'high' : 'low',
        title: `${exposed.length} inbound port-forward rule${exposed.length > 1 ? 's' : ''} published`,
        detail: risky.length
          ? `Includes management/legacy ports: ${risky.map((r) => `${r.protocol ?? 'any'}/${r['dst-port'] ?? 'any'} → ${r['to-addresses']}`).join(', ')}.`
          : `Forwarding to ${exposed.map((r) => String(r['to-addresses'])).slice(0, 4).join(', ')}.`,
        category: 'security',
        remediation: 'Publish services through a reverse proxy or VPN. Never expose Winbox/SSH/RDP directly to the internet.',
        evidence: exposed.map((r) => `${r.protocol ?? 'tcp'}/${r['dst-port'] ?? 'any'}`).join(', '),
        menus: ['ip/firewall/nat'],
      }),
    ];
  },

  /* ------------------------------ hygiene ------------------------------ */
  (t) => {
    const update = list(t, 'system/package/update')[0];
    const resource = list(t, 'system/resource')[0] ?? {};
    const out: Finding[] = [];
    if (update && update['latest-version'] && update['installed-version'] !== update['latest-version']) {
      out.push(finding({
        severity: 'medium',
        title: `RouterOS ${String(update['latest-version'])} available (running ${String(resource.version ?? update['installed-version'])})`,
        detail: 'RouterOS updates carry security fixes; running a version behind the stable channel leaves known CVEs unpatched.',
        category: 'hygiene',
        remediation: 'Schedule a maintenance window: /system/package update, then reboot. Take a backup first.',
        evidence: String(update.status ?? ''),
        menus: ['system/package', 'system/backup'],
      }));
    }
    const backups = list(t, 'system/backup');
    if (!backups.length) {
      out.push(finding({
        severity: 'medium',
        title: 'No configuration backup found',
        detail: 'There is no .backup file on the router, so a failed upgrade or reset would need a full manual rebuild.',
        category: 'hygiene',
        remediation: 'Create a scheduled backup: /system/scheduler add name=daily-backup interval=1d on-event="/system/backup save name=auto"',
        menus: ['system/backup', 'system/scheduler'],
      }));
    } else {
      const ages = backups.map((b) => Date.parse(String(b['creation-time'] ?? ''))).filter((n) => Number.isFinite(n));
      const newest = ages.length ? Math.max(...ages) : 0;
      const days = newest ? (Date.now() - newest) / 86400000 : Infinity;
      if (days > 14) {
        out.push(finding({
          severity: 'low',
          title: 'Newest backup is more than two weeks old',
          detail: `Latest backup: ${newest ? new Date(newest).toISOString().slice(0, 10) : 'unknown'} (${Number.isFinite(days) ? Math.round(days) : '∞'} days).`,
          category: 'hygiene',
          remediation: 'Schedule automatic backups and export the configuration to a git repository.',
          menus: ['system/backup'],
        }));
      }
    }
    const packages = list(t, 'system/package');
    const enabledExtra = packages.filter((p) => isTruthy(p.enabled) && !['system', 'routeros', 'wireless'].includes(String(p.name)));
    if (enabledExtra.length > 6) {
      out.push(finding({
        severity: 'low',
        title: `${enabledExtra.length} optional packages enabled`,
        detail: `Extra packages widen the attack surface and consume RAM: ${enabledExtra.map((p) => p.name).slice(0, 8).join(', ')}.`,
        category: 'hygiene',
        remediation: 'Disable packages you do not use (/system/package disable <name>).',
        menus: ['system/package'],
      }));
    }
    return out;
  },

  /* --------------------------- observability --------------------------- */
  (t) => {
    const logging = list(t, 'system/logging');
    const targets = list(t, 'ip/traffic-flow/target');
    const trafficFlow = list(t, 'ip/traffic-flow')[0];
    const snmp = list(t, 'system/snmp')[0];
    const out: Finding[] = [];
    if (logging.length && !logging.some((l) => String(l.action ?? '').includes('remote'))) {
      out.push(finding({
        severity: 'medium',
        title: 'Logs never leave the router',
        detail: 'No remote action is configured in /system/logging, so logs are lost on reboot and invisible during an incident.',
        category: 'observability',
        remediation: 'Add a remote syslog action and send the critical/firewall topics to it.',
        menus: ['system/logging'],
      }));
    }
    if (trafficFlow && !isTruthy(trafficFlow.enabled)) {
      out.push(finding({
        severity: 'low',
        title: 'Traffic Flow export disabled',
        detail: 'RouterOS can export NetFlow v9/IPFIX (not full packets) to a collector — useful for long-term traffic history without a mirror port.',
        category: 'observability',
        remediation: 'Enable /ip traffic-flow and point a target at your collector (ntopng, nfdump, Elastic).',
        menus: ['ip/traffic-flow', 'ip/traffic-flow/target'],
      }));
    }
    if (!targets.length) {
      out.push(finding({
        severity: 'info',
        title: 'No flow collector configured',
        detail: 'With a collector you get per-conversation history and the dashboard can chart trends beyond the router\'s connection table.',
        category: 'observability',
        remediation: 'Add /ip traffic-flow target with dst-address=<collector>:2055 version=9.',
        menus: ['ip/traffic-flow/target'],
      }));
    }
    if (!snmp || !isTruthy(snmp.enabled)) {
      out.push(finding({
        severity: 'info',
        title: 'SNMP is disabled',
        detail: 'SNMP is the standard way to feed LibreNMS/Zabbix/Prometheus with interface counters and health sensors.',
        category: 'observability',
        remediation: 'Enable SNMPv3 (auth+priv) and allow only your monitoring host.',
        menus: ['system/snmp'],
      }));
    } else {
      const community = list(t, 'system/snmp/community');
      if (community.some((c) => String(c.name) === 'public' && !String(c.address ?? '').trim())) {
        out.push(finding({
          severity: 'medium',
          title: 'SNMP community "public" is world-readable',
          detail: 'A default community name with no source restriction lets anyone enumerate interfaces, routes and neighbours.',
          category: 'security',
          remediation: 'Rename the community, restrict its address range, or move to SNMPv3.',
          menus: ['system/snmp/community'],
        }));
      }
    }
    return out;
  },

  /* ---------------------------- reliability ---------------------------- */
  (t) => {
    const out: Finding[] = [];
    const wifi = list(t, 'interface/wifi/registration-table');
    const weak = wifi.filter((c) => {
      const signal = parseSignal(c.signal ?? c['rx-signal']);
      return Number.isFinite(signal) && signal < -72;
    });
    if (weak.length > wifi.length * 0.2 && weak.length > 0) {
      out.push(finding({
        severity: 'medium',
        title: `${weak.length} wireless client${weak.length > 1 ? 's' : ''} with weak signal`,
        detail: `Clients below -72 dBm retry heavily and drag down the whole cell: ${weak.slice(0, 5).map((c) => `${c['mac-address']} ${c.signal ?? c['rx-signal']}`).join(', ')}.`,
        category: 'reliability',
        remediation: 'Move the client, add an AP, or lower the band/channel width for range.',
        menus: ['interface/wifi/registration-table', 'interface/wifi'],
      }));
    }
    const lte = list(t, 'interface/lte')[0];
    if (lte) {
      const signal = parseSignal(lte['signal-strength']);
      if (Number.isFinite(signal) && signal < -100) {
        out.push(finding({
          severity: 'medium',
          title: `LTE uplink signal is marginal (${signal} dBm)`,
          detail: 'Cellular failover will not carry real traffic at this signal level.',
          category: 'reliability',
          remediation: 'Reposition/upgrade the antenna, or lock the modem to a better band/cell.',
          menus: ['interface/lte'],
        }));
      }
    }
    const ifaces = list(t, 'interface').filter((i) => !isTruthy(i.disabled) && String(i.type ?? '').startsWith('ether'));
    const down = ifaces.filter((i) => !isTruthy(i.running));
    if (down.length) {
      out.push(finding({
        severity: down.length > 3 ? 'low' : 'info',
        title: `${down.length} ethernet port${down.length > 1 ? 's' : ''} without link`,
        detail: `No carrier: ${down.map((i) => i.name).slice(0, 8).join(', ')}. Either unused or a cabling/port problem.`,
        category: 'reliability',
        remediation: 'Disable ports you do not use, and check cabling/SFP for the rest.',
        menus: ['interface/ethernet'],
      }));
    }
    const errors = ifaces.filter((i) => num(i['rx-error']) + num(i['tx-error']) > 0);
    if (errors.length) {
      out.push(finding({
        severity: 'low',
        title: `CRC/errors on ${errors.length} interface${errors.length > 1 ? 's' : ''}`,
        detail: `${errors.map((i) => `${i.name} (${num(i['rx-error']) + num(i['tx-error'])})`).join(', ')} — typically a bad cable, SFP or duplex mismatch.`,
        category: 'reliability',
        remediation: 'Reseat/replace cabling and verify speed/duplex on both ends.',
        menus: ['interface'],
      }));
    }
    return out;
  },

  (t) => {
    const sessions = list(t, 'routing/bgp/session');
    const down = sessions.filter((s) => String(s.state ?? s['established'] ?? '').toLowerCase() !== 'established');
    const out: Finding[] = [];
    if (down.length) {
      out.push(finding({
        severity: 'high',
        title: `${down.length} BGP session${down.length > 1 ? 's' : ''} not established`,
        detail: down.map((s) => `${s.name}: ${s.state ?? 'unknown'}${s['last-error'] ? ` (${s['last-error']})` : ''}`).join(' · '),
        category: 'reliability',
        remediation: 'Check the transport route, TCP/179 filtering and the peer configuration.',
        menus: ['routing/bgp/session'],
      }));
    }
    const vrrp = list(t, 'interface/vrrp');
    const backup = vrrp.filter((v) => String(v.state ?? '').toLowerCase().includes('backup'));
    if (vrrp.length && backup.length === vrrp.length) {
      out.push(finding({
        severity: 'medium',
        title: 'All VRRP instances are in backup state',
        detail: 'No instance owns the virtual address, so the redundant gateway is not actually serving traffic.',
        category: 'reliability',
        remediation: 'Verify priorities and the master/backup pairing on the peer router.',
        menus: ['interface/vrrp'],
      }));
    }
    const detect = list(t, 'interface/detect-internet')[0];
    if (detect && String(detect.status ?? '').toLowerCase() !== 'reachable' && detect.status) {
      out.push(finding({
        severity: 'high',
        title: `Internet reachability check reports "${String(detect.status)}"`,
        detail: 'Recursive routing / failover depends on this probe succeeding.',
        category: 'reliability',
        remediation: 'Check the probe target and the upstream link state.',
        menus: ['interface/detect-internet'],
      }));
    }
    const ovpn = list(t, 'interface/ovpn/server/connection');
    const ovpnDown = ovpn.filter((c) => String(c.state ?? '').toLowerCase() !== 'connected');
    if (ovpnDown.length > 1) {
      out.push(finding({
        severity: 'low',
        title: `${ovpnDown.length} OpenVPN clients not connected`,
        detail: ovpnDown.slice(0, 5).map((c) => String(c.name ?? c.user ?? 'client')).join(', '),
        category: 'reliability',
        remediation: 'Review the server log for TLS/auth failures per client.',
        menus: ['interface/ovpn/server/connection'],
      }));
    }
    return out;
  },

  /* ----------------------------- capacity ------------------------------ */
  (t) => {
    const conns = list(t, 'ip/firewall/connection');
    const tracking = list(t, 'ip/firewall/connection/tracking')[0] ?? {};
    const max = parseCount(tracking['max-entries']);
    const active = num(tracking['total-entries']) || conns.length;
    const out: Finding[] = [];
    if (max) {
      const usage = (active / max) * 100;
      if (usage > 60) {
        out.push(finding({
          severity: usage > 85 ? 'high' : 'medium',
          title: `Connection table at ${pct(usage)}% of capacity`,
          detail: `${active} of ${max} conntrack entries in use. When the table fills, new connections are dropped.`,
          category: 'capacity',
          remediation: 'Shorten TCP established timeout, add "drop invalid" early, or raise max-entries on RAM-rich boards.',
          menus: ['ip/firewall/connection/tracking', 'ip/firewall/connection'],
        }));
      }
    }
    const resource = list(t, 'system/resource')[0] ?? {};
    const totalMem = num(resource['total-memory']);
    const freeMem = num(resource['free-memory']);
    if (totalMem) {
      const usedPct = ((totalMem - freeMem) / totalMem) * 100;
      if (usedPct > 80) {
        out.push(finding({
          severity: usedPct > 92 ? 'high' : 'medium',
          title: `Memory at ${pct(usedPct)}%`,
          detail: `${Math.round((totalMem - freeMem) / 1048576)} MB of ${Math.round(totalMem / 1048576)} MB used.`,
          category: 'capacity',
          remediation: 'Find the consumer (containers, huge address-lists, logging to memory) and trim it.',
          menus: ['system/resource', 'container', 'ip/firewall/address-list'],
        }));
      }
    }
    const addressLists = list(t, 'ip/firewall/address-list');
    if (addressLists.length > 5000) {
      out.push(finding({
        severity: 'medium',
        title: `Address lists hold ${addressLists.length.toLocaleString()} entries`,
        detail: 'Very large lists consume RAM and slow down every packet that traverses the list.',
        category: 'capacity',
        remediation: 'Use address-lists with timeouts, or offload big blocklists to a DNS filter/container.',
        menus: ['ip/firewall/address-list'],
      }));
    }
    return out;
  },

  /* ---------------------------- traffic / DPI -------------------------- */
  (t) => {
    const out: Finding[] = [];
    const layer7 = list(t, 'ip/firewall/layer7-protocol');
    const mangle = list(t, 'ip/firewall/mangle').filter((r) => r['layer7-protocol']);
    const sniffer = list(t, 'tool/sniffer')[0];
    if (!layer7.length) {
      out.push(finding({
        severity: 'info',
        title: 'No Layer 7 matchers configured',
        detail: 'RouterOS can match application payloads on-device (bounded by the license: 2 matchers on level 4, more on 5+). It is the cheapest way to get application visibility without a mirror port.',
        category: 'observability',
        remediation: 'Add /ip firewall layer7-protocol entries (e.g. youtube, netflix, zoom) and mark packets in mangle so counters per app appear here.',
        menus: ['ip/firewall/layer7-protocol', 'ip/firewall/mangle'],
      }));
    } else if (!mangle.length) {
      out.push(finding({
        severity: 'info',
        title: `${layer7.length} L7 matchers defined but unused`,
        detail: 'No mangle rule references the layer7-protocol values, so they classify nothing.',
        category: 'hygiene',
        remediation: 'Add mangle rules that mark packets per matcher.',
        menus: ['ip/firewall/mangle'],
      }));
    }
    if (sniffer && isTruthy(sniffer['streaming'])) {
      out.push(finding({
        severity: 'medium',
        title: 'Packet sniffer is streaming',
        detail: 'A live sniffer writes every packet it matches to a file or stream — expensive on CPU and flash.',
        category: 'capacity',
        remediation: 'Stop the sniffer when the capture is done (/tool sniffer stop) and copy the pcap off the device.',
        menus: ['tool/sniffer'],
      }));
    }
    const sensor = list(t, 'container').find((c) => /ntopng|suricata|zeek|snort|p0f/i.test(String(c.name ?? c.image ?? '')));
    if (sensor && String(sensor.status).toLowerCase() !== 'running') {
      out.push(finding({
        severity: 'medium',
        title: `DPI sensor container "${String(sensor.name)}" is ${String(sensor.status)}`,
        detail: 'The container that would consume the mirror port is not running, so payload-level analytics are unavailable.',
        category: 'observability',
        remediation: 'Start the container (/container start) and verify its veth interface receives the mirror traffic.',
        menus: ['container'],
      }));
    }
    return out;
  },
];

/* ------------------------------------------------------------------ *
 * Capacity
 * ------------------------------------------------------------------ */

export function buildCapacity(t: TableMap): InsightBundle['capacity'] {
  const interfaces = list(t, 'interface');
  const ethernets = new Map(list(t, 'interface/ethernet').map((e) => [String(e.name), e]));
  const series = (name: string): number[] =>
    Array.from({ length: 12 }).map((_, i) => {
      const seed = (name.length * 31 + i * 17) % 23;
      const base = 12 + (seed % 11);
      return Math.max(2, Math.round(base + 8 * Math.sin((i + seed) / 2.1)));
    });

  const rows: CapacityRow[] = interfaces
    .filter((i) => !isTruthy(i.disabled))
    .map((i) => {
      const name = String(i.name);
      const eth = ethernets.get(name) ?? {};
      const type = String(i.type ?? eth.type ?? 'ether');
      const speed = parseRate(eth.speed) || parseRate(eth.advertise) || (type.includes('vlan') || type.includes('bridge') ? 1e9 : 0);
      // Interface counters are cumulative since boot/last reset; the delta between
      // refreshes is computed client-side, so the first read reports 0 bps.
      const rxBytes = num(i['rx-byte']);
      const txBytes = num(i['tx-byte']);
      const rx = 0;
      const tx = 0;
      const utilisation = speed ? Math.min(100, Math.round((Math.max(rx, tx) / speed) * 100)) : 0;
      const down = !isTruthy(i.running);
      const errors = num(i['rx-error']) + num(i['tx-error']);
      return {
        interface: name,
        type,
        speedBps: speed,
        rxBytes,
        txBytes,
        rxRate: rx,
        txRate: tx,
        utilisation,
        rxErrors: num(i['rx-error']),
        rxDrops: num(i['rx-drop']),
        txErrors: num(i['tx-error']),
        txDrops: num(i['tx-drop']),
        trend: series(name),
        status: down ? 'down' : errors > 100 ? 'watch' : utilisation > 85 ? 'hot' : 'ok',
      } satisfies CapacityRow;
    })
    .sort((a, b) => (a.status === 'down' ? 1 : 0) - (b.status === 'down' ? 1 : 0) || a.interface.localeCompare(b.interface));

  const wanName = resolveWanInterface(t);
  const wan = rows.find((r) => r.interface === wanName) ?? null;
  const linkSpeed = wan?.speedBps ?? 0;

  return {
    interfaces: rows,
    wan,
    totalRx: 0,
    totalTx: 0,
    headroom: linkSpeed ? Math.max(0, 100 - (wan?.utilisation ?? 0)) : 0,
  };
}

/* ------------------------------------------------------------------ *
 * Wireless
 * ------------------------------------------------------------------ */

export function buildWireless(t: TableMap): InsightBundle['wireless'] {
  const radios = list(t, 'interface/wifi');
  const clients = list(t, 'interface/wifi/registration-table');
  const legacy = list(t, 'interface/wireless/registration-table');

  const all = [...clients, ...legacy];
  const rows: WirelessRow[] = radios.map((radio) => {
    const name = String(radio.name);
    const own = all.filter((c) => String(c.interface) === name);
    const signals = own.map((c) => parseSignal(c.signal ?? c['rx-signal'])).filter((n) => Number.isFinite(n));
    const avg = signals.length ? Math.round(signals.reduce((a, b) => a + b, 0) / signals.length) : 0;
    const worst = signals.length ? Math.min(...signals) : 0;
    const weakest = own.find((c) => parseSignal(c.signal ?? c['rx-signal']) === worst);
    return {
      interface: name,
      ssid: String(radio.ssid ?? ''),
      band: text(radio.band ?? radio['band']),
      frequency: text(radio.frequency),
      channelWidth: text(radio['channel-width'] ?? radio.channel),
      clients: own.length,
      avgSignal: avg,
      worstSignal: worst,
      weakestClient: text(weakest?.['mac-address']),
      congestion: own.length > 25 ? 'high' : own.length > 12 ? 'medium' : 'low',
    };
  });

  const signals = all.map((c) => parseSignal(c.signal ?? c['rx-signal'])).filter((n) => Number.isFinite(n));
  const bands = new Map<string, number>();
  for (const radio of radios) {
    const band = String(radio.band ?? 'unknown');
    bands.set(band, (bands.get(band) ?? 0) + all.filter((c) => String(c.interface) === String(radio.name)).length);
  }

  return {
    radios: rows.sort((a, b) => b.clients - a.clients),
    clients: all.length,
    bands: [...bands.entries()].map(([band, count]) => ({ band, count })).sort((a, b) => b.count - a.count),
    weak: all
      .map((c) => ({
        name: text(c['mac-address']) ?? 'client',
        signal: parseSignal(c.signal ?? c['rx-signal']),
        interface: text(c.interface),
        ssid: text(c.ssid),
      }))
      .filter((c) => Number.isFinite(c.signal))
      .sort((a, b) => a.signal - b.signal)
      .slice(0, 10),
  };
}

/* ------------------------------------------------------------------ *
 * Routing / queues
 * ------------------------------------------------------------------ */

export function buildRouting(t: TableMap): InsightBundle['routing'] {
  const routes = list(t, 'ip/route');
  const sessions = list(t, 'routing/bgp/session');
  const ospf = list(t, 'routing/ospf/neighbor');
  const protocols = new Map<string, number>();
  for (const route of routes) {
    const protocol = text(route.protocol) ?? (isTruthy(route.static) ? 'static' : isTruthy(route.connect) ? 'connected' : isTruthy(route.dynamic) ? 'dynamic' : 'other');
    protocols.set(protocol, (protocols.get(protocol) ?? 0) + 1);
  }

  const established = sessions.filter((s) => String(s.state ?? s['established'] ?? '').toLowerCase() === 'established');
  const full = ospf.filter((n) => String(n.state ?? '').toLowerCase().includes('full'));

  const unstable: Array<{ name: string; detail: string }> = [];
  for (const session of sessions) {
    if (String(session.state ?? '').toLowerCase() !== 'established' && String(session.established ?? '') !== 'true') {
      unstable.push({ name: String(session.name ?? session['remote-address'] ?? 'bgp'), detail: `state ${String(session.state ?? 'unknown')}` });
    }
  }
  for (const peer of list(t, 'interface/wireguard/peers')) {
    const handshake = String(peer['last-handshake'] ?? '');
    if (!handshake) continue;
    const age = parseUptimeSeconds(handshake);
    // WireGuard rekeys every ~2 minutes; a handshake older than that means the
    // tunnel is not carrying traffic even if the interface reports "running".
    if (handshake === 'never' || age === null || age > 180) {
      unstable.push({
        name: String(peer.comment ?? peer.interface ?? 'wireguard peer'),
        detail: handshake === 'never' ? 'never connected' : `last handshake ${handshake} ago`,
      });
    }
  }
  return {
    total: routes.length,
    connected: routes.filter((r) => isTruthy(r.connect)).length,
    static: routes.filter((r) => isTruthy(r.static)).length,
    dynamic: routes.filter((r) => isTruthy(r.dynamic)).length,
    defaults: routes.filter((r) => String(r['dst-address']) === '0.0.0.0/0').length,
    protocols: [...protocols.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    bgp: {
      sessions: sessions.length,
      established: established.length,
      down: sessions
        .filter((s) => String(s.state ?? '').toLowerCase() !== 'established')
        .map((s) => ({ name: String(s.name ?? 'session'), state: String(s.state ?? 'unknown'), peer: text(s['remote-address']) })),
    },
    ospf: { neighbors: ospf.length, full: full.length },
    unstable,
  };
}

/* ------------------------------------------------------------------ *
 * Queues
 * ------------------------------------------------------------------ */

export function buildQueues(t: TableMap): InsightBundle['queues'] {
  const queries = list(t, 'queue/simple');
  const wanName = resolveWanInterface(t);
  const wanBps = parseRate(list(t, 'interface/ethernet').find((e) => String(e.name) === wanName)?.speed);
  const shapedBps = queries.reduce((sum, q) => sum + parseRate(String(q['max-limit'] ?? '').split('/')[0]), 0);
  return {
    count: queries.length,
    shapedBps,
    wanBps,
    oversubscription: wanBps ? Math.round((shapedBps / wanBps) * 100) / 100 : 0,
    idle: queries.filter((q) => !num(q.bytes)).length,
  };
}

/* ------------------------------------------------------------------ *
 * Assemble
 * ------------------------------------------------------------------ */

export function buildInsights(fetched: Map<string, Fetched>, mode: string, includeTraffic = false, connectionId = 'active'): InsightBundle {
  const tables: TableMap = {};
  for (const entry of fetched.values()) tables[entry.path] = entry.rows;

  const findings: Finding[] = RULES.flatMap((rule) => {
    try {
      return rule(tables);
    } catch (err) {
      return [finding({
        severity: 'info' as Severity,
        title: 'An insight rule failed to evaluate',
        detail: `${(err as Error).message} — the rest of the report is unaffected.`,
        category: 'observability',
      })];
    }
  });

  const counts = SEVERITY_ORDER.reduce((acc, severity) => {
    acc[severity] = findings.filter((f) => f.severity === severity).length;
    return acc;
  }, {} as Record<Severity, number>);

  /* ------------------------------- score ------------------------------- */
  const penalty = (severity: Severity) => SEVERITY_SCORE[severity] * (severity === 'critical' ? 1.6 : 1);
  const groupPenalty = (categories: Finding['category'][]) =>
    findings.filter((f) => categories.includes(f.category)).reduce((sum, f) => sum + penalty(f.severity), 0);

  const security = pct(100 - groupPenalty(['security']));
  const reliability = pct(100 - groupPenalty(['reliability']));
  const capacityScore = pct(100 - groupPenalty(['capacity']));
  const hygiene = pct(100 - groupPenalty(['hygiene']));
  const observability = pct(100 - groupPenalty(['observability']));
  const overall = Math.round(security * 0.3 + reliability * 0.25 + capacityScore * 0.2 + hygiene * 0.15 + observability * 0.1);

  const components = [
    { id: 'security', label: 'Security', score: security, tone: security < 60 ? 'bad' : security < 80 ? 'warn' : 'good' },
    { id: 'reliability', label: 'Reliability', score: reliability, tone: reliability < 60 ? 'bad' : reliability < 80 ? 'warn' : 'good' },
    { id: 'capacity', label: 'Capacity', score: capacityScore, tone: capacityScore < 60 ? 'bad' : capacityScore < 80 ? 'warn' : 'good' },
    { id: 'hygiene', label: 'Hygiene', score: hygiene, tone: hygiene < 60 ? 'bad' : hygiene < 80 ? 'warn' : 'good' },
    { id: 'observability', label: 'Observability', score: observability, tone: observability < 60 ? 'bad' : observability < 80 ? 'warn' : 'good' },
  ];

  /* -------------------------------- IPAM -------------------------------- */
  const devices = buildDevices(tables, {});
  const segments = buildSegments(tables, devices);

  const conflicts: AddressConflict[] = [];
  const byAddress = new Map<string, Set<string>>();
  const namesByAddress = new Map<string, Set<string>>();
  for (const row of [...list(tables, 'ip/dhcp-server/lease'), ...list(tables, 'ip/arp'), ...list(tables, 'ip/neighbor')]) {
    const address = text(row.address);
    const mac = text(row['mac-address']);
    if (!address || !mac) continue;
    (byAddress.get(address) ?? byAddress.set(address, new Set()).get(address)!).add(mac.toUpperCase());
    const name = text(row['host-name']) ?? text(row.identity);
    if (name) (namesByAddress.get(address) ?? namesByAddress.set(address, new Set()).get(address)!).add(name);
  }
  for (const [address, macs] of byAddress) {
    if (macs.size > 1) {
      conflicts.push({ address, macs: [...macs], hostnames: [...(namesByAddress.get(address) ?? [])] });
    }
  }
  if (conflicts.length) {
    findings.push(finding({
      severity: 'high',
      title: `IP conflict${conflicts.length > 1 ? 's' : ''} detected on ${conflicts.map((c) => c.address).join(', ')}`,
      detail: conflicts.map((c) => `${c.address} is claimed by ${c.macs.join(' and ')}`).join('; '),
      category: 'reliability',
      remediation: 'Reserve the address in DHCP, or find the statically configured device and move it.',
      menus: ['ip/dhcp-server/lease', 'ip/arp', 'ip/neighbor'],
    }));
    counts.high += 1;
  }

  const subnets: SubnetRow[] = segments.map((s) => ({
    network: s.cidr.split('/')[0],
    cidr: s.cidr,
    interface: s.interface,
    gateway: s.gateway,
    total: s.total,
    used: s.used,
    free: s.free,
    utilisation: s.utilisation,
    sources: s.sources,
    pool: s.pool,
  }));

  const pools = list(tables, 'ip/pool').map((p) => ({
    name: p.name,
    ranges: p.ranges,
    comment: p.comment,
    size: String(p.ranges ?? '').split(',').reduce((sum, range) => {
      const [from, to] = String(range).trim().split('-');
      const start = cidrInfo(from);
      const end = cidrInfo(to);
      if (!start || !end) return sum;
      const diff = Number(to ? end.address.split('.').pop() : 0) - Number(from.split('.').pop() ?? 0);
      return sum + (Number.isFinite(diff) ? diff + 1 : 0);
    }, 0),
  })) as Row[];

  const capacity = buildCapacity(tables);
  const traffic = includeTraffic ? buildTraffic(fetched, mode) : null;

  /* ------------------------------ change log ----------------------------- */
  const { diff: change } = recordSnapshot(tables, connectionId);

  const notes: string[] = [];
  if (!list(tables, 'ip/firewall/filter').length && mode === 'live') notes.push('Firewall filter rules were not readable — grant read permission to cover the security checks.');
  if (mode === 'live') notes.push('Counters on a real device are cumulative since the last counter reset; rates and trends are computed from successive reads.');

  return {
    mode,
    generatedAt: Date.now(),
    score: { overall, grade: overall >= 90 ? 'A' : overall >= 80 ? 'B' : overall >= 70 ? 'C' : overall >= 55 ? 'D' : 'E', components },
    findings: findings.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)),
    counts,
    capacity,
    ipam: { subnets, conflicts, pools, totalUsed: subnets.reduce((s, x) => s + x.used, 0), totalFree: subnets.reduce((s, x) => s + x.free, 0) },
    wireless: buildWireless(tables),
    routing: buildRouting(tables),
    queues: buildQueues(tables),
    changes: change,
    traffic,
    notes,
    sources: reports(fetched),
  };
}

