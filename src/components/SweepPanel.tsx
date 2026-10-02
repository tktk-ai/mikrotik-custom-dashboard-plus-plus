/**
 * Bulk device sweep.
 *
 * Streams a ping probe over every known address on a subnet (or the whole LAN) and
 * shows results as they land. Reachability is ICMP through the router; the flow
 * counts next to each host are what conntrack has *observed* for that address —
 * RouterOS has no REST port scanner, and the panel says so rather than pretending.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import type { SweepResult, SweepSummary } from '@shared/analytics';
import { EmptyState, Icon, ProgressBar, Segmented, Spinner, Stat, toast } from './ui';
import { fmtBitrate, fmtBytes } from '../lib/format';
import { KindChip, LinkChip } from './network';

const fmtRtt = (value: number | null | undefined) => (value === null || value === undefined ? '—' : `${value} ms`);

const SCOPE_ALL = 'all';

export interface SweepPanelProps {
  /** Subnets offered in the scope picker (CIDRs). */
  subnets?: Array<{ cidr: string; label?: string }>;
  /** Pre-selected scope, e.g. when arriving from the map. */
  initialScope?: string;
  deviceCount?: number;
  className?: string;
  onFinished?: (summary: SweepSummary) => void;
}

export const SweepPanel: React.FC<SweepPanelProps> = ({ subnets = [], initialScope, deviceCount, className, onFinished }) => {
  const [scope, setScope] = useState(initialScope ?? SCOPE_ALL);
  const [running, setRunning] = useState(false);
  const [planned, setPlanned] = useState(0);
  const [results, setResults] = useState<SweepResult[]>([]);
  const [summary, setSummary] = useState<SweepSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const source = useRef<EventSource | null>(null);
  const startedAt = useRef(0);

  const stop = () => {
    source.current?.close();
    source.current = null;
    setRunning(false);
  };

  useEffect(() => () => source.current?.close(), []);

  const start = (targetScope = scope) => {
    stop();
    setResults([]);
    setSummary(null);
    setError(null);
    setPlanned(0);
    setRunning(true);
    startedAt.current = Date.now();

    try {
      const url = `/api/devices/sweep?scope=${encodeURIComponent(targetScope)}&limit=200&concurrency=8`;
      const es = new EventSource(url);
      source.current = es;

      es.addEventListener('start', (event) => {
        try { setPlanned(Number(JSON.parse((event as MessageEvent).data).total ?? 0)); } catch { /* ignore */ }
      });
      es.addEventListener('result', (event) => {
        try {
          const result = JSON.parse((event as MessageEvent).data) as SweepResult;
          setResults((current) => [...current, result]);
        } catch { /* ignore */ }
      });
      es.addEventListener('done', (event) => {
        try {
          const finished = JSON.parse((event as MessageEvent).data) as SweepSummary;
          setSummary(finished);
          setResults(finished.results);
          onFinished?.(finished);
          toast.success('Sweep complete', `${finished.reachable}/${finished.total} hosts answered`);
        } catch { /* ignore */ }
        stop();
      });
      es.addEventListener('error', (event) => {
        // The named 'error' event carries our payload; transport errors have no data.
        const data = (event as MessageEvent).data;
        if (data) {
          try { setError(String(JSON.parse(data).message ?? 'Sweep failed')); } catch { setError('Sweep failed'); }
        }
        stop();
      });
      es.onerror = () => {
        if (source.current === es) stop();
      };
    } catch {
      setRunning(false);
      setError('This browser cannot stream sweep results.');
    }
  };

  // Arriving from the map with ?sweep=<cidr> should start immediately.
  useEffect(() => {
    if (initialScope) start(initialScope);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialScope]);

  const options = useMemo(
    () => [
      { value: SCOPE_ALL, label: deviceCount ? `All known hosts (${deviceCount})` : 'All known hosts' },
      ...subnets.map((subnet) => ({ value: subnet.cidr, label: subnet.label ?? subnet.cidr })),
    ],
    [subnets, deviceCount],
  );

  const reachable = results.filter((result) => result.reachable);
  const unreachable = results.length - reachable.length;
  const elapsed = summary?.elapsedMs ?? (running ? Date.now() - startedAt.current : 0);

  return (
    <div className={clsx('space-y-3', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented value={scope} onChange={(value) => setScope(value)} options={options} />
        <button className="btn btn-sm btn-primary" onClick={() => start()} disabled={running}>
          {running ? <Spinner className="size-3.5" /> : <Icon name="Radar" size={13} />}
          {running ? 'Sweeping…' : summary ? 'Sweep again' : 'Start sweep'}
        </button>
        {running && (
          <button className="btn btn-sm" onClick={stop}>
            <Icon name="Square" size={12} />
            Stop
          </button>
        )}
        <span className="ml-auto text-[11px] text-faint" title="RouterOS exposes no REST port scanner — this is ICMP reachability plus what conntrack has already seen.">
          ICMP reachability · service column is passive conntrack, not a port scan
        </span>
      </div>

      {(running || summary) && (
        <div className="space-y-2">
          <ProgressBar
            value={results.length}
            max={Math.max(1, planned)}
            label={`${results.length}${planned ? ` / ${planned}` : ''} probed · ${reachable.length} answered${unreachable ? ` · ${unreachable} silent` : ''}`}
          />
          <div className="grid gap-2 sm:grid-cols-4">
            <Stat label="Reachable" value={reachable.length} icon="CheckCircle2" tone="good" />
            <Stat label="Silent" value={unreachable} icon="CircleSlash" tone={unreachable ? 'warn' : 'neutral'} />
            <Stat label="Avg RTT" value={summary?.averageRttMs ? `${summary.averageRttMs} ms` : '—'} icon="Timer" />
            <Stat label="Elapsed" value={elapsed >= 1000 ? `${(elapsed / 1000).toFixed(1)} s` : `${elapsed} ms`} icon="Clock" />
          </div>
        </div>
      )}

      {error && <p className="text-[12px] text-bad">{error}</p>}

      {!results.length && !running && !error && (
        <EmptyState
          icon="Radar"
          title="Probe every host at once"
          hint="Ping sweep across the devices the dashboard has discovered, streamed live. Per-host detail is a click away in the inventory."
        />
      )}

      {results.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-line">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-panel2 text-[11px] uppercase tracking-wide text-faint">
              <tr>
                <th className="px-3 py-2">Host</th>
                <th className="px-3 py-2">Address</th>
                <th className="px-3 py-2">Class</th>
                <th className="px-3 py-2">Link</th>
                <th className="px-3 py-2">RTT</th>
                <th className="px-3 py-2">Observed</th>
              </tr>
            </thead>
            <tbody>
              {results.map((result) => (
                <tr key={result.ip} className="border-t border-line/60" title={result.method === 'arp' ? 'Known to the device (ARP/lease) but did not answer the ping' : undefined}>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      <span className={clsx('size-1.5 rounded-full', result.reachable ? 'bg-good' : 'bg-bad/70')} />
                      <span className="truncate text-ink">{result.name ?? '—'}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2"><span className="mono text-[11.5px] text-dim">{result.ip}</span></td>
                  <td className="px-3 py-2">{result.kind ? <KindChip kind={result.kind as never} /> : <span className="text-faint">—</span>}</td>
                  <td className="px-3 py-2">{result.link ? <LinkChip link={result.link as never} /> : <span className="text-faint">—</span>}</td>
                  <td className="px-3 py-2"><span className="mono text-[11.5px] text-dim">{result.reachable ? fmtRtt(result.rttMs) : 'no answer'}</span></td>
                  <td className="px-3 py-2">
                    {result.flows ? (
                      <span className="text-[11.5px] text-dim">
                        {result.flows} flow{result.flows === 1 ? '' : 's'} · {fmtBytes(result.bytes ?? 0)}
                        {result.topService ? ` · ${result.topService}` : ''}
                      </span>
                    ) : (
                      <span className="text-faint">quiet</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {summary && (
        <p className="text-[11.5px] text-faint">
          Swept <span className="text-dim">{summary.scope === SCOPE_ALL ? 'all known hosts' : summary.scope}</span> in {summary.elapsedMs} ms
          {summary.observedTraffic ? ` · ${summary.observedTraffic} of observed traffic` : ''}. Silent hosts may simply drop ICMP — check the
          inventory for their lease and ARP evidence before calling them offline.
        </p>
      )}
    </div>
  );
};

/** Small wrapper used by the inventory toolbar. */
export const SweepButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button className="btn btn-sm" onClick={onClick} title="Probe every known host and stream the results">
    <Icon name="Radar" size={13} />
    Sweep
  </button>
);

export const sweepTrafficNote = (result: SweepResult) =>
  result.bytes ? `${fmtBytes(result.bytes)} seen · ${fmtBitrate((result.bytes ?? 0) / 60)} average` : 'no traffic observed';
