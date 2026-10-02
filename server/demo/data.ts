import { ENDPOINTS } from '../../shared/catalog';
import type { EndpointDef, FieldDef, Row } from '../../shared/types';
import { chance, duration, hex, hash, int, mac, pick, rng, routerosDate, timeString, dateTimeString, type Rnd } from './random';

/**
 * Hand-written demo data for the "hero" menus plus a metadata-driven generator that
 * fills in every remaining catalogued endpoint with plausible content.
 */

export interface DemoState {
  tables: Record<string, Row[]>;
  /** Per-row creation timestamps (seconds ago) so uptimes keep ticking. */
  bornAt: Record<string, Record<string, number>>;
}

let idCounter = 0;
const nextId = () => `*${(++idCounter).toString(16).toUpperCase()}`;

const LAN = '192.168.88';
const GUEST = '10.10.10';
const WAN = '100.64.12';

const people = ['ama', 'kofi', 'yaw', 'nadia', 'sam', 'chris', 'lena', 'tunde', 'maya', 'raul', 'sara', 'ibrahim', 'grace', 'peter', 'nina', 'omar'];
const hosts = ['iphone', 'galaxy-s23', 'macbook-pro', 'thinkpad', 'tv-lg', 'ps5', 'printer-hp', 'nest-thermostat', 'ipad-air', 'raspberrypi', 'xbox', 'cctv-dvr', 'echo-dot', 'desktop-win', 'pixel-8', 'roku'];
const comments = ['managed by dashboard', 'provisioned 2024', 'do not remove', 'guest network', 'vendor default', 'ticket #4471', 'audit 2025', 'uplink', ''];

