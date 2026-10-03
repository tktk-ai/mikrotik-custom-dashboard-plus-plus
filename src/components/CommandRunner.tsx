import React, { useMemo, useState } from 'react';
import clsx from 'clsx';
import type { CommandDef, EndpointDef, Row } from '@shared/types';
import { prettify } from '@shared/types';
import { api } from '../lib/api';
import { Badge, Button, Field, Icon, Modal, Toggle, toast } from './ui';
import { ResultView } from './JsonView';

/** Runs RouterOS commands (POST /rest/<menu>/<command>) with a parameter form. */

export const targetValueFor = (cmd: CommandDef, row?: Row): Row => {
  if (!row || !cmd.target || cmd.target === 'none') return {};
  const key = cmd.target === 'numbers' ? 'numbers' : cmd.target === 'interface' ? 'interface' : cmd.target;
  const value = row[key] ?? row['.id'] ?? row.name;
  return { [key]: value };
};

interface Props {
  endpoint: EndpointDef;
  command: CommandDef | null;
  row?: Row;
  onClose: () => void;
  onDone?: (result: any) => void;
}

export const CommandModal: React.FC<Props> = ({ endpoint, command, row, onClose, onDone }) => {
  const params = command?.params ?? [];
  const [values, setValues] = useState<Row>(() => {
    const init: Row = {};
    for (const p of params) if (p.default !== undefined) init[p.name] = p.default;
    return init;
  });
  const [body, setBody] = useState<Row>(() => ({ ...(command?.body ?? {}), ...(command ? targetValueFor(command, row) : {}) }));
  const [showBody, setShowBody] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ rows: Row[]; raw?: string; ms?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const path = `${endpoint.path}${command?.path ? `/${command.path}` : ''}`;

  const preview = useMemo(() => {
    const merged: Row = { ...body };
    for (const p of params) {
      const v = values[p.name];
      if (v === undefined || v === '' || v === null) continue;
      merged[p.name] = p.type === 'boolean' ? v === true || v === 'true' : p.type === 'number' ? Number(v) : v;
    }
    return merged;
  }, [body, params, values]);

  const run = async () => {
    setError(null);
    const missing = params.filter((p) => p.required && (values[p.name] === undefined || values[p.name] === ''));
    if (missing.length) {
      setError(`Required: ${missing.map((m) => m.label ?? m.name).join(', ')}`);
      return;
    }
    setRunning(true);
    try {
      const res = await api.command(path, preview);
      setResult({ rows: res.rows, raw: res.raw, ms: res.ms });
      toast.success(`${command?.label ?? 'Command'} executed`, res.raw ? undefined : `${res.rows.length} row${res.rows.length === 1 ? '' : 's'} returned in ${res.ms} ms`);
      onDone?.(res);
    } catch (err: any) {
      setError(err?.message ?? 'Command failed');
      toast.error('Command failed', err?.message, err?.hint);
    } finally {
      setRunning(false);
    }
  };

  const commandId = command?.id ?? 'command';

  return (
    <Modal
      open={Boolean(command)}
      onClose={onClose}
      wide
      title={command?.label ?? 'Run command'}
      subtitle={<span className="mono">POST /rest/{path}</span>}
      footer={
        <>
          <span className="mr-auto flex items-center gap-2 text-[11.5px] text-faint">
            <Icon name="Radio" size={13} className="text-brand" />
            Source: <span className="mono lowercase">{JSON.stringify(preview)}</span>
          </span>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button variant="primary" icon={command?.danger ? 'AlertTriangle' : 'Play'} loading={running} onClick={run}>Run</Button>
        </>
      }
    >
      <div className="space-y-4">
        {command?.danger && (
          <div className="flex items-start gap-2 rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-[12px] text-bad">
            <Icon name="AlertTriangle" size={14} className="mt-0.5" />
            <div>
              <div className="font-semibold">{command.confirm ?? 'This action changes device state.'}</div>
              <div className="text-[11.5px] opacity-80">The command runs immediately on the router when you press Run.</div>
            </div>
          </div>
        )}

        {row && command?.target && command.target !== 'none' && (
          <div className="flex items-center gap-2 rounded-lg border border-line bg-panel2/60 px-3 py-2 text-[12px] text-dim">
            <Icon name="Crosshair" size={14} className="text-brand" />
            Target: <span className="mono">{JSON.stringify(targetValueFor(command, row))}</span>
          </div>
        )}

        {params.length > 0 && (
          <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2">
            {params.map((p) => (
              <Field key={p.name} label={p.label ?? prettify(p.name)} required={p.required} hint={p.help}>
                {p.type === 'boolean' ? (
                  <Toggle checked={values[p.name] === true || values[p.name] === 'true'} onChange={(v) => setValues((s) => ({ ...s, [p.name]: v }))} label={values[p.name] === true ? 'yes' : 'no'} />
                ) : p.type === 'enum' ? (
                  <select className="input" value={String(values[p.name] ?? '')} onChange={(e) => setValues((s) => ({ ...s, [p.name]: e.target.value }))}>
                    {p.values?.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                ) : p.type === 'text' ? (
                  <textarea className="input mono h-20" value={String(values[p.name] ?? '')} placeholder={p.placeholder} onChange={(e) => setValues((s) => ({ ...s, [p.name]: e.target.value }))} />
                ) : (
                  <input
                    className={clsx('input', p.type === 'ip' || p.type === 'cidr' ? 'mono' : '')}
                    type={p.type === 'number' ? 'number' : p.type === 'password' ? 'password' : 'text'}
                    value={String(values[p.name] ?? '')}
                    placeholder={p.placeholder}
                    onChange={(e) => setValues((s) => ({ ...s, [p.name]: e.target.value }))}
                  />
                )}
              </Field>
            ))}
          </div>
        )}

        <div>
          <button className="flex items-center gap-2 text-[12px] text-dim hover:text-ink" onClick={() => setShowBody((s) => !s)}>
            <Icon name={showBody ? 'ChevronDown' : 'ChevronRight'} size={14} />
            Request body preview
            <Badge tone="neutral">{Object.keys(preview).length} properties</Badge>
          </button>
          {showBody && <pre className="mono mt-2 overflow-auto rounded-lg border border-line bg-base2/70 p-3 text-[11.5px] text-dim">{JSON.stringify(preview, null, 2)}</pre>}
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-[12px] text-bad">
            <Icon name="AlertTriangle" size={14} className="mt-0.5" />{error}
          </div>
        )}

        {result && <ResultView rows={result.rows} raw={result.raw} ms={result.ms} title={`${commandId} result`} onClear={() => setResult(null)} />}
      </div>
    </Modal>
  );
};
