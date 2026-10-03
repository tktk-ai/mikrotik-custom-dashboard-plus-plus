import React, { useState } from 'react';
import clsx from 'clsx';
import type { Row } from '@shared/types';
import { Badge, Button, CopyButton, EmptyState } from './ui';

/** Pretty JSON / table renderer for command output. */

export const JsonView: React.FC<{ data: unknown; className?: string; maxHeight?: string }> = ({ data, className, maxHeight = '26rem' }) => (
  <pre className={clsx('mono overflow-auto rounded-lg border border-line bg-base2/70 p-3 text-[11.5px] leading-relaxed text-dim', className)} style={{ maxHeight }}>
    {JSON.stringify(data, null, 2)}
  </pre>
);

export const ResultView: React.FC<{ rows: Row[]; raw?: string; ms?: number; title?: string; onClear?: () => void }> = ({ rows, raw, ms, title = 'Result', onClear }) => {
  const [mode, setMode] = useState<'table' | 'json'>('table');
  const isEmpty = (!rows || rows.length === 0) && !raw;
  const columns = rows?.length ? Array.from(new Set(rows.flatMap((r) => Object.keys(r)).filter((k) => k !== '.id'))) : [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="accent">{title}</Badge>
        {ms !== undefined && <Badge tone="neutral">{ms} ms</Badge>}
        {!isEmpty && <Badge tone="good">{rows?.length ?? 0} row{(rows?.length ?? 0) === 1 ? '' : 's'}</Badge>}
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant={mode === 'table' ? 'default' : 'ghost'} icon="Table2" onClick={() => setMode('table')}>Table</Button>
          <Button size="sm" variant={mode === 'json' ? 'default' : 'ghost'} icon="Braces" onClick={() => setMode('json')}>JSON</Button>
          <CopyButton value={raw ?? JSON.stringify(rows, null, 2)} label="Copy" />
          {onClear && <Button size="sm" variant="ghost" icon="X" onClick={onClear}>Clear</Button>}
        </div>
      </div>

      {isEmpty ? (
        <EmptyState icon="TerminalSquare" title="No output yet" hint="Run the command to see results here. Responses are rendered as a table and raw JSON." />
      ) : mode === 'json' || raw ? (
        <pre className="mono max-h-[30rem] overflow-auto rounded-lg border border-line bg-base2/70 p-3 text-[11.5px] leading-relaxed whitespace-pre-wrap text-dim">
          {raw ?? JSON.stringify(rows, null, 2)}
        </pre>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-left text-[12px]">
            <thead className="bg-panel2 text-[11px] uppercase tracking-wide text-faint">
              <tr>{columns.map((c) => <th key={c} className="px-3 py-2 font-semibold">{c}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="row-hover border-t border-line/60">
                  {columns.map((c) => (
                    <td key={c} className="px-3 py-1.5 align-top text-dim">
                      {typeof row[c] === 'boolean' ? (row[c] ? 'yes' : 'no') : typeof row[c] === 'object' ? JSON.stringify(row[c]) : String(row[c] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
