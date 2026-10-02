/**
 * Traffic analytics.
 *
 * Flow-level (5-tuple) analytics from the connection table and mangle counters,
 * plus an honest, explicit treatment of deep packet inspection: what RouterOS can
 * see over REST, what needs a mirror port and a sensor container, and which of
 * those options is already wired up on this device.
 */
import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { APP_CATEGORY_COLORS, type AppCategory } from '@shared/analytics';
import type { Row } from '@shared/types';
import { api, ApiError } from '../lib/api';
import { useApp } from '../lib/store';
import { fmtBytes, fmtNumber, relativeTime } from '../lib/format';
import { DataTable, type ColumnDef } from '../components/DataTable';
import { Badge, EmptyState, Icon, Segmented, Spinner, Stat, TableSkeleton, Field, Modal, Toggle, toast, CopyButton } from '../components/ui';
import { Donut } from '../components/charts';
import { ModeChip, UtilBar } from '../components/network';

const asRows = <T,>(items: T[]): Row[] => items as unknown as Row[];

const FIDELITY_TONE: Record<string, string> = { payload: 'chip-good', headers: 'chip-info', metadata: 'chip-neutral' };

/** Default capture name per day, so successive captures do not overwrite each other. */
const suggestedCaptureFile = () => `capture-${new Date().toISOString().slice(0, 10)}.pcap`;

