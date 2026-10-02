/**
 * Shareable audit report.
 *
 * Turns an insight bundle into a Markdown document an operator can paste into a
 * ticket, a change request or a client-facing summary — score, findings with
 * remediation, capacity/IPAM/wireless/routing detail, recent configuration drift
 * and the coverage caveats, so the reader knows exactly what was and was not read
 * from the device.
 */
import type { Finding, InsightBundle, ScoreTrend, Severity } from '../../shared/analytics';

/* Report-local formatting: a Markdown document wants stable, locale-free numbers. */
const fmtNumber = (value: number | undefined | null) => (value === undefined || value === null ? '—' : value.toLocaleString('en-US'));
const fmtBytes = (bytes: number | undefined | null) => {
  if (!Number.isFinite(bytes ?? NaN)) return '—';
  const units = ['B', 'kB', 'MB', 'GB', 'TB', 'PB'];
  let value = Number(bytes);
  let unit = 0;
  while (Math.abs(value) >= 1000 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
};
const fmtBitrate = (bytesPerSec: number | undefined | null) => {
  if (!Number.isFinite(bytesPerSec ?? NaN) || (bytesPerSec ?? 0) <= 0) return '0 bps';
  const units = ['bps', 'Kbps', 'Mbps', 'Gbps', 'Tbps'];
  let value = Number(bytesPerSec) * 8;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) { value /= 1000; unit++; }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
};

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', info: 'Info',
};

const fmtDate = (ts: number) => new Date(ts).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

const table = (headers: string[], rows: Array<Array<string | number>>) => {
  if (!rows.length) return '_None._\n';
  const head = `| ${headers.join(' | ')} |\n| ${headers.map(() => '---').join(' | ')} |\n`;
  return head + rows.map((row) => `| ${row.map((cell) => String(cell).replace(/\|/g, '\\|')).join(' | ')} |`).join('\n') + '\n';
};

function findingBlock(finding: Finding, index: number): string {
  const lines: string[] = [];
  lines.push(`### ${index}. ${finding.title}`);
  lines.push('');
  lines.push(`**Severity:** ${SEVERITY_LABEL[finding.severity]} · **Area:** ${finding.category}`);
  lines.push('');
  lines.push(finding.detail);
  if (finding.remediation) {
    lines.push('');
    lines.push(`**Remediation:** ${finding.remediation}`);
  }
  if (finding.menus?.length) {
    lines.push('');
    lines.push(`**Where to fix it:** ${finding.menus.map((menu) => `\`${menu}\``).join(', ')}`);
  }
  if (finding.evidence) {
    lines.push('');
    lines.push('<details><summary>Evidence</summary>');
    lines.push('');
    lines.push('```');
    for (const line of String(finding.evidence).split('\n').slice(0, 24)) lines.push(line);
    lines.push('```');
    lines.push('</details>');
  }
  lines.push('');
  return lines.join('\n');
}

export interface ReportOptions {
  connection?: string;
  mode?: string;
  history?: ScoreTrend | null;
}

