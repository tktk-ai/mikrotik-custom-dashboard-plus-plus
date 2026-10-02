import React, { useMemo, useState } from 'react';
import clsx from 'clsx';
import type { EndpointDef, FieldDef, Row } from '@shared/types';
import { editableFields, prettify } from '@shared/types';
import { Badge, Button, Field as FieldWrap, Icon, Segmented, Toggle } from './ui';

/** Schema-driven create/edit form with a raw-JSON escape hatch. */

export interface RecordFormProps {
  endpoint: EndpointDef;
  initial?: Row;
  mode: 'create' | 'edit';
  onSubmit: (values: Row) => Promise<void> | void;
  onCancel: () => void;
  submitting?: boolean;
}

const isBlank = (v: unknown) => v === undefined || v === null || v === '';

export const RecordForm: React.FC<RecordFormProps> = ({ endpoint, initial, mode, onSubmit, onCancel, submitting }) => {
  const fields = useMemo(() => {
    const declared = editableFields(endpoint);
    if (declared.length || !initial) return declared;
    // No schema: derive from the existing record so edits still work.
    return Object.keys(initial)
      .filter((k) => k !== '.id' && k !== 'dynamic' && k !== 'invalid' && typeof initial[k] !== 'object')
      .map<FieldDef>((k) => ({ name: k, label: prettify(k), type: typeof initial[k] === 'boolean' ? 'boolean' : 'string' }));
  }, [endpoint, initial]);

  const [values, setValues] = useState<Row>(() => {
    const v: Row = {};
    for (const f of fields) {
      const raw = initial?.[f.name];
      if (f.type === 'boolean') v[f.name] = raw === true || raw === 'true';
      else if (raw === undefined && f.default !== undefined) v[f.name] = f.default;
      else v[f.name] = raw ?? '';
    }
    return v;
  });
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [mode2, setMode2] = useState<'form' | 'raw'>('form');
  const [raw, setRaw] = useState(() => JSON.stringify(clean(initial ?? {}, fields), null, 2));
  const [error, setError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);

  const main = fields.filter((f) => !f.advanced);
  const extra = fields.filter((f) => f.advanced);
  const set = (name: string, value: unknown) => setValues((v) => ({ ...v, [name]: value }));

  const submit = async () => {
    setError(null);
    if (mode2 === 'raw') {
      try {
        const parsed = JSON.parse(raw || '{}');
        await onSubmit(parsed);
      } catch (err) {
        setError(`Invalid JSON: ${(err as Error).message}`);
      }
      return;
    }
    const missing = fields.filter((f) => f.required && isBlank(values[f.name]));
    if (missing.length) {
      setError(`Required: ${missing.map((f) => f.label ?? f.name).join(', ')}`);
      setTouched(Object.fromEntries(missing.map((f) => [f.name, true])));
      return;
    }
    const payload: Row = {};
    for (const f of fields) {
      const value = values[f.name];
      if (mode === 'edit') {
        const original = initial?.[f.name];
        const same = f.type === 'boolean' ? (original === true || original === 'true') === value : String(original ?? '') === String(value ?? '');
        if (same) continue;
      }
      if (isBlank(value) && !f.required) continue;
      payload[f.name] = coerce(value, f);
    }
    if (mode === 'edit' && Object.keys(payload).length === 0) {
      setError('Nothing changed.');
      return;
    }
    await onSubmit(payload);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[12px] text-faint">
          <Icon name="Info" size={13} />
          {mode === 'create' ? 'Empty fields are omitted from the request.' : 'Only changed properties are sent (PATCH).'}
        </div>
        <Segmented
          value={mode2}
          onChange={(v) => setMode2(v as 'form' | 'raw')}
          options={[{ value: 'form', label: 'Form', icon: 'ListTree' }, { value: 'raw', label: 'Raw JSON', icon: 'Braces' }]}
        />
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-[12px] text-bad">
          <Icon name="AlertTriangle" size={14} className="mt-0.5" />{error}
        </div>
      )}

      {mode2 === 'raw' ? (
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          spellCheck={false}
          className="mono h-72 w-full resize-y rounded-lg border border-line bg-base2/70 p-3 text-[12px] text-ink focus:border-brand/60 focus:outline-none"
        />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2">
            {main.map((f) => (
              <FieldInput key={f.name} field={f} value={values[f.name]} onChange={(v) => { set(f.name, v); setTouched((t) => ({ ...t, [f.name]: true })); }} invalid={Boolean(touched[f.name] && f.required && isBlank(values[f.name]))} />
            ))}
          </div>
          {extra.length > 0 && (
            <div className="rounded-lg border border-line/70 bg-panel2/40">
              <button type="button" onClick={() => setAdvanced((a) => !a)} className="flex w-full items-center gap-2 px-3 py-2 text-[12px] font-medium text-dim hover:text-ink">
                <Icon name={advanced ? 'ChevronDown' : 'ChevronRight'} size={14} />
                Advanced properties
                <Badge tone="neutral" className="ml-auto">{extra.length}</Badge>
              </button>
              {advanced && (
                <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 border-t border-line/70 p-3 sm:grid-cols-2">
                  {extra.map((f) => (
                    <FieldInput key={f.name} field={f} value={values[f.name]} onChange={(v) => set(f.name, v)} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
        <Button variant="ghost" onClick={onCancel} disabled={submitting}>Cancel</Button>
        <Button variant="primary" icon={mode === 'create' ? 'Plus' : 'Save'} onClick={submit} loading={submitting}>
          {mode === 'create' ? 'Create entry' : 'Save changes'}
        </Button>
      </div>
    </div>
  );
};

const coerce = (value: unknown, f: FieldDef): unknown => {
  if (f.type === 'boolean') return value === true || value === 'true';
  if (f.type === 'number') {
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  }
  if (f.type === 'json') {
    try { return JSON.parse(String(value)); } catch { return value; }
  }
  return value;
};

function clean(row: Row, fields: FieldDef[]): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === '.id' || k === 'dynamic' || k === 'invalid' || v === undefined) continue;
    const f = fields.find((x) => x.name === k);
    if (f?.type === 'readonly' || f?.immutable) continue;
    if (typeof v === 'object') continue;
    out[k] = v;
  }
  return out;
}

const FieldInput: React.FC<{ field: FieldDef; value: unknown; onChange: (v: unknown) => void; invalid?: boolean }> = ({ field, value, onChange, invalid }) => {
  const label = field.label ?? prettify(field.name);
  const common = clsx('input', invalid && 'border-bad/70');
  const hint = field.help;

  if (field.type === 'boolean') {
    return (
      <div className="flex flex-col justify-end pb-1">
        <span className="mb-1.5 text-[11.5px] font-medium text-dim">{label}</span>
        <Toggle checked={value === true} onChange={onChange} label={value === true ? (field.boolLabels?.[0] ?? 'yes') : (field.boolLabels?.[1] ?? 'no')} />
        {hint && <span className="mt-1 text-[11px] text-faint">{hint}</span>}
      </div>
    );
  }

  if (field.type === 'enum' || (field.values && field.values.length)) {
    const values = field.values ?? [];
    const isMulti = field.name.match(/topics|ciphers|algorithms|types|protocols|interface|interfaces|addresses|family/i) && String(value ?? '').includes(',');
    return (
      <FieldWrap label={label} hint={hint} required={field.required}>
        {isMulti ? (
          <input className={common} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} placeholder={values.slice(0, 3).join(',')} />
        ) : (
          <select className={common} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
            <option value="">—</option>
            {values.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        )}
      </FieldWrap>
    );
  }

  if (field.type === 'text' || field.type === 'json') {
    return (
      <FieldWrap className="sm:col-span-2" label={label} hint={hint} required={field.required}>
        <textarea className={clsx(common, 'mono h-24 resize-y')} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} spellCheck={false} />
      </FieldWrap>
    );
  }

  return (
    <FieldWrap label={label + (field.unit ? ` (${field.unit})` : '')} hint={hint} required={field.required}>
      <input
        className={clsx(common, field.mono && 'mono')}
        type={field.type === 'number' ? 'number' : field.type === 'password' ? 'password' : 'text'}
        value={String(value ?? '')}
        placeholder={field.placeholder ?? (field.type === 'cidr' ? '192.168.88.0/24' : field.type === 'ip' ? '192.168.88.1' : field.type === 'mac' ? '74:4D:28:00:00:01' : field.type === 'duration' ? '10m' : undefined)}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
      />
    </FieldWrap>
  );
};
