/**
 * Minimal, dependency-free .env loader for the standalone CLIs (drizzle-kit
 * config + `tsx` seed scripts). Next.js loads `.env.local` itself; those
 * processes do not. Ported unchanged from v1 `src/admin/db/load-env.ts`.
 *
 * Precedence: an already-set `process.env` value wins, then `.env.local`,
 * then `.env`. Import for its side effect BEFORE any code reading `process.env`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadFile(file: string): void {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key || key in process.env) continue;
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

loadFile('.env.local');
loadFile('.env');
