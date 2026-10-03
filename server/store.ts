import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Row } from '../shared/types';

/** Connection profiles (persisted to data/connections.json) plus the demo connection. */

export interface Connection extends Row {
  id: string;
  name: string;
  host: string;
  port: number;
  scheme: 'https' | 'http';
  username: string;
  password: string;
  tlsVerify: boolean;
  demo?: boolean;
  createdAt: number;
  lastSeen?: number;
  note?: string;
}

const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'connections.json');

interface Persisted { connections: Connection[]; activeId: string | null }

const DEMO: Connection = {
  id: 'demo',
  name: 'Demo lab (CCR2004 — simulated)',
  host: 'demo.routeros.local',
  port: 443,
  scheme: 'https',
  username: 'dashboard',
  password: '',
  tlsVerify: false,
  demo: true,
  createdAt: Date.now(),
  note: 'Fully simulated RouterOS 7.16 device used for previewing every screen.',
};

let state: Persisted = { connections: [DEMO], activeId: DEMO.id };

function load(): void {
  try {
    if (!fs.existsSync(FILE)) return;
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Persisted;
    if (Array.isArray(raw.connections) && raw.connections.length) {
      state = { connections: raw.connections, activeId: raw.activeId ?? raw.connections[0].id };
      if (!state.connections.some((c) => c.id === state.activeId)) state.activeId = state.connections[0].id;
    }
  } catch (err) {
    console.warn('[connections] could not read saved profiles:', (err as Error).message);
  }
}

function persist(): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
  } catch (err) {
    console.warn('[connections] could not save profiles:', (err as Error).message);
  }
}

load();

export const listConnections = (): Connection[] => state.connections;

/** Never leak passwords to the browser. */
export const publicConnection = (c: Connection): Row => {
  const { password, ...rest } = c;
  return { ...rest, hasPassword: Boolean(password) };
};

export const getActiveConnection = (): Connection | null =>
  state.connections.find((c) => c.id === state.activeId) ?? state.connections[0] ?? null;

export const getConnection = (id: string): Connection | undefined => state.connections.find((c) => c.id === id);

export function addConnection(input: Partial<Connection>, makeActive = true): Connection {
  const demo = input.host === 'demo.routeros.local' || input.demo === true;
  const conn: Connection = {
    id: crypto.randomBytes(6).toString('hex'),
    name: input.name?.trim() || input.host || 'RouterOS device',
    host: input.host?.trim() || '',
    port: Number(input.port) || (input.scheme === 'http' ? 80 : 443),
    scheme: input.scheme === 'http' ? 'http' : 'https',
    username: input.username?.trim() || 'admin',
    password: input.password ?? '',
    tlsVerify: input.tlsVerify ?? false,
    demo,
    createdAt: Date.now(),
    note: input.note,
  };
  // If an environment-provided target exists, prefer it for the first real profile.
  state.connections.push(conn);
  if (makeActive) state.activeId = conn.id;
  persist();
  return conn;
}

export function updateConnection(id: string, patch: Partial<Connection>): Connection | undefined {
  const conn = getConnection(id);
  if (!conn) return undefined;
  if (patch.password === '••••••••') delete patch.password; // placeholder from the UI
  Object.assign(conn, patch, { id: conn.id, createdAt: conn.createdAt });
  conn.port = Number(conn.port) || 443;
  persist();
  return conn;
}

export function removeConnection(id: string): boolean {
  const before = state.connections.length;
  state.connections = state.connections.filter((c) => c.id !== id);
  if (!state.connections.length) state.connections = [DEMO];
  if (!state.connections.some((c) => c.id === state.activeId)) state.activeId = state.connections[0].id;
  persist();
  return state.connections.length !== before;
}

export function setActiveConnection(id: string): Connection | undefined {
  const conn = getConnection(id);
  if (!conn) return undefined;
  state.activeId = id;
  persist();
  return conn;
}

export function touchConnection(id: string): void {
  const conn = getConnection(id);
  if (conn) conn.lastSeen = Date.now();
}

/** Bootstrap from environment variables (useful for containers / CI). */
export function bootstrapFromEnv(): void {
  const host = process.env.ROUTEROS_HOST;
  if (!host || state.connections.some((c) => c.host === host)) return;
  addConnection({
    name: process.env.ROUTEROS_NAME || host,
    host,
    port: Number(process.env.ROUTEROS_PORT || 443),
    scheme: (process.env.ROUTEROS_SCHEME as 'http' | 'https') || 'https',
    username: process.env.ROUTEROS_USER || 'admin',
    password: process.env.ROUTEROS_PASSWORD || '',
    tlsVerify: process.env.ROUTEROS_TLS_VERIFY === 'true',
    note: 'Configured from environment',
  }, true);
}

bootstrapFromEnv();
