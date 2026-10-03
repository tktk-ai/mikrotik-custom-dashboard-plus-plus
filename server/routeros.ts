import http from 'node:http';
import https from 'node:https';
import type { Row } from '../shared/types';

/** Thin client for the RouterOS REST API (`/rest/*`), with TLS-skip and timeout support. */

export interface RosTarget {
  host: string;
  port: number;
  scheme: 'https' | 'http';
  username: string;
  password: string;
  tlsVerify: boolean;
}

export class RosError extends Error {
  constructor(
    public kind: 'auth' | 'network' | 'notfound' | 'unsupported' | 'validation' | 'device' | 'timeout',
    message: string,
    public status = 502,
    public detail?: string,
  ) {
    super(message);
  }
}

export interface RosResponse {
  status: number;
  data: any;
  ms: number;
}

const timeoutMs = Number(process.env.ROS_TIMEOUT_MS || 15000);
const maxResponseBytes = Number(process.env.ROS_MAX_RESPONSE_BYTES || 16 * 1024 * 1024);

export function rosRequest(
  target: RosTarget,
  path: string,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  body?: unknown,
  query?: Record<string, string | undefined>,
): Promise<RosResponse> {
  const started = Date.now();
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== '') search.append(k, v);
  }
  const cleanPath = path.replace(/^\/+/, '');
  const urlPath = `/rest/${cleanPath}${search.size ? `?${search.toString()}` : ''}`;
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const isTls = target.scheme === 'https';
  const agent = isTls ? new https.Agent({ rejectUnauthorized: target.tlsVerify, keepAlive: true }) : undefined;

  const options: https.RequestOptions = {
    host: target.host,
    port: target.port,
    path: urlPath,
    method,
    agent,
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${target.username}:${target.password}`).toString('base64'),
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
    },
    timeout: timeoutMs,
  };

  return new Promise<RosResponse>((resolve, reject) => {
    const transport = isTls ? https : http;
    const req = transport.request(options, (res) => {
      const chunks: Buffer[] = [];
      let received = 0;
      res.on('data', (c) => {
        received += Buffer.byteLength(c);
        if (received > maxResponseBytes) {
          req.destroy(new RosError('device', `RouterOS response exceeded the ${Math.round(maxResponseBytes / 1024 / 1024)} MiB safety limit.`, 413));
          return;
        }
        chunks.push(c as Buffer);
      });
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        const ms = Date.now() - started;
        const status = res.statusCode ?? 0;
        let data: any = text;
        const contentType = String(res.headers['content-type'] ?? '');
        if (text && (contentType.includes('json') || /^[[{]/.test(text.trim()))) {
          try { data = JSON.parse(text); } catch { /* keep raw text */ }
        }
        if (status >= 400) return reject(mapError(status, data, text));
        resolve({ status, data, ms });
      });
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new RosError('timeout', `Timed out after ${Math.round(timeoutMs / 1000)}s talking to ${target.host}:${target.port}.`, 504));
    });
    req.on('error', (err: NodeJS.ErrnoException) => {
      const code = err.code ?? '';
      if (code === 'ECONNREFUSED') {
        reject(new RosError('network', `Connection refused by ${target.host}:${target.port}. Is the ${isTls ? 'www-ssl' : 'www'} service enabled and the REST API available (RouterOS 7.1+)?`, 502, err.message));
      } else if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
        reject(new RosError('network', `Host ${target.host} could not be resolved.`, 502, err.message));
      } else if (code === 'CERT_HAS_EXPIRED' || code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || code === 'SELF_SIGNED_CERT_IN_CHAIN') {
        reject(new RosError('network', `TLS certificate for ${target.host} could not be verified. Enable “skip certificate check” for self-signed RouterOS certificates.`, 502, err.message));
      } else if (code === 'ETIMEDOUT') {
        reject(new RosError('timeout', `Network timeout reaching ${target.host}:${target.port}.`, 504, err.message));
      } else {
        reject(new RosError('network', `Network error talking to ${target.host}: ${err.message}`, 502, err.message));
      }
    });
    if (payload) req.write(payload);
    req.end();
  });
}

function mapError(status: number, data: any, text: string): RosError {
  const message = typeof data === 'object' && data ? String(data.message ?? data.error ?? '') : text.slice(0, 400);
  const detail = typeof data === 'object' && data ? JSON.stringify(data.detail ?? data) : undefined;
  if (status === 401 || status === 403) {
    return new RosError('auth', 'Authentication failed — check the username, password and the user’s REST API policy.', 401, detail);
  }
  if (status === 404) {
    return new RosError('notfound', `Not found (404)${message ? `: ${message}` : ''}. The menu may not exist on this RouterOS version.`, 404, detail);
  }
  if (status === 400) {
    return new RosError('validation', message || 'The router rejected the request (400).', 400, detail);
  }
  return new RosError('device', message || `RouterOS returned HTTP ${status}.`, status || 502, detail);
}

/** RouterOS sometimes returns `{error}` bodies or arrays for single objects. */
export function normalizeList(data: any): Row[] {
  if (Array.isArray(data)) return data.map((d) => (typeof d === 'object' && d !== null ? d : { value: d }));
  if (data === null || data === undefined) return [];
  if (typeof data === 'object') return [data];
  return [{ value: data }];
}
