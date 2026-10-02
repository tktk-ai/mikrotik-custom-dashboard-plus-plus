import React, { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { getEndpoint, navEndpoints } from '@shared/catalog';
import type { CommandDef, EndpointDef, FieldDef, Row } from '@shared/types';
import { prettify, tableFields } from '@shared/types';
import { api, ApiError } from '../lib/api';
import { useApp } from '../lib/store';
import { copyToClipboard, downloadCsv, fmtNumber } from '../lib/format';
import { Cell, PropertyList, renderValue } from '../components/cells';
import { DataTable, type ColumnDef } from '../components/DataTable';
import { RecordForm } from '../components/RecordForm';
import { CommandModal } from '../components/CommandRunner';
import { JsonView, ResultView } from '../components/JsonView';
import { Badge, Button, Card, Drawer, EmptyState, Icon, Modal, Segmented, Spinner, TableSkeleton, toast, useDebounced } from '../components/ui';


/* ------------------------------------------------------------------ *
 * Page shell
 * ------------------------------------------------------------------ */

const EndpointHeader: React.FC<{ ep: EndpointDef; onRefresh: () => void; refreshing: boolean; extra?: React.ReactNode }> = ({ ep, onRefresh, refreshing, extra }) => {
  const { favorites, toggleFavorite, capabilities, mode } = useApp();
  const pinned = favorites.includes(ep.path);
  const cap = capabilities?.endpoints?.[ep.path];
  const siblings = useMemo(() => navEndpoints().filter((e) => e.category === ep.category && (e.group ?? '') === (ep.group ?? '')), [ep]);
  const restUrl = `${mode === 'demo' ? 'https://demo.routeros.local' : ''}/rest/${ep.path}`;
  return (
    <header className="border-b border-line bg-base2/50">
      <div className="mx-auto max-w-[1500px] px-3 pt-4 sm:px-4">
        <div className="flex flex-wrap items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-line bg-panel2 text-brand">
            <Icon name={ep.icon ?? 'Square'} size={19} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[18px] font-semibold tracking-tight">{ep.label}</h1>
              <button onClick={() => { toggleFavorite(ep.path); toast.info(pinned ? 'Removed from pinned menus' : 'Pinned to the sidebar'); }} className={clsx('transition-colors', pinned ? 'text-warn' : 'text-faint hover:text-dim')} title={pinned ? 'Unpin' : 'Pin to sidebar'}>
                <Icon name="Star" size={15} />
              </button>
              {cap && !cap.ok && <Badge tone="warn">unavailable on this device</Badge>}
              {ep.kind === 'singleton' && <Badge tone="accent">settings</Badge>}
              {ep.kind === 'command' && <Badge tone="accent">command</Badge>}
              {ep.readOnly && <Badge tone="info">read-only</Badge>}
              {ep.availability && ep.availability !== 'core' && <Badge tone="neutral">requires {ep.availability === 'optional' ? 'package' : `RouterOS ${String(ep.availability).replace('v', '')}`}</Badge>}
            </div>
            {ep.description && <p className="mt-0.5 max-w-3xl text-[12.5px] leading-relaxed text-dim">{ep.description}</p>}
            <div className="mono mt-1 flex flex-wrap items-center gap-2 text-[11.5px] text-faint">
              <span className="chip chip-neutral">/{ep.path}</span>
              <button className="inline-flex items-center gap-1 hover:text-dim" onClick={async () => { await copyToClipboard(`/rest/${ep.path}`); toast.success('REST path copied'); }}>
                <Icon name="Copy" size={11} />copy path
              </button>
              <a className="inline-flex items-center gap-1 hover:text-dim" target="_blank" rel="noreferrer" href={`https://help.mikrotik.com/docs/spaces/ROS/pages/47579162/REST+API`}>
                <Icon name="ExternalLink" size={11} />REST docs
              </a>
              {restUrl && <span className="hidden md:inline">·</span>}
              <span className="hidden md:inline">{cap?.ms !== undefined ? `${cap.ms} ms response` : ''}{cap?.rows !== undefined ? ` · ${cap.rows} rows` : ''}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {extra}
            <Button size="sm" icon="RefreshCw" onClick={onRefresh} loading={refreshing}>Refresh</Button>
          </div>
        </div>

        {siblings.length > 1 && (
          <nav className="mt-3 flex gap-0.5 overflow-x-auto">
            {siblings.map((s) => (
              <Link key={s.path} to={`/m/${s.path}`} className={clsx('tab', s.path === ep.path && 'tab-active')}>
                {s.label}
                {s.kind === 'singleton' && <Icon name="Settings2" size={11} className="ml-1 inline opacity-60" />}
              </Link>
            ))}
          </nav>
        )}
      </div>
    </header>
  );
};

const UnsupportedPanel: React.FC<{ ep: EndpointDef }> = ({ ep }) => {
  const { capabilities, refreshCapabilities, refreshing } = useApp();
  const cap = capabilities?.endpoints?.[ep.path];
  return (
    <div className="mx-auto max-w-3xl p-4">
      <Card title="This menu is not available on the connected device" icon="PlugZap" tone="warn">
        <p className="text-[13px] leading-relaxed text-dim">
          The dashboard probed <span className="mono">/rest/{ep.path}</span> and the router answered with an error, so there is nothing to display here yet.
        </p>
        {cap?.error && (
          <pre className="mono mt-3 overflow-auto rounded-lg border border-line bg-base2/70 p-3 text-[11.5px] text-bad">{cap.kind}: {cap.error}</pre>
        )}
        <ul className="mt-3 space-y-1.5 text-[12.5px] text-faint">
          <li className="flex items-start gap-2"><Icon name="Info" size={13} className="mt-0.5" />Menus such as <span className="mono">/interface/wifi</span> need RouterOS 7.13+, <span className="mono">/container</span> needs the container package, and <span className="mono">/user-manager</span> needs the usermanager package.</li>
          <li className="flex items-start gap-2"><Icon name="Info" size={13} className="mt-0.5" />Restricted users may also be denied read access to individual menus.</li>
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button icon="RefreshCw" loading={refreshing} onClick={() => refreshCapabilities()}>Re-probe device</Button>
          <Link to="/explorer" className="btn">Browse other menus</Link>
          <Link to="/connections" className="btn btn-ghost">Change connection</Link>
        </div>
      </Card>
    </div>
  );
};

const ErrorPanel: React.FC<{ error: unknown; onRetry: () => void; path: string }> = ({ error, onRetry, path }) => {
  const e = error as ApiError;
  return (
    <div className="mx-auto max-w-3xl p-4">
      <Card title="The router rejected this request" icon="AlertTriangle" tone="bad">
        <div className="mono text-[12px] text-bad">GET /rest/{path}</div>
        <p className="mt-2 text-[13px] text-dim">{e?.message}</p>
        {e?.hint ? <p className="mt-1 text-[12px] text-faint">{String(e.hint)}</p> : null}
        {e?.detail ? <pre className="mono mt-3 max-h-40 overflow-auto rounded-lg border border-line bg-base2/70 p-3 text-[11px] text-faint">{String(e.detail)}</pre> : null}
        <div className="mt-3 flex gap-2">
          <Button icon="RefreshCw" onClick={onRetry}>Try again</Button>
          <Link to="/connections" className="btn">Connection settings</Link>
        </div>
      </Card>
    </div>
  );
};

/* ------------------------------------------------------------------ *
 * Shared helpers
 * ------------------------------------------------------------------ */

/** RouterOS addresses single entries as /rest/<menu>/<.id>; falls back to the collection + body form. */
function itemTarget(path: string, row: Row): [string, Row] {
  const id = row['.id'];
  if (!id) return [path, row];
  const { ['.id']: _drop, ...rest } = row;
  return [`${path}/${id}`, rest as Row];
}

/* ------------------------------------------------------------------ *
 * List endpoints
 * ------------------------------------------------------------------ */

const ListEndpoint: React.FC<{ ep: EndpointDef }> = ({ ep }) => {
  const { refreshMs, supported } = useApp();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 200);
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<{ mode: 'create' | 'edit'; row?: Row } | null>(null);
  const [detail, setDetail] = useState<Row | null>(null);
  const [command, setCommand] = useState<{ cmd: CommandDef; row?: Row } | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [densityMode, setDensityMode] = useState<'table' | 'json'>('table');

  const queryKey = ['ros', ep.path];
  const query = useQuery({
    queryKey,
    queryFn: () => api.list(ep.path),
    refetchInterval: refreshMs ?? false,
    enabled: supported(ep.path) !== 'no',
  });

  const rows: Row[] = query.data?.rows ?? [];
  const fields = useMemo(() => tableFields(ep), [ep]);
  const allFields = ep.fields ?? [];

  const filtered = useMemo(() => {
    if (!debounced.trim()) return rows;
    const q = debounced.trim().toLowerCase();
    return rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q));
  }, [rows, debounced]);

