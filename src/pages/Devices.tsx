/**
 * Device inventory.
 *
 * One row per device seen by the router, merged from neighbour discovery, DHCP,
 * ARP, Wi-Fi registrations, hotspot sessions, PPP sessions and WireGuard peers.
 * Selecting a device runs an on-demand probe (ping + reverse lookup + evidence)
 * through the backend.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { DEVICE_KIND_LABEL, isTruthy, parseBytes, type DeviceKind, type DeviceRecord } from '@shared/analytics';
import type { Row } from '@shared/types';
import { api, ApiError, type DeviceProbe } from '../lib/api';
import { Link, useSearchParams } from 'react-router-dom';
import { useApp } from '../lib/store';
import { fmtBytes, fmtNumber, relativeTime } from '../lib/format';
import { DataTable, type ColumnDef } from '../components/DataTable';
import { SweepPanel } from '../components/SweepPanel';
import { Drawer, EmptyState, Icon, Segmented, Spinner, Stat, TableSkeleton, toast, useDebounced } from '../components/ui';
import { KindChip, LinkChip, ModeChip, SignalBars } from '../components/network';

const asRows = (devices: DeviceRecord[]): Row[] => devices as unknown as Row[];
const dev = (row: Row) => row as unknown as DeviceRecord;

const LINK_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'wired', label: 'Wired' },
  { value: 'wifi', label: 'Wi-Fi' },
  { value: 'tunnel', label: 'Tunnel / PPP' },
];

export const DeviceDrawer: React.FC<{ device: DeviceRecord | null; onClose: () => void }> = ({ device, onClose }) => {
  const probe = useMutation<DeviceProbe, ApiError, string>({
    mutationFn: (ip) => api.probeDevice(ip),
    onError: (err) => toast.error('Probe failed', err.message, err.hint),
  });
  const bypassPlan = useMutation({
    mutationFn: (input: { address?: string; macAddress?: string; server: string; reason: string }) => api.createHotspotBypassPlan(input),
    onSuccess: () => toast.success('Bypass plan created', 'Review and approve it in AI Operations.'),
    onError: (err: Error) => toast.error('Could not create bypass plan', err.message),
  });
  const requestBypass = () => {
    if (!device) return;
    const server = window.prompt('Hotspot server (required, for example hotspot-guest):', 'hotspot-guest')?.trim();
    if (!server) return;
    const reason = window.prompt('Reason for this captive-portal bypass:')?.trim();
    if (!reason) return;
    bypassPlan.mutate({ address: ip, macAddress: device.mac, server, reason });
  };

  React.useEffect(() => { probe.reset(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [device?.id]);

  const ip = device?.addresses[0] ?? device?.ip;
  const result = probe.data;

  return (
    <Drawer
      open={Boolean(device)}
      onClose={onClose}
      title={device?.name ?? 'Device'}
      subtitle={device ? `${DEVICE_KIND_LABEL[device.kind]}${device.vendor ? ` · ${device.vendor}` : ''}` : undefined}
      width="max-w-2xl"
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-primary btn-sm" disabled={!ip || probe.isPending} onClick={() => ip && probe.mutate(ip)}>
            {probe.isPending ? <Spinner className="size-3.5" /> : <Icon name="Radar" size={13} />}
            Probe device
          </button>
          {ip && (
            <a className="btn btn-sm" href={`/m/tool/ping`} onClick={() => { /* navigation handled by router */ }}>
              <Icon name="Radio" size={13} />Ping menu
            </a>
          )}
          {device?.link === 'wifi' || device?.sources.some((source) => source.includes('hotspot')) ? (
            <button className="btn btn-sm" disabled={bypassPlan.isPending} onClick={requestBypass}>
              {bypassPlan.isPending ? <Spinner className="size-3.5" /> : <Icon name="Unlock" size={13} />}Plan portal bypass
            </button>
          ) : null}
          <button className="btn btn-sm btn-ghost ml-auto" onClick={onClose}>Close</button>
        </div>
      }
    >
      {!device ? null : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Addresses" value={<span className="mono text-[12px]">{device.addresses.join(', ') || '–'}</span>} icon="Globe2" />
            <Stat label="MAC" value={<span className="mono text-[12px]">{device.mac ?? '–'}</span>} icon="Fingerprint" tone="info" />
            <Stat label="Interface" value={device.interface ?? '–'} icon="Cable" tone="accent" />
            <Stat label="Link" value={<LinkChip link={device.link} />} icon="Wifi" tone="info" />
            <Stat label="DHCP" value={device.dhcp ? 'Leased' : 'Static / unknown'} icon="FileText" tone={device.dhcp ? 'good' : 'neutral'} />
            <Stat
              label="Traffic observed"
              value={device.bytesIn ? fmtBytes(device.bytesIn) : '–'}
              icon="Activity"
              tone="accent"
              hint="conntrack bytes attributed to this address"
            />
          </div>

          <section className="card p-3">
            <div className="label mb-2">Evidence</div>
            <ul className="space-y-1.5 text-[12.5px] text-dim">
              {device.sources.map((source) => (
                <li key={source} className="flex items-center gap-2">
                  <Icon name="CheckCircle2" size={12} className="text-good" />
                  seen by <span className="mono text-ink">{source}</span>
                </li>
              ))}
              {device.discoveredBy && (
                <li className="flex items-center gap-2">
                  <Icon name="Radar" size={12} className="text-info" />
                  announced itself via <span className="mono text-ink">{device.discoveredBy.toUpperCase()}</span>
                </li>
              )}
              {device.platform && <li className="flex items-center gap-2"><Icon name="Cpu" size={12} />{device.platform}{device.board ? ` · ${device.board}` : ''}{device.version ? ` · ${device.version}` : ''}</li>}
              {device.ssid && <li className="flex items-center gap-2"><Icon name="Wifi" size={12} />joined <span className="mono text-ink">{device.ssid}</span>{Number.isFinite(device.signal) ? ` at ${device.signal} dBm` : ''}</li>}
              {device.randomised && <li className="flex items-center gap-2"><Icon name="Shuffle" size={12} className="text-warn" />randomised (privacy) MAC — vendor cannot be resolved</li>}
              {device.uptime && <li className="flex items-center gap-2"><Icon name="Clock" size={12} />uptime {device.uptime}</li>}
              {device.comment && <li className="flex items-center gap-2"><Icon name="MessageSquare" size={12} />{device.comment}</li>}
            </ul>
          </section>

          {result && (
            <section className="card p-3">
              <div className="mb-2 flex items-center gap-2">
                <Icon name="Radar" size={14} className="text-info" />
                <span className="text-[13px] font-semibold text-ink">Probe result</span>
                <span className="chip chip-neutral">{result.ip}</span>
                {result.ping.ok
                  ? <span className="chip chip-good">reachable · {result.ping.avgMs ?? '–'} ms avg</span>
                  : <span className="chip chip-bad">no reply{result.ping.error ? ` · ${result.ping.error}` : ''}</span>}
              </div>
              <div className="grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-3">
                <div><div className="label">Vendor</div><div className="text-ink">{result.vendor ?? (result.randomised ? 'randomised MAC' : 'unknown')}</div></div>
                <div><div className="label">Platform</div><div className="text-ink">{result.platform ?? '–'}{result.board ? ` / ${result.board}` : ''}</div></div>
                <div><div className="label">Version</div><div className="text-ink">{result.version ?? '–'}</div></div>
                <div><div className="label">Interface</div><div className="text-ink">{result.interface ?? '–'}</div></div>
                <div><div className="label">DHCP</div><div className="text-ink">{result.dhcp ? result.status ?? 'leased' : 'no lease'}</div></div>
                <div><div className="label">IPv6</div><div className="mono text-[11px] text-ink">{result.ipv6.join(', ') || '–'}</div></div>
              </div>
              {result.reverse.answers.length > 0 && (
                <p className="mt-2 text-[12px] text-dim">Reverse lookup: {result.reverse.answers.map((a) => <span key={a} className="mono text-ink">{a} </span>)}</p>
              )}
              {result.ping.raw?.length > 0 && (
                <pre className="mono mt-2 max-h-32 overflow-auto rounded-lg border border-line bg-base2/70 p-2 text-[11px] text-faint">
                  {result.ping.raw.map((r) => `${String(r.seq).padStart(2, ' ')}  ${String(r.time ?? 'timeout')}  ${String(r.status ?? '')}`).join('\n')}
                </pre>
              )}
              <p className="mt-2 text-[11px] text-faint">
                Evidence: {result.evidence.join(' · ') || 'no discovery data'} · {result.sources.filter((s) => s.ok).length}/{result.sources.length} menus read
              </p>
            </section>
          )}
        </div>
      )}
    </Drawer>
  );
};

