import React, { useMemo, useState } from 'react';
import clsx from 'clsx';
import type { Row } from '@shared/types';
import { Icon, TableSkeleton } from './ui';

export interface ColumnDef<T = Row> {
  key: string;
  label: string;
  width?: string;
  align?: 'left' | 'right';
  sortable?: boolean;
  value?: (row: T) => unknown;
  render?: (row: T) => React.ReactNode;
  className?: string;
}

interface Props<T extends Row> {
  rows: T[];
  columns: Array<ColumnDef<T>>;
  loading?: boolean;
  rowKey?: (row: T, index: number) => string;
  selectable?: boolean;
  selected?: string[];
  onSelectedChange?: (ids: string[]) => void;
  onRowClick?: (row: T) => void;
  emptyState?: React.ReactNode;
  toolbar?: React.ReactNode;
  pageSize?: number;
  dense?: boolean;
  highlight?: string;
  stickyHeader?: boolean;
  footerNote?: React.ReactNode;
  className?: string;
}

export function DataTable<T extends Row>({
  rows, columns, loading, rowKey = (r, i) => String(r['.id'] ?? r.name ?? i), selectable,
  selected = [], onSelectedChange, onRowClick, emptyState, toolbar, pageSize = 25, dense, highlight,
  stickyHeader = true, footerNote, className,
}: Props<T>) {
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    const get = (row: T) => (col?.value ? col.value(row) : row[sort.key]);
    return [...rows].sort((a, b) => {
      const va = get(a); const vb = get(b);
      const na = typeof va === 'number' ? va : parseFloat(String(va ?? '').replace(/[^\d.\-]/g, ''));
      const nb = typeof vb === 'number' ? vb : parseFloat(String(vb ?? '').replace(/[^\d.\-]/g, ''));
      let cmp: number;
      if (Number.isFinite(na) && Number.isFinite(nb) && String(va ?? '').trim() !== '' && String(vb ?? '').trim() !== '') cmp = na - nb;
      else cmp = String(va ?? '').localeCompare(String(vb ?? ''), undefined, { numeric: true });
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [rows, sort, columns]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = sorted.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const keys = pageRows.map((r, i) => rowKey(r, safePage * pageSize + i));
  const allSelected = keys.length > 0 && keys.every((k) => selected.includes(k));

  const toggleAll = () => {
    if (!onSelectedChange) return;
    onSelectedChange(allSelected ? selected.filter((s) => !keys.includes(s)) : Array.from(new Set([...selected, ...keys])));
  };

  const toggleOne = (key: string) => {
    if (!onSelectedChange) return;
    onSelectedChange(selected.includes(key) ? selected.filter((s) => s !== key) : [...selected, key]);
  };

  return (
    <div className={clsx('flex min-w-0 flex-col', className)}>
      {toolbar && <div className="flex flex-wrap items-center gap-2 border-b border-line/70 px-3 py-2.5">{toolbar}</div>}
      <div className="min-w-0 flex-1 overflow-x-auto">
        {loading ? (
          <TableSkeleton cols={columns.length} />
        ) : rows.length === 0 ? (
          emptyState ?? <div className="p-8 text-center text-[12.5px] text-faint">No entries.</div>
        ) : (
          <table className="w-full min-w-full border-collapse text-left text-[12.5px]">
            <thead className={clsx('z-10 bg-panel2/95 text-[11px] uppercase tracking-wide text-faint backdrop-blur', stickyHeader && 'sticky top-0')}>
              <tr>
                {selectable && (
                  <th className="w-9 px-3 py-2">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} className="size-3.5 accent-cyan-400" aria-label="Select all" />
                  </th>
                )}
                {columns.map((c) => (
                  <th key={c.key} style={{ width: c.width }} className={clsx('whitespace-nowrap px-3 py-2 font-semibold', c.align === 'right' && 'text-right')}>
                    {c.sortable === false ? c.label : (
                      <button
                        className="inline-flex items-center gap-1 hover:text-dim"
                        onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: 'asc' }))}
                      >
                        {c.label}
                        {sort?.key === c.key
                          ? <Icon name={sort.dir === 'asc' ? 'ChevronUp' : 'ChevronDown'} size={12} className="text-brand" />
                          : <Icon name="ChevronsUpDown" size={11} className="opacity-30" />}
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row, i) => {
                const key = keys[i];
                const isSelected = selected.includes(key);
                return (
                  <tr
                    key={key}
                    onClick={() => onRowClick?.(row)}
                    className={clsx('border-b border-line/40 transition-colors', onRowClick && 'cursor-pointer', isSelected ? 'bg-brand/5' : 'hover:bg-panel2/70')}
                  >
                    {selectable && (
                      <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={isSelected} onChange={() => toggleOne(key)} className="size-3.5 accent-cyan-400" aria-label={`Select ${key}`} />
                      </td>
                    )}
                    {columns.map((c) => (
                      <td key={c.key} className={clsx('max-w-[22rem] truncate px-3 align-middle', dense ? 'py-1' : 'py-1.5', c.align === 'right' && 'text-right', c.className)}>
                        {c.render ? c.render(row) : highlight ? <HighlightText text={String(row[c.key] ?? '')} query={highlight} /> : String(row[c.key] ?? '')}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/70 px-3 py-2 text-[11.5px] text-faint">
        <div className="flex items-center gap-3">
          <span>
            {sorted.length === 0 ? '0' : `${safePage * pageSize + 1}–${Math.min(sorted.length, (safePage + 1) * pageSize)}`} of {sorted.length}
          </span>
          {selected.length > 0 && <span className="text-brand">{selected.length} selected</span>}
          {footerNote}
        </div>
        {pageCount > 1 && (
          <div className="flex items-center gap-1.5">
            <button className="btn btn-sm btn-ghost" disabled={safePage === 0} onClick={() => setPage(0)}><Icon name="ChevronsLeft" size={13} /></button>
            <button className="btn btn-sm btn-ghost" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}><Icon name="ChevronLeft" size={13} /></button>
            <span className="px-1 tabular-nums">{safePage + 1} / {pageCount}</span>
            <button className="btn btn-sm btn-ghost" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}><Icon name="ChevronRight" size={13} /></button>
            <button className="btn btn-sm btn-ghost" disabled={safePage >= pageCount - 1} onClick={() => setPage(pageCount - 1)}><Icon name="ChevronsRight" size={13} /></button>
          </div>
        )}
      </div>
    </div>
  );
}

export const HighlightText: React.FC<{ text: string; query?: string }> = ({ text, query }) => {
  if (!query?.trim()) return <>{text}</>;
  const q = query.trim().toLowerCase();
  const idx = text.toLowerCase().indexOf(q);
  if (idx < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded bg-brand/25 px-0.5 text-ink">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
};
