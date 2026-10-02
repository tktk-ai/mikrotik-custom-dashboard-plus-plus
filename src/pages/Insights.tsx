/**
 * Strategic view: a health score with component breakdown, prioritised findings
 * with remediation, capacity and IPAM analysis, wireless health, routing posture
 * and configuration change tracking.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import {
  SEVERITY_ORDER, parseBytes, type CapacityRow, type Finding, type ScoreTrend, type Severity,
} from '@shared/analytics';
import type { Row } from '@shared/types';
import { api, ApiError } from '../lib/api';
import { useApp } from '../lib/store';
import { fmtBitrate, fmtBytes, fmtNumber, relativeTime } from '../lib/format';
import { DataTable, type ColumnDef } from '../components/DataTable';
import { EmptyState, Icon, Segmented, Spinner, Stat, TableSkeleton } from '../components/ui';
import { Gauge, Sparkline } from '../components/charts';
import { AlertsPanel } from '../components/AlertsPanel';
import { LinkChip, ModeChip, SEVERITY_DOT, SeverityChip, SignalBars, UtilBar } from '../components/network';

const asRows = <T,>(items: T[]): Row[] => items as unknown as Row[];

/** Signed movement in the health score, e.g. "+11 · 30d". */
const DeltaChip: React.FC<{ delta: number | null; label: string }> = ({ delta, label }) => {
  if (delta === null || delta === undefined) return null;
  const up = delta > 0;
  return (
    <span className={clsx('chip', delta === 0 ? 'chip-neutral' : up ? 'chip-good' : 'chip-bad')}>
      <Icon name={delta === 0 ? 'Minus' : up ? 'TrendingUp' : 'TrendingDown'} size={11} />
      {up ? '+' : ''}{delta} · {label}
    </span>
  );
};

