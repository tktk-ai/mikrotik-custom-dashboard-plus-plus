import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** Atomic, permission-preserving JSON persistence for the single-node LAN mode. */
export function atomicWriteJson(file: string, value: unknown): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const temporary = path.join(dir, `.${path.basename(file)}.${crypto.randomUUID()}.tmp`);
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, file);
}
