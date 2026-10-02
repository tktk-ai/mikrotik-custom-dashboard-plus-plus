import React from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ENDPOINTS, getEndpoint } from '@shared/catalog';
import { api } from '../lib/api';
import { REFRESH_OPTIONS, useApp } from '../lib/store';
import { relativeTime } from '../lib/format';
import { Badge, Button, Card, EmptyState, Field, Icon, Segmented, Toggle, toast } from '../components/ui';

const Settings: React.FC = () => {
  const qc = useQueryClient();
  const {
    connection, connections, capabilities, mode, refreshMs, setRefreshMs, theme, toggleTheme,
    density, setDensity, favorites, toggleFavorite, refreshCapabilities, refreshing, supported,
  } = useApp();

  const resetDemo = useMutation({
    mutationFn: () => api.resetDemo(),
    onSuccess: async () => { await qc.invalidateQueries(); toast.success('Demo device reset to its initial state'); },
  });

  return (
    <div className="mx-auto max-w-[1100px] p-3 sm:p-4">
      <header className="mb-3">
        <h1 className="text-[19px] font-semibold tracking-tight">Settings</h1>
        <p className="mt-0.5 text-[12.5px] text-dim">Preferences are stored in your browser; device credentials stay on the dashboard server.</p>
      </header>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="Appearance" icon="Palette">
          <div className="space-y-4">
            <Field label="Theme">
              <Segmented value={theme} onChange={() => toggleTheme()} options={[{ value: 'dark', label: 'Dark', icon: 'Moon' }, { value: 'light', label: 'Light', icon: 'Sun' }]} />
            </Field>
            <Field label="Table density" hint="Compact fits more rows on large rule tables.">
              <Segmented value={density} onChange={(v) => setDensity(v as 'comfortable' | 'compact')} options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]} />
            </Field>
            <Field label="Auto-refresh interval" hint="Applies to tables, dashboards and the live metrics stream.">
              <div className="flex flex-wrap gap-1.5">
                {REFRESH_OPTIONS.map((o) => (
                  <Button key={String(o.value)} size="sm" variant={refreshMs === o.value ? 'primary' : 'default'} onClick={() => setRefreshMs(o.value)}>{o.label}</Button>
                ))}
              </div>
            </Field>
          </div>
        </Card>

        <Card title="Connected device" icon="Router">
          {connection ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-xl border border-line bg-panel2 text-brand"><Icon name={connection.demo ? 'FlaskConical' : 'Router'} size={18} /></span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13.5px] font-semibold">{connection.name}</span>
                    <Badge tone={mode === 'demo' ? 'info' : 'good'}>{mode}</Badge>
                  </div>
                  <div className="mono text-[11.5px] text-faint">{connection.scheme}://{connection.host}:{connection.port} · {connection.username}</div>
                </div>
              </div>
              {capabilities && (
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg border border-line bg-panel2/50 px-2.5 py-2">
                    <div className="text-[10.5px] text-faint">Supported</div>
                    <div className="text-[16px] font-semibold text-good">{capabilities.summary.supported}</div>
                  </div>
                  <div className="rounded-lg border border-line bg-panel2/50 px-2.5 py-2">
                    <div className="text-[10.5px] text-faint">Unsupported</div>
                    <div className="text-[16px] font-semibold text-warn">{capabilities.summary.unsupported}</div>
                  </div>
                  <div className="rounded-lg border border-line bg-panel2/50 px-2.5 py-2">
                    <div className="text-[10.5px] text-faint">Errors</div>
                    <div className="text-[16px] font-semibold text-bad">{capabilities.summary.failed}</div>
                  </div>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button icon="RefreshCw" loading={refreshing} onClick={() => refreshCapabilities()}>Re-probe menus</Button>
                <Link to="/connections" className="btn">Manage connections</Link>
                {connection.demo && (
                  <Button icon="RotateCcw" loading={resetDemo.isPending} onClick={() => resetDemo.mutate()}>Reset demo data</Button>
                )}
              </div>
              {capabilities && <p className="text-[11.5px] text-faint">Probed {relativeTime(capabilities.probedAt)} · {Object.keys(capabilities.endpoints).length} menus sampled.</p>}
              <p className="text-[11.5px] text-faint">{connections.length} connection profile{connections.length === 1 ? '' : 's'} configured.</p>
            </div>
          ) : (
            <EmptyState icon="Router" title="No device connected" hint="Add a RouterOS device to unlock live data." action={<Link to="/connections" className="btn btn-primary">Add device</Link>} />
          )}
        </Card>

        <Card title="Pinned menus" icon="Star" subtitle="Pinned menus appear at the top of the sidebar">
          {favorites.length === 0 ? (
            <EmptyState icon="Star" title="Nothing pinned yet" hint="Open any menu and press the star icon to pin it here." className="py-6" />
          ) : (
            <div className="space-y-1.5">
              {favorites.map((f) => {
                const ep = getEndpoint(f);
                return (
                  <div key={f} className="flex items-center gap-2 rounded-lg border border-line bg-panel2/40 px-2.5 py-1.5">
                    <Icon name={ep?.icon ?? 'Dot'} size={14} className="text-faint" />
                    <Link to={`/m/${f}`} className="min-w-0 flex-1 truncate text-[12.5px] hover:text-brand">{ep?.label ?? f}</Link>
                    <span className="mono truncate text-[11px] text-faint">/{f}</span>
                    <Button size="sm" variant="ghost" icon="X" onClick={() => toggleFavorite(f)} />
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card title="Keyboard shortcuts" icon="Keyboard">
          <div className="space-y-2 text-[12.5px]">
            {[
              ['⌘ / Ctrl + K', 'Open the command palette'],
              ['/', 'Focus search (palette)'],
              ['⌘ / Ctrl + Enter', 'Run the command in the console'],
              ['Esc', 'Close dialogs, drawers and the palette'],
              ['↑ ↓', 'Move through palette results'],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center gap-3 border-b border-line/50 pb-1.5 last:border-0">
                <span className="kbd shrink-0">{k}</span>
                <span className="text-dim">{v}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="About this dashboard" icon="Info" className="lg:col-span-2">
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <div className="label mb-1">Coverage</div>
              <p className="text-[12.5px] text-dim">
                {ENDPOINTS.length} RouterOS REST menus across 17 categories — interfaces, IPv4/IPv6, firewall, routing, queues, wireless, PPP, VPN,
                hotspot, RADIUS, User Manager, system, containers, IoT, MPLS and tools. Menus you have verified are marked with a green dot.
              </p>
            </div>
            <div>
              <div className="label mb-1">How it talks to RouterOS</div>
              <p className="text-[12.5px] text-dim">
                All traffic flows through this server using the official REST API with HTTP basic authentication, TLS-skip for self-signed certificates and a
                15-second timeout. Nothing is proxied through third parties.
              </p>
            </div>
            <div>
              <div className="label mb-1">Safety</div>
              <ul className="space-y-1 text-[12px] text-dim">
                <li className="flex items-center gap-2"><Icon name="ShieldCheck" size={13} className="text-good" />Destructive commands ask for confirmation</li>
                <li className="flex items-center gap-2"><Icon name="Eye" size={13} className="text-info" />Read-only menus cannot be edited</li>
                <li className="flex items-center gap-2"><Icon name="Lock" size={13} className="text-warn" />Passwords never reach the browser</li>
              </ul>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <Badge tone="neutral">Demo mode: fully simulated device</Badge>
            <Badge tone="neutral">Live mode: real RouterOS REST API</Badge>
            <span className="ml-auto text-[11px] text-faint">Verified menus on this device: {Object.values(capabilities?.endpoints ?? {}).filter((c) => c.ok).length}</span>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default Settings;