export function buildState(): DemoState {
  idCounter = 0;
  const t: Record<string, Row[]> = {};
  const born: Record<string, Record<string, number>> = {};
  const now = Math.floor(Date.now() / 1000);

  const R = (path: string, o: Row, ageSec = 0): Row => {
    const id = nextId();
    (born[path] ||= {})[id] = now - ageSec;
    t[path] ||= [];
    t[path].push({ '.id': id, ...o });
    return t[path][t[path].length - 1];
  };

  /* ------------------------- SYSTEM ------------------------- */
  t['system/identity'] = [{ name: 'MikroTik-CCR-Accra' }];
  t['system/clock'] = [{ time: timeString(), date: routerosDate(0).toLowerCase(), 'time-zone-name': 'Africa/Accra', 'gmt-offset': '00:00', 'dst-active': false }];
  t['system/resource'] = [{
    uptime: `${14}d${6}h${22}m`, version: '7.16.2 (stable)', 'build-time': '2025-09-18 09:12:41',
    'factory-software': '6.48.6', 'free-memory': 1284562944, 'total-memory': 2147483648,
    cpu: 'ARM64', 'cpu-count': 4, 'cpu-frequency': 1400, 'cpu-load': 12,
    'free-hdd-space': 98304000, 'total-hdd-space': 134217728, 'write-sect-since-reboot': 18244,
    'write-sect-total': 918273, 'bad-blocks': 0, 'architecture-name': 'arm64', 'board-name': 'CCR2004-1G-12S+2XS',
    platform: 'MikroTik', 'cpu-mode': 'auto',
  }];
  t['system/routerboard'] = [{ routerboard: true, model: 'CCR2004-1G-12S+2XS', 'serial-number': 'HHX08ZKQ4R2', 'firmware-type': 'ipq4019L', 'factory-firmware': '7.1.3', 'current-firmware': '7.16.2', 'upgrade-firmware': '7.17.1', revision: 'r0' }];
  t['system/health'] = [
    { name: 'temperature', value: '41', type: 'C' },
    { name: 'cpu-temperature', value: '52', type: 'C' },
    { name: 'board-temperature1', value: '38', type: 'C' },
    { name: 'voltage', value: '24.1', type: 'V' },
    { name: 'power-consumption', value: '18.4', type: 'W' },
    { name: 'fan1-speed', value: '3480', type: 'RPM' },
    { name: 'fan2-speed', value: '3520', type: 'RPM' },
    { name: 'psu1-state', value: 'ok', type: 'state' },
  ];
  t['system/package'] = [
    { name: 'routeros', version: '7.16.2', 'build-time': '2025-09-18 09:12:41', scheduled: '' },
    { name: 'system', version: '7.16.2', scheduled: '' },
    { name: 'wireless', version: '7.16.2', scheduled: '' },
    { name: 'security', version: '7.16.2', scheduled: '' },
    { name: 'container', version: '7.16.2', scheduled: '' },
    { name: 'iot', version: '7.16.2', scheduled: '' },
    { name: 'usermanager', version: '7.16.2', scheduled: '' },
    { name: 'lora', version: '7.16.2', disabled: true },
  ];
  t['system/license'] = [{ 'software-id': 'K9X2-7QPL-3M8A-ZR4T', 'license-level': '6', nlevel: '6', deadline: '' }];
  t['system/device-mode'] = [{ mode: 'advanced', container: 'yes', scheduler: 'yes', fetch: 'yes', hotspot: 'yes', lte: 'yes', mpls: 'yes', partition: 'yes', romon: 'yes', proxy: 'yes', sniffer: 'yes', zerotier: 'yes' }];
  t['system/note'] = [{ note: 'Core router — Accra POP.\nManaged from the RouterOS Control Plane dashboard.\nEscalation: noc@example.net' }];
  t['system/watchdog'] = [{ 'watch-address': `${WAN}.1`, 'watchdog-timer': false, 'automatic-sup-out': false, 'ping-start-after-boot': '5m', 'ping-timeout': '60s', 'no-ping-delay': '5m' }];
  t['system/ups'] = [{ name: 'ups1', port: 'usb1', alarm: '', 'check-type': 'simple', mode: 'standalone', 'on-line': '1h4m20s', 'off-line': '', 'min-runtime': '5m', 'alarm-low-battery': '' }];
  t['system/routerboard/settings'] = [{ 'auto-upgrade': true, 'baud-rate': '115200', 'boot-delay': '2s', 'boot-device': 'nand-only', 'protected-routerboot': false, 'cpu-frequency': 'auto', 'cpu-mode': 'auto', 'silent-boot': false, 'preboot-etherboot': 'none' }];
  t['system/identity/settings'] = [{ 'system-name': 'MikroTik-CCR-Accra', 'hide-sensitive': true }];
  t['system/certificate/settings'] = [{ 'crl-download': 'no', 'crl-store': 'ram', 'crl-use': 'no', 'builtin-trust-anchors': 'all' }];
  t['system/console'] = [{ 'line-count': 24, columns: 80, 'sanitize-names': 'yes', 'pause-after': 0 }];
  t['system/upgrade'] = [{ 'installed-version': '7.16.2', 'latest-version': '7.17.1', status: 'New version is available', channel: 'stable' }];
  t['system/user/settings'] = [{ 'minimum-password-length': 8, 'allow-remote-requests': true, 'force-password-change': false }];

  t['system/ntp/client'] = [{ enabled: true, mode: 'unicast', servers: 'time.cloudflare.com,pool.ntp.org', 'server-dns-names': 'time.cloudflare.com', 'freq-drift': '3.211', status: 'synchronized', 'last-adjustment': `${int(120, 900, rng(1))}s`, 'last-bad-packet': '', 'poll-interval': '00:16:00' }];
  t['system/snmp'] = [{ enabled: true, contact: 'noc@example.net', location: 'Accra POP, Rack 4', 'trap-community': 'public', 'trap-version': '2', 'trap-generators': 'temperature', 'trap-interfaces': '', 'authentication-protocol': 'MD5', 'encryption-protocol': 'DES', 'engine-id': '80003A8C04' }];
  t['system/snmp/community'] = [
    R('system/snmp/community', { name: 'public', address: '0.0.0.0/0', 'read-access': true, 'write-access': false, 'security-options': 'authentication' }),
    R('system/snmp/community', { name: 'monitoring', address: `${LAN}.0/24`, 'read-access': true, 'write-access': false, 'security-options': 'authentication,encryption' }),
  ];

  t['system/user'] = [
    { name: 'admin', group: 'full', address: '0.0.0.0/0', 'last-logged-in': '2026-10-02 08:14:02', comment: 'primary' },
    { name: 'noc', group: 'write', address: `${LAN}.0/24`, 'last-logged-in': '2026-10-01 21:44:11', comment: 'NOC team' },
    { name: 'monitoring', group: 'read', address: `${LAN}.0/24`, 'last-logged-in': '2026-10-02 09:59:31', comment: 'SNMP/REST reader' },
    { name: 'automation', group: 'api', address: `${LAN}.0/24`, comment: 'rest-api service account' },
  ];
  t['system/user/group'] = [
    { name: 'read', policy: 'local,telnet,ssh,reboot,read,test,winbox,password,web,sniff,sensitive,api,romon,rest-api', system: 'routeros' },
    { name: 'write', policy: 'local,telnet,ssh,reboot,read,write,test,winbox,password,web,sniff,sensitive,api,romon,rest-api', system: 'routeros' },
    { name: 'full', policy: 'local,telnet,ssh,ftp,reboot,read,write,policy,test,winbox,password,web,sniff,sensitive,api,romon,rest-api', system: 'routeros' },
    { name: 'api', policy: 'read,write,api,rest-api,test', system: 'routeros' },
  ];
  t['system/user/active'] = [
    { name: 'admin', address: `${LAN}.44`, via: 'winbox', 'when': '8m12s', group: 'full' },
    { name: 'noc', address: `${LAN}.19`, via: 'ssh', 'when': '1h22m4s', group: 'write' },
    { name: 'monitoring', address: `${LAN}.7`, via: 'api', 'when': '3h2m56s', group: 'read' },
  ];

  t['system/scheduler'] = [
    R('system/scheduler', { name: 'daily-backup', 'start-date': '2025-01-04', 'start-time': '03:00:00', interval: '1d', 'on-event': 'backup', event: '/system backup save name=auto-daily', 'run-count': '271', 'next-run': `${routerosDate(1)} 03:00:00`, policy: 'read,write,policy,test', comment: 'nightly config backup' }, 3600),
    R('system/scheduler', { name: 'check-updates', 'start-date': '2025-02-11', 'start-time': '05:30:00', interval: '1d', 'on-event': 'check-for-updates', event: '/system package update check-for-updates', 'run-count': '233', policy: 'read,write,test', comment: '' }, 7200),
    R('system/scheduler', { name: 'disable-guest-night', 'start-date': '2025-03-01', 'start-time': '23:00:00', interval: '1d', 'on-event': 'script', event: '/ip hotspot disable hotspot-guest', 'run-count': '218', policy: 'write', comment: 'guest wifi off at night' }, 1800),
    R('system/scheduler', { name: 'rotate-logs', 'start-date': '2025-03-01', 'start-time': '00:05:00', interval: '1w', 'on-event': 'script', event: '/system logging action remove [find name=disk]', 'run-count': '31', policy: 'write', comment: '' }, 600),
    R('system/scheduler', { name: 'lte-reconnect', 'start-date': '2025-06-19', 'start-time': '04:15:00', interval: '1d', 'on-event': 'script', event: '/interface lte at-chat lte1 input="AT+CFUN=1,1"', 'run-count': '104', policy: 'write,test', comment: 'modem refresh', disabled: true }, 300),
    R('system/scheduler', { name: 'netwatch-report', 'start-date': '2025-07-02', 'start-time': '*/15:00', interval: '15m', 'on-event': 'script', event: ':log info "netwatch summary"', 'run-count': '8120', policy: 'read,test', comment: '' }, 60),
  ];
  t['system/script'] = [
    R('system/script', { name: 'block-abuse', source: ':local a [/ip firewall address-list find list=abuse]\n:foreach i in=$a do={ /ip firewall address-list set $i timeout=1d }', policy: 'read,write,test', 'run-count': '42', 'last-started': dateTimeString(3600), owner: 'admin', comment: 're-arm abuse timeouts' }, 7200),
    R('system/script', { name: 'guest-voucher-create', source: ':local user ("guest-" . [:pick [:tostr [:rndnum from=1000 to=9999]] 0 4])\n/ip hotspot user add name=$user password=$user profile=guest-profile limit-uptime=8h', policy: 'write,test', 'run-count': '1284', 'last-started': dateTimeString(600), owner: 'noc', comment: 'voucher generator' }, 400),
    R('system/script', { name: 'wan-failover', source: ':if ([/ping 8.8.8.8 count=3] = 0) do={\n /ip route set [find comment=default] distance=2\n}', policy: 'read,write,test', 'run-count': '96', 'last-started': dateTimeString(9800), owner: 'admin', comment: 'LTE backup' }, 9000),
    R('system/script', { name: 'report-traffic', source: ':local r [/queue simple find]\n:foreach q in=$r do={ :log info [/queue simple get $q name] }', policy: 'read,test', 'run-count': '338', 'last-started': dateTimeString(1200), owner: 'monitoring', comment: '' }, 1200),
    R('system/script', { name: 'cleanup-arp', source: '/ip arp remove [find where dynamic and !complete]', policy: 'write', 'run-count': '77', 'last-started': dateTimeString(14400), owner: 'admin', comment: '' }, 14400),
    R('system/script', { name: 'firmware-check', source: ':if ([/system routerboard get current-firmware] != [/system routerboard get upgrade-firmware]) do={\n :log warning "routerboard firmware upgrade available"\n}', policy: 'read,test', 'run-count': '19', 'last-started': dateTimeString(86400), owner: 'noc', comment: '' }, 86400),
    R('system/script', { name: 'hotspot-welcome', source: ':log info ("hotspot login: " . $user)', policy: 'read,write,test', 'run-count': '5210', 'last-started': dateTimeString(120), owner: 'admin', comment: 'profile on-login hook' }, 120),
    R('system/script', { name: 'backup-email', source: '/tool e-mail send to="noc@example.net" subject="backup" body="done"', policy: 'read,write,test', 'run-count': '31', 'last-started': dateTimeString(43200), owner: 'admin', comment: '' }, 43200),
  ];
  t['system/script/environment'] = [
    { name: 'mmap', value: 'false' },
    { name: 'nocContact', value: 'noc@example.net' },
    { name: 'siteName', value: 'Accra POP' },
  ];
  t['system/backup'] = [
    R('system/backup', { name: 'auto-daily.backup', size: 184320, 'creation-time': routerosDate(0).toLowerCase() + ' 03:00:12' }, 25200),
    R('system/backup', { name: 'pre-upgrade.backup', size: 182912, 'creation-time': routerosDate(-3).toLowerCase() + ' 17:41:02' }, 300000),
    R('system/backup', { name: 'guest-config.rsc', size: 42180, 'creation-time': routerosDate(-6).toLowerCase() + ' 11:02:44' }, 600000),
  ];
  t['system/certificate'] = [
    R('system/certificate', { name: 'hotspot-login', 'common-name': 'login.example.net', issuer: 'hotspot-login', subject: 'CN=login.example.net', 'key-usage': 'digital-signature,key-encipherment', 'serial-number': hex(rng(9), 16).toUpperCase(), 'akid': '', ca: false, trusted: false, 'expires-after': '241d12h', 'invalid-before': '2025-01-02 10:00:00', 'invalid-after': '2026-06-02 10:00:00', 'fingerprint': hex(rng(3), 40).toUpperCase(), comment: 'captive portal TLS' }, 86400),
    R('system/certificate', { name: 'vpn-server', 'common-name': 'vpn.example.net', issuer: 'Example CA', subject: 'CN=vpn.example.net', 'key-usage': 'digital-signature,key-encipherment', 'serial-number': hex(rng(11), 16).toUpperCase(), ca: false, trusted: true, 'expires-after': '58d4h', 'invalid-before': '2025-02-11 09:20:00', 'invalid-after': '2026-02-11 09:20:00', 'fingerprint': hex(rng(4), 40).toUpperCase(), comment: 'SSTP/OVPN' }, 90000),
    R('system/certificate', { name: 'example-ca', 'common-name': 'Example Root CA', issuer: 'Example Root CA', subject: 'CN=Example Root CA', 'key-usage': 'key-cert-sign,crl-sign', ca: true, trusted: true, 'expires-after': '1721d', 'invalid-after': '2031-04-02 00:00:00', 'fingerprint': hex(rng(5), 40).toUpperCase(), comment: 'internal PKI' }, 200000),
    R('system/certificate', { name: 'rest-api', 'common-name': 'mtk-accra.local', issuer: 'mtk-accra.local', subject: 'CN=mtk-accra.local', 'key-usage': 'digital-signature,key-encipherment', ca: false, trusted: false, 'expires-after': '19d2h', 'invalid-after': '2026-10-21 07:00:00', 'fingerprint': hex(rng(6), 40).toUpperCase(), comment: 'self-signed, expiring soon' }, 300000),
  ];
  t['system/logging'] = [
    R('system/logging', { topics: 'critical,error,warning', action: 'memory', prefix: '', comment: '' }, 0),
    R('system/logging', { topics: 'info', action: 'disk', prefix: 'info-', comment: 'kept 3 days' }, 0),
    R('system/logging', { topics: 'firewall,account', action: 'remote', prefix: 'fw-', comment: 'syslog to collector' }, 0),
    R('system/logging', { topics: 'script', action: 'memory', prefix: 'script-', comment: '' }, 0),
    R('system/logging', { topics: 'hotspot,radius', action: 'disk', prefix: 'hs-', comment: '' }, 0),
    R('system/logging', { topics: '!debug', action: 'echo', prefix: '', comment: '' }, 0),
  ];
  t['system/logging/action'] = [
    { name: 'memory', target: 'memory', 'memory-lines': '1000', 'memory-stop-on-full': false },
    { name: 'disk', target: 'disk', 'disk-file-name': 'log', 'disk-lines-per-file': '500', 'disk-file-count': '2', 'disk-stop-on-full': true },
    { name: 'remote', target: 'remote', remote: `${LAN}.11`, 'remote-port': '514', 'syslog-facility': 'local1', 'syslog-severity': 'info', 'syslog-time-format': 'bsd-syslog' },
  ];
  t['log'] = buildLog();

  /* ----------------------- INTERFACES ----------------------- */
  const ifaces: Array<[string, string, number, number, boolean]> = [
    ['ether1', 'ether', 1500, 0, true], ['ether2', 'ether', 1500, 1, true], ['ether3', 'ether', 1500, 2, true],
    ['ether4', 'ether', 1500, 3, true], ['ether5', 'ether', 1500, 4, true], ['ether6', 'ether', 1500, 5, true],
    ['ether7', 'ether', 1500, 6, false], ['ether8', 'ether', 1500, 7, false], ['sfp-sfpplus1', 'ether', 1500, 8, true],
    ['sfp-sfpplus2', 'ether', 1500, 9, false], ['bridge1', 'bridge', 1500, -1, true], ['bridge-guest', 'bridge', 1500, -1, true],
    ['vlan10', 'vlan', 1500, -1, true], ['vlan20', 'vlan', 1500, -1, true], ['vlan30', 'vlan', 1500, -1, false],
    ['wifi1', 'wifi', 1500, -1, true], ['wifi2', 'wifi', 1500, -1, true], ['lte1', 'lte', 1500, -1, true],
    ['wg-mgmt', 'wireguard', 1420, -1, true], ['lo', 'bridge', 1500, -1, true],
  ];
  for (const [name, type, mtu, port, running] of ifaces) {
    const r = rng(hash(name));
    R('interface', {
      name, type, mtu, l2mtu: type === 'ether' ? 1588 : 1600, 'max-l2mtu': type === 'ether' ? 10240 : 1600,
      'mac-address': port >= 0 ? `74:4D:28:${hex(r, 2).toUpperCase()}:${String(port).padStart(2, '0')}:${hex(r, 2).toUpperCase()}` : `AA:${hex(r, 2).toUpperCase()}:${hex(r, 2).toUpperCase()}:${hex(r, 2).toUpperCase()}:${hex(r, 2).toUpperCase()}:${hex(r, 2).toUpperCase()}`,
      arp: 'enabled', 'arp-timeout': 'auto', running, slave: false, disabled: !running && name !== 'vlan30',
      'rx-byte': int(2e8, 9e10, r), 'tx-byte': int(1e8, 6e10, r), 'rx-packet': int(1e6, 9e7, r), 'tx-packet': int(1e6, 8e7, r),
      'rx-error': int(0, 40, r), 'tx-error': 0, 'rx-drop': int(0, 900, r), 'tx-drop': 0, 'link-downs': int(0, 12, r),
      'last-link-up-time': `${int(2, 60, r)}d${int(2, 23, r)}h${int(5, 59, r)}m${int(2, 59, r)}s`,
      comment: name.startsWith('ether') ? '' : name === 'lte1' ? 'LTE backup uplink' : name === 'bridge1' ? 'LAN bridge' : '',
    }, int(20000, 900000, r));
  }
  t['interface/ethernet'] = ['ether1', 'ether2', 'ether3', 'ether4', 'ether5', 'ether6', 'ether7', 'ether8', 'sfp-sfpplus1', 'sfp-sfpplus2'].map((name, i) => {
    const up = !['ether7', 'ether8', 'sfp-sfpplus2'].includes(name);
    return R('interface/ethernet', {
      name, 'mac-address': `74:4D:28:${hex(rng(i + 20), 2).toUpperCase()}:${String(i).padStart(2, '0')}:${hex(rng(i + 30), 2).toUpperCase()}`,
      'auto-negotiation': true, advertise: i === 8 ? '10G-baseSR-LR,1G-baseT-full' : '1G-baseT-full,100M-baseT-full',
      speed: i === 8 ? '10Gbps' : up ? '1Gbps' : '0bps', 'full-duplex': up, mtu: 1500, l2mtu: 1588,
      'tx-flow-control': i === 0 || i === 8 ? 'on' : 'off', 'rx-flow-control': i === 0 || i === 8 ? 'on' : 'off',
      running: up, 'poe-out': ['ether5', 'ether6'].includes(name) ? 'auto-on' : 'off', comment: i === 0 ? 'uplink' : '',
    }, 40000 + i * 100);
  });
  t['interface/bridge'] = [
    R('interface/bridge', { name: 'bridge1', mtu: 1500, l2mtu: 1600, 'mac-address': '74:4D:28:AA:01:10', 'protocol-mode': 'rstp', 'vlan-filtering': true, priority: '0x8000', 'igmp-snooping': false, comment: 'LAN' }, 1200000),
    R('interface/bridge', { name: 'bridge-guest', mtu: 1500, l2mtu: 1600, 'mac-address': '74:4D:28:AA:01:11', 'protocol-mode': 'rstp', 'vlan-filtering': true, priority: '0x8000', comment: 'Guest VLAN 20' }, 900000),
  ];
  ['ether2', 'ether3', 'ether4', 'ether5', 'ether6', 'sfp-sfpplus1'].forEach((iface, i) => {
    R('interface/bridge/port', {
      interface: iface, bridge: 'bridge1', pvid: i === 0 ? 10 : 1, 'frame-types': 'admit-all', 'ingress-filtering': true,
      priority: 128, 'path-cost': 10 + i, 'edge': 'auto', 'point-to-point': 'auto', 'learn': 'auto', 'horizon': 'none',
      'hw': 'yes', comment: iface === 'sfp-sfpplus1' ? 'core uplink' : '',
    }, 800000);
  });
  t['interface/bridge/vlan'] = [
    R('interface/bridge/vlan', { bridge: 'bridge1', 'vlan-ids': '10', tagged: 'bridge1', untagged: 'ether2,ether3', dynamic: false, comment: 'Office VLAN' }, 800000),
    R('interface/bridge/vlan', { bridge: 'bridge1', 'vlan-ids': '20', tagged: 'bridge1,wifi2', untagged: '', dynamic: false, comment: 'Guest VLAN' }, 800000),
    R('interface/bridge/vlan', { bridge: 'bridge1', 'vlan-ids': '30', tagged: 'bridge1', untagged: '', dynamic: false, comment: 'Voice' }, 700000),
    R('interface/bridge/vlan', { bridge: 'bridge-guest', 'vlan-ids': '20', tagged: '', untagged: 'ether4', dynamic: false, comment: '' }, 600000),
  ];
  t['interface/bridge/host'] = Array.from({ length: 12 }).map((_, i) => {
    const r = rng(300 + i);
    return R('interface/bridge/host', {
      'mac-address': mac(r), bridge: i > 9 ? 'bridge-guest' : 'bridge1', 'on-interface': pick(['ether2', 'ether3', 'wifi1', 'wifi2', 'sfp-sfpplus1'], r),
      dynamic: i > 1, age: `${int(0, 40, r)}s${int(10, 59, r)}ms`, vid: pick([1, 10, 10, 20], r),
    }, 2000 + i * 40);
  });
  t['interface/bridge/settings'] = [{ 'use-ip-firewall': false, 'use-ip-firewall-for-vlan': false, 'allow-fast-path': true, 'bridge-fast-path-active': true, 'frame-types': 'admit-all', 'forward-delay': '15s', 'max-message-age': '20s', 'hello-time': '2s', priority: '0x8000', 'igmp-snooping': false, 'dhcp-snooping': false, 'igmp-version': '2' }];
  t['interface/vlan'] = [
    R('interface/vlan', { name: 'vlan10', interface: 'bridge1', 'vlan-id': 10, mtu: 1500, 'use-service-tag': false, comment: 'Office' }, 900000),
    R('interface/vlan', { name: 'vlan20', interface: 'bridge1', 'vlan-id': 20, mtu: 1500, 'use-service-tag': false, comment: 'Guest' }, 900000),
    R('interface/vlan', { name: 'vlan30', interface: 'bridge1', 'vlan-id': 30, mtu: 1500, 'use-service-tag': false, disabled: true, comment: 'Voice (planned)' }, 50000),
  ];
  t['interface/bonding'] = [R('interface/bonding', { name: 'bond-uplink', slaves: 'sfp-sfpplus1,sfp-sfpplus2', mode: '802.3ad', 'transmit-hash-policy': 'layer-2-and-3', mtu: 1500, 'lacp-rate': '1sec', 'link-monitoring': 'mii', 'arp-interval': '', 'arp-ip-targets': '', 'min-links': 1, 'lacp-user-key': 0, comment: 'LAG to core switch' }, 500000)];
  t['interface/list'] = [
    R('interface/list', { name: 'LAN', include: '', 'include-all': false, comment: 'all internal interfaces' }, 900000),
    R('interface/list', { name: 'WAN', include: '', 'include-all': false, comment: '' }, 900000),
    R('interface/list', { name: 'MGMT', include: '', 'include-all': false, comment: 'management access' }, 900000),
    R('interface/list', { name: 'WIFI', include: '', 'include-all': false, comment: '' }, 400000),
    R('interface/list', { name: 'BLOCKED', include: '', 'include-all': false, comment: 'quarantine list' }, 300000),
  ];
  [['LAN', 'bridge1'], ['LAN', 'vlan10'], ['LAN', 'ether2'], ['LAN', 'ether3'], ['LAN', 'wifi1'], ['WAN', 'ether1'], ['WAN', 'lte1'], ['MGMT', 'vlan30'], ['WIFI', 'wifi1'], ['WIFI', 'wifi2']]
    .forEach(([list, iface]) => R('interface/list/member', { list, interface: iface, dynamic: false, comment: '' }, 400000));
  t['interface/lte'] = [R('interface/lte', {
    name: 'lte1', 'apn-profiles': 'internet', 'network-mode': 'auto', pin: '', 'data-class': 12, 'sms-read': true, mtu: 1500,
    'operator': 65501, 'session-uptime': '3h41m', 'current-operator': 'MTN GH', 'current-cellid': 21845622,
    'registration-status': 'registered', 'access-technology': 'LTE', 'signal-strengh': '-71dBm' as unknown as number, 'signal-strength': '-71dBm',
    'rssi': '-67dBm', 'rsrp': '-98dBm', 'rsrq': '-11dB', 'sinr': '14dB', 'imei': '356938035643809', 'imsi': '655010123456789',
    'uicc': 'ready', comment: 'MTN backup uplink',
  }, 13000)];
  t['interface/lte/apn'] = [R('interface/lte/apn', { name: 'default', apn: 'internet', 'user': '', 'password': '', 'authentication': 'none', 'add-default-route': true, 'default-route-distance': 2, 'use-network-apn': true }, 13000)];

  /* --------------------------- IP --------------------------- */
  t['ip/address'] = [
    R('ip/address', { address: `${LAN}.1/24`, network: `${LAN}.0`, interface: 'bridge1', 'actual-interface': 'bridge1', broadcast: `${LAN}.255`, dynamic: false, invalid: false, comment: 'default LAN' }, 1200000),
    R('ip/address', { address: `${GUEST}.1/24`, network: `${GUEST}.0`, interface: 'bridge-guest', 'actual-interface': 'bridge-guest', broadcast: `${GUEST}.255`, dynamic: false, comment: 'guest gateway' }, 900000),
    R('ip/address', { address: '172.16.10.1/24', network: '172.16.10.0', interface: 'vlan10', 'actual-interface': 'vlan10', broadcast: '172.16.10.255', comment: 'office' }, 900000),
    R('ip/address', { address: '10.20.30.1/24', network: '10.20.30.0', interface: 'vlan30', 'actual-interface': 'vlan30', broadcast: '10.20.30.255', disabled: true, comment: 'voice' }, 50000),
    R('ip/address', { address: `${WAN}.2/30`, network: `${WAN}.0`, interface: 'ether1', 'actual-interface': 'ether1', broadcast: '', dynamic: false, comment: 'ISP handoff' }, 1200000),
    R('ip/address', { address: '10.88.0.1/24', network: '10.88.0.0', interface: 'wg-mgmt', 'actual-interface': 'wg-mgmt', broadcast: '10.88.0.255', comment: 'WireGuard mgmt' }, 400000),
  ];
  t['ip/arp'] = [
    ...[`${LAN}.1`, `${LAN}.5`, `${LAN}.11`, `${LAN}.12`, `${LAN}.20`, `${LAN}.31`, `${LAN}.44`, `${LAN}.55`, `${GUEST}.33`, '172.16.10.20'].map((addr, i) =>
      R('ip/arp', { address: addr, 'mac-address': mac(rng(700 + i)), interface: addr.startsWith(GUEST) ? 'bridge-guest' : addr.startsWith('172') ? 'vlan10' : 'bridge1', published: false, complete: i !== 8, dynamic: i > 1, invalid: false, comment: i === 0 ? 'gateway' : '' }, 300 + i * 20)),
  ];
  t['ip/cloud'] = [{ 'ddns-enabled': true, 'ddns-update-interval': 'none', 'update-time': true, 'public-address': '102.176.94.21', 'dns-name': 'a1b2c3d4e5f6.sn.mynetname.net', status: 'updated', 'backup-allowed': true, 'ddns-ipv6': false, warning: '' }];
  t['ip/dhcp-client'] = [
    R('ip/dhcp-client', { interface: 'ether1', address: `${WAN}.2/30`, gateway: `${WAN}.1`, 'primary-dns': '102.176.1.1', 'secondary-dns': '8.8.8.8', status: 'bound', 'expires-after': '3h12m44s', 'add-default-route': true, 'use-peer-dns': true, 'use-peer-ntp': false, 'dhcp-options': '', 'client-id': 'ether1', 'lease-time': '10m', comment: 'ISP DHCP' }, 2400),
    R('ip/dhcp-client', { interface: 'sfp-sfpplus1', status: 'searching', 'add-default-route': false, 'use-peer-dns': false, disabled: true, comment: 'spare uplink' }, 90000),
  ];
  t['ip/dhcp-server'] = [
    R('ip/dhcp-server', { name: 'dhcp-lan', interface: 'bridge1', 'address-pool': 'pool-lan', 'lease-time': '10m', authoritative: 'yes', 'add-arp': false, 'always-broadcast': false, 'use-radius': false, 'conflict-detection': true, 'bootp-support': 'none', 'delay-threshold': 'none', 'address-lists': '', comment: 'LAN DHCP' }, 1200000),
    R('ip/dhcp-server', { name: 'dhcp-guest', interface: 'bridge-guest', 'address-pool': 'pool-guest', 'lease-time': '1h', authoritative: 'yes', 'use-radius': false, 'address-lists': 'GUEST-DHCP', comment: 'captive portal subnet' }, 900000),
  ];
  const leaseRows: Row[] = [];
  for (let i = 0; i < 26; i++) {
    const r = rng(900 + i);
    const guest = i > 20;
    leaseRows.push(R('ip/dhcp-server/lease', {
      address: guest ? `${GUEST}.${100 + i}` : i === 0 ? `${LAN}.11` : i < 16 ? `${LAN}.${100 + i}` : `172.16.10.${50 + i}`,
      'mac-address': mac(r), 'client-id': `1:${mac(r).toLowerCase()}`,
      server: guest ? 'dhcp-guest' : 'dhcp-lan',
      status: i === 0 ? 'bound' : pick(['bound', 'bound', 'bound', 'waiting', 'offered'], r),
      'expires-after': i === 0 ? 'never' : `${int(2, 9, r)}m${int(10, 59, r)}s`,
      'last-seen': `${int(0, 3, r)}m${int(4, 59, r)}s`, 'host-name': i === 0 ? 'noc-jumpbox' : `${pick(hosts, r)}-${pick(people, r)}`,
      dynamic: i !== 0 && i !== 4, blocked: i === 17, disabled: false,
      comment: i === 0 ? 'static jump host' : i === 4 ? 'static printer' : '',
      'address-lists': guest ? 'GUEST-DHCP' : '',
    }, int(60, 8000, r)));
  }
  t['ip/dhcp-server/lease'] = leaseRows;
  t['ip/dhcp-server/network'] = [
    R('ip/dhcp-server/network', { address: `${LAN}.0/24`, gateway: `${LAN}.1`, netmask: '24', 'dns-server': `${LAN}.1,1.1.1.1`, domain: 'lan.example.net', 'dns-none': false, 'wins-server': '', 'ntp-server': `${LAN}.1`, comment: '' }, 1200000),
    R('ip/dhcp-server/network', { address: `${GUEST}.0/24`, gateway: `${GUEST}.1`, netmask: '24', 'dns-server': `${GUEST}.1`, domain: 'guest.example.net', 'dhcp-option-set': 'guest-opts', comment: '' }, 900000),
  ];
  t['ip/dhcp-server/option'] = [
    R('ip/dhcp-server/option', { name: 'option-121', code: 121, value: '0x18c0a85801', force: true }, 900000),
    R('ip/dhcp-server/option', { name: 'tftp-server', code: 66, value: '0xc0a8580b', force: false, comment: 'phone provisioning' }, 800000),
    R('ip/dhcp-server/option', { name: 'option-43', code: 43, value: '0x0104c0a858', force: false, comment: 'unifi controller' }, 800000),
    R('ip/dhcp-server/option', { name: 'captive-portal', code: 114, value: '0x01', force: false }, 100000),
  ];
  t['ip/dhcp-server/option/sets'] = [R('ip/dhcp-server/option/sets', { name: 'guest-opts', options: 'captive-portal,option-121' }, 100000)];
  t['ip/pool'] = [
    R('ip/pool', { name: 'pool-lan', ranges: `${LAN}.100-${LAN}.200`, comment: 'LAN leases' }, 1200000),
    R('ip/pool', { name: 'pool-guest', ranges: `${GUEST}.100-${GUEST}.240`, comment: '' }, 900000),
    R('ip/pool', { name: 'pool-vpn', ranges: '10.88.0.100-10.88.0.200', comment: 'road-warrior' }, 400000),
  ];
  t['ip/service'] = [
    { name: 'telnet', port: 23, address: '', disabled: true, invalid: false },
    { name: 'ftp', port: 21, address: '', disabled: true, invalid: false },
    { name: 'www', port: 80, address: '', disabled: true, invalid: false },
    { name: 'ssh', port: 2222, address: `${LAN}.0/24,10.88.0.0/24`, disabled: false, invalid: false },
    { name: 'www-ssl', port: 443, address: '', disabled: false, invalid: false },
    { name: 'api', port: 8728, address: `${LAN}.0/24`, disabled: false, invalid: false },
    { name: 'winbox', port: 8291, address: `${LAN}.0/24,10.88.0.0/24`, disabled: false, invalid: false },
    { name: 'api-ssl', port: 8729, address: `${LAN}.0/24`, disabled: false, invalid: false },
  ];
  t['ip/settings'] = [{ 'ip-forward': true, 'send-redirects': true, 'accept-redirects': false, 'accept-source-route': false, 'secure-redirects': true, 'rp-filter': 'no', 'tcp-syncookies': false, 'icmp-rate-limit': 10, 'icmp-rate-mask': '0x1818', 'allow-fast-path': true, 'max-neighbor-entries': 8192, 'ipv4-fast-path-active': true, 'ipv4-fast-path-bytes': 812345678 }];
  t['ip/neighbor'] = Array.from({ length: 8 }).map((_, i) => {
    const r = rng(1100 + i);
    return R('ip/neighbor', {
      address: i % 3 === 0 ? '172.16.10.' + (20 + i) : `${LAN}.${20 + i}`, 'mac-address': mac(r),
      interface: i % 3 === 0 ? 'vlan10' : 'bridge1', identity: i === 0 ? 'core-sw-01' : `device-${i}`,
      platform: pick(['MikroTik', 'Cisco', 'Ubiquiti', 'TP-Link'], r), version: pick(['7.16.2', '6.49.13', 'IOS 15.2', '6.6.65'], r),
      board: pick(['CRS326-24G-2S+', 'RB4011', 'USW-24-PoE', 'SG350'], r), 'discovered-by': pick(['mndp', 'lldp', 'cdp'], r), age: `${int(1, 30, r)}s`,
    }, 60 + i * 5);
  });
  t['ip/neighbor/discovery-settings'] = [{ 'discover-interface-list': 'LAN', protocol: 'mndp,lldp,cdp', 'protocol-raw': 'mndp,lldp,cdp' }];
  t['ip/route'] = [
    R('ip/route', { 'dst-address': '0.0.0.0/0', gateway: `${WAN}.1`, distance: 1, scope: 30, 'target-scope': 10, 'check-gateway': 'ping', 'pref-src': `${WAN}.2`, active: true, static: true, dynamic: false, connect: false, blackhole: false, 'routing-table': 'main', comment: 'ISP default' }, 1200000),
    R('ip/route', { 'dst-address': '0.0.0.0/0', gateway: 'lte1', distance: 2, scope: 30, 'target-scope': 10, 'check-gateway': 'ping', active: false, static: true, dynamic: false, connect: false, 'routing-table': 'main', comment: 'LTE failover' }, 1200000),
    R('ip/route', { 'dst-address': `${LAN}.0/24`, gateway: 'bridge1', distance: 0, scope: 10, 'target-scope': 5, active: true, static: false, dynamic: true, connect: true, 'routing-table': 'main', prefSrc: '' }, 1200000),
    R('ip/route', { 'dst-address': `${GUEST}.0/24`, gateway: 'bridge-guest', distance: 0, scope: 10, active: true, connect: true, dynamic: true, 'routing-table': 'main' }, 900000),
    R('ip/route', { 'dst-address': '172.16.10.0/24', gateway: 'vlan10', distance: 0, scope: 10, active: true, connect: true, dynamic: true, 'routing-table': 'main' }, 900000),
    R('ip/route', { 'dst-address': '10.88.0.0/24', gateway: 'wg-mgmt', distance: 0, scope: 10, active: true, connect: true, dynamic: true, 'routing-table': 'main' }, 400000),
    R('ip/route', { 'dst-address': '192.168.50.0/24', gateway: '10.88.0.5', distance: 1, scope: 30, 'target-scope': 10, 'check-gateway': 'ping', active: true, static: true, 'routing-table': 'main', comment: 'branch office via WG' }, 400000),
    R('ip/route', { 'dst-address': '203.0.113.0/24', gateway: '', distance: 1, scope: 30, active: true, static: true, blackhole: true, 'routing-table': 'main', comment: 'blackhole bogon' }, 300000),
    R('ip/route', { 'dst-address': '10.99.0.0/16', gateway: 'vlan20', distance: 5, scope: 40, active: false, static: true, 'routing-table': 'vpn-table', comment: 'reserved' }, 200000),
  ];
  t['ip/dns'] = [{ servers: '1.1.1.1,9.9.9.9', 'dynamic-servers': '102.176.1.1', 'use-doh-server': true, 'doh-server': 'https://cloudflare-dns.com/dns-query', 'verify-doh-cert': true, 'allow-remote-requests': true, 'max-udp-packet-size': 4096, 'query-server-timeout': '2s', 'query-total-timeout': '10s', 'max-concurrent-queries': 100, 'max-concurrent-tcp-sessions': 20, 'cache-size': 2048, 'cache-max-ttl': '1w', 'cache-used': 438, 'address-list-extra-time': '0s', 'vrf': 'main', 'mdns-repeat-ifaces': '', 'cache': '' }];
  t['ip/dns/static'] = [
    R('ip/dns/static', { name: 'router.lan', address: `${LAN}.1`, type: 'A', ttl: '10m', comment: 'gateway' }, 900000),
    R('ip/dns/static', { name: 'nas.lan', address: '172.16.10.20', type: 'A', ttl: '1h', comment: '' }, 900000),
    R('ip/dns/static', { name: 'printer.lan', address: `${LAN}.104`, type: 'A', ttl: '30m', comment: '' }, 900000),
    R('ip/dns/static', { name: 'vpn.example.net', address: '102.176.94.21', type: 'A', ttl: '5m', comment: 'DDNS alias' }, 800000),
    R('ip/dns/static', { name: 'guest.lan', cname: 'router.lan', type: 'CNAME', ttl: '1h' }, 800000),
    R('ip/dns/static', { name: '*.lab.lan', address: '172.16.10.30', type: 'A', ttl: '1h', 'match-subdomain': true }, 800000),
    R('ip/dns/static', { name: 'blocked.example', address: '0.0.0.0', type: 'A', ttl: '1d', 'address-list': 'BLOCKED', comment: 'DNS sinkhole' }, 700000),
    R('ip/dns/static', { name: 'ads.tracker.net', type: 'NXDOMAIN', ttl: '1h', comment: 'sinkhole' }, 700000),
    R('ip/dns/static', { name: 'internal.example.net', type: 'FWD', 'forward-to': '172.16.10.53', ttl: '1h' }, 600000),
  ];
  t['ip/dns/cache'] = Array.from({ length: 16 }).map((_, i) => {
    const r = rng(1300 + i);
    const name = pick(['www.google.com', 'github.com', 'api.cloudflare.com', 'cdn.jsdelivr.net', 'fonts.gstatic.com', 'time.cloudflare.com', 'www.mikrotik.com', 'telemetry.example.net'], r);
    return R('ip/dns/cache', { name: `${name}`, type: pick(['A', 'A', 'AAAA', 'CNAME'], r), data: `${int(20, 220, r)}.${int(1, 254, r)}.${int(1, 254, r)}.${int(1, 254, r)}`, ttl: `${int(15, 3590, r)}s`, status: 'answered' }, i * 7);
  });
  t['ip/upnp'] = [{ enabled: false, 'allow-disable-external-interface': false, 'show-dummy-rule': true }];
  t['ip/vrf'] = [R('ip/vrf', { name: 'vrf-guest', interfaces: 'bridge-guest', table: 'guest', comment: 'isolated guest routing' }, 600000)];
  t['ip/nexthop'] = [R('ip/nexthop', { gateway: `${WAN}.1`, scope: '30', 'target-scope': '10', 'check-gateway': 'ping', distance: 1, comment: '' }, 1200000)];
  t['ip/kid-control'] = [R('ip/kid-control', { name: 'kids', comment: 'weekday bedtime 20:00' }, 400000)];
  t['ip/kid-control/device'] = Array.from({ length: 4 }).map((_, i) => {
    const r = rng(1500 + i);
    return R('ip/kid-control/device', { 'mac-address': mac(r), name: pick(hosts, r), 'rate-limit': `${int(1, 10, r)}M/${int(1, 10, r)}M`, blocking: 'blocked', 'day-rates': '', days: 'mon,tue,wed,thu,fri', disabled: false, comment: '' }, 300000);
  });
  t['ip/traffic-flow'] = [{ enabled: true, interfaces: 'ether1', 'cache-entries': 4000, 'active-flow-timeout': '30m', 'inactive-flow-timeout': '15s' }];
  t['ip/socks'] = [{ enabled: false, port: 1080, 'connection-idle-timeout': '2m', 'max-connections': 200, version: 4 }];
  t['ip/smb'] = [{ enabled: false, domain: 'MSHOME', comment: '', interfaces: '', 'smb-negotiation': 'auto' }];
  t['ip/ssh'] = [{ 'forwarding-enabled': false }];

  /* ------------------------ FIREWALL ------------------------ */
  const fw = (path: string, rows: Array<[string, string, Row]>) =>
    (t[path] = rows.map(([chain, action, o], i) => R(path, {
      chain, action, bytes: int(1e3, 9e9, rng(hash(path + i))), packets: int(10, 9e5, rng(hash(path + 'p' + i))),
      index: i, dynamic: false, invalid: false, ...o,
    }, 1000000 - i * 1000)));
  fw('ip/firewall/filter', [
    ['input', 'accept', { 'connection-state': 'established,related', comment: 'accept established/related' }],
    ['input', 'drop', { 'connection-state': 'invalid', comment: 'drop invalid' }],
    ['input', 'accept', { 'in-interface-list': 'LAN', 'src-address-list': 'MGMT-HOSTS', protocol: 'tcp', 'dst-port': '22,8291,8728', comment: 'management from LAN' }],
    ['input', 'accept', { 'in-interface-list': 'LAN', protocol: 'icmp', comment: 'LAN icmp' }],
    ['input', 'accept', { 'in-interface-list': 'LAN', protocol: 'udp', 'dst-port': '53,67,123', comment: 'LAN services' }],
    ['input', 'drop', { 'in-interface': 'ether1', 'src-address-list': 'BlockedNets', comment: 'known bad actors' }],
    ['input', 'accept', { protocol: 'udp', 'dst-port': '1194,51820', comment: 'VPN' }],
    ['input', 'drop', { 'log-prefix': 'input-drop:', log: true, comment: 'default deny input' }],
    ['forward', 'accept', { 'connection-state': 'established,related', comment: '' }],
    ['forward', 'drop', { 'connection-state': 'invalid', comment: '' }],
    ['forward', 'accept', { 'in-interface-list': 'LAN', 'out-interface-list': 'WAN', comment: 'LAN -> WAN' }],
    ['forward', 'accept', { 'in-interface': 'bridge-guest', 'out-interface-list': 'WAN', comment: 'guest internet only' }],
    ['forward', 'drop', { 'in-interface': 'bridge-guest', 'out-interface': 'bridge1', comment: 'guest cannot reach LAN' }],
    ['forward', 'drop', { protocol: 'tcp', 'dst-port': '23,21,3389', comment: 'block legacy protocols' }],
    ['forward', 'drop', { 'log-prefix': 'fwd-drop:', log: true, comment: 'default deny forward' }],
    ['output', 'accept', {}, { } as Row],
  ].map((r) => [r[0], r[1], r[2]] as [string, string, Row]));
  fw('ip/firewall/nat', [
    ['srcnat', 'masquerade', { 'out-interface-list': 'WAN', comment: 'masquerade to internet' }],
    ['dstnat', 'dst-nat', { protocol: 'tcp', 'dst-port': 443, 'to-addresses': '172.16.10.30', 'to-ports': 443, comment: 'publish web server' }],
    ['dstnat', 'dst-nat', { protocol: 'tcp', 'dst-port': 8291, 'to-addresses': LAN + '.44', comment: 'remote winbox (avoid)' }],
    ['dstnat', 'redirect', { 'in-interface': 'bridge-guest', protocol: 'tcp', 'dst-port': 80, 'to-ports': 64872, comment: 'force captive portal' }],
    ['srcnat', 'src-nat', { 'src-address': '172.16.10.0/24', 'dst-address': '10.88.0.0/24', 'to-addresses': '10.88.0.1', comment: 'WG branch SNAT' }],
    ['srcnat', 'masquerade', { 'out-interface': 'lte1', comment: 'LTE failover masquerade' }],
    ['dstnat', 'dst-nat', { protocol: 'udp', 'dst-port': '51820', 'to-addresses': `${LAN}.1`, 'to-ports': 51820, comment: 'wireguard' }],
  ]);
  fw('ip/firewall/mangle', [
    ['prerouting', 'mark-connection', { 'connection-mark': 'no-mark', 'in-interface-list': 'WAN', 'new-connection-mark': 'wan-conn' }],
    ['prerouting', 'mark-routing', { 'connection-mark': 'wan-conn', 'new-routing-mark': 'to-wan', passthrough: false }],
    ['prerouting', 'mark-packet', { 'connection-mark': 'wan-conn', 'new-packet-mark': 'download' }],
    ['prerouting', 'mark-connection', { 'connection-mark': 'no-mark', 'in-interface-list': 'LAN', 'new-connection-mark': 'lan-conn' }],
    ['postrouting', 'mark-packet', { 'connection-mark': 'lan-conn', 'out-interface-list': 'WAN', 'new-packet-mark': 'upload' }],
    ['forward', 'change-mss', { protocol: 'tcp', 'tcp-flags': 'syn', 'new-mss': 'clamp-to-pmtu' }],
    ['prerouting', 'mark-packet', { protocol: 'udp', 'dst-port': '3478-3481', 'new-packet-mark': 'voip', comment: 'voip marking' }],
    ['prerouting', 'set-priority', { 'connection-mark': 'lan-conn', 'new-priority': '1', comment: 'highest priority' }],
    ['prerouting', 'mark-packet', { 'src-address-list': 'throttled', 'new-packet-mark': 'throttle' }],
  ]);
  fw('ip/firewall/raw', [
    ['prerouting', 'drop', { 'src-address-list': 'BlockedNets', comment: 'early drop before conntrack' }],
    ['prerouting', 'notrack', { protocol: 'udp', 'dst-port': '53', comment: 'do not track DNS' }],
    ['prerouting', 'drop', { 'dst-address-list': 'bogons', comment: 'bogon filtering' }],
    ['prerouting', 'accept', { 'connection-state': 'untracked' }],
    ['prerouting', 'drop', { srcPortRange: '', protocol: 'tcp', dstPortRange: '137-139,445', 'in-interface-list': 'WAN', comment: 'SMB from WAN' }],
    ['output', 'accept', { 'connection-state': 'established,related' }],
  ]);
  t['ip/firewall/address-list'] = [
    ...['203.0.113.46', '198.51.100.23', '192.0.2.155', '45.155.205.233', '185.220.101.7'].map((a, i) =>
      R('ip/firewall/address-list', { list: 'BlockedNets', address: a, dynamic: false, 'creation-time': `${int(1, 40, rng(2000 + i))}d${int(1, 23, rng(2001 + i))}h`, timeout: pick(['1d', '1d', '1w', 'never'], rng(2002 + i)), comment: pick(['ssh brute force', 'port scan', 'spam source', 'repeat offender', ''], rng(2003 + i)) }, 90000 + i * 1000)),
    ...['192.168.88.0/24', '172.16.10.0/24'].map((a, i) => R('ip/firewall/address-list', { list: 'LAN-NETS', address: a, dynamic: false, 'creation-time': '42d3h', timeout: 'never', comment: '' }, 3600000)),
    ...['192.168.88.10', '192.168.88.44', '10.88.0.0/24'].map((a, i) => R('ip/firewall/address-list', { list: 'MGMT-HOSTS', address: a, timeout: 'never', comment: i === 2 ? 'wireguard mgmt' : '' }, 3000000)),
    ...['203.0.113.0/24', '198.51.100.0/24', '192.0.2.0/24', '0.0.0.0/8', '169.254.0.0/16', '10.0.0.0/8'].map((a, i) =>
      R('ip/firewall/address-list', { list: 'bogons', address: a, dynamic: false, timeout: 'never', comment: 'RFC6890 - must not appear on internet' }, 3000000)),
  ];
  t['ip/firewall/connection'] = Array.from({ length: 40 }).map((_, i) => {
    const r = rng(2100 + i);
    const proto = pick(['tcp', 'tcp', 'tcp', 'udp', 'udp', 'icmp'], r);
    const state = proto === 'tcp' ? pick(['established', 'established', 'established', 'time-wait', 'syn-sent', 'close-wait'], r) : pick(['established', 'assured'], r);
    return R('ip/firewall/connection', {
      protocol: proto, srcnat: pick([true, false], r), dstnat: false,
      'src-address': pick([`${LAN}.100`, `${LAN}.104`, `${LAN}.112`, '172.16.10.55', `${GUEST}.120`], r),
      'dst-address': pick(['142.250.190.14', '140.82.121.4', '104.16.132.229', '1.1.1.1', '20.42.65.90', '162.159.135.232'], r),
      'src-port': int(30000, 65000, r), 'dst-port': proto === 'tcp' ? pick([443, 443, 443, 80, 5228], r) : proto === 'udp' ? pick([443, 53, 123], r) : '',
      'tcp-state': proto === 'tcp' ? state : 'established', state, timeout: `${int(1, 5, r)}h${int(0, 59, r)}m${int(0, 59, r)}s`,
      'orig-bytes': int(200, 90000000, r), 'repl-bytes': int(200, 400000000, r), 'orig-packets': int(2, 90000, r), 'repl-packets': int(2, 90000, r),
      fasttrack: chance(0.4, r), 'connection-mark': chance(0.3, r) ? 'wan-conn' : '', 'connection-type': proto === 'tcp' ? 'tcp' : 'udp',
      'srcnat-address': chance(0.5, r) ? `${WAN}.2:${int(20000, 60000, r)}` : undefined,
    }, int(5, 3600, r));
  });
  t['ip/firewall/connection/tracking'] = [{ enabled: true, 'loose-tcp-tracking': true, 'max-entries': '1M', 'tcp-syn-sent-timeout': '5s', 'tcp-established-timeout': '1d', 'tcp-fin-wait-timeout': '10s', 'tcp-close-wait-timeout': '10s', 'tcp-last-ack-timeout': '10s', 'tcp-time-wait-timeout': '10s', 'tcp-close-timeout': '10s', 'tcp-max-retrans-timeout': '5m', 'tcp-unacked-timeout': '5m', 'udp-timeout': '10s', 'udp-stream-timeout': '3m', 'icmp-timeout': '10s', 'generic-timeout': '10m', 'total-entries': 4128, 'active-ipv4': 2688, 'active-ipv6': 12 }];
  t['ip/firewall/service-port'] = [
    { name: 'ftp', port: '21', 'sip-direct-media': '', 'sip-timeout': '' },
    { name: 'sip', port: '5060', 'sip-direct-media': 'yes', 'sip-timeout': '1h' },
    { name: 'h323', port: '1720' }, { name: 'irc', port: '6667' }, { name: 'pptp', port: '1723' },
    { name: 'tftp', port: '69' }, { name: 'sip-tls', port: '5061' }, { name: 'rtsp', port: '554' },
    { name: 'netbios-ns', port: '137' }, { name: 'netbios-dgm', port: '138' },
  ];
  t['ip/firewall/helper'] = [
    R('ip/firewall/helper', { name: 'ftp', enabled: true, port: 21, comment: '' }, 900000),
    R('ip/firewall/helper', { name: 'sip', enabled: true, port: 5060, 'sip-direct-media': true, comment: 'voip ALG' }, 900000),
    R('ip/firewall/helper', { name: 'h323', enabled: false, port: 1720 }, 900000),
    R('ip/firewall/helper', { name: 'pptp', enabled: false, port: 1723 }, 900000),
  ];
  t['ip/firewall/layer7-protocol'] = [
    R('ip/firewall/layer7-protocol', { name: 'youtube', regexp: '^.*(youtu.be|youtube).*$', comment: '' }, 800000),
    R('ip/firewall/layer7-protocol', { name: 'facebook', regexp: '^.*(facebook|fbcdn).*$', comment: 'social media blocking' }, 800000),
    R('ip/firewall/layer7-protocol', { name: 'netflix', regexp: '^.*(nflxvideo|netflix).*$', comment: '' }, 800000),
  ];

  /* ------------------------- ROUTING ------------------------ */
  t['routing/table'] = [
    R('routing/table', { name: 'main', fib: true, comment: 'default table' }, 1200000),
    R('routing/table', { name: 'vpn-table', fib: true, comment: 'branch routes' }, 600000),
    R('routing/table', { name: 'guest', fib: true, comment: 'guest VRF' }, 600000),
  ];
  t['routing/rule'] = [
    R('routing/rule', { 'src-address': '172.16.10.0/24', 'dst-address': '10.88.0.0/24', action: 'lookup', table: 'vpn-table', comment: 'office to branch' }, 600000),
    R('routing/rule', { 'src-address': `${GUEST}.0/24`, action: 'lookup', table: 'guest', comment: 'guest traffic isolation' }, 600000),
    R('routing/rule', { 'src-address': `${LAN}.250`, action: 'drop', comment: 'quarantine host' }, 300000),
  ];
  t['routing/ospf/instance'] = [R('routing/ospf/instance', { name: 'default', 'router-id': '10.0.0.1', vrf: 'main', 'distribute-default': 'never', 'redistribute-connected': 'as-type-1', 'redistribute-static': 'no', 'redistribute-bgp': 'no', 'spf-interval': '1s', 'originate-default': 'never', comment: 'internal OSPF' }, 900000)];
  t['routing/ospf/area'] = [
    R('routing/ospf/area', { name: 'backbone', instance: 'default', 'area-id': '0.0.0.0', type: 'default', comment: '' }, 900000),
    R('routing/ospf/area', { name: 'office', instance: 'default', 'area-id': '0.0.0.10', type: 'stub', comment: '' }, 900000),
  ];
  t['routing/ospf/interface-template'] = [
    R('routing/ospf/interface-template', { areas: 'backbone', interfaces: 'vlan10', 'network-type': 'broadcast', cost: 10, priority: 1, 'hello-interval': '10s', 'dead-interval': '40s', passive: false, comment: '' }, 800000),
    R('routing/ospf/interface-template', { areas: 'backbone', interfaces: 'sfp-sfpplus1', 'network-type': 'point-to-point', cost: 5, priority: 1, 'hello-interval': '10s', 'dead-interval': '40s', passive: false, comment: 'core link' }, 800000),
    R('routing/ospf/interface-template', { areas: 'office', interfaces: 'ether2,ether3', 'network-type': 'broadcast', cost: 20, passive: true, comment: 'user ports' }, 700000),
  ];
  t['routing/ospf/neighbor'] = [
    R('routing/ospf/neighbor', { 'router-id': '10.0.0.2', address: '172.16.10.2', interface: 'vlan10', state: 'Full', area: 'backbone', 'adjacency-time': '3d4h' }, 300000),
    R('routing/ospf/neighbor', { 'router-id': '10.0.0.3', address: '10.0.0.3', interface: 'sfp-sfpplus1', state: 'Full', area: 'backbone', 'adjacency-time': '14d2h' }, 1200000),
  ];
  t['routing/bgp/connection'] = [
    R('routing/bgp/connection', { name: 'to-upstream', 'remote.address': '41.206.16.1', 'remote.as': 37637, 'remote.port': 179, 'local.address': `${WAN}.2`, 'local.role': 'ebgp', 'template': 'upstream', multihop: false, connect: true, listen: false, 'routing-table': 'main', 'hold-time': '3m', 'keepalive-time': '1m', 'nexthop-choice': 'default', comment: 'primary upstream' }, 900000),
    R('routing/bgp/connection', { name: 'to-ixp', 'remote.address': '196.60.8.13', 'remote.as': 30986, 'remote.port': 179, 'local.role': 'ebgp', 'template': 'ixp', multihop: true, connect: true, 'routing-table': 'main', comment: 'Ghana IX peering' }, 800000),
  ];
  t['routing/bgp/template'] = [
    R('routing/bgp/template', { name: 'upstream', as: 64512, 'router-id': '10.0.0.1', 'local.role': 'ebgp', 'routing-table': 'main', 'hold-time': '3m', 'keepalive-time': '1m', 'address-families': 'ipv4', 'nexthop-choice': 'default', 'output.network': '203.0.113.0/24', 'output.redistribute': '', comment: '' }, 900000),
    R('routing/bgp/template', { name: 'ixp', as: 64512, 'router-id': '10.0.0.1', 'local.role': 'ebgp', 'routing-table': 'main', 'hold-time': '3m', 'address-families': 'ipv4,ipv6', comment: '' }, 800000),
  ];
  t['routing/bgp/session'] = [
    R('routing/bgp/session', { name: 'to-upstream-1', 'remote.address': '41.206.16.1', 'remote.as': 37637, state: 'established', uptime: '14d2h11m', 'prefix-count': 842311, 'local.role': 'ebgp', 'remote.id': '41.206.16.1', 'last-error': '', established: 'yes' }, 1200000),
    R('routing/bgp/session', { name: 'to-ixp-1', 'remote.address': '196.60.8.13', 'remote.as': 30986, state: 'established', uptime: '6d4h', 'prefix-count': 214880, 'local.role': 'ebgp', established: 'yes' }, 500000),
  ];
  t['routing/bgp/advertisement'] = [
    R('routing/bgp/advertisement', { prefix: '203.0.113.0/24', nexthop: `${WAN}.2`, 'as-path': '64512', 'local-pref': '100', communities: '64512:100', origin: 'igp' }, 300000),
    R('routing/bgp/advertisement', { prefix: '198.51.100.0/24', nexthop: `${WAN}.2`, 'as-path': '64512', 'local-pref': '100', origin: 'igp' }, 300000),
  ];
  t['routing/rip'] = [R('routing/rip', { name: 'rip1', interfaces: 'vlan10', 'distribute-default': 'never', 'redistribute-connected': 'no', metric: 1, routes: '', comment: 'legacy lab' }, 400000)];
  t['routing/bfd/configuration'] = [R('routing/bfd/configuration', { name: 'default', interfaces: 'vlan10,sfp-sfpplus1', 'min-tx': '200ms', 'min-rx': '200ms', multiplier: 3, 'transmit-interval': '200ms', 'receive-interval': '200ms', comment: '' }, 500000)];
  t['routing/filter/rule'] = [
    R('routing/filter/rule', { chain: 'bgp-in', rule: 'if (bgp-med != 0) { reject }', comment: 'strip default MED' }, 600000),
    R('routing/filter/rule', { chain: 'bgp-in', rule: 'if (protocol bgp && bgp-as-path-length > 30) { accept }', comment: '' }, 600000),
    R('routing/filter/rule', { chain: 'bgp-out', rule: 'if (dst==203.0.113.0/24) { set bgp-med 100; accept }', comment: 'prepend control' }, 600000),
    R('routing/filter/rule', { chain: 'ospf-out', rule: 'if (protocol connected) { accept }', disabled: true, comment: '' }, 600000),
  ];
  t['routing/filter/select-rule'] = [R('routing/filter/select-rule', { chain: 'bgp-in', do: 'jump', rule: 'bgp-in', comment: '' }, 600000)];
  t['routing/filter/num-list'] = [
    R('routing/filter/num-list', { name: 'private-as', ranges: '64512-65534,4200000000-4294967294', comment: 'RFC6996' }, 700000),
    R('routing/filter/num-list', { name: 'bogon-as', ranges: '0,23456,64496-64511', comment: '' }, 700000),
  ];
  t['routing/settings'] = [{ 'check-gateway-ping-timeout': '10s', 'single-process': 'yes', 'max-sessions': 'none' }];

  /* -------------------------- QUEUES ------------------------ */
  t['queue/simple'] = [
    R('queue/simple', { name: 'guest-wifi', target: `${GUEST}.0/24`, 'max-limit': '20M/50M', 'limit-at': '5M/10M', 'burst-limit': '30M/60M', 'burst-threshold': '15M/25M', 'burst-time': '16s/16s', priority: '8/8', queue: 'cake', time: '', comment: 'guest shaping' }, 900000),
    R('queue/simple', { name: 'office-vlan', target: '172.16.10.0/24', 'max-limit': '50M/100M', 'limit-at': '10M/20M', priority: '6/6', queue: 'fq-codel', comment: '' }, 900000),
    R('queue/simple', { name: 'server-web', target: '172.16.10.30/32', 'max-limit': '100M/100M', 'limit-at': '20M/20M', priority: '4/4', queue: 'pcq-upload-default/pcq-download-default', comment: 'web server' }, 800000),
    R('queue/simple', { name: 'ceo-laptop', target: `${LAN}.44/32`, 'max-limit': '30M/30M', priority: '2/2', comment: 'priority user' }, 700000),
    R('queue/simple', { name: 'throttle-heavy', target: '0.0.0.0/0', 'max-limit': '4M/4M', 'packet-marks': 'throttle', priority: '8/8', comment: 'bulk downloads' }, 600000),
    R('queue/simple', { name: 'kids-devices', target: '192.168.88.150/32', 'max-limit': '10M/10M', 'limit-at': '1M/1M', priority: '8/8', comment: '' }, 500000),
    R('queue/simple', { name: 'voip-priority', target: '172.16.10.0/24', 'max-limit': '5M/5M', 'packet-marks': 'voip', priority: '1/1', comment: 'QoS for voice' }, 400000),
    R('queue/simple', { name: 'lte-backup-cap', target: '0.0.0.0/0', 'max-limit': '15M/15M', 'limit-at': '3M/3M', disabled: true, comment: 'data cap helper' }, 300000),
  ];
  t['queue/tree'] = [
    R('queue/tree', { name: 'total-down', parent: 'global', 'packet-mark': 'download', 'max-limit': '200M', priority: '8', bucket: '0/0', comment: '' }, 900000),
    R('queue/tree', { name: 'total-up', parent: 'global', 'packet-mark': 'upload', 'max-limit': '100M', priority: '8', comment: '' }, 900000),
    R('queue/tree', { name: 'voip-up', parent: 'total-up', 'packet-mark': 'voip', 'max-limit': '5M', 'limit-at': '2M', priority: '1', comment: 'voice gets priority' }, 800000),
    R('queue/tree', { name: 'http-down', parent: 'total-down', 'packet-mark': 'download', 'max-limit': '150M', 'limit-at': '20M', priority: '6', comment: '' }, 700000),
    R('queue/tree', { name: 'throttled-down', parent: 'total-down', 'packet-mark': 'throttle', 'max-limit': '4M', priority: '8', comment: '' }, 600000),
  ];
  t['queue/type'] = [
    { name: 'default', kind: 'pfifo', 'pfifo-limit': 50 },
    { name: 'default-small', kind: 'pfifo', 'pfifo-limit': 10 },
    { name: 'pcq-upload-default', kind: 'pcq', 'pcq-rate': '0', 'pcq-classifier': 'src-address', 'pcq-total-limit': '2000' },
    { name: 'pcq-download-default', kind: 'pcq', 'pcq-rate': '0', 'pcq-classifier': 'dst-address', 'pcq-total-limit': '2000' },
    { name: 'fq-codel', kind: 'fq-codel', 'fq-codel-limit': '10240', 'fq-codel-interval': '100ms' },
    { name: 'cake', kind: 'cake', 'cake-bandwidth': '0', 'cake-flowmode': 'triple-isolate', 'cake-diffserv': 'diffserv3', 'cake-nat': 'yes' },
    { name: 'sfq', kind: 'sfq', 'sfq-perturb': '5' },
    { name: 'red', kind: 'red', 'red-limit': 200 },
  ];

  /* ------------------------- WIRELESS ----------------------- */
  t['interface/wifi'] = [
    R('interface/wifi', { name: 'wifi1', ssid: 'Accra-Office', configuration: 'cfg-office', security: 'sec-office', datapath: 'dp-lan', master: '', band: '2ghz-ax', channel: 'auto', 'country': 'GH', running: true, state: 'running-ap', uptime: '14d2h', comment: '' }, 1200000),
    R('interface/wifi', { name: 'wifi2', ssid: 'Accra-Guest', configuration: 'cfg-guest', security: 'sec-guest', datapath: 'dp-guest', band: '5ghz-ax', channel: 'auto', country: 'GH', running: true, state: 'running-ap', uptime: '14d2h', comment: 'captive portal' }, 1200000),
    R('interface/wifi', { name: 'wifi3-backhaul', ssid: 'PTP-CoreBackhaul', configuration: 'cfg-bridge', security: 'sec-bridge', datapath: 'dp-lan', mode: 'station-bridge', running: true, state: 'running-bridge', comment: '5GHz backhaul to annex' }, 900000),
    R('interface/wifi', { name: 'wifi-lab', ssid: 'Lab-Test', configuration: 'cfg-office', security: 'sec-office', datapath: 'dp-lan', disabled: true, state: 'disabled', comment: 'bench testing' }, 90000),
  ];
  t['interface/wifi/configuration'] = [
    R('interface/wifi/configuration', { name: 'cfg-office', ssid: 'Accra-Office', country: 'GH', mode: 'ap', band: '2ghz-ax', channel: 'auto', width: '20/40mhz', 'hide-ssid': false, 'tx-power': 20, 'antenna-gain': 3, 'dtim-period': '1', installation: 'indoor', 'qos-classifier': 'wmm', 'multicast-enhancer': 'disabled', comment: 'staff network' }, 1200000),
    R('interface/wifi/configuration', { name: 'cfg-guest', ssid: 'Accra-Guest', country: 'GH', mode: 'ap', band: '5ghz-ax', channel: 'auto', width: '20/40/80mhz', 'hide-ssid': false, 'tx-power': 17, installation: 'indoor', comment: 'guest, isolated' }, 1200000),
    R('interface/wifi/configuration', { name: 'cfg-bridge', ssid: 'PTP-CoreBackhaul', country: 'GH', mode: 'station-bridge', band: '5ghz-ax', width: '20/40/80mhz', 'hide-ssid': true, 'tx-power': 25, installation: 'outdoor', comment: 'point-to-point' }, 900000),
  ];
  t['interface/wifi/security'] = [
    R('interface/wifi/security', { name: 'sec-office', 'authentication-types': 'wpa2-psk,wpa3-psk', passphrase: '********', 'encryption': 'ccmp', 'group-key-update': '5m', 'management-protection': 'allowed', 'ft': true, 'ft-over-ds': true, comment: 'WPA2/WPA3 mixed' }, 1200000),
    R('interface/wifi/security', { name: 'sec-guest', 'authentication-types': 'wpa2-psk', passphrase: '********', 'group-key-update': '10m', comment: 'guest PSK rotates monthly' }, 1200000),
    R('interface/wifi/security', { name: 'sec-bridge', 'authentication-types': 'wpa2-psk', passphrase: '********', 'management-protection': 'required', comment: '' }, 900000),
  ];
  t['interface/wifi/datapath'] = [
    R('interface/wifi/datapath', { name: 'dp-lan', bridge: 'bridge1', 'vlan-id': 1, 'client-isolation': false, 'bridge-cost': 10, 'traffic-processing': 'local', comment: '' }, 1200000),
    R('interface/wifi/datapath', { name: 'dp-guest', bridge: 'bridge-guest', 'vlan-id': 20, 'client-isolation': true, 'bridge-cost': 10, comment: 'isolate guests' }, 1200000),
  ];
  t['interface/wifi/registration-table'] = Array.from({ length: 14 }).map((_, i) => {
    const r = rng(3000 + i);
    const guest = i > 9;
    return R('interface/wifi/registration-table', {
      'mac-address': mac(r), interface: guest ? 'wifi2' : i % 3 === 0 ? 'wifi2' : 'wifi1', ssid: guest ? 'Accra-Guest' : 'Accra-Office',
      uptime: duration(r), signal: `-${int(38, 74, r)}dBm`, 'tx-rate': `${pick([86, 144, 300, 433, 866, 1200], r)}Mbps`, 'rx-rate': `${pick([72, 130, 288, 400, 780, 1100], r)}Mbps`,
      packets: int(1000, 900000, r), bytes: int(1e5, 9e8, r), 'tx-packets': int(1000, 500000, r), 'rx-signal': `-${int(40, 76, r)}dBm`,
      authorized: true, 'last-ip': guest ? `${GUEST}.${int(100, 240, r)}` : `${LAN}.${int(100, 200, r)}`,
      'eap-identity': '', 'interface-type': 'wifi',
    }, int(60, 40000, r));
  });
  t['interface/wifi/access-list'] = [
    R('interface/wifi/access-list', { action: 'accept', 'mac-address': '74:4D:28:11:22:33', interface: 'wifi1', 'signal-range': '-70..120', comment: 'always allow office printer' }, 700000),
    R('interface/wifi/access-list', { action: 'reject', 'mac-address': mac(rng(77)), interface: 'wifi1', 'signal-range': '0..-95', 'allow-signal-out-of-range': false, comment: 'far clients rejected' }, 700000),
    R('interface/wifi/access-list', { action: 'accept', 'mac-address': mac(rng(78)), 'time': '08:00:00-18:00:00', interface: 'wifi2', comment: 'guest hours' }, 600000),
  ];
  t['interface/wifi/channel'] = [
    { name: 'channel-1', band: '2ghz-ax', frequency: '2412', width: '20mhz', 'tx-power': '20' },
    { name: 'channel-6', band: '2ghz-ax', frequency: '2437', width: '20mhz', 'tx-power': '20' },
    { name: 'channel-36', band: '5ghz-ax', frequency: '5180', width: '20/40/80mhz', 'tx-power': '23' },
    { name: 'channel-100', band: '5ghz-ax', frequency: '5500', width: '20/40/80mhz', 'tx-power': '23' },
  ];
  t['interface/wifi/radio'] = [
    { name: 'wifi1', 'mac-address': '74:4D:28:AB:CD:01', band: '2ghz-ax', channel: '2437/20mhz', 'current-channel': '2437/20mhz', width: '20mhz', 'registered-clients': '9', interfaces: 'wifi1' },
    { name: 'wifi2', 'mac-address': '74:4D:28:AB:CD:02', band: '5ghz-ax', channel: '5180/20/40/80mhz', 'current-channel': '5180/20/40/80mhz', width: '20/40/80mhz', 'registered-clients': '5', interfaces: 'wifi2,wifi3-backhaul' },
  ];
  t['interface/wifi/provisioning'] = [R('interface/wifi/provisioning', { action: 'create-dynamic-enabled', 'identity-regexp': '^AP-', 'address-ranges': '192.168.88.0/24', 'master-configuration': 'cfg-office', 'slave-configurations': 'cfg-guest', 'name-format': 'wifi-%d', comment: '' }, 600000)];

  /* ---------------------------- PPP ------------------------- */
  t['interface/pppoe-client'] = [
    R('interface/pppoe-client', { name: 'pppoe-out1', interface: 'ether6', user: 'isp-account@provider.gh', password: '********', service: 'any', 'ac-name': 'BRAS-ACC-01', profile: 'default-encryption', 'add-default-route': true, 'default-route-distance': 1, 'use-peer-dns': true, 'dial-on-demand': false, 'keepalive-timeout': '10s', 'max-mtu': 1492, 'max-mru': 1492, mtru: 1492, mrru: 1500, uptime: '14d2h11m', status: 'connected', 'local-address': '10.200.4.18', 'remote-address': '10.200.0.1', comment: 'secondary WAN' }, 1200000),
    R('interface/pppoe-client', { name: 'pppoe-out2', interface: 'ether7', user: 'backup@provider.gh', password: '********', 'add-default-route': true, 'default-route-distance': 3, 'use-peer-dns': false, disabled: true, status: 'disabled', comment: 'cold standby' }, 400000),
  ];
  t['ppp/profile'] = [
    R('ppp/profile', { name: 'default', 'local-address': `${LAN}.1`, 'remote-address': 'pool-vpn', 'dns-server': `${LAN}.1`, 'rate-limit': '', 'session-timeout': '0s', 'idle-timeout': '0s', 'only-one': 'no', 'change-tcp-mss': 'yes', 'use-compression': 'default', 'use-encryption': 'default', 'use-ipv6': 'yes', 'use-mpls': 'default', 'use-upnp': 'default', 'use-radius': false, comment: '' }, 1200000),
    R('ppp/profile', { name: 'residential-10M', 'local-address': `${LAN}.1`, 'remote-address': 'pool-vpn', 'dns-server': '1.1.1.1,9.9.9.9', 'rate-limit': '10M/10M', 'session-timeout': '0s', 'idle-timeout': '10m', 'only-one': 'yes', 'change-tcp-mss': 'yes', 'use-encryption': 'required', 'use-radius': true, 'address-list': 'pppoe-users', comment: 'home fibre plan' }, 900000),
    R('ppp/profile', { name: 'residential-50M', 'local-address': `${LAN}.1`, 'remote-address': 'pool-vpn', 'dns-server': '1.1.1.1,9.9.9.9', 'rate-limit': '50M/50M', 'only-one': 'yes', 'change-tcp-mss': 'yes', 'use-encryption': 'required', 'address-list': 'pppoe-users', comment: 'home fibre pro' }, 900000),
    R('ppp/profile', { name: 'business', 'local-address': `${LAN}.1`, 'remote-address': 'pool-vpn', 'dns-server': '1.1.1.1,9.9.9.9', 'rate-limit': '100M/100M', 'only-one': 'yes', 'change-tcp-mss': 'yes', 'use-compression': 'no', 'use-encryption': 'required', 'use-upnp': 'yes', comment: 'SLA customers' }, 800000),
  ];
  t['ppp/secret'] = Array.from({ length: 18 }).map((_, i) => {
    const r = rng(4000 + i);
    const profile = pick(['residential-10M', 'residential-10M', 'residential-50M', 'residential-50M', 'business'], r);
    return R('ppp/secret', {
      name: `${pick(people, r)}${int(1, 99, r)}`, password: pick(['voucher2026', 'fibre-8821', 'sla-4471', 'ppp-kofi'], r),
      service: 'pppoe', profile, 'remote-address': '', 'local-address': '', routes: i === 0 ? '203.0.113.0/24' : '',
      'limit-bytes-in': i % 5 === 0 ? String(int(5, 100, r)) + 'G' : '', 'limit-bytes-out': '', 'last-logged-out': dateTimeString(int(60, 90000, r)),
      'caller-id': i < 6 ? `${WAN}.${int(2, 60, r)}` : '', disabled: i === 12, comment: i === 0 ? 'static /29 customer' : '',
    }, int(3600, 900000, r));
  });
  t['ppp/active'] = Array.from({ length: 11 }).map((_, i) => {
    const r = rng(4500 + i);
    return R('ppp/active', {
      name: `${pick(people, r)}${int(1, 99, r)}`, service: pick(['pppoe', 'pppoe', 'l2tp', 'ovpn'], r),
      'caller-id': `${WAN}.${int(2, 60, r)}:${int(1000, 6000, r)}`, address: pick(['10.200.0.10', '10.200.0.11', '10.200.0.12', '10.200.0.13', '10.200.0.14', '10.200.0.15'], r),
      uptime: duration(r), encoding: 'encryption-aes-cbc', 'session-id': `0x${hex(r, 8).toUpperCase()}`, limitBytesIn: '', limitBytesOut: '',
    }, int(120, 80000, r));
  });
  t['ppp/aaa'] = [{ 'use-radius': true, accounting: true, 'interim-update': '5m', 'use-circuit-id-in-nas-port-id': false, 'use-realm-for-roaming': false }];
  t['ppp/l2tp-secret'] = [R('ppp/l2tp-secret', { name: 'roadwarrior-a', password: '********', service: 'l2tp', profile: 'default', 'remote-address': 'pool-vpn', comment: '' }, 400000)];

  /* ---------------------------- VPN ------------------------- */
  t['interface/wireguard'] = [
    R('interface/wireguard', { name: 'wg-mgmt', 'listen-port': 13231, 'private-key': '********', 'public-key': 'hL8oQdF2x7mZ4pR9vN1bY6tK3sW5cA0eJgDqUvXiHnM=', mtu: 1420, comment: 'management tunnel' }, 400000),
    R('interface/wireguard', { name: 'wg-branch', 'listen-port': 51820, 'private-key': '********', 'public-key': 'Qx2fT7kL9wP3sD5gH8jM1vB4nC6zR0aEoYiUkJdXfVw=', mtu: 1420, comment: 'site-to-site to Kumasi' }, 400000),
  ];
  t['interface/wireguard/peers'] = Array.from({ length: 7 }).map((_, i) => {
    const r = rng(5000 + i);
    return R('interface/wireguard/peers', {
      interface: i % 3 === 0 ? 'wg-branch' : 'wg-mgmt',
      'public-key': `${hex(r, 32)}=`,
      'endpoint-address': i % 3 === 0 ? '' : `${WAN}.${int(2, 80, r)}`,
      'endpoint-port': i % 3 === 0 ? '' : int(1024, 65000, r),
      'allowed-address': i % 3 === 0 ? '192.168.50.0/24' : `10.88.0.${i + 2}/32`,
      'preshared-key': '', 'persistent-keepalive': i % 3 === 0 ? '25s' : '0s',
      'current-endpoint-address': i % 3 === 0 ? '' : `${WAN}.${int(2, 80, r)}`,
      'current-endpoint-port': i % 3 === 0 ? '' : int(1024, 65000, r),
      'last-handshake': i === 6 ? 'never' : duration(r),
      rx: int(1e5, 9e7, r), tx: int(1e5, 9e7, r), responder: chance(0.4, r),
      comment: pick(['laptop', 'phone', 'branch router', 'CI runner', ''], r),
    }, int(300, 400000, r));
  });
  t['interface/ovpn-client'] = [R('interface/ovpn-client', { name: 'ovpn-out1', 'connect-to': 'vpn.provider.net', port: 1194, user: 'client-accra', password: '********', profile: 'default', certificate: 'none', auth: 'sha256', cipher: 'aes-256-cbc', mode: 'ip', 'add-default-route': false, 'verify-server-certificate': true, 'tls-version': 'any', 'max-mtu': 1500, status: 'connected', comment: '' }, 600000)];
  t['interface/sstp-client'] = [R('interface/sstp-client', { name: 'sstp-out1', 'connect-to': 'sstp.example.net', port: 443, user: 'branch-kumasi', password: '********', profile: 'business', 'add-default-route': false, 'verify-server-certificate': true, 'keepalive-timeout': '60s', status: 'connected', comment: '' }, 600000)];
  t['ip/ipsec/peer'] = [
    R('ip/ipsec/peer', { name: 'peer-branch', address: '41.204.11.8', port: 500, profile: 'ike2-main', 'exchange-mode': 'ike2', 'send-initial-contact': true, comment: 'branch office' }, 800000),
    R('ip/ipsec/peer', { name: 'peer-partner', address: '196.201.9.4', port: 500, profile: 'ike2-main', 'exchange-mode': 'ike2', 'send-initial-contact': true, comment: 'partner VPN' }, 700000),
  ];
  t['ip/ipsec/profile'] = [
    R('ip/ipsec/profile', { name: 'ike2-main', 'hash-algorithm': 'sha256', 'enc-algorithm': 'aes-256', 'dh-group': 'modp2048', lifetime: '1d', 'proposal-check': 'obey', 'nat-traversal': true, 'generate-policy': 'port-strict', comment: '' }, 800000),
    R('ip/ipsec/profile', { name: 'ike2-strict', 'hash-algorithm': 'sha512', 'enc-algorithm': 'aes-256-gcm', 'dh-group': 'ecp384', lifetime: '1h', 'proposal-check': 'claim', 'nat-traversal': false, comment: 'hardened' }, 500000),
  ];
  t['ip/ipsec/proposal'] = [
    R('ip/ipsec/proposal', { name: 'ph2-aes256', 'auth-algorithms': 'sha256', 'enc-algorithms': 'aes-256-cbc', lifetime: '30m', 'pfs-group': 'modp2048', comment: '' }, 800000),
    R('ip/ipsec/proposal', { name: 'ph2-gcm', 'auth-algorithms': 'sha1', 'enc-algorithms': 'aes-256-gcm', lifetime: '1h', 'pfs-group': 'none', comment: 'hardware offload' }, 600000),
  ];
  t['ip/ipsec/identity'] = [
    R('ip/ipsec/identity', { peer: 'peer-branch', 'my-id': 'ip:41.204.11.9', 'remote-id': 'ip:41.204.11.8', 'auth-method': 'pre-shared-key', secret: '********', 'generate-policy': 'port-strict', 'match-by': 'remote-id', policy: '', comment: '' }, 800000),
    R('ip/ipsec/identity', { peer: 'peer-partner', 'my-id': 'fqdn:mtk-accra.example.net', 'remote-id': 'fqdn:partner.example.net', 'auth-method': 'rsa-signature', certificate: 'vpn-server', 'generate-policy': 'no', 'match-by': 'remote-id', comment: '' }, 700000),
  ];
  t['ip/ipsec/policy'] = [
    R('ip/ipsec/policy', { 'src-address': '172.16.10.0/24', 'dst-address': '192.168.50.0/24', protocol: 'all', action: 'encrypt', level: 'require', 'ipsec-protocols': 'esp', proposal: 'ph2-aes256', tunnel: true, peer: 'peer-branch', 'sa-src-address': '41.204.11.9', 'sa-dst-address': '41.204.11.8', 'ph2-count': 2, ph2state: 'established', dynamic: false, comment: 'branch subnet' }, 800000),
    R('ip/ipsec/policy', { 'src-address': '10.20.0.0/16', 'dst-address': '10.60.0.0/16', protocol: 'all', action: 'encrypt', level: 'require', 'ipsec-protocols': 'esp', proposal: 'ph2-gcm', tunnel: true, peer: 'peer-partner', 'ph2-count': 1, dynamic: false, comment: 'partner peering' }, 700000),
    R('ip/ipsec/policy', { 'src-address': '0.0.0.0/0', 'dst-address': '0.0.0.0/0', protocol: 'all', action: 'none', level: 'require', comment: 'default bypass' }, 800000),
  ];
  t['ip/ipsec/mode-config'] = [R('ip/ipsec/mode-config', { name: 'cfg-roadwarrior', 'address-pool': 'pool-vpn', 'address-prefix-length': 24, 'split-include': '172.16.10.0/24,192.168.88.0/24', 'system-dns': true, 'send-dns': true, 'dns-server': `${LAN}.1`, comment: '' }, 500000)];
  t['ip/ipsec/active-peers'] = [
    R('ip/ipsec/active-peers', { 'remote-address': '41.204.11.8', state: 'established', uptime: '6d4h21m', 'ph2-total': 2, rx: int(1e6, 9e8, rng(1)), tx: int(1e6, 9e8, rng(2)), 'local-address': '41.204.11.9', side: 'responder', responder: true, 'dynamic-address': '' }, 500000),
    R('ip/ipsec/active-peers', { 'remote-address': '196.201.9.4', state: 'established', uptime: '2d8h', 'ph2-total': 1, rx: int(1e6, 9e8, rng(3)), tx: int(1e6, 9e8, rng(4)), 'local-address': '41.204.11.9', side: 'initiator', responder: false }, 200000),
  ];
  t['ip/ipsec/installed-sa'] = Array.from({ length: 6 }).map((_, i) => {
    const r = rng(6000 + i);
    return R('ip/ipsec/installed-sa', {
      'src-address': pick(['172.16.10.0/24', '10.20.0.0/16'], r), 'dst-address': pick(['192.168.50.0/24', '10.60.0.0/16'], r),
      state: i === 5 ? 'dying' : 'established', spi: `0x${hex(r, 8)}`, 'auth-algorithm': 'sha256', 'enc-algorithm': pick(['aes-cbc', 'aes-gcm'], r),
      bytes: int(1e5, 9e9, r), 'ph2-state': 'established', uptime: duration(r), 'packet-count': int(100, 900000, r),
    }, int(120, 500000, r));
  });
  t['ip/ipsec/settings'] = [{ 'src-address': false, logging: 'yes', 'max-peers': 'none' }];
  t['zerotier'] = [R('zerotier', { name: '8056c2e21c000001', status: 'OK', identity: 'a1b2c3d4e5f6a7b8:c9d0e1f2a3b4c5d6', interface: 'zt1', comment: 'site mesh' }, 900000)];
  t['zerotier/peer'] = [R('zerotier/peer', { id: 'a1b2c3d4e5f6a7b8', address: '41.204.11.8/9993', path: 'DIRECT', latency: '12ms', version: '1.12.2', role: 'LEAF' }, 900000)];

  /* -------------------------- HOTSPOT ----------------------- */
  t['ip/hotspot'] = [
    R('ip/hotspot', { name: 'hotspot-guest', interface: 'bridge-guest', 'address-pool': 'pool-guest', profile: 'hs-guest', 'idle-timeout': '30m', 'keepalive-timeout': '2m', 'addresses-per-mac': '2', addresses: `${GUEST}.1`, hops: 1, comment: 'captive portal' }, 900000),
    R('ip/hotspot', { name: 'hotspot-lobby', interface: 'vlan20', 'address-pool': 'pool-guest', profile: 'hs-lobby', 'idle-timeout': '15m', addresses: `${GUEST}.1`, comment: 'lobby WiFi' }, 800000),
  ];
  t['ip/hotspot/profile'] = [
    R('ip/hotspot/profile', { name: 'hs-guest', 'hotspot-address': `${GUEST}.1`, 'dns-name': 'login.example.net', 'html-directory': 'hotspot', 'http-cookie-lifetime': '3d', 'login-by': 'http-chap,http-pap,mac-cookie', 'use-radius': false, 'rate-limit': '', 'session-timeout': '8h', 'idle-timeout': '30m', 'open-status-page': 'always', 'ssl-certificate': 'hotspot-login', 'transparent-proxy': true, 'split-user-domain': false, 'smtp-server': '', 'nas-port-type': 'wireless-802.11', 'radius-accounting': true, 'radius-interim-update': 'received', comment: '' }, 900000),
    R('ip/hotspot/profile', { name: 'hs-lobby', 'hotspot-address': `${GUEST}.1`, 'dns-name': 'lobby.example.net', 'html-directory': 'hotspot-lobby', 'login-by': 'http-pap,mac-cookie', 'session-timeout': '2h', 'ssl-certificate': 'hotspot-login', comment: 'reception kiosk' }, 800000),
  ];
  t['ip/hotspot/user/profile'] = [
    R('ip/hotspot/user/profile', { name: 'default', 'shared-users': '1', 'rate-limit': '', 'session-timeout': '0s', 'idle-timeout': '0s', 'keepalive-timeout': '2m', 'add-mac-cookie': true, 'mac-cookie-timeout': '3d', 'status-autorefresh': '1m', 'on-login': 'hotspot-welcome', comment: '' }, 900000),
    R('ip/hotspot/user/profile', { name: 'guest-profile', 'shared-users': '2', 'rate-limit': '8M/8M', 'session-timeout': '8h', 'idle-timeout': '30m', 'add-mac-cookie': true, 'mac-cookie-timeout': '1d', 'on-login': '', comment: 'voucher plan 8h' }, 900000),
    R('ip/hotspot/user/profile', { name: 'staff-1d', 'shared-users': '3', 'rate-limit': '20M/20M', 'session-timeout': '1d', 'idle-timeout': '1h', 'add-mac-cookie': true, comment: 'daily staff pass' }, 800000),
  ];
  t['ip/hotspot/user'] = Array.from({ length: 14 }).map((_, i) => {
    const r = rng(7000 + i);
    const profile = pick(['guest-profile', 'guest-profile', 'default', 'staff-1d'], r);
    const up = int(60, 20000, r);
    return R('ip/hotspot/user', {
      name: i === 0 ? 'reception-desk' : `guest-${int(1000, 9999, r)}`, password: pick(['welcome1', 'sunrise22', 'accra2026', 'ghana77'], r),
      profile, 'limit-uptime': pick(['8h', '1d', '0s'], r), 'limit-bytes-in': '', 'limit-bytes-out': '',
      'limit-bytes-total': i % 4 === 0 ? '5G' : '', 'mac-address': i === 0 ? '74:4D:28:99:88:77' : '',
      server: 'all', uptime: `${Math.floor(up / 3600)}h${Math.floor((up % 3600) / 60)}m`, 'bytes-in': int(1e4, 9e7, r), 'bytes-out': int(1e4, 4e7, r),
      comment: i === 0 ? 'kiosk account' : '', disabled: i === 13,
    }, up);
  });
  t['ip/hotspot/active'] = Array.from({ length: 20 }).map((_, i) => {
    const r = rng(7500 + i);
    const up = int(60, 30000, r);
    return R('ip/hotspot/active', {
      server: i > 14 ? 'hotspot-lobby' : 'hotspot-guest', user: i === 0 ? 'reception-desk' : `guest-${int(1000, 9999, r)}`,
      address: `${GUEST}.${int(100, 240, r)}`, 'mac-address': mac(r), 'login-by': pick(['http-chap', 'mac-cookie', 'http-pap'], r),
      uptime: `${Math.floor(up / 3600)}h${Math.floor((up % 3600) / 60)}m${up % 60}s`, 'bytes-in': int(1e4, 2e8, r), 'bytes-out': int(1e4, 9e7, r),
      'idle-time': `${int(0, 20, r)}m${int(1, 59, r)}s`, 'session-time-left': pick(['1h20m', '4h', '7h11m', '25m'], r), radius: false,
    }, up);
  });
  t['ip/hotspot/host'] = Array.from({ length: 16 }).map((_, i) => {
    const r = rng(7700 + i);
    const up = int(60, 40000, r);
    return R('ip/hotspot/host', {
      'mac-address': mac(r), address: `${GUEST}.${int(100, 240, r)}`, 'to-address': '', server: i > 12 ? 'hotspot-lobby' : 'hotspot-guest',
      uptime: `${Math.floor(up / 3600)}h${Math.floor((up % 3600) / 60)}m`, 'idle-time': `${int(0, 30, r)}m`, dynamic: i > 3, blocked: i === 15, authorized: i < 12,
    }, up);
  });
  t['ip/hotspot/ip-binding'] = [
    R('ip/hotspot/ip-binding', { address: `${GUEST}.10`, 'mac-address': '74:4D:28:99:88:77', type: 'bypassed', server: 'hotspot-guest', comment: 'reception kiosk' }, 800000),
    R('ip/hotspot/ip-binding', { address: '', 'mac-address': mac(rng(31)), type: 'blocked', server: 'all', comment: 'abuse' }, 700000),
    R('ip/hotspot/ip-binding', { address: `${GUEST}.20`, 'mac-address': '', type: 'bypassed', server: 'hotspot-lobby', comment: 'smart TV' }, 600000),
  ];
  t['ip/hotspot/walled-garden'] = [
    R('ip/hotspot/walled-garden', { action: 'allow', server: 'hotspot-guest', 'dst-host': '*.example.net', 'dst-port': '', protocol: 'tcp', comment: 'company portal' }, 800000),
    R('ip/hotspot/walled-garden', { action: 'allow', server: 'hotspot-guest', 'dst-host': '*.whatsapp.net', protocol: 'tcp', comment: 'messaging allowed pre-login' }, 800000),
    R('ip/hotspot/walled-garden', { action: 'allow', server: 'hotspot-guest', 'dst-host': '*.gstatic.com', path: '/*', protocol: 'tcp', comment: '' }, 700000),
    R('ip/hotspot/walled-garden', { action: 'deny', server: 'hotspot-guest', 'dst-host': '*.tiktokcdn.com', protocol: 'tcp', comment: 'blocked on guest' }, 700000),
    R('ip/hotspot/walled-garden', { action: 'allow', server: 'all', 'dst-address': '1.1.1.1', protocol: 'udp', comment: 'DNS' }, 600000),
  ];
  t['ip/hotspot/cookie'] = Array.from({ length: 6 }).map((_, i) => R('ip/hotspot/cookie', { user: `guest-${int(1000, 9999, rng(8000 + i))}`, 'mac-address': mac(rng(8001 + i)), domain: 'lobby.example.net', 'expires-in': `${int(1, 22, rng(8002 + i))}h`, comment: '' }, 3000 + i * 100));

  /* -------------------------- RADIUS ------------------------ */
  t['radius'] = [
    R('radius', { service: 'hotspot', address: '172.16.10.53', secret: '********', 'authentication-port': 1812, 'accounting-port': 1813, timeout: '300ms', srcAddress: '', 'called-id': '', domain: '', comment: 'freeradius guest' }, 700000),
    R('radius', { service: 'ppp', address: '172.16.10.53', secret: '********', 'authentication-port': 1812, 'accounting-port': 1813, timeout: '300ms', comment: 'PPPoE billing' }, 700000),
    R('radius', { service: 'login', address: '172.16.10.54', secret: '********', 'authentication-port': 1812, 'accounting-port': 1813, timeout: '1s', comment: 'admin MFA relay', disabled: true }, 400000),
  ];
  t['radius/incoming'] = [R('radius/incoming', { accept: 'yes', port: 3799, address: '', comment: 'CoA from billing server' }, 400000)];
  t['user/aaa'] = [{ 'use-radius': true, accounting: true, 'interim-update': '5m', 'default-group': 'read', 'exclude-groups': 'full' }];
  t['user/active'] = [{ name: 'monitoring', address: `${LAN}.7`, via: 'api', when: '3h2m56s' }];

  /* ----------------------- USER MANAGER --------------------- */
  t['user-manager/user'] = Array.from({ length: 10 }).map((_, i) => {
    const r = rng(9000 + i);
    return R('user-manager/user', { name: `${pick(people, r)}@isp`, password: '********', group: 'default', comment: pick(['paid - 30d', 'trial', 'paid - 90d', ''], r), disabled: i === 9 }, int(3600, 900000, r));
  });
  t['user-manager/profile'] = [
    R('user-manager/profile', { name: 'trial-1d', 'name-for-users': 'Trial 1 Day', 'starts-when': 'first-auth', validity: '1d', price: '0', 'override-shared-users': 'no', 'lock-user': 'yes' }, 900000),
    R('user-manager/profile', { name: 'daily-5g', 'name-for-users': 'Daily 5GB', 'starts-when': 'first-auth', validity: '1d', price: '5.00', 'lock-user': 'yes' }, 900000),
    R('user-manager/profile', { name: 'monthly-30', 'name-for-users': 'Monthly 30 Days', 'starts-when': 'first-auth', validity: '30d', price: '45.00', 'override-shared-users': 'yes' }, 800000),
    R('user-manager/profile', { name: 'prepaid-50g', 'name-for-users': 'Prepaid 50GB', 'starts-when': 'first-auth', validity: '90d', price: '120.00' }, 700000),
  ];
  t['user-manager/limitation'] = [
    R('user-manager/limitation', { name: 'rate-5M', 'rate-limit-rx': '5M', 'rate-limit-tx': '5M', 'transfer-limit': '5G', 'uptime-limit': '1d' }, 900000),
    R('user-manager/limitation', { name: 'rate-20M', 'rate-limit-rx': '20M', 'rate-limit-tx': '20M', 'transfer-limit': '50G', 'uptime-limit': '30d' }, 900000),
    R('user-manager/limitation', { name: 'night-unlimited', 'rate-limit-rx': '50M', 'rate-limit-tx': '50M', 'transfer-limit': '0', 'uptime-limit': '0' }, 800000),
  ];
  t['user-manager/profile-limitation'] = [
    R('user-manager/profile-limitation', { profile: 'trial-1d', limitation: 'rate-5M' }, 900000),
    R('user-manager/profile-limitation', { profile: 'daily-5g', limitation: 'rate-5M' }, 900000),
    R('user-manager/profile-limitation', { profile: 'monthly-30', limitation: 'rate-20M' }, 800000),
  ];
  t['user-manager/session'] = Array.from({ length: 8 }).map((_, i) => {
    const r = rng(9500 + i);
    const up = int(120, 90000, r);
    return R('user-manager/session', {
      name: `0x${hex(r, 8)}`, user: `${pick(people, r)}@isp`, 'nas-port-id': `ether6:${int(100, 900, r)}`, 'nas-ip-address': `${WAN}.2`,
      uptime: `${Math.floor(up / 3600)}h${Math.floor((up % 3600) / 60)}m`, download: int(1e6, 9e9, r), upload: int(1e6, 3e9, r), status: 'active',
    }, up);
  });
  t['user-manager/router'] = [R('user-manager/router', { name: 'core-router', address: '172.16.10.1', secret: '********', authorize: 'yes', accounting: 'yes', 'coa-port': 3799, comment: '' }, 900000)];
  t['user-manager/advanced'] = [{ 'web-interface': true, port: 8443, tls: true, certificate: 'vpn-server', 'paypal-use-sandbox': true, 'paypal-user': 'merchant@example.net' }];
  t['user-manager/payment'] = [R('user-manager/payment', { name: 'mpesa-4471', currency: 'GHS', amount: '45.00', comment: 'monthly-30 via mobile money' }, 20000)];

  /* ------------------------ CONTAINERS ---------------------- */
  t['container/config'] = [{ 'registry-url': 'https://registry-1.docker.io', tmpdir: '/disk1/containers/tmp', 'ram-high': '512.0MiB', 'layer-update': true }];
  t['container'] = [
    R('container', { name: 'pihole-dns', image: 'docker.io/pihole/pihole:latest', interface: 'veth-dns', 'root-dir': '/disk1/containers/pihole', status: 'running', 'cpu-usage': 3, 'memory-usage': 128450560, 'memory-shared': 4194304, tag: 'latest', arch: 'arm64', comment: 'DNS ad-blocking' }, 900000),
    R('container', { name: 'grafana-agent', image: 'docker.io/grafana/agent:latest', interface: 'veth-agent', 'root-dir': '/disk1/containers/agent', status: 'running', 'cpu-usage': 1, 'memory-usage': 68157440, tag: 'latest', arch: 'arm64', comment: 'metrics push' }, 600000),
    R('container', { name: 'speedtest-server', image: 'docker.io/openspeedtest/server:latest', interface: 'veth-speed', 'root-dir': '/disk1/containers/speed', status: 'stopped', 'cpu-usage': 0, 'memory-usage': 0, disabled: true, comment: 'bench tooling' }, 300000),
    R('container', { name: 'nginx-portal', image: 'docker.io/library/nginx:alpine', interface: 'veth-web', 'root-dir': '/disk1/containers/nginx', status: 'error', 'cpu-usage': 0, 'memory-usage': 0, comment: 'portal (crashloop) — check mounts' }, 200000),
  ];
  t['container/envs'] = [
    R('container/envs', { name: 'TZ', value: 'Africa/Accra', list: 'pihole-env' }, 900000),
    R('container/envs', { name: 'WEBPASSWORD', value: '********', list: 'pihole-env' }, 900000),
    R('container/envs', { name: 'DNSMASQ_LISTENING', value: 'all', list: 'pihole-env' }, 900000),
    R('container/envs', { name: 'GF_SECURITY_ADMIN_PASSWORD', value: '********', list: 'agent-env' }, 600000),
  ];
  t['container/mounts'] = [
    R('container/mounts', { name: 'pihole-data', src: '/disk1/containers/pihole/etc', dst: '/etc/pihole', type: 'bind' }, 900000),
    R('container/mounts', { name: 'pihole-dnsmasq', src: '/disk1/containers/pihole/dnsmasq', dst: '/etc/dnsmasq.d', type: 'bind' }, 900000),
    R('container/mounts', { name: 'agent-config', src: '/disk1/containers/agent/config', dst: '/etc/agent', type: 'bind' }, 600000),
  ];
  t['container/network'] = [
    R('container/network', { name: 'bridge-containers', gateway: `${LAN}.2`, dns: `${LAN}.1`, nat: 'yes', veth: 'veth-dns,veth-agent', comment: '' }, 900000),
    R('container/network', { name: 'web-net', gateway: `${GUEST}.2`, dns: '1.1.1.1', nat: 'yes', veth: 'veth-web' }, 500000),
  ];
  t['container/image'] = [
    { tag: 'docker.io/library/alpine:latest', arch: 'arm64', os: 'linux', 'repo-digest': `sha256:${hex(rng(41), 64)}`, size: 8257536 },
    { tag: 'docker.io/pihole/pihole:latest', arch: 'arm64', os: 'linux', 'repo-digest': `sha256:${hex(rng(42), 64)}`, size: 219781529 },
    { tag: 'docker.io/grafana/agent:latest', arch: 'arm64', os: 'linux', 'repo-digest': `sha256:${hex(rng(43), 64)}`, size: 141557760 },
    { tag: 'docker.io/library/nginx:alpine', arch: 'arm64', os: 'linux', 'repo-digest': `sha256:${hex(rng(44), 64)}`, size: 52428800 },
    { tag: 'docker.io/openspeedtest/server:latest', arch: 'arm64', os: 'linux', 'repo-digest': `sha256:${hex(rng(45), 64)}`, size: 68157440 },
  ];

  /* ---------------------------- IoT ------------------------- */
  t['iot/leds'] = [
    { name: 'user-led', type: 'led', status: 'off', interface: '' },
    { name: 'sfp-sfpplus1-link', type: 'led', status: 'on', interface: 'sfp-sfpplus1' },
    { name: 'ether1-activity', type: 'led', status: 'auto', interface: 'ether1' },
    { name: 'lte1-signal', type: 'led', status: 'auto', interface: 'lte1' },
  ];
  t['iot/gpio'] = [
    { name: 'gpio0', output: false, input: true, direction: 'input' },
    { name: 'gpio1', output: true, input: false, direction: 'output' },
    { name: 'gpio2', output: false, input: false, direction: 'input' },
  ];
  t['iot/modbus'] = Array.from({ length: 5 }).map((_, i) => {
    const r = rng(9600 + i);
    return R('iot/modbus', { name: `modbus-${i}`, type: pick(['coil', 'register', 'input'], r), address: `192.168.88.${60 + i}`, register: String(int(0, 40000, r)), value: String(int(0, 1000, r)), timestamp: dateTimeString(int(1, 900, r)) }, int(5, 600, r));
  });
  t['iot/mqtt'] = [
    R('iot/mqtt', { name: 'broker-main', server: '192.168.88.30', port: 1883, 'client-id': 'mtk-accra', username: 'router', password: '********', topic: 'router/accra/#', 'keep-alive': '60', 'auto-connect': true, comment: 'home automation' }, 800000),
    R('iot/mqtt', { name: 'broker-backup', server: '10.88.0.30', port: 8883, 'client-id': 'mtk-accra-backup', username: '', password: '', topic: 'router/accra/#', 'auto-connect': true, disabled: true, comment: '' }, 300000),
  ];
  t['iot/mqtt/forwards'] = [
    R('iot/mqtt/forwards', { name: 'fwd-lte', 'mqtt-server': 'broker-main', topic: 'router/accra/lte', 'client-id': 'mtk-accra', 'expanded-topic': 'router/accra/lte/signal', field: 'signal-strength' }, 700000),
    R('iot/mqtt/forwards', { name: 'fwd-temp', 'mqtt-server': 'broker-main', topic: 'router/accra/temp', 'client-id': 'mtk-accra', field: 'temperature' }, 700000),
  ];
  t['iot/mqtt/subscriptions'] = [
    R('iot/mqtt/subscriptions', { topic: 'router/accra/cmd', 'mqtt-server': 'broker-main', qos: 1, 'on-message': ':log info ("mqtt: " . $message)', comment: 'remote commands' }, 700000),
    R('iot/mqtt/subscriptions', { topic: 'home/thermostat/set', 'mqtt-server': 'broker-main', qos: 0, 'on-message': '/iot/gpio set gpio1 value=$message', comment: '' }, 600000),
  ];
  t['iot/serial'] = [{ enabled: false, 'baud-rate': '115200', 'data-bits': '8', parity: 'none', 'stop-bits': '1', 'flow-control': 'none' }];

  /* --------------------------- MPLS ------------------------- */
  t['mpls/ldp'] = [{ enabled: true, 'lsr-id': '10.0.0.1', 'transport-addresses': '10.0.0.1', 'path-vector-limit': '255', 'use-explicit-null': false, 'afi-ip': true, 'afi-vpn': false }];
  t['mpls/interface'] = [
    R('mpls/interface', { interface: 'sfp-sfpplus1', comment: 'core link' }, 900000),
    R('mpls/interface', { interface: 'vlan10', comment: '' }, 900000),
  ];
  t['mpls/local-mapping'] = [
    R('mpls/local-mapping', { 'dst-address': '203.0.113.0/24', label: 1001, comment: '' }, 800000),
    R('mpls/local-mapping', { 'dst-address': '10.99.0.0/16', label: 1002, comment: '' }, 800000),
  ];
  t['mpls/remote-mapping'] = [
    R('mpls/remote-mapping', { 'dst-address': '192.168.50.0/24', label: 2001, nexthop: '10.0.0.2', path: 'vlan10' }, 800000),
    R('mpls/remote-mapping', { 'dst-address': '10.60.0.0/16', label: 2002, nexthop: '10.0.0.3', path: 'sfp-sfpplus1' }, 800000),
    R('mpls/remote-mapping', { 'dst-address': '172.20.0.0/16', label: 2003, nexthop: '10.0.0.2', path: 'vlan10' }, 700000),
  ];
  t['mpls/forwarding-table'] = Array.from({ length: 4 }).map((_, i) => {
    const r = rng(9700 + i);
    return R('mpls/forwarding-table', { label: String(2000 + i), 'in-label': 2000 + i, 'out-label': 3000 + i, nexthop: pick(['10.0.0.2', '10.0.0.3'], r), interface: pick(['vlan10', 'sfp-sfpplus1'], r), bytes: int(1e5, 9e9, r) }, int(60, 90000, r));
  });

  /* --------------------------- IPv6 ------------------------- */
  t['ipv6/address'] = [
    R('ipv6/address', { address: '2a02:1348:14c:1a00::1/64', interface: 'bridge1', 'actual-interface': 'bridge1', advertise: true, 'eui-64': false, 'no-dad': true, deprecated: false, dynamic: false, comment: 'LAN IPv6' }, 900000),
    R('ipv6/address', { address: '2a02:1348:14c:1a20::1/64', interface: 'bridge-guest', 'actual-interface': 'bridge-guest', advertise: true, 'eui-64': false, dynamic: false, comment: '' }, 900000),
    R('ipv6/address', { address: 'fe80::744d:28ff:feaa:110/64', interface: 'bridge1', 'actual-interface': 'bridge1', advertise: false, 'eui-64': true, dynamic: true, comment: 'link-local' }, 900000),
    R('ipv6/address', { address: '2001:db8:88::2/64', interface: 'ether1', 'actual-interface': 'ether1', advertise: false, dynamic: true, comment: 'ISP delegated' }, 800000),
  ];
  t['ipv6/route'] = [
    R('ipv6/route', { 'dst-address': '::/0', gateway: 'fe80::1%ether1', distance: 1, scope: 30, active: true, static: true, dynamic: false, connect: false, 'routing-table': 'main', comment: 'ISP default' }, 800000),
    R('ipv6/route', { 'dst-address': '2a02:1348:14c:1a00::/64', gateway: 'bridge1', distance: 0, scope: 10, active: true, connect: true, dynamic: true, 'routing-table': 'main' }, 800000),
    R('ipv6/route', { 'dst-address': '2a02:1348:14c:1a20::/64', gateway: 'bridge-guest', distance: 0, active: true, connect: true, dynamic: true, 'routing-table': 'main' }, 800000),
    R('ipv6/route', { 'dst-address': '2001:db8:50::/48', gateway: 'fe80::2%vlan10', distance: 1, scope: 30, active: true, static: true, 'routing-table': 'main', comment: 'branch v6' }, 700000),
    R('ipv6/route', { 'dst-address': '2001:db8:99::/48', gateway: '', distance: 1, active: true, static: true, blackhole: true, comment: '' }, 700000),
  ];
  t['ipv6/dhcp-client'] = [R('ipv6/dhcp-client', { interface: 'ether1', status: 'bound', address: '2001:db8:88::2/64', 'expires-after': '22h41m', 'add-default-route': true, 'use-peer-dns': false, request: 'address', 'pool-name': 'v6-pool', 'pool-prefix-length': 64, comment: '' }, 800000)];
  t['ipv6/dhcp-server'] = [R('ipv6/dhcp-server', { name: 'dhcpv6-lan', interface: 'bridge1', 'address-pool': 'v6-pool', 'lease-time': '1h', 'rapid-commit': true, 'route-distance': 1, 'dns-server': '2606:4700:4700::1111', comment: '' }, 800000)];
  t['ipv6/pool'] = [R('ipv6/pool', { name: 'v6-pool', prefix: '2a02:1348:14c:1a00::/64', 'prefix-length': 64, 'from-pool': '', 'prefix-count': 0, comment: '' }, 800000)];
  t['ipv6/nd'] = [{ 'ra-interval': '3m20s-10m', 'ra-delay': '3s', 'ra-lifetime': '30m', 'ra-preference': 'medium', 'hop-limit': 'unspecified', 'managed-address-configuration': false, 'other-configuration': false, 'reachable-time': '30m', 'retransmit-interval': 'unspecified', 'mtu': 'unspecified' }];
  t['ipv6/nd/prefix'] = [
    R('ipv6/nd/prefix', { prefix: '2a02:1348:14c:1a00::/64', interface: 'bridge1', 'on-link': true, autonomous: true, 'valid-lifetime': '1d', 'preferred-lifetime': '4h', comment: '' }, 800000),
    R('ipv6/nd/prefix', { prefix: '2a02:1348:14c:1a20::/64', interface: 'bridge-guest', 'on-link': true, autonomous: true, 'valid-lifetime': '1d', 'preferred-lifetime': '4h', comment: '' }, 800000),
  ];
  t['ipv6/neighbor'] = Array.from({ length: 6 }).map((_, i) => {
    const r = rng(9800 + i);
    return R('ipv6/neighbor', { address: `fe80::${hex(r, 4)}:${hex(r, 4)}:${hex(r, 4)}`, 'mac-address': mac(r), interface: pick(['bridge1', 'vlan10', 'bridge-guest'], r), status: i === 5 ? 'failed' : 'reachable', router: chance(0.3, r), dynamic: true, incomplete: i === 5 }, 30 + i * 10);
  });
  t['ipv6/settings'] = [{ forwarding: true, 'accept-redirects': false, 'accept-router-advertisements': 'yes-if-forwarding-disabled', 'disable-ipv6': false, 'max-neighbor-entries': 8192, softwire: '', 'multipath-hash-policy': 'l3' }];
  t['ipv6/firewall/filter'] = [
    ['input', 'accept', { 'connection-state': 'established,related', comment: 'established' }],
    ['input', 'drop', { 'connection-state': 'invalid', comment: '' }],
    ['input', 'accept', { protocol: 'icmpv6', comment: 'ICMPv6 required' }],
    ['input', 'drop', { 'in-interface-list': 'WAN', comment: 'deny inbound v6' }],
    ['forward', 'accept', { 'connection-state': 'established,related' }],
    ['forward', 'accept', { 'in-interface-list': 'LAN', 'out-interface-list': 'WAN' }],
    ['forward', 'drop', { 'log-prefix': 'v6-fwd-drop:', log: true }],
  ].map(([chain, action, o], i) => R('ipv6/firewall/filter', { chain, action, index: i, bytes: int(1e3, 9e7, rng(hash('v6f' + i))), packets: int(10, 99999, rng(hash('v6fp' + i))), dynamic: false, invalid: false, ...(o as Row) }, 900000 - i * 100));
  t['ipv6/firewall/address-list'] = ['2001:db8:bad::/48', '2001:db8:bad2::/48', '2a02:1348:14c:1a00::/64', '2a02:1348:14c:1a20::/64', 'fe80::/10']
    .map((a, i) => R('ipv6/firewall/address-list', { list: i < 2 ? 'BlockedNets6' : 'LAN-NETS6', address: a, timeout: i < 2 ? '1w' : 'never', dynamic: false, comment: '' }, 800000 - i * 1000));
  t['ipv6/firewall/nat'] = [R('ipv6/firewall/nat', { chain: 'srcnat', action: 'src-nat', 'src-address': '2a02:1348:14c:1a00::/64', 'to-addresses': '2001:db8:88::2', comment: 'NPTv6 to ISP' }, 700000)];
  t['ipv6/firewall/mangle'] = [R('ipv6/firewall/mangle', { chain: 'forward', action: 'change-mss', protocol: 'tcp', 'new-mss': 'clamp-to-pmtu', comment: '' }, 700000)];
  t['ipv6/firewall/raw'] = [R('ipv6/firewall/raw', { chain: 'prerouting', action: 'drop', 'src-address-list': 'BlockedNets6', comment: 'early drop' }, 700000)];

  /* --------------------------- TOOLS ------------------------- */
  t['tool/netwatch'] = [
    R('tool/netwatch', { name: 'isp-gateway', host: `${WAN}.1`, type: 'icmp', interval: '30s', timeout: '1s', status: 'up', since: '14d2h', 'down-script': 'wan-failover', comment: 'primary uplink' }, 1200000),
    R('tool/netwatch', { name: 'core-switch', host: '172.16.10.2', type: 'icmp', interval: '1m', timeout: '1s', status: 'up', since: '14d2h', comment: '' }, 1200000),
    R('tool/netwatch', { name: 'public-dns', host: '1.1.1.1', type: 'icmp', interval: '1m', timeout: '2s', status: 'up', since: '6d4h' }, 600000),
    R('tool/netwatch', { name: 'branch-vpn', host: '192.168.50.1', type: 'tcp-conn', port: 8291, interval: '2m', timeout: '3s', status: 'down', since: '2h14m', 'up-script': '', 'down-script': ':log warning "branch VPN down"', comment: '' }, 9000),
    R('tool/netwatch', { name: 'web-portal', host: 'portal.example.net', type: 'https-get', 'http-code': '200', interval: '5m', timeout: '5s', status: 'up', since: '30d' }, 900000),
  ];
  t['tool/graphing'] = [{ enabled: true, 'store-every': '5min', 'page-refresh': 300 }];
  t['tool/graphing/interface'] = [
    R('tool/graphing/interface', { interface: 'ether1', 'allow-address': `${LAN}.0/24`, 'allow-target': '' }, 900000),
    R('tool/graphing/interface', { interface: 'bridge1', 'allow-address': `${LAN}.0/24` }, 900000),
    R('tool/graphing/interface', { interface: 'lte1', 'allow-address': '10.88.0.0/24' }, 800000),
    R('tool/graphing/interface', { interface: 'sfp-sfpplus1', 'allow-address': `${LAN}.0/24` }, 800000),
  ];
  t['tool/graphing/resource'] = [R('tool/graphing/resource', { 'allow-address': `${LAN}.0/24`, 'allow-target': '' }, 900000)];
  t['tool/graphing/queue'] = t['queue/simple'].slice(0, 5).map((q) => R('tool/graphing/queue', { queue: q.name, 'allow-address': `${LAN}.0/24` }, 800000));
  t['tool/sms'] = [{ port: 'lte1', secret: 'yes', 'notify-on-receive': true, 'sms-storage': 'modem', 'send-sms-to': '+233200000000' }];
  t['tool/sms/inbox'] = [
    R('tool/sms/inbox', { phone: '+233244112233', message: 'Router down at site B - please check', timestamp: dateTimeString(3600), type: 'received' }, 3600),
    R('tool/sms/inbox', { phone: '+233244445566', message: 'Please restart the lobby wifi', timestamp: dateTimeString(14400), type: 'received' }, 14400),
  ];
  t['tool/email'] = [{ from: 'mtk-accra@example.net', server: 'smtp.example.net', port: 587, 'start-tls': 'yes', tls: 'no', user: 'mtk-accra', password: '********', auth: 'yes' }];
  t['tool/mac-server'] = [{ 'allowed-interface-list': 'MGMT' }];
  t['tool/mac-server/mac-winbox'] = [R('tool/mac-server/mac-winbox', { interface: 'all', 'allowed-interface-list': 'MGMT' }, 900000)];
  t['tool/mac-server/ping'] = [R('tool/mac-server/ping', { interface: 'all', 'allowed-interface-list': 'MGMT' }, 900000)];
  t['tool/romon'] = [{ enabled: true, secret: '********', port: 8729, 'idle-timeout': '30s' }];
  t['tool/romon/port'] = [R('tool/romon/port', { interface: 'bridge1', forbid: false, secret: '', cost: 100, comment: '' }, 800000)];
  t['tool/macscan'] = Array.from({ length: 8 }).map((_, i) => R('tool/macscan', { 'mac-address': mac(rng(9900 + i)), address: `${LAN}.${int(2, 250, rng(9901 + i))}`, interface: 'bridge1', age: `${int(1, 400, rng(9902 + i))}s` }, 30 + i));
  t['tool/ip-scan'] = Array.from({ length: 10 }).map((_, i) => R('tool/ip-scan', { address: `172.16.10.${int(2, 250, rng(9910 + i))}`, 'mac-address': mac(rng(9911 + i)), interface: 'vlan10', timeout: '1s' }, 20 + i));
  t['tool/profile'] = [
    { name: 'ethernet', usage: '62.4%', cpu: '0', count: '' },
    { name: 'firewall', usage: '14.1%', cpu: '0' },
    { name: 'bridging', usage: '8.9%', cpu: '0' },
    { name: 'wireless', usage: '6.2%', cpu: '1' },
    { name: 'routing', usage: '3.4%', cpu: '0' },
    { name: 'ipsec', usage: '2.1%', cpu: '2' },
    { name: 'queues', usage: '1.6%', cpu: '2' },
    { name: 'console', usage: '0.8%', cpu: '0' },
    { name: 'idle', usage: '0.5%', cpu: '3' },
  ];
  t['tool/sniffer'] = [{ 'filter-interface': 'ether1', 'filter-direction': 'any', 'only-headers': false, 'file-name': 'sniffer.pcap', 'file-limit': '1000KiB', streaming: false, filterProtocol: '', filterPort: '' }];
  t['tool/sniffer/host'] = Array.from({ length: 5 }).map((_, i) => R('tool/sniffer/host', { address: pick(['142.250.190.14', '104.16.132.229', '140.82.121.4', '1.1.1.1', '20.42.65.90'], rng(9920 + i)), interface: 'ether1', 'mac-address': mac(rng(9921 + i)), rate: `${int(1, 900, rng(9922 + i))}kbps` }, 60 + i * 5));
  t['tool/sniffer/connection'] = Array.from({ length: 5 }).map((_, i) => R('tool/sniffer/connection', { 'src-address': `${LAN}.${int(10, 200, rng(9930 + i))}`, 'src-port': int(30000, 60000, rng(9931 + i)), 'dst-address': pick(['142.250.190.14', '104.16.132.229', '140.82.121.4'], rng(9932 + i)), 'dst-port': 443, protocol: 'tcp', bytes: int(1e4, 9e7, rng(9933 + i)) }, 60 + i * 5));
  t['tool/bandwidth-server'] = [{ enabled: true, 'allocate-udp-ports-from': 2000, authenticate: true, 'max-sessions': 100 }];
  t['tool/traffic-generator'] = [{ 'latency-distribution': '1s' }];
  t['tool/traffic-generator/port'] = [R('tool/traffic-generator/port', { interface: 'ether7', 'tx-template': 'tpl-l2', 'rx-template': 'tpl-l2' }, 600000)];
  t['tool/traffic-generator/stream'] = [R('tool/traffic-generator/stream', { name: 'stream-1', 'tx-template': 'tpl-l2', 'packet-size': 1500, rate: '1Gbps', comment: '' }, 600000)];
  t['tool/traffic-generator/packet-template'] = [R('tool/traffic-generator/packet-template', { name: 'tpl-l2', headers: 'ethernet', 'extra-bytes': 0 }, 600000)];
  t['tool/traffic-generator/stats'] = [R('tool/traffic-generator/stats', { name: 'stream-1', 'tx-packet': 128456, 'rx-packet': 128450, 'tx-rate': '987Mbps', 'rx-rate': '986Mbps', latency: '142us', jitter: '8us' }, 600)];
  t['tool/dns-update'] = [R('tool/dns-update', { name: 'cloudflare-home', 'dns-server': 'dyn.example.net', address: 'vpn.example.net', key: '********', 'key-name': 'mtk-accra', ttl: '5m', comment: 'DDNS' }, 700000)];
  t['tool/keygen'] = [];
  t['dude'] = [{ enabled: true, 'data-directory': '/disk1/dude', status: 'running', version: '7.16.2' }];

  const byPath = new Map(ENDPOINTS.map((e) => [e.path, e]));
  for (const ep of ENDPOINTS) {
    if (t[ep.path]) continue;
    t[ep.path] = generateRows(ep, born);
  }
  // Keep the `byPath` reference alive for the generic generator's naming needs.
  void byPath;
  return { tables: t, bornAt: born };
}