const Traffic: React.FC = () => {
  const { connection, mode } = useApp();
  const [tab, setTab] = useState<'apps' | 'talkers' | 'conversations' | 'dpi'>('apps');

  const query = useQuery({
    queryKey: ['traffic'],
    queryFn: () => api.traffic(),
    staleTime: 20_000,
    refetchOnWindowFocus: false,
  });

  const traffic = query.data;
  const error = query.error as ApiError | null;

  /* ------------------------- DPI tooling (writes) ------------------------- */
  const qc = useQueryClient();
  const [matcherOpen, setMatcherOpen] = useState(false);
  const [matcherName, setMatcherName] = useState('');
  const [matcherRegexp, setMatcherRegexp] = useState('');
  const [markPackets, setMarkPackets] = useState(true);
  const [snifferFilter, setSnifferFilter] = useState('ether1');
  const [snifferFile, setSnifferFile] = useState(suggestedCaptureFile);
  const [snifferOpen, setSnifferOpen] = useState(false);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['traffic'] });
    void qc.invalidateQueries({ queryKey: ['captures'] });
  };

  const captures = useQuery({
    queryKey: ['captures'],
    queryFn: () => api.captures(),
    enabled: tab === 'dpi',
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const createMatcher = useMutation({
    mutationFn: async () => {
      const created = await api.createMatcher({ name: matcherName.trim(), regexp: matcherRegexp, comment: 'dashboard l7 matcher' });
      if (markPackets) await api.createMangle({ matcher: matcherName.trim(), chain: 'prerouting', comment: `classify ${matcherName.trim()}` });
      return created;
    },
    onSuccess: () => {
      toast.success('Matcher created', markPackets ? `${matcherName} is matching, and a mangle rule marks its packets` : `${matcherName} is matching`);
      setMatcherOpen(false);
      setMatcherName('');
      setMatcherRegexp('');
      invalidate();
    },
    onError: (err) => toast.error('Could not create matcher', (err as Error).message),
  });

  const sniffer = useMutation({
    mutationFn: (running: boolean) => api.sniffer({ running, filter: snifferFilter, file: snifferFile }),
    onSuccess: (_data, running) => {
      toast.success(running ? 'Sniffer started' : 'Sniffer stopped', running ? `Capturing on ${snifferFilter} into ${snifferFile}` : 'Capture stopped');
      setSnifferOpen(false);
      invalidate();
    },
    onError: (err) => toast.error('Sniffer command failed', (err as Error).message),
  });



  const categorySplit = useMemo(() => {
    if (!traffic) return [];
    const map = new Map<AppCategory, number>();
    for (const app of traffic.apps) map.set(app.category, (map.get(app.category) ?? 0) + app.bytes);
    return [...map.entries()]
      .map(([category, bytes]) => ({ label: category, value: bytes, color: APP_CATEGORY_COLORS[category] }))
      .sort((a, b) => b.value - a.value);
  }, [traffic]);

  const talkerColumns: Array<ColumnDef<Row>> = [
    {
      key: 'ip', label: 'Source', sortable: true,
      render: (row) => (
        <div className="min-w-0">
          <div className="mono text-[12px] text-ink">{String(row.ip)}</div>
          <div className="truncate text-[10.5px] text-faint">{String(row.name ?? 'unresolved')}{row.mac ? ` · ${String(row.mac)}` : ''}</div>
        </div>
      ),
    },
    { key: 'flows', label: 'Flows', sortable: true, render: (row) => <span className="mono text-[11.5px] text-dim">{String(row.flows)}</span> },
    { key: 'bytes', label: 'Volume', sortable: true, value: (row) => row.bytes ?? 0, render: (row) => <span className="mono text-[11.5px] text-ink">{fmtBytes(Number(row.bytes))}</span> },
    { key: 'topApp', label: 'Dominant app', sortable: true, render: (row) => <span className="chip chip-neutral">{String(row.topApp)}</span> },
  ];

  const destinationColumns: Array<ColumnDef<Row>> = [
    { key: 'ip', label: 'Destination', sortable: true, render: (row) => <div><div className="mono text-[12px] text-ink">{String(row.ip)}</div><div className="truncate text-[10.5px] text-faint">{String(row.name ?? 'external')}</div></div> },
    { key: 'app', label: 'App', sortable: true, render: (row) => <span className="chip chip-neutral">{String(row.app)}</span> },
    { key: 'flows', label: 'Flows', sortable: true, render: (row) => <span className="mono text-[11.5px] text-dim">{String(row.flows)}</span> },
    { key: 'bytes', label: 'Volume', sortable: true, value: (row) => row.bytes ?? 0, render: (row) => <span className="mono text-[11.5px] text-ink">{fmtBytes(Number(row.bytes))}</span> },
  ];

  const conversationColumns: Array<ColumnDef<Row>> = [
    { key: 'src', label: 'Source', sortable: true, render: (row) => <span className="mono text-[11.5px] text-ink">{String(row.src)}</span> },
    { key: 'dst', label: 'Destination', sortable: true, render: (row) => <span className="mono text-[11.5px] text-dim">{String(row.dst)}:{String(row.port || '')}</span> },
    { key: 'protocol', label: 'Proto', sortable: true, render: (row) => <span className="chip chip-neutral">{String(row.protocol)}</span> },
    { key: 'app', label: 'App', sortable: true, render: (row) => <span className="chip chip-accent">{String(row.app)}</span> },
    { key: 'bytes', label: 'Bytes', sortable: true, value: (row) => row.bytes ?? 0, render: (row) => <span className="mono text-[11.5px] text-ink">{fmtBytes(Number(row.bytes))}</span> },
    { key: 'state', label: 'State', sortable: true, render: (row) => <span className="text-[11.5px] text-dim">{String(row.state)}</span> },
    { key: 'timeout', label: 'Timeout', sortable: true, render: (row) => <span className="mono text-[11px] text-faint">{String(row.timeout)}</span> },
  ];

  return (
    <div className="space-y-4 p-4">
      <header className="flex flex-wrap items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl border border-brand/30 bg-gradient-to-br from-brand/20 to-brand2/10 text-brand">
          <Icon name="Activity" size={20} />
        </span>
        <div className="min-w-0">
          <h1 className="text-[15px] font-semibold text-ink">Traffic &amp; DPI</h1>
          <p className="text-[12px] text-faint">
            Flow analytics from conntrack, mangle and Layer 7 counters · payload inspection options · {connection?.name ?? 'no connection'}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ModeChip mode={mode ?? undefined} />
          <button className="btn btn-sm btn-primary" onClick={() => query.refetch()} disabled={query.isFetching}>
            {query.isFetching ? <Spinner className="size-3.5" /> : <Icon name="RefreshCw" size={13} />}
            Refresh
          </button>
        </div>
      </header>

      {query.isLoading && <div className="card p-4"><TableSkeleton cols={5} rows={6} /></div>}

      {error && !traffic && (
        <div className="card border-bad/40 p-4">
          <p className="text-[13px] text-bad">Could not read traffic: {error.message}</p>
          {error.hint ? <p className="mt-1 text-[12px] text-faint">{String(error.hint)}</p> : null}
        </div>
      )}

      {traffic && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
            <Stat label="Tracked flows" value={fmtNumber(traffic.totalFlows)} icon="Activity" tone="accent" hint={`conntrack entries: ${fmtNumber(traffic.dpi.conntrack?.entries ?? traffic.totalFlows)} / ${traffic.dpi.conntrack?.maxEntries ?? '?'}`} />
            <Stat label="Volume observed" value={fmtBytes(traffic.totalBytes)} icon="Database" tone="info" />
            <Stat label="Classified" value={`${traffic.totalBytes ? Math.round((traffic.classifiedBytes / traffic.totalBytes) * 100) : 0}%`} icon="Wand2" tone="good" hint="attributable to a known application class" />
            <Stat label="L7 matchers" value={traffic.dpi.l7.matchers.length} icon="Filter" tone="info" hint={`${traffic.dpi.l7.ruleCount} mangle rules classify with them`} />
            <Stat label="DPI sensor" value={traffic.dpi.containers.some((c) => /ntopng|suricata|zeek/i.test(c.name) && c.status === 'running') ? 'running' : 'not running'} icon="ScanEye" tone={traffic.dpi.containers.some((c) => /ntopng|suricata|zeek/i.test(c.name) && c.status === 'running') ? 'good' : 'warn'} />
            <Stat label="Flow export" value={traffic.dpi.trafficFlow?.enabled ? `${traffic.dpi.trafficFlow.targets} target(s)` : 'disabled'} icon="Send" tone={traffic.dpi.trafficFlow?.enabled ? 'good' : 'neutral'} hint="NetFlow v9 / IPFIX" />
          </div>

          <Segmented
            value={tab}
            onChange={(value) => setTab(value as typeof tab)}
            options={[
              { value: 'apps', label: 'Applications', icon: 'PieChart' },
              { value: 'talkers', label: 'Talkers', icon: 'Users' },
              { value: 'conversations', label: 'Conversations', icon: 'ListTree' },
              { value: 'dpi', label: 'Deep inspection', icon: 'ScanEye' },
            ]}
          />

          {tab === 'apps' && (
            <div className="grid gap-3 lg:grid-cols-[320px_1fr]">
              <section className="card flex flex-col items-center justify-center gap-3 p-4">
                <Donut
                  segments={categorySplit.length ? categorySplit : [{ label: 'no data', value: 1, color: '#334155' }]}
                  size={190}
                  thickness={16}
                  center={
                    <div className="text-center">
                      <div className="mono text-[15px] font-semibold text-ink">{fmtBytes(traffic.totalBytes)}</div>
                      <div className="label">observed</div>
                    </div>
                  }
                />
                <div className="flex flex-wrap justify-center gap-1.5">
                  {categorySplit.map((segment) => (
                    <span key={segment.label} className="chip chip-neutral gap-1.5">
                      <span className="size-2 rounded-full" style={{ background: segment.color }} />
                      {segment.label}
                      <span className="font-mono text-faint">{fmtBytes(segment.value)}</span>
                    </span>
                  ))}
                </div>
              </section>

              <section className="card p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Icon name="PieChart" size={15} className="text-brand" />
                  <span className="text-[13px] font-semibold text-ink">Application classes</span>
                  <span className="ml-auto text-[11px] text-faint">ports + protocol, merged with on-device L7 counters</span>
                </div>
                <div className="space-y-2.5">
                  {traffic.apps.slice(0, 14).map((app) => (
                    <div key={app.id}>
                      <div className="mb-1 flex items-center justify-between text-[12px]">
                        <span className="flex items-center gap-2">
                          <span className="size-2 rounded-full" style={{ background: app.color }} />
                          <span className="text-ink">{app.label}</span>
                          <span className="chip chip-neutral">{app.category}</span>
                        </span>
                        <span className="mono text-dim">{fmtBytes(app.bytes)} · {app.share}%{app.flows ? ` · ${app.flows} flows` : ' · L7 counter'}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-panel3">
                        <div className="h-full rounded-full" style={{ width: `${Math.max(1, app.share)}%`, background: app.color }} />
                      </div>
                    </div>
                  ))}
                  {!traffic.apps.length && <EmptyState icon="Activity" title="No flows to classify" hint="The connection table is empty or not readable." />}
                </div>
              </section>

              <section className="card p-4 lg:col-span-2">
                <div className="mb-3 flex items-center gap-2">
                  <Icon name="Route" size={15} className="text-brand2" />
                  <span className="text-[13px] font-semibold text-ink">Protocols &amp; top ports</span>
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="space-y-2">
                    {traffic.protocols.map((protocol) => (
                      <div key={protocol.name} className="flex items-center gap-3">
                        <span className="mono w-16 text-[12px] text-ink">{protocol.name}</span>
                        <UtilBar value={protocol.share} tone="accent" />
                        <span className="mono text-[11px] text-faint">{protocol.flows} flows · {fmtBytes(protocol.bytes)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-1.5">
                    {traffic.ports.slice(0, 8).map((port) => (
                      <div key={`${port.protocol}-${port.port}`} className="flex items-center gap-2 text-[12px]">
                        <span className="mono w-14 text-ink">{port.port || '–'}</span>
                        <span className="chip chip-neutral">{port.label}</span>
                        <span className="ml-auto mono text-[11px] text-faint">{port.flows} flows</span>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </div>
          )}

          {tab === 'talkers' && (
            <div className="space-y-3">
              <DataTable rows={asRows(traffic.talkers)} columns={talkerColumns} rowKey={(row) => String(row.ip)} pageSize={12} emptyState={<EmptyState icon="Users" title="No talkers" hint="Nothing is logged in the connection table right now." />} footerNote="Bytes are the sum of original and reply counters per flow, attributed to the LAN source address." />
              <DataTable rows={asRows(traffic.destinations)} columns={destinationColumns} rowKey={(row) => String(row.ip)} pageSize={12} />
            </div>
          )}

          {tab === 'conversations' && (
            <DataTable rows={asRows(traffic.conversations)} columns={conversationColumns} rowKey={(row, index) => `${row.src}-${row.dst}-${row.port}-${index}`} pageSize={15} />
          )}

          {tab === 'dpi' && (
            <div className="space-y-3">
              <section className="card border-info/40 p-4">
                <div className="flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-info/40 bg-info/10 text-info">
                    <Icon name="ScanEye" size={17} />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13.5px] font-semibold text-ink">Deep packet inspection</span>
                      <Badge tone="warn">not over REST</Badge>
                      <Badge tone="neutral">metadata only without a sensor</Badge>
                    </div>
                    <p className="mt-1 text-[12.5px] text-dim">{traffic.dpi.reason}</p>
                    <p className="mt-1.5 text-[11.5px] text-faint">
                      What this page shows today is flow analytics: addresses, ports, protocols, byte counts, application classes from
                      on-device matchers. Payload content (URLs inside TLS, DNS names, file types) only becomes visible through one of
                      the options below.
                    </p>
                  </div>
                </div>
              </section>

              <div className="grid gap-3 lg:grid-cols-2">
                <section className="card p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <Icon name="Filter" size={15} className="text-brand" />
                    <span className="text-[13px] font-semibold text-ink">On-device Layer 7 matchers</span>
                    <span className="chip chip-neutral">{traffic.dpi.l7.matchers.length}</span>
                    <button className="btn btn-sm ml-auto" onClick={() => setMatcherOpen(true)}>
                      <Icon name="Plus" size={12} />
                      New matcher
                    </button>
                  </div>
                  {traffic.dpi.l7.matchers.length === 0
                    ? <p className="text-[12px] text-dim">No matchers configured. Layer 7 rules let the router classify payloads it can already see — cheap, but licence-bounded and CPU-heavy.</p>
                    : (
                      <div className="space-y-1.5">
                        {traffic.dpi.l7.matchers.map((matcher) => (
                          <div key={matcher.name} className="rounded-lg border border-line bg-base2/60 p-2">
                            <div className="flex items-center gap-2">
                              <span className="mono text-[12px] text-ink">{matcher.name}</span>
                              {matcher.bytes ? <span className="chip chip-accent">{fmtBytes(matcher.bytes)} matched</span> : null}
                              <span className={clsx('chip', matcher.rules ? 'chip-good' : 'chip-neutral')}>{matcher.rules} rule(s)</span>
                              <Link to="/m/ip/firewall/layer7-protocol" className="ml-auto text-[11px] text-brand hover:underline">edit</Link>
                            </div>
                            <p className="mono mt-1 break-all text-[10.5px] text-faint">{matcher.regexp}</p>
                          </div>
                        ))}
                      </div>
                    )}
                </section>

                <section className="card p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <Icon name="Network" size={15} className="text-brand2" />
                    <span className="text-[13px] font-semibold text-ink">Mirror port &amp; sensors</span>
                  </div>
                  {traffic.dpi.mirror ? (
                    <p className="text-[12.5px] text-dim">{traffic.dpi.mirror.note}</p>
                  ) : (
                    <p className="text-[12.5px] text-dim">No mirror source detected. Mark a switch port as mirror-source/target on the uplink to feed a sensor.</p>
                  )}
                  <div className="mt-3 space-y-1.5">
                    {traffic.dpi.containers.map((container) => (
                      <div key={container.name} className="flex items-center gap-2">
                        <span className={clsx('size-1.5 rounded-full', container.status === 'running' ? 'bg-good' : container.status === 'error' ? 'bg-bad' : 'bg-dim')} />
                        <span className="mono text-[11.5px] text-ink">{container.name}</span>
                        <span className="chip chip-neutral">{container.status}</span>
                        <span className="truncate text-[11px] text-faint">{container.image}</span>
                      </div>
                    ))}
                    {!traffic.dpi.containers.length && <p className="text-[12px] text-faint">No containers on this device.</p>}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 border-t border-line/60 pt-3 text-[11.5px]">
                    <div><div className="label">Sniffer</div><div className="text-ink">{traffic.dpi.sniffer?.running ? `running on ${traffic.dpi.sniffer.filter ?? 'all'}` : 'stopped'}</div></div>
                    <div><div className="label">Flow export</div><div className="text-ink">{traffic.dpi.trafficFlow?.enabled ? `enabled · ${traffic.dpi.trafficFlow.targets} target(s)` : 'disabled'}</div></div>
                    <div><div className="label">Remote syslog</div><div className="text-ink">{traffic.dpi.remoteLogging ? `${traffic.dpi.remoteLogging} action(s)` : 'none'}</div></div>
                    <div><div className="label">Conntrack</div><div className="text-ink">{fmtNumber(traffic.dpi.conntrack?.entries ?? traffic.totalFlows)} entries</div></div>
                  </div>

                  <div className="mt-3 border-t border-line/60 pt-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <button className="btn btn-sm" onClick={() => setSnifferOpen(true)}>
                        <Icon name={traffic.dpi.sniffer?.running ? 'Square' : 'Play'} size={12} />
                        {traffic.dpi.sniffer?.running ? 'Capture settings' : 'Start capture'}
                      </button>
                      {traffic.dpi.sniffer?.running && (
                        <button className="btn btn-sm btn-ghost" onClick={() => sniffer.mutate(false)} disabled={sniffer.isPending}>
                          {sniffer.isPending ? <Spinner className="size-3.5" /> : <Icon name="Square" size={12} />}
                          Stop capture
                        </button>
                      )}
                      <span className="text-[11px] text-faint">
                        Capture-to-file is the only on-box payload path — analyse the pcap off-box.
                      </span>
                    </div>

                    <div className="mt-3">
                      <div className="mb-1 flex items-center gap-2">
                        <span className="label">Capture files on the device</span>
                        <button className="btn btn-sm btn-ghost ml-auto" onClick={() => captures.refetch()} disabled={captures.isFetching}>
                          {captures.isFetching ? <Spinner className="size-3" /> : <Icon name="RefreshCw" size={11} />}
                          Refresh
                        </button>
                      </div>
                      {captures.data?.files.length ? (
                        <div className="space-y-1">
                          {captures.data.files.map((file) => (
                            <div key={file.name} className="flex items-center gap-2 rounded-lg border border-line bg-base2/60 px-2 py-1.5">
                              <Icon name="FileText" size={12} className="text-faint" />
                              <span className="mono truncate text-[11.5px] text-ink">{file.name}</span>
                              <span className="chip chip-neutral">{fmtBytes(file.size)}</span>
                              <CopyButton value={file.name} label="copy name" className="ml-auto" />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[11.5px] text-faint">{captures.isLoading ? 'Reading the file list…' : 'No pcap files on the device yet.'}</p>
                      )}
                      {captures.data && (
                        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-faint">
                          <Icon name="Info" size={11} className="mt-0.5 shrink-0" />
                          {captures.data.downloadHint}
                        </p>
                      )}
                    </div>
                  </div>
                </section>
              </div>

              <section className="card p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Icon name="ListChecks" size={15} className="text-brand" />
                  <span className="text-[13px] font-semibold text-ink">Ways to get deeper visibility</span>
                  <span className="ml-auto text-[11px] text-faint">ranked by effort on this device</span>
                </div>
                <div className="grid gap-3 xl:grid-cols-2">
                  {traffic.dpi.options.map((option) => (
                    <div key={option.title} className="rounded-xl border border-line bg-base2/50 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] font-semibold text-ink">{option.title}</span>
                        <span className={clsx('chip', FIDELITY_TONE[option.fidelity] ?? 'chip-neutral')}>{option.fidelity}</span>
                        <span className="chip chip-neutral">effort: {option.effort}</span>
                      </div>
                      <p className="mt-1.5 text-[12px] text-dim">{option.detail}</p>
                      {option.commands && (
                        <pre className="mono mt-2 overflow-x-auto rounded-lg border border-line bg-base/80 p-2 text-[11px] text-faint">{option.commands}</pre>
                      )}
                      <Link to="/console" className="mt-2 inline-flex items-center gap-1 text-[11.5px] text-brand hover:underline">
                        <Icon name="Terminal" size={11} />Open in console
                      </Link>
                    </div>
                  ))}
                </div>
              </section>

              <Modal
                open={matcherOpen}
                onClose={() => setMatcherOpen(false)}
                title="New Layer 7 matcher"
                subtitle="RouterOS matches payload patterns it can already see and counts the bytes — the closest thing to on-box application detection"
                footer={
                  <>
                    <button className="btn" onClick={() => setMatcherOpen(false)}>Cancel</button>
                    <button
                      className="btn btn-primary"
                      onClick={() => createMatcher.mutate()}
                      disabled={!matcherName.trim() || !matcherRegexp.trim() || createMatcher.isPending}
                    >
                      {createMatcher.isPending ? <Spinner className="size-3.5" /> : <Icon name="Plus" size={13} />}
                      Create matcher
                    </button>
                  </>
                }
              >
                <div className="space-y-3">
                  <Field label="Name" hint="Referenced by mangle rules — letters, digits, dot, dash, underscore." required>
                    <input className="input" value={matcherName} onChange={(e) => setMatcherName(e.target.value)} placeholder="e.g. tiktok-video" />
                  </Field>
                  <Field
                    label="Regular expression"
                    hint="RouterOS uses its own regex engine; matching is CPU-bound, so keep the pattern specific."
                    required
                  >
                    <input
                      className="input mono text-[12px]"
                      value={matcherRegexp}
                      onChange={(e) => setMatcherRegexp(e.target.value)}
                      placeholder="e.g. ^(GET|POST) /api/v1/telemetry"
                    />
                  </Field>
                  <Toggle
                    checked={markPackets}
                    onChange={setMarkPackets}
                    label="Also add a mangle rule that marks matching packets (prerouting)"
                  />
                  <p className="flex items-start gap-1.5 text-[11.5px] text-faint">
                    <Icon name="Info" size={12} className="mt-0.5 shrink-0" />
                    This creates real configuration on the router. Nothing here decodes payloads for you — the counters tell you how much
                    matched, and the packet mark lets queues and routes treat it differently.
                  </p>
                </div>
              </Modal>

              <Modal
                open={snifferOpen}
                onClose={() => setSnifferOpen(false)}
                title="Start a capture"
                subtitle="Writes a pcap on the device's storage — pull it off with SCP/FTP and open it in Wireshark or Zeek"
                footer={
                  <>
                    <button className="btn" onClick={() => setSnifferOpen(false)}>Cancel</button>
                    <button className="btn btn-primary" onClick={() => sniffer.mutate(true)} disabled={sniffer.isPending}>
                      {sniffer.isPending ? <Spinner className="size-3.5" /> : <Icon name="Play" size={13} />}
                      Start capture
                    </button>
                  </>
                }
              >
                <div className="space-y-3">
                  <Field label="Filter interface" hint="Capture on the uplink to see everything that crosses the WAN.">
                    <input className="input" value={snifferFilter} onChange={(e) => setSnifferFilter(e.target.value)} placeholder="ether1" />
                  </Field>
                  <Field label="File name" required>
                    <input className="input mono text-[12px]" value={snifferFile} onChange={(e) => setSnifferFile(e.target.value)} />
                  </Field>
                  <p className="flex items-start gap-1.5 text-[11.5px] text-faint">
                    <Icon name="TriangleAlert" size={12} className="mt-0.5 shrink-0" />
                    A running sniffer costs CPU and disk on the router. Stop it when the incident is over — for continuous visibility, mirror
                    the port into a sensor container instead.
                  </p>
                </div>
              </Modal>

              <section className="card p-3">
                <div className="label mb-2">Menus this analysis read</div>
                <div className="flex flex-wrap gap-1.5">
                  {traffic.sources.map((source) => (
                    <span key={source.path} className={clsx('chip', source.ok ? 'chip-neutral' : 'chip-bad')} title={source.error ?? `${source.rows} rows`}>
                      <span className="mono text-[11px]">/{source.path}</span>
                      <span className="font-mono text-faint">{source.rows}</span>
                    </span>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-faint">snapshot {relativeTime(traffic.generatedAt)}</p>
              </section>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Traffic;
