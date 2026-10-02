/**
 * Network map renderer.
 *
 * Nodes are HTML cards laid out in five layers (internet → uplink → router →
 * L2/VLAN/tunnel → segment); links are drawn in an SVG overlay using the same
 * pixel coordinates, so text stays crisp and the whole map scales with its
 * container. Layout is a simple top-down barycentre pass: children are ordered by
 * the average position of their parents, which keeps the common
 * router → bridge → subnet tree free of crossings.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import type { DeviceRecord, TopoLink, TopoNode, Topology } from '@shared/analytics';
import { Icon } from './ui';
import { DeviceStack, TOPO_STYLE, UtilBar } from './network';

const NODE_W = 158;
const NODE_H = 68;
const LAYER_GAP = 122;
const PAD_X = 16;
const PAD_Y = 14;
const MIN_WIDTH = 940;

const layerOf = (kind: TopoNode['kind']): number =>
  ({ internet: 0, uplink: 1, router: 2, bridge: 3, vlan: 3, tunnel: 3, segment: 4 }[kind] ?? 4);

const useElementWidth = (min: number) => {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(min);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.max(min, el.clientWidth || min));
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [min]);
  return [ref, width] as const;
};

interface Positioned {
  node: TopoNode;
  x: number;
  y: number;
}

export interface NetGraphProps {
  topology: Topology;
  selectedId?: string | null;
  onSelectNode?: (node: TopoNode) => void;
  onOpenDevices?: (node: TopoNode) => void;
  /** Nodes that do not match the current filter are dimmed rather than hidden. */
  isDimmed?: (node: TopoNode) => boolean;
}