/** Score over time: the strategic half — is the network getting better or worse? */
const ScoreHistory: React.FC<{ history?: ScoreTrend | null }> = ({ history }) => {
  if (!history || history.samples.length < 2) return null;
  const series = history.samples.map((sample) => sample.overall);
  const tone = history.direction === 'up' ? 'good' : history.direction === 'down' ? 'bad' : 'brand';
  const moved = history.components.filter((component) => component.delta !== 0);

  return (
    <section className="card p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Icon name="Activity" size={15} className="text-brand" />
        <span className="text-[13px] font-semibold text-ink">Score history</span>
        <span className="text-[11px] text-faint">
          {history.total} samples{history.deltaDays ? ` over ${history.deltaDays} days` : ''}
          {history.first ? ` · since ${relativeTime(history.first.at)}` : ''}
        </span>
        {history.source === 'demo' ? (
          <span className="chip chip-neutral" title="The demo device has no real past — this series is simulated so the trend UI is visible.">simulated</span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          {history.newFindings > 0 ? <span className="chip chip-warn">{history.newFindings} new since last sample</span> : null}
          <DeltaChip delta={history.delta} label={history.deltaDays ? `${history.deltaDays}d` : 'all'} />
          {history.delta24h !== null && history.delta24h !== history.delta ? <DeltaChip delta={history.delta24h} label="24h" /> : null}
        </div>
      </div>

      <Sparkline
        data={series}
        tone={tone}
        height={58}
        className="w-full"
      />
      <div className="mt-1 flex justify-between text-[10.5px] text-faint">
        <span>{history.first ? Math.round(series[0]) : ''} at start</span>
        <span>now {history.last?.overall ?? ''}/100</span>
      </div>

      {moved.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line/60 pt-3">
          {moved.map((component) => (
            <span key={component.id} className="chip chip-neutral" title={`${component.before} → ${component.now}`}>
              {component.label}
              <b className={component.delta > 0 ? 'text-good' : 'text-bad'}>{component.delta > 0 ? '+' : ''}{component.delta}</b>
            </span>
          ))}
        </div>
      )}
    </section>
  );
};

/** Interface counters are cumulative; derive bps from consecutive reads. */
function useCounterRates(rows: CapacityRow[] | undefined) {
  const previous = useRef(new Map<string, { rx: number; tx: number; at: number }>());
  const [rates, setRates] = useState<Record<string, { rx: number; tx: number }>>({});

  useEffect(() => {
    if (!rows?.length) return;
    const now = Date.now();
    const next: Record<string, { rx: number; tx: number }> = {};
    for (const row of rows) {
      const before = previous.current.get(row.interface);
      if (before && now > before.at) {
        const seconds = (now - before.at) / 1000;
        const rx = Math.max(0, (row.rxBytes - before.rx) * 8) / seconds;
        const tx = Math.max(0, (row.txBytes - before.tx) * 8) / seconds;
        if (Number.isFinite(rx) && Number.isFinite(tx) && (rx > 0 || tx > 0)) next[row.interface] = { rx, tx };
      }
      previous.current.set(row.interface, { rx: row.rxBytes, tx: row.txBytes, at: now });
    }
    if (Object.keys(next).length) setRates(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  return rates;
}

const InsightRow: React.FC<{ finding: Finding }> = ({ finding }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className={clsx('card card-hover overflow-hidden', finding.severity === 'critical' && 'border-bad/40')}>
      <button className="flex w-full items-start gap-3 p-3 text-left" onClick={() => setOpen((v) => !v)}>
        <span className={clsx('mt-1.5 size-2 shrink-0 rounded-full', SEVERITY_DOT[finding.severity])} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold text-ink">{finding.title}</span>
            <SeverityChip severity={finding.severity} />
            <span className="chip chip-neutral">{finding.category}</span>
          </span>
          <span className="mt-1 block text-[12px] text-dim">{finding.detail}</span>
        </span>
        <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={14} className="mt-1 shrink-0 text-faint" />
      </button>
      {open && (
        <div className="border-t border-line/60 bg-panel2/40 px-3 py-2.5">
          {finding.remediation && (
            <p className="text-[12px] text-dim">
              <span className="label mr-2">Remediation</span>
              {finding.remediation}
            </p>
          )}
          {finding.evidence && <p className="mono mt-1.5 text-[11px] text-faint">{finding.evidence}</p>}
          {finding.menus?.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {finding.menus.map((menu) => (
                <Link key={menu} to={`/m/${menu}`} className="chip chip-accent hover:border-brand">
                  <Icon name="ArrowRight" size={10} />/{menu}
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};

const Insights: React.FC = () => {
  const { connection, mode } = useApp();
  const [filter, setFilter] = useState<Severity | 'all'>('all');
  const [tab, setTab] = useState<'capacity' | 'ipam' | 'wireless' | 'routing' | 'changes' | 'alerts'>('capacity');

  const query = useQuery({
    queryKey: ['insights'],
    queryFn: () => api.insights(),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const insights = query.data;
  const rates = useCounterRates(insights?.capacity.interfaces);
  const error = query.error as ApiError | null;

  const findings = useMemo(
    () => (insights?.findings ?? []).filter((f) => filter === 'all' || f.severity === filter),
    [insights, filter],
  );

  const capacityRows = useMemo<CapacityRow[]>(() => {
    const rows = insights?.capacity.interfaces ?? [];
    return rows.map((row) => {
      const rate = rates[row.interface];
      if (!rate) return row;
      return { ...row, rxRate: rate.rx, txRate: rate.tx, utilisation: row.speedBps ? Math.min(100, Math.round((Math.max(rate.rx, rate.tx) / row.speedBps) * 100)) : 0 };
    });
  }, [insights, rates]);

  const totalRx = capacityRows.reduce((sum, row) => sum + row.rxRate, 0);
  const totalTx = capacityRows.reduce((sum, row) => sum + row.txRate, 0);
  const sampled = Object.keys(rates).length > 0;

  const capacityColumns: Array<ColumnDef<Row>> = [
    { key: 'interface', label: 'Interface', sortable: true, render: (row) => <span className="mono text-[12px] text-ink">{String(row.interface)}</span> },
    { key: 'type', label: 'Type', sortable: true, render: (row) => <span className="chip chip-neutral">{String(row.type ?? '–')}</span> },
    { key: 'speed', label: 'Link speed', sortable: true, value: (row) => row.speedBps ?? 0, render: (row) => <span className="mono text-[11.5px] text-dim">{row.speedBps ? fmtBitrate(Number(row.speedBps) / 8) : '–'}</span> },
    { key: 'rx', label: 'Ingress', sortable: true, value: (row) => row.rxRate ?? 0, render: (row) => <span className="mono text-[11.5px] text-dim">{Number(row.rxRate) ? fmtBitrate(Number(row.rxRate) / 8) : '–'}</span> },
    { key: 'tx', label: 'Egress', sortable: true, value: (row) => row.txRate ?? 0, render: (row) => <span className="mono text-[11.5px] text-dim">{Number(row.txRate) ? fmtBitrate(Number(row.txRate) / 8) : '–'}</span> },
    { key: 'util', label: 'Utilisation', sortable: true, value: (row) => row.utilisation ?? 0, render: (row) => <UtilBar value={Number(row.utilisation ?? 0)} /> },
    {
      key: 'errors', label: 'Errors / drops', sortable: true, value: (row) => Number(row.rxErrors ?? 0) + Number(row.txDrops ?? 0),
      render: (row) => {
        const total = Number(row.rxErrors ?? 0) + Number(row.txErrors ?? 0) + Number(row.rxDrops ?? 0) + Number(row.txDrops ?? 0);
        return <span className={clsx('mono text-[11.5px]', total > 100 ? 'text-warn' : 'text-dim')}>{fmtNumber(total)}</span>;
      },
    },
    {
      key: 'status', label: 'State', sortable: true, value: (row) => String(row.status),
      render: (row) => {
        const status = String(row.status);
        return <span className={clsx('chip', status === 'down' ? 'chip-neutral' : status === 'hot' ? 'chip-bad' : status === 'watch' ? 'chip-warn' : 'chip-good')}>{status}</span>;
      },
    },
  ];

  const subnetColumns: Array<ColumnDef<Row>> = [
    { key: 'cidr', label: 'Subnet', sortable: true, render: (row) => <span className="mono text-[12px] text-ink">{String(row.cidr)}</span> },
    { key: 'interface', label: 'Interface', sortable: true, render: (row) => <span className="mono text-[11.5px] text-dim">{String(row.interface ?? '–')}</span> },
    { key: 'used', label: 'Used / total', sortable: true, value: (row) => Number(row.used ?? 0), render: (row) => <span className="mono text-[11.5px] text-dim">{String(row.used)} / {String(row.total)}</span> },
    { key: 'free', label: 'Free', sortable: true, value: (row) => Number(row.free ?? 0), render: (row) => <span className="mono text-[11.5px] text-dim">{String(row.free)}</span> },
    { key: 'util', label: 'Utilisation', sortable: true, value: (row) => Number(row.utilisation ?? 0), render: (row) => <UtilBar value={Number(row.utilisation ?? 0)} /> },
    { key: 'pool', label: 'DHCP pool', sortable: true, render: (row) => <span className="text-[11.5px] text-dim">{String(row.pool ?? '–')}</span> },
  ];

  return (
    <div className="space-y-4 p-4">
      <header className="flex flex-wrap items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl border border-brand/30 bg-gradient-to-br from-brand/20 to-brand2/10 text-brand">
          <Icon name="Gauge" size={20} />
        </span>
        <div className="min-w-0">
          <h1 className="text-[15px] font-semibold text-ink">Insights</h1>
          <p className="text-[12px] text-faint">
            Security, capacity and reliability analysis across {insights?.sources.length ?? 0} menus · {connection?.name ?? 'no connection'}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ModeChip mode={mode ?? undefined} />
          <a
            className="btn btn-sm"
            href="/api/insights/report?format=md&traffic=true&download=true"
            title="Download this analysis as a Markdown report (score, findings, remediation, capacity, drift)"
          >
            <Icon name="FileDown" size={13} />
            Report
          </a>
          <button className="btn btn-sm btn-primary" onClick={() => query.refetch()} disabled={query.isFetching}>
            {query.isFetching ? <Spinner className="size-3.5" /> : <Icon name="RefreshCw" size={13} />}
            Re-analyse
          </button>
        </div>
      </header>

      {query.isLoading && <div className="card p-4"><TableSkeleton cols={6} rows={8} /></div>}

      {error && !insights && (
        <div className="card border-bad/40 p-4">
          <p className="text-[13px] text-bad">Analysis failed: {error.message}</p>
          {error.hint ? <p className="mt-1 text-[12px] text-faint">{String(error.hint)}</p> : null}
        </div>
      )}

      {insights && (
        <>
          <div className="grid gap-3 lg:grid-cols-[280px_1fr]">
            <section className="card flex flex-col items-center justify-center gap-2 p-4">
              <Gauge
                value={insights.score.overall}
                label={`Grade ${insights.score.grade}`}
                sub="weighted security, reliability, capacity, hygiene, observability"
                tone={insights.score.overall >= 80 ? 'good' : insights.score.overall >= 65 ? 'warn' : 'bad'}
                size={150}
              />
              <div className="mt-1 flex gap-1.5">
                {SEVERITY_ORDER.map((severity) => (
                  insights.counts[severity] ? <SeverityChip key={severity} severity={severity} count={insights.counts[severity]} /> : null
                ))}
              </div>
            </section>

            <section className="card p-4">
              <div className="mb-3 flex items-center gap-2">
                <Icon name="Activity" size={15} className="text-brand" />
                <span className="text-[13px] font-semibold text-ink">Score breakdown</span>
                <span className="ml-auto text-[11px] text-faint">analysed {relativeTime(insights.generatedAt)}</span>
              </div>
              <div className="space-y-3">
                {insights.score.components.map((component) => (
                  <div key={component.id}>
                    <div className="mb-1 flex items-center justify-between text-[12px]">
                      <span className="text-dim">{component.label}</span>
                      <span className={clsx('mono', component.tone === 'good' ? 'text-good' : component.tone === 'warn' ? 'text-warn' : 'text-bad')}>{component.score}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-panel3">
                      <div
                        className={clsx('h-full rounded-full', component.tone === 'good' ? 'bg-good' : component.tone === 'warn' ? 'bg-warn' : 'bg-bad')}
                        style={{ width: `${component.score}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              {insights.notes.length > 0 && (
                <div className="mt-3 space-y-1 border-t border-line/60 pt-3">
                  {insights.notes.map((note) => (
                    <p key={note} className="flex items-start gap-2 text-[11.5px] text-faint"><Icon name="Info" size={12} className="mt-0.5 shrink-0" />{note}</p>
                  ))}
                </div>
              )}
            </section>
          </div>

          <ScoreHistory history={insights.history} />

          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              value={filter}
              onChange={(value) => setFilter(value as Severity | 'all')}
              options={[
                { value: 'all', label: `All (${insights.findings.length})` },
                ...SEVERITY_ORDER.filter((s) => insights.counts[s]).map((s) => ({ value: s, label: `${s} (${insights.counts[s]})` })),
              ]}
            />
            <span className="ml-auto text-[11px] text-faint">click a finding for remediation and the menus that fix it</span>
          </div>

          <div className="space-y-2">
            {findings.length === 0 && <EmptyState icon="ShieldCheck" title="No findings in this bucket" hint="Either the device is clean here, or the relevant menu could not be read." />}
            {findings.map((finding) => <InsightRow key={finding.id} finding={finding} />)}
          </div>

          <Segmented
            value={tab}
            onChange={(value) => setTab(value as typeof tab)}
            options={[
              { value: 'capacity', label: 'Capacity', icon: 'Gauge' },
              { value: 'ipam', label: 'Address space', icon: 'Sitemap' },
              { value: 'wireless', label: 'Wireless', icon: 'Wifi' },
              { value: 'routing', label: 'Routing', icon: 'Route' },
              { value: 'changes', label: 'Changes', icon: 'GitCompare' },
              { value: 'alerts', label: 'Alerts', icon: 'BellRing' },
            ]}
          />

          {tab === 'capacity' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label="Aggregate ingress" value={sampled ? fmtBitrate(totalRx / 8) : 'sampling…'} icon="ArrowDownToLine" tone="info" hint={sampled ? 'from successive counter reads' : 'needs a second read'} />
                <Stat label="Aggregate egress" value={sampled ? fmtBitrate(totalTx / 8) : 'sampling…'} icon="ArrowUpRight" tone="accent" />
                <Stat label="WAN link" value={insights.capacity.wan ? fmtBitrate((insights.capacity.wan.speedBps ?? 0) / 8) : 'unknown'} icon="Cable" tone="neutral" hint="negotiated speed on the default-route interface" />
                <Stat label="Interfaces up" value={`${capacityRows.filter((r) => r.status !== 'down').length}/${capacityRows.length}`} icon="Plug" tone="good" />
              </div>
              <DataTable rows={asRows(capacityRows)} columns={capacityColumns} rowKey={(row) => String(row.interface)} pageSize={12} footerNote="Counters are cumulative since boot; utilisation appears once two reads have been compared." />
            </div>
          )}

          {tab === 'ipam' && (
            <div className="space-y-3">
              {insights.ipam.conflicts.length > 0 && (
                <section className="card border-warn/40 p-3">
                  <div className="mb-1.5 flex items-center gap-2">
                    <Icon name="TriangleAlert" size={14} className="text-warn" />
                    <span className="text-[13px] font-semibold text-ink">Address conflicts</span>
                    <span className="chip chip-warn">{insights.ipam.conflicts.length}</span>
                  </div>
                  {insights.ipam.conflicts.map((conflict) => (
                    <p key={conflict.address} className="text-[12px] text-dim">
                      <span className="mono text-ink">{conflict.address}</span> is claimed by {conflict.macs.map((mac) => <span key={mac} className="mono text-warn">{mac} </span>)}
                      {conflict.hostnames.length ? <span className="text-faint"> ({conflict.hostnames.join(', ')})</span> : null}
                    </p>
                  ))}
                </section>
              )}
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label="Subnets" value={insights.ipam.subnets.length} icon="Sitemap" tone="info" />
                <Stat label="Addresses in use" value={fmtNumber(insights.ipam.totalUsed)} icon="CircleDot" tone="accent" />
                <Stat label="Addresses free" value={fmtNumber(insights.ipam.totalFree)} icon="Circle" tone="good" />
                <Stat label="Pools" value={insights.ipam.pools.length} icon="ListTree" tone="neutral" />
              </div>
              <DataTable rows={asRows(insights.ipam.subnets)} columns={subnetColumns} rowKey={(row) => String(row.cidr)} pageSize={12} />
            </div>
          )}

          {tab === 'wireless' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label="Wireless clients" value={insights.wireless.clients} icon="Wifi" tone="info" />
                <Stat label="Radios" value={insights.wireless.radios.length} icon="Radio" tone="accent" />
                <Stat label="Weak clients" value={insights.wireless.weak.filter((c) => c.signal < -72).length} icon="Signal" tone="warn" hint="below −72 dBm" />
                <Stat label="Bands" value={insights.wireless.bands.map((b) => `${b.band}:${b.count}`).join(' · ') || '–'} icon="Waves" tone="neutral" />
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                {insights.wireless.radios.map((radio) => (
                  <section key={radio.interface} className="card p-3">
                    <div className="flex items-center gap-2">
                      <Icon name="Wifi" size={14} className="text-info" />
                      <span className="mono text-[12.5px] text-ink">{radio.interface}</span>
                      <span className="chip chip-neutral">{radio.ssid || 'hidden SSID'}</span>
                      <span className={clsx('chip', radio.congestion === 'high' ? 'chip-bad' : radio.congestion === 'medium' ? 'chip-warn' : 'chip-good')}>
                        {radio.congestion} load
                      </span>
                      <span className="ml-auto mono text-[11.5px] text-dim">{radio.clients} clients</span>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-[11.5px]">
                      <div><div className="label">Band</div><div className="text-ink">{radio.band ?? '–'}</div></div>
                      <div><div className="label">Channel</div><div className="text-ink">{radio.channelWidth ?? radio.frequency ?? 'auto'}</div></div>
                      <div><div className="label">Avg signal</div><div className="flex items-center gap-1.5"><SignalBars dbm={radio.avgSignal} /><span className="mono text-ink">{radio.avgSignal || '–'}</span></div></div>
                    </div>
                  </section>
                ))}
              </div>
              {insights.wireless.weak.length > 0 && (
                <section className="card p-3">
                  <div className="label mb-2">Weakest clients</div>
                  <div className="flex flex-wrap gap-1.5">
                    {insights.wireless.weak.map((client) => (
                      <span key={`${client.name}-${client.interface}`} className="chip chip-neutral gap-2">
                        <span className="mono text-[11px]">{client.name}</span>
                        <SignalBars dbm={client.signal} showValue />
                        <span className="text-faint">{client.ssid}</span>
                      </span>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}

          {tab === 'routing' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label="Routes" value={insights.routing.total} icon="Route" tone="accent" hint={`${insights.routing.connected} connected · ${insights.routing.static} static · ${insights.routing.dynamic} dynamic`} />
                <Stat label="Default routes" value={insights.routing.defaults} icon="Globe2" tone="info" hint="primary + failover" />
                <Stat label="BGP sessions" value={`${insights.routing.bgp.established}/${insights.routing.bgp.sessions}`} icon="Network" tone={insights.routing.bgp.down.length ? 'bad' : 'good'} />
                <Stat label="OSPF neighbours" value={`${insights.routing.ospf.full}/${insights.routing.ospf.neighbors}`} icon="Radar" tone={insights.routing.ospf.full === insights.routing.ospf.neighbors ? 'good' : 'warn'} hint="full state" />
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                <section className="card p-3">
                  <div className="label mb-2">Route sources</div>
                  <div className="flex flex-wrap gap-1.5">
                    {insights.routing.protocols.map((protocol) => (
                      <span key={protocol.name} className="chip chip-neutral">{protocol.name} <span className="font-mono text-faint">{protocol.count}</span></span>
                    ))}
                  </div>
                </section>
                <section className="card p-3">
                  <div className="label mb-2">Unstable adjacencies</div>
                  {insights.routing.unstable.length === 0
                    ? <p className="text-[12px] text-good">All tracked sessions are healthy.</p>
                    : insights.routing.unstable.map((item) => (
                      <p key={`${item.name}-${item.detail}`} className="text-[12px] text-dim">
                        <span className="text-ink">{item.name}</span> — {item.detail}
                      </p>
                    ))}
                </section>
              </div>
              <section className="card p-3">
                <div className="label mb-2">Quality of service</div>
                <div className="grid grid-cols-2 gap-3 text-[12px] lg:grid-cols-4">
                  <div><div className="label">Simple queues</div><div className="text-ink">{insights.queues.count}</div></div>
                  <div><div className="label">Shaped ceiling</div><div className="text-ink">{fmtBitrate((insights.queues.shapedBps ?? 0) / 8)}</div></div>
                  <div><div className="label">WAN capacity</div><div className="text-ink">{insights.queues.wanBps ? fmtBitrate(insights.queues.wanBps / 8) : 'unknown'}</div></div>
                  <div><div className="label">Oversubscription</div><div className={clsx('text-ink', insights.queues.oversubscription > 1 && 'text-warn')}>{insights.queues.oversubscription}×</div></div>
                </div>
              </section>
            </div>
          )}

          {tab === 'changes' && (
            <div className="space-y-3">
              {!insights.changes && (
                <EmptyState
                  icon="GitCompare"
                  title="Baseline recorded"
                  hint="This is the first snapshot. Re-analyse after making changes — or after the router changes itself — and added/removed configuration shows up here."
                />
              )}
              {insights.changes && (
                <>
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <Stat label="Changed sections" value={insights.changes.sections.length} icon="GitCompare" tone="accent" />
                    <Stat label="Added entries" value={insights.changes.labels.added.length} icon="Plus" tone="good" />
                    <Stat label="Removed entries" value={insights.changes.labels.removed.length} icon="Minus" tone="bad" />
                    <Stat label="Compared since" value={relativeTime(insights.changes.since)} icon="Clock" tone="neutral" />
                  </div>
                  {insights.changes.sections.length === 0
                    ? <EmptyState icon="CheckCircle2" title="No configuration drift" hint="The watched menus are identical to the previous snapshot." />
                    : insights.changes.sections.map((section) => (
                      <section key={section.section} className="card p-3">
                        <div className="mb-1.5 flex items-center gap-2">
                          <span className="text-[13px] font-semibold text-ink">{section.section}</span>
                          {section.added.length > 0 && <span className="chip chip-good">+{section.added.length}</span>}
                          {section.removed.length > 0 && <span className="chip chip-bad">−{section.removed.length}</span>}
                        </div>
                        <div className="space-y-0.5">
                          {section.added.map((entry) => <p key={`a-${entry}`} className="mono text-[11.5px] text-good">+ {entry}</p>)}
                          {section.removed.map((entry) => <p key={`r-${entry}`} className="mono text-[11.5px] text-bad">− {entry}</p>)}
                        </div>
                      </section>
                    ))}
                </>
              )}
            </div>
          )}

          {tab === 'alerts' && <AlertsPanel />}
        </>
      )}
    </div>
  );
};

export default Insights;

export { parseBytes };
