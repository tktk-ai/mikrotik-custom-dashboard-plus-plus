import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { CATEGORIES, ENDPOINTS, getCategory, searchEndpoints } from '@shared/catalog';
import { useApp } from '../lib/store';
import { Badge, Button, Card, EmptyState, Icon, Segmented, Stat } from '../components/ui';
import { prettify } from '@shared/types';

const Explorer: React.FC = () => {
  const { capabilities, mode, refreshCapabilities, refreshing } = useApp();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [status, setStatus] = useState<'all' | 'supported' | 'unsupported'>('all');
  const [kind, setKind] = useState<'all' | 'list' | 'singleton' | 'command'>('all');

  const rows = useMemo(() => {
    const base = searchEndpoints(query, 300).map((h) => h.endpoint);
    const all = query.trim() ? base : ENDPOINTS.filter((e) => !e.hidden);
    return all
      .filter((e) => category === 'all' || e.category === category)
      .filter((e) => kind === 'all' || (e.kind ?? 'list') === kind)
      .filter((e) => {
        if (status === 'all') return true;
        const cap = capabilities?.endpoints?.[e.path];
        const ok = cap ? cap.ok : 'unknown';
        return status === 'supported' ? ok === true : ok === false;
      })
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [query, category, status, kind, capabilities]);

  const stats = useMemo(() => {
    const withFields = ENDPOINTS.filter((e) => (e.fields?.length ?? 0) > 0).length;
    const commands = ENDPOINTS.reduce((a, e) => a + (e.commands?.length ?? 0), 0);
    const fields = ENDPOINTS.reduce((a, e) => a + (e.fields?.length ?? 0), 0);
    return { total: ENDPOINTS.length, withFields, commands, fields };
  }, []);

  return (
    <div className="mx-auto max-w-[1500px] p-3 sm:p-4">
      <header className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight">API explorer</h1>
          <p className="mt-0.5 max-w-3xl text-[12.5px] text-dim">
            Every RouterOS REST menu the dashboard knows about, with live availability for the connected device. Menus are rendered from the same
            metadata that drives forms, tables and commands, so anything you see here is fully operable.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button icon="RefreshCw" loading={refreshing} onClick={() => refreshCapabilities()}>Re-probe device</Button>
        </div>
      </header>

      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Catalogued menus" value={stats.total} icon="Compass" tone="accent" />
        <Stat label="Typed property fields" value={stats.fields} icon="ListTree" tone="info" />
        <Stat label="Commands & actions" value={stats.commands} icon="Play" tone="good" />
        <Stat
          label={mode === 'demo' ? 'Demo coverage' : 'Verified on device'}
          value={capabilities ? `${capabilities.summary.supported}/${Object.keys(capabilities.endpoints).length}` : '—'}
          icon="ShieldCheck"
          tone={capabilities && capabilities.summary.failed === 0 ? 'good' : 'warn'}
        />
      </div>

      <Card bodyClassName="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Icon name="Search" size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search menus, properties, commands…" className="input pl-8" />
          </div>
          <select className="input w-auto" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="all">All categories</option>
            {CATEGORIES.filter((c) => c.id !== 'overview').map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <Segmented value={kind} onChange={(v) => setKind(v as any)} options={[
            { value: 'all', label: 'All' },
            { value: 'list', label: 'Tables' },
            { value: 'singleton', label: 'Settings' },
            { value: 'command', label: 'Commands' },
          ]} />
          <Segmented value={status} onChange={(v) => setStatus(v as any)} options={[
            { value: 'all', label: 'Any status' },
            { value: 'supported', label: 'Supported' },
            { value: 'unsupported', label: 'Unsupported' },
          ]} />
          <Badge tone="neutral">{rows.length} menus</Badge>
        </div>
      </Card>

      <div className="mt-3 overflow-hidden rounded-xl border border-line bg-panel/70">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-[12.5px]">
            <thead className="bg-panel2 text-[11px] uppercase tracking-wide text-faint">
              <tr>
                <th className="px-3 py-2">Menu</th>
                <th className="px-3 py-2">REST path</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">Properties</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Avail.</th>
                <th className="px-3 py-2">On this device</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((ep) => {
                const cap = capabilities?.endpoints?.[ep.path];
                return (
                  <tr key={ep.path} className="row-hover border-t border-line/50">
                    <td className="px-3 py-1.5">
                      <Link to={`/m/${ep.path}`} className="flex items-center gap-2 hover:text-brand">
                        <Icon name={ep.icon ?? 'Square'} size={13} className="text-faint" />
                        <span className="font-medium">{ep.label}</span>
                      </Link>
                    </td>
                    <td className="mono px-3 py-1.5 text-faint">/{ep.path}</td>
                    <td className="px-3 py-1.5 text-dim">{getCategory(ep.category)?.label}</td>
                    <td className="px-3 py-1.5 text-faint">
                      {(ep.fields?.length ?? 0) > 0 ? `${ep.fields!.length} fields` : '—'}
                      {ep.commands?.length ? ` · ${ep.commands.length} cmds` : ''}
                    </td>
                    <td className="px-3 py-1.5">
                      <Badge tone={ep.kind === 'singleton' ? 'info' : ep.kind === 'command' ? 'accent' : 'neutral'}>
                        {ep.kind === 'singleton' ? 'settings' : ep.kind === 'command' ? 'command' : 'table'}
                      </Badge>
                    </td>
                    <td className="px-3 py-1.5 text-faint">{ep.availability && ep.availability !== 'core' ? String(ep.availability) : 'core'}</td>
                    <td className="px-3 py-1.5">
                      {!cap ? <span className="text-faint">not probed</span>
                        : cap.ok ? <Badge tone="good">{cap.ms} ms</Badge>
                          : <Badge tone={cap.kind === 'notfound' || cap.kind === 'unsupported' ? 'warn' : 'bad'} title={cap.error}>{cap.kind}</Badge>}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <Link to={`/m/${ep.path}`} className="btn btn-sm btn-ghost">Open<Icon name="ArrowRight" size={12} /></Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && <EmptyState icon="SearchX" title="No menus match" hint="Try a different search term or clear the filters." />}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {CATEGORIES.filter((c) => c.id !== 'overview').map((c) => {
          const count = ENDPOINTS.filter((e) => e.category === c.id && !e.hidden).length;
          const supportedCount = ENDPOINTS.filter((e) => e.category === c.id && capabilities?.endpoints?.[e.path]?.ok).length;
          return (
            <Link key={c.id} to={`/m/${ENDPOINTS.find((e) => e.category === c.id)?.path ?? ''}`} onClick={() => setCategory(c.id)}
              className={clsx('card card-hover flex items-center gap-3 px-3.5 py-3')}>
              <span className="grid size-9 place-items-center rounded-lg border border-line bg-panel2 text-brand"><Icon name={c.icon} size={17} /></span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold">{c.label}</div>
                <div className="truncate text-[11.5px] text-faint">{c.description}</div>
              </div>
              <div className="text-right">
                <div className="text-[13px] font-semibold text-dim">{count}</div>
                {capabilities && <div className="text-[10.5px] text-faint">{supportedCount} ok</div>}
              </div>
            </Link>
          );
        })}
      </div>

      <p className="mt-4 text-center text-[11px] text-faint">
        {prettify('') /* keep spacing tidy */}
        Availability is probed with a single GET per menu (5 concurrent, cached 5 minutes) so production routers are never hammered.
      </p>
    </div>
  );
};

export default Explorer;