export const NetGraph: React.FC<NetGraphProps> = ({ topology, selectedId, onSelectNode, onOpenDevices, isDimmed }) => {
  const [wrapRef, width] = useElementWidth(MIN_WIDTH);
  const [hovered, setHovered] = useState<TopoNode | null>(null);

  const { positions, links, height } = useMemo(() => {
    const byLayer = new Map<number, TopoNode[]>();
    for (const node of topology.nodes) {
      const layer = layerOf(node.kind);
      byLayer.set(layer, [...(byLayer.get(layer) ?? []), node]);
    }

    const parentX = new Map<string, number[]>();
    for (const link of topology.links) {
      if (!parentX.has(link.to)) parentX.set(link.to, []);
    }

    const placed = new Map<string, Positioned>();
    const layers = [...byLayer.keys()].sort((a, b) => a - b);
    const maxLayer = layers.length ? Math.max(...layers) : 0;
    const rows = maxLayer + 1;

    for (const layer of layers) {
      const nodes = byLayer.get(layer) ?? [];
      const ordered = [...nodes]
        .map((node, index) => {
          const parents = parentX.get(node.id) ?? [];
          const key = parents.length ? parents.reduce((a, b) => a + b, 0) / parents.length : Number.MAX_SAFE_INTEGER;
          return { node, key, index };
        })
        .sort((a, b) => (a.key === b.key ? a.index - b.index : a.key - b.key));

      const usable = width - PAD_X * 2 - NODE_W;
      ordered.forEach(({ node }, index) => {
        const x = ordered.length === 1
          ? width / 2
          : PAD_X + NODE_W / 2 + (usable * index) / (ordered.length - 1);
        const y = PAD_Y + NODE_H / 2 + layer * LAYER_GAP;
        const positioned = { node, x, y };
        placed.set(node.id, positioned);
        for (const link of topology.links) {
          if (link.from === node.id) {
            const list = parentX.get(link.to) ?? [];
            list.push(x);
            parentX.set(link.to, list);
          }
        }
      });
    }

    const drawn = topology.links
      .map((link) => {
        const from = placed.get(link.from);
        const to = placed.get(link.to);
        if (!from || !to) return null;
        return { link, from, to };
      })
      .filter(Boolean) as Array<{ link: TopoLink; from: Positioned; to: Positioned }>;

    return { positions: placed, links: drawn, height: PAD_Y * 2 + rows * LAYER_GAP - (LAYER_GAP - NODE_H) };
  }, [topology, width]);

  const active = hovered ?? (selectedId ? topology.nodes.find((n) => n.id === selectedId) ?? null : null);
  const related = useMemo(() => {
    if (!active) return new Set<string>();
    const ids = new Set<string>([active.id]);
    for (const { link } of links) {
      if (link.from === active.id) ids.add(link.to);
      if (link.to === active.id) ids.add(link.from);
    }
    return ids;
  }, [active, links]);

  const linkPath = (from: Positioned, to: Positioned) => {
    const x1 = from.x;
    const y1 = from.y + NODE_H / 2;
    const x2 = to.x;
    const y2 = to.y - NODE_H / 2;
    const mid = (y1 + y2) / 2;
    return `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`;
  };

  return (
    <div className="relative">
      <div ref={wrapRef} className="overflow-x-auto">
        <div className="relative" style={{ width: Math.max(width, MIN_WIDTH), height, minWidth: MIN_WIDTH }}>
          <svg className="absolute inset-0 overflow-visible" width={Math.max(width, MIN_WIDTH)} height={height} aria-hidden>
            {links.map(({ link, from, to }, index) => {
              const isActive = active ? (link.from === active.id || link.to === active.id) : false;
              const status = link.status ?? 'up';
              return (
                <g key={`${link.from}-${link.to}-${index}`}>
                  <path
                    d={linkPath(from, to)}
                    fill="none"
                    strokeWidth={isActive ? 2 : 1.25}
                    className={clsx(
                      'transition-all',
                      status === 'down' ? 'stroke-bad/70' : status === 'warn' ? 'stroke-warn/70' : 'stroke-line2',
                      isActive && 'stroke-brand',
                      active && !isActive && 'opacity-30',
                    )}
                    strokeDasharray={link.link === 'tunnel' ? '4 4' : link.link === 'wifi' ? '2 3' : undefined}
                  />
                  {link.label && (
                    <text
                      x={(from.x + to.x) / 2}
                      y={(from.y + to.y) / 2 + 3}
                      textAnchor="middle"
                      className={clsx('fill-[var(--color-faint)] text-[9px]', active && !isActive && 'opacity-30')}
                    >
                      {link.label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          {[...positions.values()].map(({ node, x, y }) => {
            const style = TOPO_STYLE[node.kind];
            const dimmed = Boolean(isDimmed?.(node)) || Boolean(active && !related.has(node.id));
            const isSelected = selectedId === node.id;
            return (
              <button
                key={node.id}
                type="button"
                onMouseEnter={() => setHovered(node)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => onSelectNode?.(node)}
                className={clsx(
                  'card card-hover animate-in absolute flex flex-col gap-1 p-2 text-left',
                  style.ring,
                  dimmed && 'opacity-35',
                  isSelected && 'border-brand ring-1 ring-brand/40',
                )}
                style={{ left: x - NODE_W / 2, top: y - NODE_H / 2, width: NODE_W, height: NODE_H }}
                title={[node.label, node.sublabel, node.detail].filter(Boolean).join('\n')}
              >
                <span className="flex items-center gap-1.5">
                  <span className={clsx('grid size-5 shrink-0 place-items-center rounded-md border bg-panel2', style.ring, style.tone)}>
                    <Icon name={style.icon} size={12} />
                  </span>
                  <span className="truncate text-[12px] font-semibold text-ink">{node.label}</span>
                  <span
                    className={clsx(
                      'ml-auto size-1.5 shrink-0 rounded-full',
                      node.status === 'up' ? 'bg-good' : node.status === 'warn' ? 'bg-warn' : 'bg-bad',
                    )}
                  />
                </span>
                <span className="truncate text-[10.5px] leading-tight text-faint">{node.sublabel}</span>
                {node.kind === 'segment' ? (
                  <span className="mt-auto flex items-center justify-between gap-1">
                    {node.devices?.length ? (
                      <DeviceStack devices={node.devices.map((d: DeviceRecord) => ({ kind: d.kind, name: d.name }))} max={5} />
                    ) : (
                      <span className="text-[10px] text-faint">no devices seen</span>
                    )}
                    {typeof node.utilisation === 'number' && node.utilisation > 0 ? <UtilBar value={node.utilisation} /> : null}
                  </span>
                ) : (
                  <span className="mt-auto flex items-center gap-1 text-[10px] text-faint">
                    {node.cidr ?? node.ip ?? ''}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line/60 pt-3">
        <span className="label">Legend</span>
        {(['internet', 'uplink', 'router', 'bridge', 'tunnel', 'segment'] as const).map((kind) => (
          <span key={kind} className="flex items-center gap-1.5 text-[11px] text-dim">
            <span className={clsx('grid size-4 place-items-center rounded border bg-panel2', TOPO_STYLE[kind].ring, TOPO_STYLE[kind].tone)}>
              <Icon name={TOPO_STYLE[kind].icon} size={10} />
            </span>
            {kind}
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-[11px] text-dim"><span className="h-px w-6 bg-line2" />wired</span>
        <span className="flex items-center gap-1.5 text-[11px] text-dim"><span className="h-px w-6 border-t border-dashed border-line2" />wifi / tunnel</span>
        {onOpenDevices && (
          <button className="btn btn-sm btn-ghost ml-auto" onClick={() => active && onOpenDevices(active)} disabled={!active}>
            <Icon name="ListTree" size={12} />
            {active ? `Devices on ${active.label}` : 'Pick a node'}
          </button>
        )}
      </div>

      {active && (
        <div className="mt-3 rounded-xl border border-line bg-panel2/60 p-3">
          <div className="flex items-center gap-2">
            <Icon name={TOPO_STYLE[active.kind].icon} size={14} className={TOPO_STYLE[active.kind].tone} />
            <span className="text-[13px] font-semibold text-ink">{active.label}</span>
            <span className="chip chip-neutral">{active.kind}</span>
            {active.link && <span className="chip chip-neutral">{active.link}</span>}
            {typeof active.clients === 'number' && <span className="chip chip-neutral">{active.clients} devices</span>}
          </div>
          {active.detail && <p className="mt-1 text-[12px] text-dim">{active.detail}</p>}
          {active.devices?.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {active.devices.slice(0, 24).map((device) => (
                <span key={device.id} className="chip chip-neutral gap-1" title={`${device.ip ?? ''} ${device.mac ?? ''}`}>
                  <Icon name="Circle" size={7} />
                  {device.name}
                  {device.vendor ? <span className="text-faint">· {device.vendor}</span> : null}
                </span>
              ))}
              {active.devices.length > 24 && <span className="chip chip-neutral">+{active.devices.length - 24} more</span>}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};
