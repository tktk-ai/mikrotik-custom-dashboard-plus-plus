/**
 * Network map: internet → uplink → router → L2 (bridge/VLAN/tunnel) → subnets,
 * with the devices seen on each subnet. Everything is derived from RouterOS
 * menus by the backend; this page only lays it out and lets you filter it.
 */
import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import type { DeviceRecord, TopoNode } from '@shared/analytics';
import { DEVICE_KIND_LABEL } from '@shared/analytics';
import type { Row } from '@shared/types';
import { api, ApiError } from '../lib/api';
import { useApp } from '../lib/store';
import { fmtBytes, fmtNumber, relativeTime } from '../lib/format';
import { NetGraph } from '../components/NetGraph';
import { DataTable, type ColumnDef } from '../components/DataTable';
import { Badge, EmptyState, Icon, Segmented, Spinner, Stat, TableSkeleton } from '../components/ui';
import { LinkChip, ModeChip, UtilBar } from '../components/network';
import { DeviceDrawer } from './Devices';

type Tab = 'devices' | 'subnets' | 'sources';

const asRows = <T,>(items: T[]): Row[] => items as unknown as Row[];

const Topology: React.FC = () => {
  const { connection, mode } = useApp();
  const [tab, setTab] = useState<Tab>('devices');
  const [search, setSearch] = useState('');
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedDevice, setSelectedDevice] = useState<DeviceRecord | null>(null);

  const query = useQuery({
    queryKey: ['topology'],
    queryFn: () => api.topology(),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const topology = query.data;
  const error = query.error as ApiError | null;
  const q = search.trim().toLowerCase();

  const segments = useMemo(
    () => (topology?.nodes ?? []).filter((n) => n.kind === 'segment'),
    [topology],
  );

  const allDevices = useMemo(() => {
    const map = new Map<string, DeviceRecord>();
    for (const node of topology?.nodes ?? []) for (const device of node.devices ?? []) map.set(device.id, device);
    return [...map.values()];
  }, [topology]);

  const matchesDevice = (device: DeviceRecord) =>
    !q || [device.name, device.mac, device.vendor, device.platform, ...device.addresses]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(q));

  const matches = (node: TopoNode) => {
    if (!q) return true;
    if (node.label.toLowerCase().includes(q) || (node.sublabel ?? '').toLowerCase().includes(q)) return true;
    return (node.devices ?? []).some(matchesDevice);
  };

  const deviceRows = asRows(allDevices);
  const deviceColumns: Array<ColumnDef<Row>> = [
    {
      key: 'name', label: 'Device', sortable: true,
      render: (row) => {
        const device = row as unknown as DeviceRecord;
        return (
          <div className="flex items-center gap-2">
            <Icon name="Circle" size={8} className={device.active ? 'text-good' : 'text-faint'} />
            <div className="min-w-0">
              <div className="truncate text-[12.5px] text-ink">{device.name}</div>
              <div className="truncate text-[10.5px] text-faint">{device.vendor ?? 'unidentified'}</div>
            </div>
          </div>
        );
      },
    },
    { key: 'ip', label: 'Address', sortable: true, value: (row) => (row as unknown as DeviceRecord).addresses[0] ?? '', render: (row) => <span className="mono text-[11.5px] text-dim">{(row as unknown as DeviceRecord).addresses.join(', ') || '–'}</span> },
    { key: 'mac', label: 'MAC', sortable: true, value: (row) => (row as unknown as DeviceRecord).mac ?? '', render: (row) => <span className="mono text-[11.5px] text-dim">{(row as unknown as DeviceRecord).mac ?? '–'}</span> },
    { key: 'kind', label: 'Class', sortable: true, value: (row) => DEVICE_KIND_LABEL[(row as unknown as DeviceRecord).kind], render: (row) => <span className="text-[11.5px] text-dim">{DEVICE_KIND_LABEL[(row as unknown as DeviceRecord).kind]}</span> },
    { key: 'link', label: 'Link', sortable: true, value: (row) => (row as unknown as DeviceRecord).link, render: (row) => <LinkChip link={(row as unknown as DeviceRecord).link} /> },
    { key: 'interface', label: 'Interface', sortable: true, render: (row) => <span className="mono text-[11.5px] text-dim">{(row as unknown as DeviceRecord).interface ?? '–'}</span> },
    { key: 'traffic', label: 'Traffic', sortable: true, value: (row) => (row as unknown as DeviceRecord).bytesIn ?? 0, render: (row) => <span className="mono text-[11.5px] text-dim">{(row as unknown as DeviceRecord).bytesIn ? fmtBytes((row as unknown as DeviceRecord).bytesIn) : '–'}</span> },
  ];

  const subnetColumns: Array<ColumnDef<Row>> = [
    { key: 'label', label: 'Subnet', sortable: true, render: (row) => <span className="mono text-[12px] text-ink">{String(row.label)}</span> },
    { key: 'interface', label: 'Interface', sortable: true, render: (row) => <span className="mono text-[11.5px] text-dim">{String(row.interface ?? '–')}</span> },
    { key: 'gateway', label: 'Gateway', sortable: true, render: (row) => <span className="mono text-[11.5px] text-dim">{String(row.ip ?? '–')}</span> },
    { key: 'use', label: 'Addresses', sortable: true, value: (row) => row.clients ?? 0, render: (row) => <span className="mono text-[11.5px] text-dim">{String(row.clients ?? 0)} devices</span> },
    { key: 'util', label: 'Utilisation', sortable: true, value: (row) => row.utilisation ?? 0, render: (row) => <UtilBar value={Number(row.utilisation ?? 0)} /> },
    { key: 'dhcp', label: 'DHCP', sortable: true, value: (row) => String((row.meta as Row | undefined)?.dhcpServer ?? ''), render: (row) => <span className="text-[11.5px] text-dim">{String((row.meta as Row | undefined)?.dhcpServer ?? '–')}</span> },
    {
      key: 'open', label: '', render: (row) => (
        <button className="btn btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); setSelectedNode(String(row.id)); setTab('devices'); }}>
          <Icon name="ListTree" size={12} />Devices
        </button>
      ),
    },
  ];

  const sourceColumns: Array<ColumnDef<Row>> = [
    { key: 'path', label: 'Menu', sortable: true, render: (row) => <span className="mono text-[11.5px] text-ink">{String(row.path)}</span> },
    { key: 'ok', label: 'Status', sortable: true, value: (row) => (row.ok ? 1 : 0), render: (row) => (row.ok ? <Badge tone="good">read</Badge> : <Badge tone="bad" title={String(row.error ?? '')}>failed</Badge>) },
    { key: 'rows', label: 'Rows', sortable: true, render: (row) => <span className="mono text-[11.5px] text-dim">{String(row.rows)}</span> },
    { key: 'error', label: 'Detail', render: (row) => <span className="text-[11px] text-faint">{String(row.error ?? '')}</span> },
  ];

  const nodeDevices = selectedNode
    ? (topology?.nodes.find((n) => n.id === selectedNode)?.devices ?? [])
    : [];

  const visibleSegments = segments.filter(matches);

  return (
    <div className="space-y-4 p-4" id="topology">
      <header className="flex flex-wrap items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl border border-brand/30 bg-gradient-to-br from-brand/20 to-brand2/10 text-brand">
          <Icon name="Waypoints" size={20} />
        </span>
        <div className="min-w-0">
          <h1 className="text-[15px] font-semibold text-ink">Network map</h1>
          <p className="text-[12px] text-faint">
            Built from {topology ? topology.sources.length : 0} RouterOS menus · {topology?.stats.segments ?? 0} subnets ·{' '}
            {topology?.stats.devices ?? 0} devices · {connection?.name ?? 'no connection'}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ModeChip mode={mode ?? undefined} />
          <Link to="/devices" className="btn btn-sm">
            <Icon name="MonitorSmartphone" size={13} />Inventory
          </Link>
          <button className="btn btn-sm btn-primary" onClick={() => query.refetch()} disabled={query.isFetching}>
            {query.isFetching ? <Spinner className="size-3.5" /> : <Icon name="Radar" size={13} />}
            Re-scan
          </button>
        </div>
      </header>

      {query.isLoading && <div className="card p-4"><TableSkeleton cols={5} rows={6} /></div>}

      {error && !topology && (
        <div className="card border-bad/40 p-4">
          <p className="text-[13px] text-bad">Could not build the map: {error.message}</p>
          {error.hint ? <p className="mt-1 text-[12px] text-faint">{String(error.hint)}</p> : null}
        </div>
      )}

      {topology && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
            <Stat label="Devices" value={fmtNumber(topology.stats.devices)} icon="MonitorSmartphone" tone="accent" />
            <Stat label="Subnets" value={fmtNumber(topology.stats.segments)} icon="Sitemap" tone="info" />
            <Stat label="Wired" value={fmtNumber(topology.stats.wired)} icon="Cable" tone="neutral" />
            <Stat label="Wireless" value={fmtNumber(topology.stats.wireless)} icon="Wifi" tone="info" />
            <Stat label="Tunnels / PPP" value={fmtNumber(topology.stats.tunnels)} icon="Waypoints" tone="good" />
            <Stat label="Unidentified" value={fmtNumber(topology.stats.unidentified)} icon="CircleHelp" tone="warn" hint="no OUI match or randomised MAC" />
          </div>

          <section className="card p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="label">Topology</span>
              <span className="text-[11px] text-faint">{topology.nodes.length} nodes · {topology.links.length} links · built {relativeTime(topology.generatedAt)}</span>
              <div className="relative ml-auto w-full max-w-xs">
                <Icon name="Search" size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Highlight a device, subnet or VLAN…"
                  className="input pl-7 text-[12.5px]"
                />
              </div>
            </div>
            <NetGraph
              topology={topology}
              selectedId={selectedNode}
              onSelectNode={(node) => setSelectedNode(node.id)}
              onOpenDevices={(node) => { setSelectedNode(node.id); setTab('devices'); }}
              isDimmed={(node) => (q ? !matches(node) : false)}
            />
          </section>

          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              value={tab}
              onChange={(value) => setTab(value as Tab)}
              options={[
                { value: 'devices', label: `Devices (${selectedNode ? nodeDevices.length : allDevices.length})`, icon: 'MonitorSmartphone' },
                { value: 'subnets', label: `Subnets (${visibleSegments.length})`, icon: 'Sitemap' },
                { value: 'sources', label: `Sources (${topology.sources.length})`, icon: 'Database' },
              ]}
            />
            {selectedNode && (
              <button className="btn btn-sm btn-ghost" onClick={() => setSelectedNode(null)}>
                <Icon name="X" size={12} />
                Clear “{topology.nodes.find((n) => n.id === selectedNode)?.label}”
              </button>
            )}
            <span className="ml-auto text-[11px] text-faint">
              {q ? `filtered by “${search}”` : 'click a node to focus its devices'}
            </span>
          </div>

          {tab === 'devices' && (
            <DataTable
              rows={selectedNode ? asRows(nodeDevices.filter(matchesDevice)) : asRows(allDevices.filter(matchesDevice))}
              columns={deviceColumns}
              rowKey={(row) => (row as unknown as DeviceRecord).id}
              onRowClick={(row) => setSelectedDevice(row as unknown as DeviceRecord)}
              pageSize={15}
              emptyState={<EmptyState icon="MonitorSmartphone" title="No devices here" hint="Pick another node or clear the filter." />}
            />
          )}

          {tab === 'subnets' && (
            <DataTable
              rows={asRows(visibleSegments)}
              columns={subnetColumns}
              rowKey={(row) => String(row.id)}
              pageSize={12}
              emptyState={<EmptyState icon="Sitemap" title="No subnets detected" hint="The router has no /ip/address entries, or the menu is not readable." />}
            />
          )}

          {tab === 'sources' && (
            <DataTable
              rows={asRows(topology.sources)}
              columns={sourceColumns}
              rowKey={(row) => String(row.path)}
              pageSize={20}
              footerNote="Every node and link in the map is derived from these menus — nothing is hardcoded."
            />
          )}

          <div className="grid gap-3 lg:grid-cols-2">
            <section className="card p-3">
              <div className="label mb-2">Vendor mix</div>
              <div className="space-y-1.5">
                {topology.stats.vendors.map((vendor) => (
                  <div key={vendor.name} className="flex items-center gap-2">
                    <span className="w-40 truncate text-[12px] text-dim">{vendor.name}</span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel3">
                      <span
                        className={clsx('block h-full rounded-full bg-brand')}
                        style={{ width: `${(vendor.count / Math.max(1, topology.stats.devices)) * 100}%` }}
                      />
                    </span>
                    <span className="mono w-8 text-right text-[11px] text-faint">{vendor.count}</span>
                  </div>
                ))}
              </div>
            </section>
            <section className="card p-3">
              <div className="label mb-2">Device classes</div>
              <div className="flex flex-wrap gap-1.5">
                {topology.stats.kinds.map((kind) => (
                  <span key={kind.name} className="chip chip-neutral">
                    {DEVICE_KIND_LABEL[kind.name]} <span className="font-mono text-faint">{kind.count}</span>
                  </span>
                ))}
              </div>
              <p className="mt-3 text-[11.5px] text-faint">
                The map draws device stacks per subnet instead of one node per client, so a 500-device network stays readable.
                Use the inventory for the full list and per-device probes.
              </p>
            </section>
          </div>
        </>
      )}

      <DeviceDrawer device={selectedDevice} onClose={() => setSelectedDevice(null)} />
    </div>
  );
};

export default Topology;
