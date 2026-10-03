/**
 * Shared type surface for the RouterOS control plane.
 *
 * The whole application — server-side demo engine, endpoint probing, navigation,
 * tables, forms and command runners — is driven by these definitions.
 */

export type FieldType =
  | 'string'
  | 'text'
  | 'number'
  | 'boolean'
  | 'enum'
  | 'ip'
  | 'cidr'
  | 'mac'
  | 'duration'
  | 'bytes'
  | 'password'
  | 'date'
  | 'time'
  | 'json'
  | 'readonly';

export type Tone = 'success' | 'danger' | 'warning' | 'info' | 'neutral' | 'accent';

export interface FieldDef {
  /** RouterOS property name, e.g. `chain`. */
  name: string;
  /** Human label; falls back to a prettified property name. */
  label?: string;
  type: FieldType;
  /** Options for `enum` fields. */
  values?: string[];
  /** Per-value badge tones for enums. */
  tones?: Record<string, Tone>;
  help?: string;
  required?: boolean;
  /** Collapsed under "Advanced" in forms. */
  advanced?: boolean;
  default?: unknown;
  unit?: string;
  mono?: boolean;
  /** Show as a column in the default table view. */
  key?: boolean;
  /** Main identifying property (row title, links, search weighting). */
  primary?: boolean;
  /** Boolean badge tone. */
  tone?: Tone;
  /** Custom labels for booleans, e.g. ["running", "stopped"]. */
  boolLabels?: [string, string];
  min?: number;
  max?: number;
  placeholder?: string;
  /** Read-only in forms (still shown). */
  immutable?: boolean;
  /** Column width hint. */
  width?: 'xs' | 'sm' | 'md' | 'lg';
}

/** Where a command gets its target from the selected row. */
export type CommandTarget = 'id' | 'name' | 'interface' | 'numbers' | 'none' | (string & {});

export interface ParamDef {
  name: string;
  label?: string;
  type: FieldType;
  values?: string[];
  default?: unknown;
  required?: boolean;
  help?: string;
  placeholder?: string;
}

export interface CommandDef {
  id: string;
  label: string;
  icon?: string;
  /** Appended to the endpoint path; empty string posts to the endpoint itself. */
  path?: string;
  target?: CommandTarget;
  /** Literal fields merged into the request body. */
  body?: Record<string, unknown>;
  danger?: boolean;
  confirm?: string;
  /** Runtime parameters collected by a form before the call (tool endpoints). */
  params?: ParamDef[];
  response?: 'json' | 'text' | 'none';
  /** Non-command helper flags. */
  bulk?: boolean;
}

export type EndpointKind = 'list' | 'singleton' | 'command';

/** Availability hint — used to badge optional menus and to group the explorer. */
export type Availability = 'core' | 'v7' | 'v7.13' | 'v7.14' | 'v7.16' | 'optional';

export interface EndpointDef {
  /** RouterOS menu path without leading slash, e.g. `ip/firewall/filter`. */
  path: string;
  label: string;
  category: CategoryId;
  /** Tab / section inside a module. */
  group?: string;
  kind?: EndpointKind;
  icon?: string;
  description?: string;
  fields?: FieldDef[];
  /** Default table columns (property names). */
  columns?: string[];
  /** Extra properties used by client-side search. */
  searchKeys?: string[];
  readOnly?: boolean;
  noCreate?: boolean;
  noEdit?: boolean;
  noDelete?: boolean;
  /** Endpoint is an ordered list — enables move up/down actions. */
  ordered?: boolean;
  commands?: CommandDef[];
  availability?: Availability;
  /** Rendered in the sidebar module list. */
  key?: boolean;
  /** Hide from navigation (still reachable from explorer/search). */
  hidden?: boolean;
  tags?: string[];
  /** Fields recomputed on every read (live counters). */
  live?: string[];
  /** Suggested page size / demo row count. */
  demoRows?: number;
  /** RouterOS requires these to be set together. */
  note?: string;
}

export interface CategoryDef {
  id: CategoryId;
  label: string;
  icon: string;
  accent: string;
  order: number;
  description?: string;
}

