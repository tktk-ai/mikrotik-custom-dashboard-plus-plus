import React, { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { CATEGORIES, endpointsByCategory, getCategory, getEndpoint, searchEndpoints } from '@shared/catalog';
import { api } from '../lib/api';
import { REFRESH_OPTIONS, useApp } from '../lib/store';
import { Badge, Button, Icon, Segmented, toast, useToggle } from './ui';

const QUICK_ACTIONS = [
  { id: 'ping', label: 'Ping a host', path: '/m/tool/ping', icon: 'Radio' },
  { id: 'trace', label: 'Traceroute', path: '/m/tool/traceroute', icon: 'Route' },
  { id: 'torch', label: 'Torch interface', path: '/m/tool/torch', icon: 'Flame' },
  { id: 'sniffer', label: 'Packet sniffer', path: '/m/tool/sniffer', icon: 'Radar' },
  { id: 'console', label: 'Console command', path: '/console', icon: 'Terminal' },
  { id: 'fw', label: 'Firewall filter rules', path: '/m/ip/firewall/filter', icon: 'ShieldCheck' },
  { id: 'leases', label: 'DHCP leases', path: '/m/ip/dhcp-server/lease', icon: 'FileText' },
  { id: 'backup', label: 'Create a backup', path: '/m/system/backup', icon: 'HardDriveDownload' },
  { id: 'log', label: 'System log', path: '/m/log', icon: 'ScrollText' },
  { id: 'conn', label: 'Device connections', path: '/connections', icon: 'Plug' },
];

/* ------------------------------------------------------------------ *
 * Sidebar
 * ------------------------------------------------------------------ */

const Sidebar: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const { connection, capabilities, mode, favorites, toggleFavorite, supported, refreshMs, setRefreshMs, theme, toggleTheme } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const groups = useMemo(() => endpointsByCategory(), []);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem('rcd.collapsed') ?? '{}'); } catch { return {}; }
  });
  const [filter, setFilter] = useState('');
  const activePath = location.pathname.startsWith('/m/') ? decodeURIComponent(location.pathname.slice(3)) : '';
  const activeCategory = getEndpoint(activePath)?.category;

  useEffect(() => {
    localStorage.setItem('rcd.collapsed', JSON.stringify(collapsed));
  }, [collapsed]);

  useEffect(() => { onClose(); /* close the mobile drawer on navigation */ }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  const favItems = favorites.map((f) => getEndpoint(f)).filter(Boolean) as NonNullable<ReturnType<typeof getEndpoint>>[];

  const matches = (label: string, path: string) => !filter || label.toLowerCase().includes(filter.toLowerCase()) || path.includes(filter.toLowerCase());

  return (
    <>
      <div className={clsx('fixed inset-0 z-30 bg-black/50 backdrop-blur-sm lg:hidden', open ? 'block' : 'hidden')} onClick={onClose} />
      <aside className={clsx(
        'fixed inset-y-0 left-0 z-40 flex w-[272px] flex-col border-r border-line bg-base2/95 backdrop-blur transition-transform lg:static lg:translate-x-0',
        open ? 'translate-x-0' : '-translate-x-full',
      )}>
        {/* brand */}
        <div className="flex items-center gap-2.5 border-b border-line px-3.5 py-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-brand/30 bg-gradient-to-br from-brand/25 to-brand2/20 text-brand">
            <Icon name="Router" size={18} />
          </span>
          <div className="min-w-0">
            <div className="truncate text-[13.5px] font-semibold leading-tight">RouterOS Control Plane</div>
            <div className="truncate text-[10.5px] text-faint">Every REST menu, one dashboard</div>
          </div>
          <button className="ml-auto text-faint lg:hidden" onClick={onClose} aria-label="Close navigation"><Icon name="X" size={16} /></button>
        </div>

        {/* device card */}
        <button onClick={() => navigate('/connections')} className="group mx-3 mt-3 rounded-xl border border-line bg-panel/70 px-3 py-2.5 text-left transition-colors hover:border-line2">
          <div className="flex items-center gap-2">
            <span className={clsx('size-1.5 rounded-full', mode === 'demo' ? 'bg-info' : 'bg-good live-dot')} />
            <span className="truncate text-[12.5px] font-medium">{connection?.name ?? 'No device'}</span>
            <Icon name="ChevronRight" size={13} className="ml-auto shrink-0 text-faint group-hover:text-dim" />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone={mode === 'demo' ? 'info' : 'good'}>{mode === 'demo' ? 'demo device' : 'live'}</Badge>
            {capabilities?.device?.board && <Badge tone="neutral">{String(capabilities.device.board)}</Badge>}
            {capabilities?.device?.version && <Badge tone="neutral">v{String(capabilities.device.version).split(' ')[0]}</Badge>}
          </div>
          {capabilities && (
            <div className="mt-1.5 text-[10.5px] text-faint">
              {capabilities.summary.supported} menus verified{capabilities.summary.unsupported ? ` · ${capabilities.summary.unsupported} unsupported` : ''}
            </div>
          )}
        </button>

        {/* filter */}
        <div className="px-3 pt-3">
          <div className="relative">
            <Icon name="Search" size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter menus…"
              className="input pl-7 text-[12.5px]"
            />
          </div>
        </div>

        {/* nav */}
        <nav className="mt-2 flex-1 overflow-y-auto px-2 pb-4">
          <NavLink to="/" className={({ isActive }) => clsx('nav-item', isActive && 'nav-item-active')} end>
            <Icon name="LayoutDashboard" size={15} />
            <span className="flex-1">Overview</span>
          </NavLink>
          <NavLink to="/explorer" className={({ isActive }) => clsx('nav-item', isActive && 'nav-item-active')}>
            <Icon name="Compass" size={15} />
            <span className="flex-1">API explorer</span>
            <Badge tone="neutral">{capabilities?.endpoints ? Object.keys(capabilities.endpoints).length : ''}</Badge>
          </NavLink>

          {favItems.length > 0 && (
            <div className="mt-3">
              <div className="label flex items-center gap-1.5 px-2 py-1"><Icon name="Star" size={11} />Pinned</div>
              {favItems.map((ep) => (
                <NavLink key={ep.path} to={`/m/${ep.path}`} className={({ isActive }) => clsx('nav-item', isActive && 'nav-item-active')}>
                  <Icon name={ep.icon ?? 'Dot'} size={14} />
                  <span className="flex-1 truncate">{ep.label}</span>
                  <button onClick={(e) => { e.preventDefault(); toggleFavorite(ep.path); }} className="text-brand opacity-70 hover:opacity-100" title="Unpin"><Icon name="StarOff" size={12} /></button>
                </NavLink>
              ))}
            </div>
          )}

          {groups.map(({ category, endpoints }) => {
            const visible = endpoints.filter((e) => matches(e.label, e.path));
            if (!visible.length) return null;
            const isCollapsed = collapsed[category.id] && activeCategory !== category.id && !filter;
            const grouped = visible.reduce<Record<string, typeof visible>>((acc, e) => {
              const g = e.group ?? 'General';
              (acc[g] ||= []).push(e);
              return acc;
            }, {});
            return (
              <div key={category.id} className="mt-3">
                <button
                  onClick={() => setCollapsed((c) => ({ ...c, [category.id]: !c[category.id] }))}
                  className={clsx('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left', activeCategory === category.id ? 'text-ink' : 'text-dim hover:text-ink')}
                >
                  <Icon name={category.icon} size={14} className={activeCategory === category.id ? 'text-brand' : 'text-faint'} />
                  <span className="flex-1 text-[12px] font-semibold uppercase tracking-[0.06em]">{category.label}</span>
                  <Badge tone="neutral">{visible.length}</Badge>
                  <Icon name={isCollapsed ? 'ChevronRight' : 'ChevronDown'} size={12} className="text-faint" />
                </button>
                {!isCollapsed && (
                  <div className="mt-0.5 space-y-0.5">
                    {Object.entries(grouped).map(([group, items]) => (
                      <div key={group}>
                        {Object.keys(grouped).length > 1 && <div className="px-2 pb-0.5 pt-1.5 text-[10px] font-medium uppercase tracking-wider text-faint/80">{group}</div>}
                        {items.map((ep) => {
                          const support = supported(ep.path);
                          return (
                            <NavLink key={ep.path} to={`/m/${ep.path}`} className={({ isActive }) => clsx('nav-item pl-3', isActive && 'nav-item-active')}>
                              <Icon name={ep.icon ?? 'Dot'} size={13} className="shrink-0 opacity-80" />
                              <span className="flex-1 truncate">{ep.label}</span>
                              {support === 'no' && <span title="Not available on this device" className="size-1.5 rounded-full bg-warn/70" />}
                              {capabilities && support === 'yes' && <span className="size-1.5 rounded-full bg-good/60" />}
                              {ep.availability === 'optional' && <Badge tone="warn">pkg</Badge>}
                            </NavLink>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* footer */}
        <div className="border-t border-line px-3 py-2.5">
          <div className="flex items-center gap-2">
            <Icon name="Timer" size={13} className="text-faint" />
            <span className="text-[11px] text-faint">Auto-refresh</span>
            <select
              value={String(refreshMs)}
              onChange={(e) => setRefreshMs(e.target.value === 'null' ? null : Number(e.target.value))}
              className="input ml-auto w-[74px] py-0.5 text-[11.5px]"
            >
              {REFRESH_OPTIONS.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
            </select>
          </div>
          <div className="mt-2 flex items-center gap-1">
            <NavLink to="/console" className={({ isActive }) => clsx('btn btn-sm btn-ghost flex-1', isActive && 'text-ink')}><Icon name="Terminal" size={13} />Console</NavLink>
            <Button size="sm" variant="ghost" icon={theme === 'dark' ? 'Sun' : 'Moon'} onClick={toggleTheme} title="Toggle theme" />
            <NavLink to="/settings" className={({ isActive }) => clsx('btn btn-sm btn-ghost', isActive && 'text-ink')}><Icon name="Settings" size={13} /></NavLink>
          </div>
        </div>
      </aside>
    </>
  );
};

/* ------------------------------------------------------------------ *
 * Command palette
 * ------------------------------------------------------------------ */

const Palette: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [recent, setRecent] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('rcd.recent') ?? '[]'); } catch { return []; }
  });

  const results = useMemo(() => {
    const epHits = searchEndpoints(query, 14).map((h) => ({
      kind: 'menu' as const,
      id: h.endpoint.path,
      label: h.endpoint.label,
      sub: `/${h.endpoint.path}`,
      icon: h.endpoint.icon ?? 'Dot',
      group: getCategory(h.endpoint.category)?.label ?? '',
      to: `/m/${h.endpoint.path}`,
    }));
    const actions = QUICK_ACTIONS
      .filter((a) => !query || a.label.toLowerCase().includes(query.toLowerCase()))
      .map((a) => ({ kind: 'action' as const, id: a.id, label: a.label, sub: a.path, icon: a.icon, group: 'Quick actions', to: a.path }));
    const favs = recent
      .filter((r) => !query)
      .map((r) => getEndpoint(r))
      .filter(Boolean)
      .map((e) => ({ kind: 'menu' as const, id: e!.path, label: e!.label, sub: `/${e!.path}`, icon: e!.icon ?? 'Dot', group: 'Recent', to: `/m/${e!.path}` }));
    return [...favs, ...epHits, ...actions].slice(0, 20);
  }, [query, recent]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(results.length - 1, i + 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
      if (e.key === 'Enter') {
        const r = results[index];
        if (r) {
          const path = r.to.replace('/m/', '');
          const next = [path, ...recent.filter((x) => x !== path)].slice(0, 6);
          setRecent(next);
          localStorage.setItem('rcd.recent', JSON.stringify(next));
          navigate(r.to);
          onClose();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, results, index, navigate, onClose, recent]);

  if (!open) return null;

  let lastGroup = '';
  return (
    <div className="fixed inset-0 z-[55] flex items-start justify-center bg-black/60 p-4 backdrop-blur-sm sm:p-10" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="animate-in card w-full max-w-2xl overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
          <Icon name="Search" size={15} className="text-brand" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setIndex(0); }}
            placeholder="Search 277 RouterOS menus, run tools…"
            className="flex-1 bg-transparent text-[14px] text-ink placeholder-faint focus:outline-none"
          />
          <span className="kbd">esc</span>
        </div>
        <div className="max-h-[52vh] overflow-y-auto p-1.5">
          {results.length === 0 && <div className="px-3 py-6 text-center text-[12.5px] text-faint">No matches. Try “firewall”, “queue”, “wireguard”…</div>}
          {results.map((r, i) => {
            const showGroup = r.group !== lastGroup;
            lastGroup = r.group;
            return (
              <React.Fragment key={`${r.kind}-${r.id}`}>
                {showGroup && <div className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-faint">{r.group}</div>}
                <button
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => { navigate(r.to); onClose(); }}
                  className={clsx('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left', i === index ? 'bg-panel3' : 'hover:bg-panel2')}
                >
                  <Icon name={r.icon} size={15} className={i === index ? 'text-brand' : 'text-faint'} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-ink">{r.label}</span>
                    <span className="mono block truncate text-[11px] text-faint">{r.sub}</span>
                  </span>
                  {r.kind === 'action' && <Badge tone="accent">run</Badge>}
                </button>
              </React.Fragment>
            );
          })}
        </div>
        <div className="flex items-center gap-3 border-t border-line px-3 py-2 text-[11px] text-faint">
          <span><span className="kbd">↑↓</span> navigate</span>
          <span><span className="kbd">↵</span> open</span>
          <span className="ml-auto">{results.length} results</span>
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ *
 * Alerts bell
 * ------------------------------------------------------------------ */

const AlertBell: React.FC = () => {
  const { mode, refreshMs } = useApp();
  const [open, toggle, setOpen] = useToggle(false);
  const { data } = useQuery({
    queryKey: ['dashboard-alerts', mode],
    queryFn: () => api.dashboard(),
    refetchInterval: refreshMs ?? false,
    enabled: mode === 'demo',
  });
  const alerts: any[] = (mode === 'demo' ? data?.alerts : []) ?? [];
  return (
    <div className="relative">
      <Button variant="ghost" size="sm" onClick={toggle} className="relative">
        <Icon name="Bell" size={15} />
        {alerts.length > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid size-4 place-items-center rounded-full bg-bad text-[9px] font-bold text-white">{alerts.length}</span>
        )}
      </Button>
      {open && (
        <div className="animate-in card absolute right-0 top-9 z-50 w-[340px] p-2 shadow-2xl">
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="text-[12px] font-semibold">Alerts</span>
            <button className="text-faint hover:text-dim" onClick={() => setOpen(false)}><Icon name="X" size={13} /></button>
          </div>
          {alerts.length === 0 && <div className="px-2 py-4 text-center text-[12px] text-faint">No active alerts.</div>}
          {alerts.map((a) => (
            <div key={a.id} className="flex items-start gap-2 rounded-lg px-2 py-2 hover:bg-panel2">
              <Icon name={a.severity === 'critical' ? 'AlertOctagon' : a.severity === 'warning' ? 'AlertTriangle' : 'Info'}
                className={a.severity === 'critical' ? 'text-bad' : a.severity === 'warning' ? 'text-warn' : 'text-info'} size={14} />
              <div className="min-w-0">
                <div className="text-[12px] text-ink">{a.title}</div>
                <div className="truncate text-[11px] text-faint">{a.detail}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ *
 * Shell
 * ------------------------------------------------------------------ */

export const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [navOpen, setNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const location = useLocation();
  const { connection, mode, refreshCapabilities, refreshing, density, setDensity } = useApp();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((p) => !p);
      }
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const crumbs = useMemo(() => {
    if (location.pathname.startsWith('/m/')) {
      const path = decodeURIComponent(location.pathname.slice(3));
      const ep = getEndpoint(path);
      if (ep) return [getCategory(ep.category)?.label ?? '', ep.group ?? '', ep.label];
    }
    if (location.pathname === '/') return ['Overview'];
    if (location.pathname === '/explorer') return ['API explorer'];
    if (location.pathname === '/connections') return ['Device connections'];
    if (location.pathname === '/console') return ['Console'];
    if (location.pathname === '/settings') return ['Settings'];
    return [];
  }, [location.pathname]);

  return (
    <div className="flex h-full min-h-screen">
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
      <Palette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-line bg-base/85 px-3 py-2 backdrop-blur-md sm:px-4">
          <Button variant="ghost" size="sm" className="lg:hidden" onClick={() => setNavOpen(true)} aria-label="Open navigation"><Icon name="Menu" size={16} /></Button>
          <nav className="flex min-w-0 items-center gap-1.5 text-[12.5px]">
            {crumbs.map((c, i) => (
              <React.Fragment key={`${c}-${i}`}>
                {i > 0 && <Icon name="ChevronRight" size={12} className="shrink-0 text-faint" />}
                <span className={clsx('truncate', i === crumbs.length - 1 ? 'font-medium text-ink' : 'text-faint')}>{c}</span>
              </React.Fragment>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={() => setPaletteOpen(true)}
              className="hidden items-center gap-2 rounded-lg border border-line bg-panel2 px-2.5 py-1.5 text-[12px] text-faint transition-colors hover:border-line2 hover:text-dim sm:flex"
            >
              <Icon name="Search" size={13} />
              <span>Search menus…</span>
              <span className="kbd">⌘K</span>
            </button>

            <Segmented
              className="hidden md:inline-flex"
              value={density}
              onChange={(v) => setDensity(v as 'comfortable' | 'compact')}
              options={[{ value: 'comfortable', label: 'Comfort' }, { value: 'compact', label: 'Compact' }]}
            />

            <AlertBell />

            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await refreshCapabilities();
                toast.info('Menu availability refreshed');
              }}
              title="Re-probe the device for available REST menus"
            >
              <Icon name="RefreshCw" size={14} className={refreshing ? 'animate-spin' : ''} />
            </Button>

            <div className="hidden items-center gap-2 rounded-lg border border-line bg-panel2 px-2.5 py-1.5 sm:flex">
              <span className={clsx('size-1.5 rounded-full', mode === 'demo' ? 'bg-info' : 'bg-good live-dot')} />
              <span className="max-w-[150px] truncate text-[12px] text-dim">{connection?.host ?? 'not connected'}</span>
            </div>
          </div>
        </header>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
};