const Devices: React.FC = () => {
  const { connection, mode } = useApp();
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 200);
  const [link, setLink] = useState('all');
  const [kind, setKind] = useState<DeviceKind | 'all'>('all');
  const [selected, setSelected] = useState<DeviceRecord | null>(null);
  const [sweepOpen, setSweepOpen] = useState(false);
  const [params, setParams] = useSearchParams();
  // The map links straight into a segment sweep: /devices?sweep=10.0.0.0/24
  const sweepScope = params.get('sweep') ?? undefined;

  useEffect(() => {
    if (sweepScope) setSweepOpen(true);
  }, [sweepScope]);

  const closeSweep = () => {
    setSweepOpen(false);
    if (params.has('sweep')) {
      const next = new URLSearchParams(params);
      next.delete('sweep');
      setParams(next, { replace: true });
    }
  };

  const topology = useQuery({
    queryKey: ['topology'],
    queryFn: () => api.topology(),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const devices = useMemo(() => {
    const all = topology.data?.nodes.flatMap((n) => n.devices ?? []) ?? [];
    const unique = new Map<string, DeviceRecord>();
    for (const device of all) unique.set(device.id, device);
    return [...unique.values()];
  }, [topology.data]);

  const filtered = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    return devices.filter((device) => {
      if (link === 'wifi' && device.link !== 'wifi') return false;
      if (link === 'wired' && device.link !== 'wired') return false;
      if (link === 'tunnel' && !['tunnel', 'ppp'].includes(device.link)) return false;
      if (kind !== 'all' && device.kind !== kind) return false;
      if (!q) return true;
      return [device.name, device.hostname, device.vendor, device.mac, device.platform, device.board, device.ssid, ...device.addresses]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    });
  }, [devices, debounced, link, kind]);

  const kindCounts = useMemo(() => {
    const counts = new Map<DeviceKind, number>();
    for (const device of devices) counts.set(device.kind, (counts.get(device.kind) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [devices]);

  const subnets = useMemo(() => {
    const seen = new Map<string, number>();
    for (const node of topology.data?.nodes ?? []) {
      if (node.kind !== 'segment' || !node.cidr) continue;
      seen.set(node.cidr, (node.devices?.length ?? 0) + (node.clients ?? 0));
    }
    return [...seen.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([cidr, count]) => ({ cidr, label: `${cidr} (${count})` }));
  }, [topology.data]);

  const rows = asRows(filtered);
  const stats = topology.data?.stats;

  const columns: Array<ColumnDef<Row>> = [
    {
      key: 'name', label: 'Device', sortable: true, width: '22%',
      render: (row) => {
        const device = dev(row);
        return (
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[12.5px] font-medium text-ink">{device.name}</span>
              {device.randomised && <Icon name="Shuffle" size={11} className="text-warn" title="randomised MAC" />}
              {!device.active && <span className="chip chip-neutral" title="not currently online">offline</span>}
            </div>
            <div className="truncate text-[11px] text-faint">{device.platform ?? device.vendor ?? '—'}{device.board ? ` · ${device.board}` : ''}</div>
          </div>
        );
      },
    },
    { key: 'kind', label: 'Class', sortable: true, value: (row) => DEVICE_KIND_LABEL[dev(row).kind], render: (row) => <KindChip kind={dev(row).kind} /> },
    { key: 'addresses', label: 'Address', sortable: true, value: (row) => dev(row).addresses[0] ?? '', render: (row) => <span className="mono text-[11.5px] text-dim">{dev(row).addresses.join(', ') || '–'}</span> },
    {
      key: 'mac', label: 'MAC / vendor', sortable: true, value: (row) => dev(row).mac ?? '',
      render: (row) => {
        const device = dev(row);
        return (
          <div className="min-w-0">
            <div className="mono text-[11.5px] text-dim">{device.mac ?? '–'}</div>
            <div className="truncate text-[10.5px] text-faint">{device.vendor ?? (device.randomised ? 'randomised MAC' : 'unidentified')}</div>
          </div>
        );
      },
    },
    { key: 'link', label: 'Link', sortable: true, value: (row) => dev(row).link, render: (row) => <div className="flex items-center gap-2"><LinkChip link={dev(row).link} />{dev(row).signal !== undefined && <SignalBars dbm={dev(row).signal} />}</div> },
    { key: 'interface', label: 'Interface', sortable: true, render: (row) => <span className="mono text-[11.5px] text-dim">{dev(row).interface ?? '–'}</span> },
    { key: 'bytesIn', label: 'Traffic', sortable: true, value: (row) => dev(row).bytesIn ?? 0, render: (row) => <span className="mono text-[11.5px] text-dim">{dev(row).bytesIn ? fmtBytes(dev(row).bytesIn) : '–'}</span> },
    { key: 'sources', label: 'Seen by', sortable: false, value: (row) => dev(row).sources.join(' '), render: (row) => <span className="text-[11px] text-faint">{dev(row).sources.map((s) => s.split('/').pop()).join(', ')}</span> },
  ];

  if (topology.isLoading) return <div className="p-4"><TableSkeleton cols={6} rows={8} /></div>;

  const error = topology.error as ApiError | null;

  return (
    <div className="space-y-4 p-4">
      <header className="flex flex-wrap items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl border border-brand/30 bg-gradient-to-br from-brand/20 to-brand2/10 text-brand">
          <Icon name="MonitorSmartphone" size={20} />
        </span>
        <div className="min-w-0">
          <h1 className="text-[15px] font-semibold text-ink">Devices</h1>
          <p className="text-[12px] text-faint">
            Merged from neighbour discovery, DHCP leases, ARP, Wi-Fi, hotspot, PPP and WireGuard · {connection?.name ?? 'no connection'}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ModeChip mode={mode ?? undefined} />
          <button className="btn btn-sm" onClick={() => setSweepOpen(true)} title="Probe every known host and stream the results">
            <Icon name="Radar" size={13} />
            Sweep
          </button>
          <button className="btn btn-sm" onClick={() => topology.refetch()} disabled={topology.isFetching}>
            <Icon name="RefreshCw" size={13} className={clsx(topology.isFetching && 'animate-spin')} />
            Refresh
          </button>
        </div>
      </header>

      {error && !topology.data && (
        <div className="card border-bad/40 p-4">
          <p className="text-[13px] text-bad">{error.message}</p>
          {error.hint ? <p className="mt-1 text-[12px] text-faint">{String(error.hint)}</p> : null}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-6">
        <Stat label="Devices" value={fmtNumber(stats?.devices ?? 0)} icon="MonitorSmartphone" tone="accent" />
        <Stat label="Wired" value={fmtNumber(stats?.wired ?? 0)} icon="Cable" tone="info" />
        <Stat label="Wireless" value={fmtNumber(stats?.wireless ?? 0)} icon="Wifi" tone="info" />
        <Stat label="Tunnels / PPP" value={fmtNumber(stats?.tunnels ?? 0)} icon="Waypoints" tone="good" />
        <Stat label="Unidentified" value={fmtNumber(stats?.unidentified ?? 0)} icon="CircleHelp" tone="warn" />
        <Stat label="Last scan" value={topology.data ? relativeTime(topology.data.generatedAt) : '–'} icon="Clock" tone="neutral" />
      </div>

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => dev(row).id}
        onRowClick={(row) => setSelected(dev(row))}
        highlight={debounced}
        pageSize={20}
        emptyState={<EmptyState icon="MonitorSmartphone" title="No devices match" hint="Adjust the filters, or refresh to re-scan the router." />}
        toolbar={
          <div className="flex w-full flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Icon name="Search" size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, MAC, IP, vendor, SSID…" className="input pl-7 text-[12.5px]" />
            </div>
            <Segmented value={link} onChange={setLink} options={LINK_FILTERS} />
            <select value={kind} onChange={(e) => setKind(e.target.value as DeviceKind | 'all')} className="input w-auto text-[12px]">
              <option value="all">All classes</option>
              {kindCounts.map(([value, count]) => (
                <option key={value} value={value}>{DEVICE_KIND_LABEL[value]} ({count})</option>
              ))}
            </select>
          </div>
        }
      />

      <section className="card p-3">
        <div className="label mb-2">Vendors</div>
        <div className="flex flex-wrap gap-1.5">
          {(stats?.vendors ?? []).map((vendor) => (
            <button
              key={vendor.name}
              className="chip chip-neutral hover:border-line2"
              onClick={() => setSearch(vendor.name.split(' ')[0])}
              title={`Filter by ${vendor.name}`}
            >
              {vendor.name} <span className="font-mono text-faint">{vendor.count}</span>
            </button>
          ))}
          <span className="chip chip-neutral" title="Devices that answered but whose OUI is not in the vendor table">
            Unidentified <span className="font-mono text-faint">{stats?.unidentified ?? 0}</span>
          </span>
        </div>
      </section>

      <DeviceDrawer device={selected} onClose={() => setSelected(null)} />

      <Drawer
        open={sweepOpen}
        onClose={closeSweep}
        title="Bulk device sweep"
        subtitle={`Probe every address the router knows about${sweepScope ? ` · starting on ${sweepScope}` : ''}`}
        width="max-w-3xl"
      >
        <SweepPanel
          subnets={subnets}
          initialScope={sweepScope}
          deviceCount={devices.length}
          onFinished={(summary) => toast.success(`Swept ${summary.total} addresses — ${summary.reachable} answered`)}
        />
      </Drawer>
    </div>
  );
};

export default Devices;

export { parseBytes, isTruthy };