const invalidate = () => qc.invalidateQueries({ queryKey });

  const createMutation = useMutation({
    mutationFn: (values: Row) => api.create(ep.path, values),
    onSuccess: () => { invalidate(); setEditing(null); toast.success('Entry created', `POST /rest/${ep.path}`); },
    onError: (err: ApiError) => toast.error('Create failed', err.message, err.hint),
  });

  const updateMutation = useMutation({
    mutationFn: ({ values }: { values: Row }) => api.update(...itemTarget(ep.path, values)),
    onSuccess: () => { invalidate(); setEditing(null); toast.success('Changes applied'); },
    onError: (err: ApiError) => toast.error('Update failed', err.message, err.hint),
  });

  const removeMutation = useMutation({
    mutationFn: (ids: string[]) => (ids.length === 1 ? api.remove(`${ep.path}/${ids[0]}`, {}) : api.remove(ep.path, { numbers: ids })),
    onSuccess: (_r, ids) => { invalidate(); setSelected([]); setDetail(null); toast.success(`Removed ${ids.length} entr${ids.length === 1 ? 'y' : 'ies'}`); },
    onError: (err: ApiError) => toast.error('Delete failed', err.message, err.hint),
  });

  const bulkCommand = useMutation({
    mutationFn: ({ cmd, ids }: { cmd: CommandDef; ids: string[] }) => api.command(`${ep.path}${cmd.path ? `/${cmd.path}` : ''}`, { numbers: ids }),
    onSuccess: (_r, v) => { invalidate(); setSelected([]); toast.success(`${v.cmd.label} executed on ${v.ids.length} entries`); },
    onError: (err: ApiError) => toast.error('Command failed', err.message, err.hint),
  });

  const columns: Array<ColumnDef<Row>> = useMemo(() => {
    const cols: Array<ColumnDef<Row>> = fields.map((f) => ({
      key: f.name,
      label: f.label ?? prettify(f.name),
      width: f.width === 'xs' ? '62px' : f.width === 'sm' ? '108px' : undefined,
      value: (row) => row[f.name],
      render: (row) => <Cell value={row[f.name]} field={f} compact />,
      className: f.mono ? 'mono' : '',
    }));
    cols.push({
      key: '__actions',
      label: '',
      sortable: false,
      width: '120px',
      render: (row) => (
        <span className="flex items-center justify-end gap-0.5 opacity-60 transition-opacity group-hover:opacity-100">
          {!ep.noEdit && <button className="btn btn-sm btn-ghost" title="Edit" onClick={(e) => { e.stopPropagation(); setDetail(row); setEditing({ mode: 'edit', row }); }}><Icon name="Pencil" size={12} /></button>}
          {!ep.noDelete && <button className="btn btn-sm btn-ghost text-bad" title="Delete" onClick={(e) => { e.stopPropagation(); if (confirm(`Delete this entry from /${ep.path}?`)) removeMutation.mutate([String(row['.id'])]); }}><Icon name="Trash2" size={12} /></button>}
          <button className="btn btn-sm btn-ghost" title="Details" onClick={(e) => { e.stopPropagation(); setDetail(row); }}><Icon name="ChevronRight" size={13} /></button>
        </span>
      ),
    });
    return cols;
  }, [fields, ep.noEdit, ep.noDelete, removeMutation]);

  if (supported(ep.path) === 'no') {
    return <><EndpointHeader ep={ep} onRefresh={() => query.refetch()} refreshing={query.isFetching} /><UnsupportedPanel ep={ep} /></>;
  }
  if (query.error) {
    return <><EndpointHeader ep={ep} onRefresh={() => query.refetch()} refreshing={query.isFetching} /><ErrorPanel error={query.error} onRetry={() => query.refetch()} path={ep.path} /></>;
  }

  const enableCmd = ep.commands?.find((c) => c.id === 'enable');
  const disableCmd = ep.commands?.find((c) => c.id === 'disable');
  const standaloneCommands = (ep.commands ?? []).filter((c) => c.id !== 'enable' && c.id !== 'disable' && !c.bulk);

  return (
    <>
      <EndpointHeader
        ep={ep}
        onRefresh={() => query.refetch()}
        refreshing={query.isFetching}
        extra={
          <>
            <Segmented value={densityMode} onChange={(v) => setDensityMode(v as 'table' | 'json')} options={[{ value: 'table', label: 'Table', icon: 'Table2' }, { value: 'json', label: 'JSON', icon: 'Braces' }]} />
            {!ep.readOnly && !ep.noCreate && <Button size="sm" variant="primary" icon="Plus" onClick={() => setEditing({ mode: 'create' })}>Add</Button>}
          </>
        }
      />

      <div className="mx-auto max-w-[1500px] p-3 sm:p-4">
        {densityMode === 'json' ? (
          <Card title="Raw REST response" icon="Braces" subtitle={`GET /rest/${ep.path}`} actions={<Button size="sm" icon="Copy" onClick={async () => { await copyToClipboard(JSON.stringify(rows, null, 2)); toast.success('JSON copied'); }}>Copy</Button>}>
            {query.isLoading ? <TableSkeleton cols={4} /> : <JsonView data={rows} maxHeight="60vh" />}
          </Card>
        ) : (
          <Card bodyClassName="p-0" className="overflow-hidden">
            <DataTable
              rows={filtered}
              columns={columns}
              loading={query.isLoading}
              selectable={!ep.readOnly}
              selected={selected}
              onSelectedChange={setSelected}
              rowKey={(r) => String(r['.id'] ?? JSON.stringify(r).slice(0, 40))}
              onRowClick={(row) => setDetail(row)}
              highlight={debounced}
              pageSize={ep.demoRows && ep.demoRows > 40 ? 50 : 25}
              toolbar={
                <>
                  <div className="relative min-w-[180px] flex-1">
                    <Icon name="Search" size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
                    <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Filter ${rows.length} entries…`} className="input pl-7 text-[12.5px]" />
                  </div>
                  {selected.length > 0 && (
                    <>
                      {enableCmd && <Button size="sm" icon="Power" onClick={() => bulkCommand.mutate({ cmd: enableCmd, ids: selected })}>Enable</Button>}
                      {disableCmd && <Button size="sm" icon="PowerOff" onClick={() => bulkCommand.mutate({ cmd: disableCmd, ids: selected })}>Disable</Button>}
                      {!ep.noDelete && <Button size="sm" variant="danger" icon="Trash2" onClick={() => { if (confirm(`Delete ${selected.length} selected entr${selected.length === 1 ? 'y' : 'ies'}?`)) removeMutation.mutate(selected); }}>Delete</Button>}
                      <Button size="sm" variant="ghost" onClick={() => setSelected([])}>Clear</Button>
                    </>
                  )}
                  {standaloneCommands.map((c) => (
                    <Button key={c.id} size="sm" icon={c.icon} variant={c.danger ? 'danger' : 'default'} onClick={() => setCommand({ cmd: c })}>{c.label}</Button>
                  ))}
                  <div className="ml-auto flex items-center gap-1.5">
                    {ep.live?.length ? <Badge tone="good"><span className="live-dot size-1.5 rounded-full bg-good" />live counters</Badge> : null}
                    <Button size="sm" variant="ghost" icon="Braces" onClick={() => setShowRaw((s) => !s)} title="Show raw JSON" />
                    <Button size="sm" variant="ghost" icon="Download" onClick={() => { downloadCsv(`${ep.path.replace(/\//g, '-')}.csv`, allFields.length ? allFields.map((f) => f.name) : Object.keys(rows[0] ?? {}), rows); toast.success('CSV exported'); }} title="Export CSV" />
                    <span className="text-[11px] text-faint">{query.isFetching ? <Spinner className="size-3" /> : `${fmtNumber(rows.length)} rows`}</span>
                  </div>
                </>
              }
              emptyState={
                <EmptyState
                  icon={ep.icon ?? 'Inbox'}
                  title={debounced ? 'No entries match your filter' : 'This menu is empty'}
                  hint={debounced ? 'Try a different search term.' : `${ep.description ?? ''} Use “Add” to create the first entry — it is written straight to the router over the REST API.`}
                  action={!ep.readOnly && !ep.noCreate ? <Button variant="primary" icon="Plus" onClick={() => setEditing({ mode: 'create' })}>Add entry</Button> : undefined}
                />
              }
              footerNote={query.data ? <span>· fetched in {query.data.ms} ms</span> : undefined}
            />
          </Card>
        )}

        {showRaw && (
          <div className="mt-3">
            <Card title="Raw REST response" icon="Braces" actions={<Button size="sm" variant="ghost" icon="X" onClick={() => setShowRaw(false)} />}>
              <JsonView data={rows} maxHeight="30rem" />
            </Card>
          </div>
        )}
      </div>

      {/* create / edit */}
      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        wide
        title={editing?.mode === 'create' ? `Add to ${ep.label}` : `Edit entry — ${ep.label}`}
        subtitle={<span className="mono">{editing?.mode === 'create' ? `POST /rest/${ep.path}` : `PATCH /rest/${ep.path}`}</span>}
      >
        {editing && (
          <RecordForm
            endpoint={ep}
            mode={editing.mode}
            initial={editing.row}
            submitting={createMutation.isPending || updateMutation.isPending}
            onCancel={() => setEditing(null)}
            onSubmit={async (values) => {
              if (editing.mode === 'create') await createMutation.mutateAsync(values);
              else await updateMutation.mutateAsync({ values: { ...values, '.id': editing.row?.['.id'] } });
            }}
          />
        )}
      </Modal>

      {/* detail drawer */}
      <Drawer
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail?.name ?? detail?.[fields[0]?.name] ?? 'Entry'}
        subtitle={<span className="mono">/{ep.path} · {String(detail?.['.id'] ?? '')}</span>}
        footer={
          <>
            {!ep.noDelete && <Button variant="danger" icon="Trash2" onClick={() => { if (detail && confirm('Delete this entry?')) removeMutation.mutate([String(detail['.id'])]); }}>Delete</Button>}
            <Button variant="ghost" onClick={() => setDetail(null)}>Close</Button>
            {!ep.noEdit && detail && <Button variant="primary" icon="Pencil" onClick={() => { setEditing({ mode: 'edit', row: detail }); }}>Edit</Button>}
          </>
        }
      >
        {detail && (
          <div className="space-y-4">
            {(ep.commands ?? []).length > 0 && (
              <div>
                <div className="label mb-2">Actions</div>
                <div className="flex flex-wrap gap-1.5">
                  {(ep.commands ?? []).map((c) => (
                    <Button key={c.id} size="sm" icon={c.icon} variant={c.danger ? 'danger' : 'default'} onClick={() => setCommand({ cmd: c, row: detail })}>{c.label}</Button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <div className="label mb-2">Properties</div>
              <PropertyList row={detail} fields={ep.fields} />
            </div>
            <div>
              <div className="label mb-2">Raw JSON</div>
              <JsonView data={detail} maxHeight="18rem" />
            </div>
          </div>
        )}
      </Drawer>

      <CommandModal endpoint={ep} command={command?.cmd ?? null} row={command?.row} onClose={() => setCommand(null)} onDone={() => invalidate()} />
    </>
  );
};

/* ------------------------------------------------------------------ *
 * Singleton (settings) endpoints
 * ------------------------------------------------------------------ */

const SingletonEndpoint: React.FC<{ ep: EndpointDef }> = ({ ep }) => {
  const qc = useQueryClient();
  const { supported, refreshMs } = useApp();
  const [command, setCommand] = useState<{ cmd: CommandDef; row?: Row } | null>(null);

  const query = useQuery({
    queryKey: ['ros', ep.path],
    queryFn: () => api.list(ep.path),
    refetchInterval: refreshMs ?? false,
    enabled: supported(ep.path) !== 'no',
  });

  const row: Row = (query.data?.rows?.[0] ?? {}) as Row;

  const save = useMutation({
    mutationFn: (values: Row) => api.update(ep.path, values),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ros', ep.path] }); toast.success('Settings saved', `PATCH /rest/${ep.path}`); },
    onError: (err: ApiError) => toast.error('Save failed', err.message, err.hint),
  });

  if (supported(ep.path) === 'no') return <><EndpointHeader ep={ep} onRefresh={() => query.refetch()} refreshing={query.isFetching} /><UnsupportedPanel ep={ep} /></>;
  if (query.error) return <><EndpointHeader ep={ep} onRefresh={() => query.refetch()} refreshing={query.isFetching} /><ErrorPanel error={query.error} onRetry={() => query.refetch()} path={ep.path} /></>;

  const declared = new Set((ep.fields ?? []).map((f) => f.name));
  const extraKeys = Object.keys(row).filter((k) => k !== '.id' && !declared.has(k));

  return (
    <>
      <EndpointHeader
        ep={ep}
        onRefresh={() => query.refetch()}
        refreshing={query.isFetching}
        extra={(ep.commands ?? []).map((c) => (
          <Button key={c.id} size="sm" icon={c.icon} variant={c.danger ? 'danger' : 'default'} onClick={() => setCommand({ cmd: c })}>{c.label}</Button>
        ))}
      />
      <div className="mx-auto grid max-w-[1500px] gap-3 p-3 sm:p-4 xl:grid-cols-[1.6fr_1fr]">
        <Card title="Settings" icon="Sliders" subtitle={`Values are written with PATCH /rest/${ep.path}`}>
          {query.isLoading ? <TableSkeleton cols={3} /> : (
            <RecordForm
              endpoint={ep}
              mode="edit"
              initial={row}
              submitting={save.isPending}
              onCancel={() => query.refetch()}
              onSubmit={async (values) => { await save.mutateAsync(values); }}
            />
          )}
        </Card>
        <div className="flex flex-col gap-3">
          <Card title="Current values" icon="Eye">
            {query.isLoading ? <TableSkeleton cols={2} /> : <PropertyList row={row} fields={ep.fields} />}
          </Card>
          {extraKeys.length > 0 && (
            <Card title="Device-reported properties" icon="Wand2" subtitle="Read-only values returned by this RouterOS build">
              <PropertyList row={Object.fromEntries(extraKeys.map((k) => [k, row[k]]))} />
            </Card>
          )}
          <Card title="Raw response" icon="Braces">
            <JsonView data={row} maxHeight="18rem" />
          </Card>
        </div>
      </div>
      <CommandModal endpoint={ep} command={command?.cmd ?? null} row={command?.row} onClose={() => setCommand(null)} onDone={() => query.refetch()} />
    </>
  );
};

/* ------------------------------------------------------------------ *
 * Command endpoints (tools)
 * ------------------------------------------------------------------ */

const CommandEndpoint: React.FC<{ ep: EndpointDef }> = ({ ep }) => {
  const { refreshMs, supported } = useApp();
  const [active, setActive] = useState<string>(ep.commands?.[0]?.id ?? '');
  const [results, setResults] = useState<Record<string, { rows: Row[]; raw?: string; ms?: number } | undefined>>({});
  const [running, setRunning] = useState(false);
  const [params, setParams] = useState<Row>(() => {
    const init: Row = {};
    for (const c of ep.commands ?? []) for (const p of c.params ?? []) if (p.default !== undefined) init[`${c.id}.${p.name}`] = p.default;
    return init;
  });

  const listQuery = useQuery({
    queryKey: ['ros', ep.path],
    queryFn: () => api.list(ep.path),
    refetchInterval: refreshMs ?? false,
    enabled: Boolean(ep.fields?.length) && supported(ep.path) !== 'no',
  });

  const cmd = (ep.commands ?? []).find((c) => c.id === active) ?? ep.commands?.[0];

  const run = async () => {
    if (!cmd) return;
    setRunning(true);
    try {
      const body: Row = { ...(cmd.body ?? {}) };
      for (const p of cmd.params ?? []) {
        const v = params[`${cmd.id}.${p.name}`];
        if (v === undefined || v === '' || v === null) continue;
        body[p.name] = p.type === 'number' ? Number(v) : p.type === 'boolean' ? v === true || v === 'true' : v;
      }
      const res = await api.command(`${ep.path}${cmd.path ? `/${cmd.path}` : ''}`, body);
      setResults((r) => ({ ...r, [cmd.id]: { rows: res.rows, raw: res.raw, ms: res.ms } }));
      toast.success(`${cmd.label} finished`, res.raw ? undefined : `${res.rows.length} row${res.rows.length === 1 ? '' : 's'} in ${res.ms} ms`);
    } catch (err: any) {
      toast.error(`${cmd.label} failed`, err?.message, err?.hint);
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <EndpointHeader ep={ep} onRefresh={() => { listQuery.refetch(); }} refreshing={listQuery.isFetching} />
      <div className="mx-auto grid max-w-[1500px] gap-3 p-3 sm:p-4 xl:grid-cols-[1fr_1.35fr]">
        <div className="flex flex-col gap-3">
          <Card title={cmd?.label ?? ep.label} icon={ep.icon ?? 'Terminal'} subtitle={ep.description}>
            <div className="space-y-3">
              {cmd?.danger && (
                <div className="flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/5 px-3 py-2 text-[12px] text-warn">
                  <Icon name="AlertTriangle" size={14} className="mt-0.5" />{cmd.confirm ?? 'This command changes device state.'}
                </div>
              )}
              {(cmd?.params ?? []).length === 0 && <p className="text-[12.5px] text-faint">This command takes no parameters.</p>}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {(cmd?.params ?? []).map((p) => {
                  const key = `${cmd!.id}.${p.name}`;
                  return (
                    <label key={key} className={clsx('block', (p.type === 'text' || p.type === 'json') && 'sm:col-span-2')}>
                      <span className="mb-1 block text-[11.5px] font-medium text-dim">{p.label ?? prettify(p.name)}{p.required && <span className="text-bad"> *</span>}</span>
                      {p.type === 'enum' ? (
                        <select className="input" value={String(params[key] ?? '')} onChange={(e) => setParams((s) => ({ ...s, [key]: e.target.value }))}>
                          {p.values?.map((v) => <option key={v} value={v}>{v}</option>)}
                        </select>
                      ) : p.type === 'text' ? (
                        <textarea className="input mono h-20" value={String(params[key] ?? '')} onChange={(e) => setParams((s) => ({ ...s, [key]: e.target.value }))} placeholder={p.placeholder} />
                      ) : (
                        <input
                          className={clsx('input', ['ip', 'cidr', 'mac'].includes(p.type) && 'mono')}
                          type={p.type === 'number' ? 'number' : p.type === 'password' ? 'password' : 'text'}
                          value={String(params[key] ?? '')}
                          placeholder={p.placeholder}
                          onChange={(e) => setParams((s) => ({ ...s, [key]: e.target.value }))}
                        />
                      )}
                    </label>
                  );
                })}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="primary" icon={cmd?.danger ? 'AlertTriangle' : 'Play'} loading={running} onClick={run}>{cmd?.label ?? 'Run'}</Button>
                {results[cmd?.id ?? ''] && (
                  <Button variant="ghost" icon="RotateCcw" onClick={() => setResults((r) => ({ ...r, [cmd!.id]: undefined }))}>Clear result</Button>
                )}
                <span className="mono ml-auto text-[11px] text-faint">POST /rest/{ep.path}{cmd?.path ? `/${cmd.path}` : ''}</span>
              </div>
            </div>
          </Card>

          {(ep.commands ?? []).length > 1 && (
            <Card title="Other commands on this menu" icon="ListTree">
              <div className="flex flex-wrap gap-1.5">
                {(ep.commands ?? []).map((c) => (
                  <Button key={c.id} size="sm" icon={c.icon} variant={c.id === active ? 'primary' : 'default'} onClick={() => setActive(c.id)}>{c.label}</Button>
                ))}
              </div>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-3">
          {Object.entries(results).map(([id, res]) => res && (
            <Card key={id} title={`${(ep.commands ?? []).find((c) => c.id === id)?.label ?? id} — output`} icon="TerminalSquare">
              <ResultView rows={res.rows} raw={res.raw} ms={res.ms} title={id} />
            </Card>
          ))}
          {!Object.values(results).some(Boolean) && (
            <Card title="Output" icon="TerminalSquare" subtitle="Results appear here after running a command">
              <EmptyState icon="Play" title="Nothing run yet" hint="Fill in the parameters and press Run — the request goes straight to the router's REST API." className="py-10" />
            </Card>
          )}
          {Boolean(ep.fields?.length) && (
            <Card title="Last known results" icon="Table2" bodyClassName="p-0" subtitle={`GET /rest/${ep.path}`}>
              {listQuery.isFetching && !listQuery.data ? <TableSkeleton cols={3} /> : (
                <div className="max-h-[320px] overflow-auto">
                  {(listQuery.data?.rows ?? []).length === 0 ? (
                    <EmptyState icon="Inbox" title="No stored results" hint="Run the command to populate this table." className="py-6" />
                  ) : (
                    <table className="w-full text-left text-[12px]">
                      <thead className="bg-panel2 text-[11px] uppercase tracking-wide text-faint">
                        <tr>{Object.keys(listQuery.data!.rows[0]).filter((k) => k !== '.id').map((k) => <th key={k} className="px-3 py-2">{prettify(k)}</th>)}</tr>
                      </thead>
                      <tbody>
                        {listQuery.data!.rows.map((r, i) => (
                          <tr key={i} className="border-t border-line/50">
                            {Object.keys(listQuery.data!.rows[0]).filter((k) => k !== '.id').map((k) => (
                              <td key={k} className="px-3 py-1.5 text-dim"><Cell value={r[k]} /></td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
};

const EndpointPage: React.FC = () => {
  const params = useParams();
  const path = decodeURIComponent((params as Record<string, string>)['*'] ?? '');
  const ep = getEndpoint(path);

  if (!ep) {
    return (
      <div className="p-6">
        <EmptyState
          icon="SearchX"
          title={`No menu named “/${path}”`}
          hint="That REST path is not part of the catalog. Open the API explorer to browse every menu the dashboard knows about."
          action={<Link to="/explorer" className="btn btn-primary"><Icon name="Compass" size={14} />Open API explorer</Link>}
        />
      </div>
    );
  }

  if (ep.kind === 'command') return <CommandEndpoint ep={ep} />;
  if (ep.kind === 'singleton') return <SingletonEndpoint ep={ep} />;
  return <ListEndpoint ep={ep} />;
};

export default EndpointPage;