/* ------------------------------------------------------------------ *
 * Metadata-driven row synthesis for endpoints without hand-written data
 * ------------------------------------------------------------------ */

const NAME_POOLS: Record<string, string[]> = {
  'interface/gre': ['gre-branch', 'gre-lab'],
  'interface/eoip': ['eoip-branch'],
  'interface/vxlan': ['vxlan-overlay'],
  'interface/vrrp': ['vrrp-lan', 'vrrp-guest'],
  'interface/macsec': ['macsec-core'],
  'interface/ipip': ['ipip-transit'],
  'interface/l2tp-ether': ['l2tp-tunnel'],
  'interface/detect-internet': ['detect-internet'],
  'interface/wireless': ['wlan-legacy-1'],
  'interface/wireless/registration-table': ['legacy-client'],
  'interface/wireless/security-profiles': ['legacy-sec'],
  'interface/wireless/access-list': ['legacy-acl'],
  'interface/wireless/connect-list': ['legacy-connect'],
  'interface/ethernet/switch/vlan': ['switch-vlan-10'],
  'interface/ethernet/switch/rule': ['switch-rule-1'],
  'ip/dhcp-relay': ['relay-branch'],
  'ip/socks/users': ['proxy-user'],
  'ip/upnp/interfaces': ['ether1'],
  'ip/traffic-flow/target': ['collector-1'],
  'ip/tftp': ['tftp-settings'],
  'ip/packing': ['packing'],
  'ipv6/dhcp-server': ['dhcpv6-lan'],
  'ipv6/pool': ['v6-delegated'],
  'ipv6/neighbor': ['v6-neighbor'],
  'routing/igmp-proxy': ['igmp-upstream'],
  'routing/igmp-proxy/interface': ['vlan10'],
  'routing/igmp-proxy/mfc': ['239.1.1.1'],
  'routing/pimsm': ['pim'],
  'routing/pimsm/interface': ['vlan10'],
  'routing/ripng': ['ripng-lab'],
  'routing/ospf/neighbor': ['10.0.0.9'],
  'queue/interface': ['ether1', 'ether2'],
  'ppp/l2tp-secret': ['l2tp-user'],
  'ppp/aaa': ['ppp-aaa'],
  'hotspot/cookie': ['guest-1234'],
  'radius/coa': ['coa-server'],
  'system/script/job': ['job-1'],
  'system/note': ['note'],
  'system/ups': ['ups1'],
  'system/ntp/server': ['ntp-server'],
  'system/console': ['console'],
  'system/license': ['license'],
  'system/health': ['temperature'],
  'system/certificate/settings': ['cert-settings'],
  'system/routerboard/settings': ['rb-settings'],
  'system/identity/settings': ['identity-settings'],
  'system/user/settings': ['user-settings'],
  'system/user/aaa': ['user-aaa'],
  'system/device-mode': ['device-mode'],
  'system/upgrade': ['upgrade'],
  'system/snmp/community': ['public', 'private'],
  'system/backup': ['auto-daily.backup'],
  'container/config': ['container-config'],
  'container/image': ['alpine:latest'],
  'container/shell': ['shell'],
  'iot/serial': ['serial0'],
  'mpls/ldp': ['ldp'],
  'mpls/forwarding-table': ['1001'],
  'tool/bandwidth-server': ['bandwidth-server'],
  'tool/graphing': ['graphing'],
  'tool/mac-server': ['mac-server'],
  'tool/email': ['email'],
  'tool/sms': ['sms'],
  'tool/sniffer': ['sniffer'],
  'tool/traffic-generator': ['tg'],
  'tool/keygen': ['keygen'],
  'tool/romon': ['romon'],
};

