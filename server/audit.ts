import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const dir = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
const file = path.join(dir, 'audit.jsonl');
const maxBytes = Number(process.env.AUDIT_MAX_BYTES || 25 * 1024 * 1024);

export interface AuditEvent {
  id: string;
  at: string;
  method: string;
  path: string;
  status: number;
  actor: string;
  agent?: string;
  ip?: string;
  requestId: string;
}

export function audit(event: Omit<AuditEvent, 'id' | 'at'>): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(file) && fs.statSync(file).size > maxBytes) {
      fs.renameSync(file, `${file}.${new Date().toISOString().replaceAll(':', '-')}`);
    }
    const entry: AuditEvent = { id: crypto.randomUUID(), at: new Date().toISOString(), ...event };
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  } catch (err) {
    console.error('[audit] unable to persist event:', err instanceof Error ? err.message : err);
  }
}