export function insightsReportMarkdown(bundle: InsightBundle, options: ReportOptions = {}): string {
  const { score, findings, capacity, ipam, wireless, routing, queues, changes, traffic } = bundle;
  const history = options.history;
  const out: string[] = [];

  out.push(`# Network health report — ${options.connection ?? 'RouterOS device'}`);
  out.push('');
  out.push(`Generated ${fmtDate(bundle.generatedAt)} · source: **${options.mode ?? bundle.mode}**${options.mode === 'demo' ? ' (simulated device)' : ''}`);
  out.push('');
  out.push('---');
  out.push('');

  /* ------------------------------ executive ------------------------------ */
  out.push('## Executive summary');
  out.push('');
  out.push(`**Health score ${score.overall}/100 (grade ${score.grade})**`);
  if (history && history.delta !== null && history.deltaDays) {
    const arrow = history.delta > 0 ? '▲' : history.delta < 0 ? '▼' : '■';
    out.push('');
    out.push(`${arrow} ${history.delta > 0 ? '+' : ''}${history.delta} points over ${history.deltaDays} days (${history.total} samples${history.source === 'demo' ? ', simulated history' : ''}).`);
  }
  out.push('');
  out.push(`${bundle.counts.critical} critical, ${bundle.counts.high} high, ${bundle.counts.medium} medium, ${bundle.counts.low} low and ${bundle.counts.info} informational findings.`);
  out.push('');
  out.push('### Score breakdown');
  out.push('');
  out.push(table(
    ['Component', 'Score', 'Trend'],
    score.components.map((component) => {
      const delta = history?.components.find((entry) => entry.id === component.id)?.delta;
      return [component.label, `${component.score}/100`, delta ? `${delta > 0 ? '+' : ''}${delta}` : '—'];
    }),
  ));
  out.push('');

  const top = findings.filter((finding) => finding.severity === 'critical' || finding.severity === 'high');
  if (top.length) {
    out.push('### Act on first');
    out.push('');
    for (const finding of top) out.push(`- **${finding.title}** — ${finding.remediation ?? finding.detail}`);
    out.push('');
  }

  /* ------------------------------ findings ------------------------------- */
  out.push('## Findings');
  out.push('');
  if (!findings.length) out.push('_No findings._\n');
  else findings.forEach((finding, i) => out.push(findingBlock(finding, i + 1)));

  /* ------------------------------ capacity ------------------------------- */
  out.push('## Capacity');
  out.push('');
  out.push(`Aggregate throughput ${fmtBitrate(capacity.totalRx)} in / ${fmtBitrate(capacity.totalTx)} out · headroom ${capacity.headroom}%.`);
  if (capacity.wan) {
    out.push('');
    out.push(`WAN \`${capacity.wan.interface}\`: ${fmtBitrate(capacity.wan.rxRate)} in / ${fmtBitrate(capacity.wan.txRate)} out, utilisation ${capacity.wan.utilisation}%.`);
  }
  out.push('');
  const busiest = [...capacity.interfaces]
    .sort((a, b) => (b.rxRate ?? 0) + (b.txRate ?? 0) - ((a.rxRate ?? 0) + (a.txRate ?? 0)))
    .slice(0, 10);
  out.push(table(
    ['Interface', 'Link', 'RX', 'TX', 'Utilisation', 'State'],
    busiest.map((row) => [
      row.interface,
      row.type ?? '—',
      fmtBitrate(row.rxRate),
      fmtBitrate(row.txRate),
      `${row.utilisation}%`,
      row.status,
    ]),
  ));
  out.push('');

  /* -------------------------------- IPAM -------------------------------- */
  out.push('## Addressing (IPAM)');
  out.push('');
  out.push(`${fmtNumber(ipam.totalUsed)} addresses in use, ${fmtNumber(ipam.totalFree)} free across ${ipam.subnets.length} subnets; ${ipam.pools.length} DHCP pool(s).`);
  out.push('');
  if (ipam.conflicts.length) {
    out.push(`**${ipam.conflicts.length} address conflict(s):**`);
    out.push('');
    for (const conflict of ipam.conflicts) {
      out.push(`- \`${conflict.address}\` claimed by ${conflict.macs.map((mac) => `\`${mac}\``).join(', ')}${conflict.hostnames.length ? ` (${conflict.hostnames.join(', ')})` : ''}`);
    }
    out.push('');
  }
  out.push(table(
    ['Subnet', 'Gateway', 'Interface', 'Used', 'Free', 'Utilisation', 'Pool'],
    ipam.subnets.map((row) => [
      row.cidr,
      row.gateway ?? '—',
      row.interface ?? '—',
      `${row.used}/${row.total}`,
      row.free,
      `${row.utilisation}%`,
      row.pool ?? '—',
    ]),
  ));
  out.push('');

  /* ------------------------------ wireless ------------------------------ */
  if (wireless.radios.length) {
    out.push('## Wireless');
    out.push('');
    out.push(`${wireless.clients} client(s) across ${wireless.radios.length} radio(s)${wireless.bands.length ? ` · bands: ${wireless.bands.map((b) => `${b.band} (${b.count})`).join(', ')}` : ''}.`);
    out.push('');
    out.push(table(
      ['Radio', 'SSID', 'Band', 'Frequency', 'Clients', 'Avg signal', 'Congestion'],
      wireless.radios.map((row) => [
        row.interface,
        row.ssid ?? '—',
        row.band ?? '—',
        row.frequency ?? '—',
        row.clients,
        Number.isFinite(row.avgSignal) ? `${Math.round(row.avgSignal)} dBm` : '—',
        row.congestion,
      ]),
    ));
    if (wireless.weak.length) {
      out.push('');
      out.push(`Weak clients (< -70 dBm): ${wireless.weak.map((client) => `${client.name} ${client.signal} dBm`).join(', ')}.`);
    }
    out.push('');
  }

  /* ------------------------------- routing ------------------------------ */
  out.push('## Routing');
  out.push('');
  out.push(`${routing.total} routes (${routing.connected} connected, ${routing.static} static, ${routing.dynamic} dynamic), ${routing.defaults} default route(s).`);
  out.push('');
  if (routing.protocols.length) out.push(`Routing processes: ${routing.protocols.map((p) => `${p.name} (${p.count})`).join(', ')}.`);
  if (routing.bgp.sessions) out.push(`BGP: ${routing.bgp.established}/${routing.bgp.sessions} sessions established${routing.bgp.down.length ? ` — down: ${routing.bgp.down.map((s) => s.name).join(', ')}` : ''}.`);
  if (routing.ospf.neighbors) out.push(`OSPF: ${routing.ospf.full}/${routing.ospf.neighbors} neighbours full.`);
  if (routing.unstable.length) {
    out.push('');
    out.push(`Unstable adjacencies: ${routing.unstable.map((entry) => `${entry.name} (${entry.detail})`).join(', ')}.`);
  }
  out.push('');

  /* ------------------------------- queues ------------------------------- */
  if (queues.count) {
    out.push('## Queues');
    out.push('');
    out.push(`${queues.count} queue(s) shaping ${fmtBitrate(queues.shapedBps)} against ${fmtBitrate(queues.wanBps)} of WAN capacity (oversubscription ${queues.oversubscription}×, ${queues.idle} idle).`);
    out.push('');
  }

  /* ------------------------------- traffic ------------------------------ */
  if (traffic) {
    out.push('## Traffic');
    out.push('');
    const classifiedPct = traffic.totalBytes ? Math.round((traffic.classifiedBytes / traffic.totalBytes) * 100) : 0;
    out.push(`${fmtNumber(traffic.totalFlows)} tracked conversations, ${fmtBytes(traffic.totalBytes)} observed; ${classifiedPct}% classified.`);
    out.push('');
    const topApps = traffic.apps.slice(0, 8);
    if (topApps.length) {
      out.push(table(
        ['Application class', 'Bytes', 'Flows'],
        topApps.map((app) => [app.label, fmtBytes(app.bytes), app.flows]),
      ));
      out.push('');
    }
    out.push('**Deep packet inspection: not available over REST.** Classification above is flow/metadata based (conntrack 5-tuple, ports, mangle L7 counters). Payload inspection requires mirroring or sniffer streaming to an external sensor.');
    out.push('');
  }

  /* ------------------------------ changes ------------------------------- */
  out.push('## Configuration drift');
  out.push('');
  if (changes) {
    out.push(`Changes since ${fmtDate(changes.since)}: ${changes.labels.added.length} addition(s), ${changes.labels.removed.length} removal(s) across ${changes.sections.length} section(s).`);
    out.push('');
    if (changes.labels.added.length) {
      out.push('Added:');
      out.push('');
      for (const item of changes.labels.added.slice(0, 20)) out.push(`- ${item}`);
      out.push('');
    }
    if (changes.labels.removed.length) {
      out.push('Removed:');
      out.push('');
      for (const item of changes.labels.removed.slice(0, 20)) out.push(`- ${item}`);
      out.push('');
    }
  } else {
    out.push('_No baseline recorded yet — the first insights read establishes one, later reads report drift._');
    out.push('');
  }

  /* ------------------------------ coverage ------------------------------ */
  out.push('## Coverage & caveats');
  out.push('');
  const unread = bundle.sources.filter((source) => !source.ok);
  out.push(`${bundle.sources.filter((source) => source.ok).length}/${bundle.sources.length} source menus read successfully.`);
  if (unread.length) {
    out.push('');
    out.push('Not readable:');
    out.push('');
    for (const source of unread.slice(0, 20)) out.push(`- \`${source.path}\` — ${source.error ?? 'unavailable'}`);
  }
  if (bundle.notes.length) {
    out.push('');
    for (const note of bundle.notes) out.push(`- ${note}`);
  }
  out.push('');
  out.push('---');
  out.push('');
  out.push('_Generated by RouterOS Control Plane from the RouterOS REST API. Counters are cumulative since the last reset; classification is flow-based._');
  out.push('');
  return out.join('\n');
}