const COMMENTS = ['', '', 'provisioned by dashboard', 'review in Q4', 'lab only', 'vendor template', 'ticket #4471'];

function generateRows(ep: EndpointDef, born: Record<string, Record<string, number>>): Row[] {
  const n = ep.demoRows ?? 3;
  if (n <= 0) return [];
  const rows: Row[] = [];
  const now = Math.floor(Date.now() / 1000);
  const names = NAME_POOLS[ep.path] ?? [];
  for (let i = 0; i < n; i++) {
    const seed = rng(hash(ep.path) + i * 7919);
    const id = nextId();
    (born[ep.path] ||= {})[id] = now - int(30, 900000, seed);
    const row: Row = { '.id': id };
    for (const f of ep.fields ?? []) {
      if (f.name === '.id') continue;
      row[f.name] = valueFor(f, { path: ep.path, index: i, r: seed, names, endpoint: ep });
    }
    if (!row.name && (ep.fields ?? []).some((f) => f.name === 'name') === false) {
      const primary = (ep.fields ?? []).find((f) => f.primary);
      if (primary && row[primary.name] === undefined) row[primary.name] = valueFor(primary, { path: ep.path, index: i, r: seed, names, endpoint: ep });
    }
    rows.push(row);
  }
  return rows;
}

interface GenCtx { path: string; index: number; r: Rnd; names: string[]; endpoint: EndpointDef }