export type CategoryId =
  | 'overview'
  | 'interfaces'
  | 'ip'
  | 'ipv6'
  | 'firewall'
  | 'routing'
  | 'queues'
  | 'wireless'
  | 'ppp'
  | 'vpn'
  | 'hotspot'
  | 'radius'
  | 'usermanager'
  | 'system'
  | 'tools'
  | 'containers'
  | 'iot'
  | 'mpls';

export type Row = Record<string, any>;

export const isTrue = (v: unknown): boolean =>
  v === true || v === 'true' || v === 'yes' || v === 'enabled';

export const prettify = (name: string): string =>
  name
    .replace(/^\./, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

/* ------------------------------------------------------------------ *
 * Small DSL helpers used by the catalog files
 * ------------------------------------------------------------------ */

export const F = (name: string, type: FieldType, extra: Partial<FieldDef> = {}): FieldDef => ({
  name,
  type,
  ...extra,
});

export const S = (name: string, extra: Partial<FieldDef> = {}) => F(name, 'string', extra);
export const T = (name: string, extra: Partial<FieldDef> = {}) => F(name, 'text', extra);
export const N = (name: string, extra: Partial<FieldDef> = {}) => F(name, 'number', extra);
export const B = (name: string, extra: Partial<FieldDef> = {}) =>
  F(name, 'boolean', { tone: 'success', boolLabels: ['yes', 'no'], ...extra });
export const E = (name: string, values: string[], extra: Partial<FieldDef> = {}) =>
  F(name, 'enum', { values, ...extra });
export const I = (name: string, extra: Partial<FieldDef> = {}) => F(name, 'ip', { mono: true, ...extra });
export const C = (name: string, extra: Partial<FieldDef> = {}) => F(name, 'cidr', { mono: true, ...extra });
export const D = (name: string, extra: Partial<FieldDef> = {}) => F(name, 'duration', { mono: true, ...extra });
export const BY = (name: string, extra: Partial<FieldDef> = {}) => F(name, 'bytes', { mono: true, ...extra });

/** Common RouterOS columns. */
export const DISABLED = B('disabled', { label: 'Disabled', key: true, tone: 'neutral', boolLabels: ['disabled', 'enabled'] });
export const COMMENT = S('comment', { label: 'Comment', key: true, width: 'lg' });
export const NAME = S('name', { label: 'Name', required: true, primary: true, key: true, mono: true });
export const DYN = { name: 'dynamic', type: 'readonly' as FieldType, label: 'Dynamic', key: true, tone: 'info' as Tone };
export const INVALID = { name: 'invalid', type: 'readonly' as FieldType, label: 'Invalid', tone: 'warning' as Tone };
export const ID_FIELD: FieldDef = { name: '.id', type: 'readonly', label: 'ID', mono: true, width: 'xs' };

export const ENABLE_DISABLE: CommandDef[] = [
  { id: 'enable', label: 'Enable', icon: 'Power', path: 'enable', target: 'id' },
  { id: 'disable', label: 'Disable', icon: 'PowerOff', path: 'disable', target: 'id' },
];

/** Standard actions available on ordered rule lists (firewall, queues, ...). */
export const ORDERED: CommandDef[] = [
  { id: 'move-up', label: 'Move up', icon: 'ArrowUp', path: 'move', target: 'id', bulk: false, body: { destination: '${prev}' } },
  { id: 'move-down', label: 'Move down', icon: 'ArrowDown', path: 'move', target: 'id', bulk: false, body: { destination: '${next}' } },
];

export const endpointIndex = (endpoints: EndpointDef[]): Map<string, EndpointDef> => {
  const map = new Map<string, EndpointDef>();
  for (const e of endpoints) map.set(e.path, e);
  return map;
};

/** Ordered field list used to render tables. */
export const tableFields = (ep: EndpointDef): FieldDef[] => {
  const fields = ep.fields ?? [];
  if (ep.columns?.length) {
    return ep.columns
      .map((c) => fields.find((f) => f.name === c) ?? { name: c, type: 'string' as FieldType })
      .filter(Boolean);
  }
  const keys = fields.filter((f) => f.key);
  return keys.length ? keys : fields.slice(0, 6);
};

/** Fields a user may edit (create or update). */
export const editableFields = (ep: EndpointDef): FieldDef[] =>
  (ep.fields ?? []).filter((f) => f.type !== 'readonly' && !f.immutable);
