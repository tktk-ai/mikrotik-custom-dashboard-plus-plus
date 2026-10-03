/** Small presentational pieces shared by the map, inventory, insights and traffic pages. */
import React from 'react';
import clsx from 'clsx';
import {
  DEVICE_KIND_ICON, DEVICE_KIND_LABEL, SEVERITY_ORDER,
  type DeviceKind, type Finding, type LinkKind, type Severity, type TopoKind,
} from '@shared/analytics';
import { Icon } from './ui';

/* ------------------------------- severity ------------------------------- */

export const SEVERITY_TONE: Record<Severity, string> = {
  critical: 'bad',
  high: 'bad',
  medium: 'warn',
  low: 'info',
  info: 'neutral',
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  info: 'Info',
};

export const SEVERITY_DOT: Record<Severity, string> = {
  critical: 'bg-bad',
  high: 'bg-bad/70',
  medium: 'bg-warn',
  low: 'bg-info',
  info: 'bg-dim',
};

export const SeverityChip: React.FC<{ severity: Severity; count?: number; className?: string }> = ({ severity, count, className }) => (
  <span className={clsx('chip', `chip-${SEVERITY_TONE[severity]}`, className)}>
    <span className={clsx('size-1.5 rounded-full', SEVERITY_DOT[severity])} />
    {SEVERITY_LABEL[severity]}
    {count !== undefined && <span className="ml-0.5 font-mono opacity-80">{count}</span>}
  </span>
);

export const sortFindings = (findings: Finding[]) =>
  [...findings].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));

/* -------------------------------- devices -------------------------------- */

export const KindChip: React.FC<{ kind: DeviceKind; label?: boolean; className?: string }> = ({ kind, className }) => (
  <span className={clsx('chip chip-neutral gap-1', className)} title={DEVICE_KIND_LABEL[kind]}>
    <Icon name={DEVICE_KIND_ICON[kind]} size={11} />
    {DEVICE_KIND_LABEL[kind]}
  </span>
);

export const LinkChip: React.FC<{ link: LinkKind; className?: string }> = ({ link, className }) => {
  const map: Record<LinkKind, { icon: string; label: string; tone: string }> = {
    wired: { icon: 'Cable', label: 'Wired', tone: 'chip-neutral' },
    wifi: { icon: 'Wifi', label: 'Wi-Fi', tone: 'chip-info' },
    tunnel: { icon: 'Waypoints', label: 'Tunnel', tone: 'chip-accent' },
    ppp: { icon: 'Waypoints', label: 'PPP', tone: 'chip-accent' },
    virtual: { icon: 'Layers', label: 'Virtual', tone: 'chip-neutral' },
  };
  const meta = map[link] ?? map.wired;
  return (
    <span className={clsx('chip gap-1', meta.tone, className)}>
      <Icon name={meta.icon} size={11} />
      {meta.label}
    </span>
  );
};

/** Signal strength as four bars; green ≥ -60, amber ≥ -72, red below. */
export const SignalBars: React.FC<{ dbm?: number; className?: string; showValue?: boolean }> = ({ dbm, className, showValue }) => {
  if (!Number.isFinite(dbm)) return <span className="text-faint">–</span>;
  const value = Number(dbm);
  const bars = value >= -55 ? 4 : value >= -63 ? 3 : value >= -72 ? 2 : 1;
  const tone = bars >= 3 ? 'bg-good' : bars === 2 ? 'bg-warn' : 'bg-bad';
  return (
    <span className={clsx('inline-flex items-center gap-1.5', className)} title={`${value} dBm`}>
      <span className="flex items-end gap-[2px]">
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={clsx('w-[3px] rounded-sm', i <= bars ? tone : 'bg-line')} style={{ height: 3 + i * 2.5 }} />
        ))}
      </span>
      {showValue && <span className="mono text-[11px] text-dim">{value}</span>}
    </span>
  );
};

export const UtilBar: React.FC<{ value: number; tone?: 'auto' | string; className?: string }> = ({ value, tone = 'auto', className }) => {
  const pct = Math.max(0, Math.min(100, value));
  const resolved = tone !== 'auto' ? tone : pct > 90 ? 'bad' : pct > 70 ? 'warn' : 'good';
  const colors: Record<string, string> = { bad: 'bg-bad', warn: 'bg-warn', good: 'bg-good', accent: 'bg-brand', info: 'bg-info' };
  return (
    <span className={clsx('flex items-center gap-2', className)}>
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-panel3">
        <span className={clsx('block h-full rounded-full', colors[resolved] ?? 'bg-brand')} style={{ width: `${pct}%` }} />
      </span>
      <span className="mono text-[11px] text-dim">{pct.toFixed(0)}%</span>
    </span>
  );
};

/* -------------------------------- topology ------------------------------- */

export const TOPO_STYLE: Record<TopoKind, { icon: string; tone: string; ring: string }> = {
  internet: { icon: 'Globe2', tone: 'text-info', ring: 'border-info/40' },
  uplink: { icon: 'ArrowUpRight', tone: 'text-warn', ring: 'border-warn/40' },
  router: { icon: 'Router', tone: 'text-brand', ring: 'border-brand/50' },
  bridge: { icon: 'Network', tone: 'text-brand2', ring: 'border-brand2/40' },
  vlan: { icon: 'Layers', tone: 'text-brand2', ring: 'border-brand2/40' },
  tunnel: { icon: 'Waypoints', tone: 'text-good', ring: 'border-good/40' },
  segment: { icon: 'Sitemap', tone: 'text-dim', ring: 'border-line2' },
};

export const ModeChip: React.FC<{ mode?: string; className?: string }> = ({ mode, className }) => (
  <span className={clsx('chip gap-1', mode === 'demo' ? 'chip-info' : 'chip-good', className)}>
    <span className={clsx('live-dot size-1.5 rounded-full', mode === 'demo' ? 'bg-info' : 'bg-good')} />
    {mode === 'demo' ? 'Demo device' : 'Live device'}
  </span>
);

/** Stack of small dots representing the devices attached to a segment. */
export const DeviceStack: React.FC<{ devices: Array<{ kind: DeviceKind; name: string }>; max?: number }> = ({ devices, max = 6 }) => (
  <span className="flex items-center">
    {devices.slice(0, max).map((device, i) => (
      <span
        key={`${device.name}-${i}`}
        title={device.name}
        className="grid size-4 place-items-center rounded-full border border-line bg-panel3 text-dim"
        style={{ marginLeft: i === 0 ? 0 : -6 }}
      >
        <Icon name={DEVICE_KIND_ICON[device.kind]} size={9} />
      </span>
    ))}
    {devices.length > max && <span className="ml-1 text-[10px] text-faint">+{devices.length - max}</span>}
  </span>
);