function nameFor(ctx: GenCtx): string {
  if (ctx.names.length) return ctx.names[ctx.index % ctx.names.length];
  const base = ctx.endpoint.path.split('/').slice(-2).join('-');
  return `${base}-${ctx.index + 1}`;
}

function valueFor(f: FieldDef, ctx: GenCtx): unknown {
  const r = ctx.r;
  const label = f.label ?? f.name;
  switch (f.name) {
    case 'name': return nameFor(ctx);
    case 'comment': return pick(COMMENTS, r);
    case 'disabled': return false;
    case 'dynamic': return chance(0.3, r);
    case 'invalid': return false;
    case 'running': return chance(0.8, r);
    case 'chain': return pick(['input', 'forward', 'output', 'srcnat', 'dstnat'], r);
    case 'list': return pick(['LAN', 'WAN', 'MGMT', 'BLOCKED'], r);
    case 'interface': case 'in-interface': case 'out-interface': return pick(['bridge1', 'ether1', 'ether2', 'vlan10', 'wifi1', 'sfp-sfpplus1'], r);
    case 'topics': return pick(['info', 'error,warning', 'firewall,account', 'script', 'hotspot,radius'], r);
    case 'action': return f.values ? pick(f.values, r) : 'accept';
    case 'policy': return pick(['read,write,test', 'read,test', 'read,write,policy,test'], r);
    case 'size': return int(4096, 90000000, r);
    case 'uptime': return duration(r);
    case 'since': return duration(r);
    case 'last-seen': return duration(r);
    case 'age': return `${int(1, 900, r)}s`;
    default: break;
  }
  switch (f.type) {
    case 'enum': return f.values?.length ? pick(f.values, r) : String(int(0, 5, r));
    case 'boolean': return chance(0.35, r);
    case 'number': return int(f.min ?? 0, f.max ?? 100, r);
    case 'ip': return /6|v6|ipv6/i.test(f.name) ? `2a02:${hex(r, 4)}::${hex(r, 2)}` : `${LAN}.${int(2, 250, r)}`;
    case 'cidr': return f.name.includes('6') ? `2a02:${hex(r, 4)}::/64` : `${LAN}.${int(0, 8, r) * 8}/${pick([24, 25, 26, 16], r)}`;
    case 'mac': return mac(r);
    case 'duration': return duration(r);
    case 'bytes': return int(1024, 90000000, r);
    case 'date': return routerosDate(int(-30, 30, r));
    case 'time': return timeString(int(0, 86400, r));
    case 'text': return `${label}: ${pick(['configured from dashboard', 'review required', 'ok', 'see runbook'], r)}`;
    case 'password': return '********';
    case 'readonly': return chance(0.5, r) ? true : '';
    default: {
      if (/address|gateway|network/i.test(f.name)) return f.name.includes('6') ? `2a02:${hex(r, 4)}::1` : `${LAN}.${int(2, 250, r)}`;
      if (/port$/i.test(f.name)) return int(1, 65535, r);
      if (/(^|-)time$|timeout/i.test(f.name)) return duration(r);
      if (/rate/i.test(f.name)) return `${int(1, 90, r)}M`;
      if (/version/i.test(f.name)) return '7.16.2';
      if (/uptime|since/i.test(f.name)) return duration(r);
      if (/file|path|dir/i.test(f.name)) return `/disk1/${hex(r, 4)}`;
      if (/^type$/i.test(f.name)) return pick(['bind', 'virtual', 'local'], r);
      return `${slug(label)}-${int(1, 99, r)}`;
    }
  }
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/* --------------------------- log --------------------------- */

function buildLog(): Row[] {
  const templates: Array<[string, string]> = [
    ['firewall', 'input-drop: in:ether1 out:(none), src-mac 00:11:22:33:44:55, proto TCP (SYN), 45.155.205.233:51234->100.64.12.2:22, len 60'],
    ['firewall', 'fwd-drop: in:bridge-guest out:bridge1, proto TCP, 10.10.10.133:49122->192.168.88.10:445, len 52'],
    ['hotspot,account', 'hotspot-guest: guest-4821 logged in from 10.10.10.151'],
    ['hotspot,account', 'hotspot-guest: guest-2310 logged out: session timeout'],
    ['dhcp,info', 'dhcp-lan assigned 192.168.88.141 to 74:4D:28:1A:2B:3C'],
    ['dhcp,info', 'dhcp-guest deassigned 10.10.10.188 from 2C:C8:1B:44:55:66'],
    ['interface,info', 'ether7 link down'],
    ['interface,info', 'ether7 link up (speed 1G, full duplex)'],
    ['pppoe,info', 'pppoe-out1: dialing out1... connected'],
    ['pppoe,info', 'pppoe-out1: disconnected: peer request'],
    ['script,info', 'script-auto-daily: backup saved to auto-daily.backup'],
    ['system,info', 'router rebooted, uptime 0s'],
    ['system,info,account', 'user noc logged in from 192.168.88.19 via ssh'],
    ['wireless,info', 'wifi1: 74:4D:28:AB:CD:EF connected, signal strength -52'],
    ['wireless,info', 'wifi2: 74:4D:28:99:88:11 disconnected, signal strength -78'],
    ['ipsec,info', 'IPsec peer peer-branch established (SPI 0x1a2b3c4d)'],
    ['ipsec,error', 'IPsec phase2 negotiation timeout for peer-partner'],
    ['dns,info', 'DNS: cache flushed by admin'],
    ['route,info', 'default route changed: gateway 100.64.12.1 distance 1'],
    ['route,warning', 'LTE backup route active: 0.0.0.0/0 distance 2'],
    ['lte,info', 'lte1: registered on network MTN GH, access-technology LTE'],
    ['lte,warning', 'lte1: signal strength -104dBm (weak)'],
    ['container,info', 'container nginx-portal: exited with code 1, restarting'],
    ['container,info', 'container pihole-dns: started'],
    ['netwatch,info', 'netwatch branch-vpn: host down'],
    ['netwatch,info', 'netwatch isp-gateway: host up'],
    ['radius,info', 'radius: hotspot user guest-4821 authenticated from 172.16.10.53'],
    ['certificate,info', 'certificate rest-api expired'],
    ['account,info', 'system user automation logged in from 192.168.88.7 via api'],
    ['hotspot,info', 'hotspot-lobby: user reception-desk logged in from 10.10.10.10'],
  ];
  const rows: Row[] = [];
  let offset = 0;
  for (let i = 0; i < 46; i++) {
    const r = rng(500 + i);
    const [topics, message] = templates[i % templates.length];
    offset += int(3, 180, r);
    rows.push({ '.id': nextId(), time: timeString(offset), topics, message });
  }
  return rows;
}
