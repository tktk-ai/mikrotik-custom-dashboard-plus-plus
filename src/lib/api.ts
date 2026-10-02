/** Typed client for the dashboard's own HTTP API. */

import type { Row } from '@shared/types';

export interface ApiFailure {
  kind: string;
  message: string;
  hint?: string;
  detail?: unknown;
  status?: number;
}

export class ApiError extends Error implements ApiFailure {
  kind: string;
  hint?: string;
  detail?: unknown;
  status?: number;
  constructor(f: ApiFailure) {
    super(f.message);
    this.kind = f.kind;
    this.hint = f.hint;
    this.detail = f.detail;
    this.status = f.status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch (err) {
    throw new ApiError({ kind: 'network', message: (err as Error).message || 'Network request failed' });
  }
  const text = await res.text();
  let payload: any = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
  if (!res.ok) {
    const err = payload?.error ?? {};
    throw new ApiError({
      kind: err.kind ?? (res.status === 502 ? 'network' : 'device'),
      message: err.message ?? `Request failed (${res.status})`,
      hint: err.hint,
      detail: err.detail,
      status: res.status,
    });
  }
  return (payload?.data ?? payload) as T;
}

export interface RosResult<T = Row[]> {
  rows: T;
  ms: number;
  mode: 'demo' | 'live';
  raw?: string;
}

export interface ConnectionInfo extends Row {
  id: string;
  name: string;
  host: string;
  port: number;
  scheme: 'https' | 'http';
  username: string;
  tlsVerify: boolean;
  demo?: boolean;
  note?: string;
  lastSeen?: number;
  hasPassword?: boolean;
}

export interface Capability { ok: boolean; error?: string; kind?: string; ms?: number; rows?: number }

export interface Capabilities {
  mode: 'demo' | 'live';
  connectionId: string | null;
  connectionName: string | null;
  host: string | null;
  device: Row;
  probedAt: number;
  probing: boolean;
  endpoints: Record<string, Capability>;
  summary: { supported: number; unsupported: number; failed: number };
}

export interface TestResult { ok: boolean; latencyMs?: number; identity?: string; board?: string; note?: string; error?: string; kind?: string; hint?: string; detail?: string }

const buildQuery = (params?: Record<string, string | number | boolean | undefined>) => {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '') continue;
    search.append(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
};

export const api = {
  health: () => request<{ ok: boolean; mode: string; connection: ConnectionInfo | null; endpoints: number }>('/api/health'),

  listConnections: () => request<{ connections: ConnectionInfo[]; activeId: string | null }>('/api/connections'),
  createConnection: (body: Partial<ConnectionInfo> & { test?: boolean }) =>
    request<{ connection: ConnectionInfo; test: TestResult | null }>('/api/connections', { method: 'POST', body: JSON.stringify(body) }),
  updateConnection: (id: string, body: Partial<ConnectionInfo>) =>
    request<ConnectionInfo>(`/api/connections/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  removeConnection: (id: string) => request<{ removed: boolean }>(`/api/connections/${id}`, { method: 'DELETE' }),
  activateConnection: (id: string) => request<ConnectionInfo>(`/api/connections/${id}/activate`, { method: 'POST' }),
  testConnection: (id: string) => request<TestResult>(`/api/connections/${id}/test`, { method: 'POST' }),

  capabilities: () => request<Capabilities>('/api/capabilities'),
  refreshCapabilities: () => request<Capabilities>('/api/capabilities/refresh', { method: 'POST' }),

  dashboard: () => request<Row>('/api/dashboard'),

  list: <T = Row[]>(path: string, params?: Record<string, string | number | boolean | undefined>) =>
    request<RosResult<T>>(`/api/ros/${path}${buildQuery(params)}`),
  create: (path: string, body: Row) => request<RosResult>(`/api/ros/${path}`, { method: 'POST', body: JSON.stringify(body) }),
  update: (path: string, body: Row) => request<RosResult>(`/api/ros/${path}`, { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (path: string, body: Row) => request<RosResult>(`/api/ros/${path}`, { method: 'DELETE', body: JSON.stringify(body) }),
  command: (path: string, body: Row) => request<RosResult>(`/api/ros/${path}`, { method: 'POST', body: JSON.stringify(body) }),

  console: (script: string) => request<RosResult>(`/api/console`, { method: 'POST', body: JSON.stringify({ script }) }),
  resetDemo: () => request<{ reset: boolean }>('/api/demo/reset', { method: 'POST' }),
};

/** Server-sent metrics stream (demo device). Falls back silently when unavailable. */
export function subscribeMetrics(onMetrics: (data: Row) => void, onStatus?: (live: boolean) => void): () => void {
  let es: EventSource | null = null;
  try {
    es = new EventSource('/api/stream');
    es.addEventListener('metrics', (ev) => {
      try { onMetrics(JSON.parse((ev as MessageEvent).data)); onStatus?.(true); } catch { /* ignore */ }
    });
    es.onerror = () => onStatus?.(false);
  } catch {
    onStatus?.(false);
  }
  return () => es?.close();
}
