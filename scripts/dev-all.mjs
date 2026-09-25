/**
 * Boot the app and the edit-lock relay together.
 *
 * The two are separate processes by design — `next start` cannot upgrade an
 * HTTP connection, so the WebSocket relay runs beside it (in production as its
 * own PM2 app). That is correct architecturally and tedious daily, hence this.
 *
 * ## Why it spawns node directly rather than `npm run dev`
 *
 * `npm run x` puts a wrapper process between this script and the real server,
 * and killing the wrapper does not necessarily kill what it started — on
 * Windows it reliably does not. The orphan then keeps port 3002 and Next's dev
 * registry, and the next `npm run dev` refuses to start, naming a PID that
 * `taskkill` may not even be able to see (a WSL pid, say). Spawning the
 * binaries as direct children means one kill is one kill. `dev-qa.mjs` resolves
 * the next binary the same way.
 *
 * ## Why a dying relay does NOT take the app down with it
 *
 * Locking is a collaboration nicety layered on top of a server-side check. If
 * the relay cannot start — no `CMS_LOCK_INTERNAL_SECRET`, port in use — the
 * right outcome is an admin that still works, with every editor showing "live
 * editing status is unavailable" and saving normally. Stopping development
 * because a sidecar died would be the wrong trade. The app dying is different:
 * nothing is left worth running, so the relay goes too.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);

let nextBin;
try {
  nextBin = require.resolve('next/dist/bin/next');
} catch {
  console.error('[dev:all] cannot find the next binary — run `npm install` first.');
  process.exit(1);
}

/** Read a key out of the env files without pulling in a dotenv dependency. */
function envValue(key) {
  if (process.env[key]) return process.env[key];
  for (const file of ['.env.local', '.env']) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    for (const raw of readFileSync(path, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1 || line.slice(0, eq).trim() !== key) continue;
      return line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
  return '';
}

const port = process.env.PORT || '3002';
const secret = envValue('CMS_LOCK_INTERNAL_SECRET');
const wsPort = envValue('CMS_LOCK_WS_PORT') || '8081';

/*
 * Said up front rather than left to the relay's own exit code, because the
 * symptom otherwise is silence: the admin loads, nothing locks, and the only
 * clue is a one-line note at the top of the editor.
 */
if (secret.length < 32) {
  console.log(
    `[dev:all] CMS_LOCK_INTERNAL_SECRET is ${secret ? 'under 32 characters' : 'not set'} — ` +
      `edit locks are OFF.\n` +
      `[dev:all] Add it to .env.local to turn them on; see .env.example for the whole block.\n` +
      `[dev:all] Starting the app on its own.`,
  );
}

const children = [];
let shuttingDown = false;

function stopAll(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { child } of children) {
    if (!child.killed && child.exitCode === null) child.kill('SIGTERM');
  }
  process.exit(code ?? 0);
}

function start(name, args, { critical, prefix }) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    // The app inherits so Next's own output stays intact; the relay is piped so
    // its handful of lines are recognisable in the middle of it.
    stdio: prefix ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    env: process.env,
  });
  if (prefix) {
    const write = (stream) => (data) => {
      for (const raw of String(data).split('\n')) {
        const line = raw.trim();
        if (!line) continue;
        // The relay tags its own output; only Node's own chatter needs a label.
        stream.write(line.startsWith('[') ? `${line}\n` : `[${name}] ${line}\n`);
      }
    };
    child.stdout.on('data', write(process.stdout));
    child.stderr.on('data', write(process.stderr));
  }
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    if (critical) {
      console.log(`[dev:all] ${name} exited (${signal ?? code}) — stopping everything.`);
      stopAll(code ?? 0);
    } else {
      console.log(
        `[dev:all] ${name} exited (${signal ?? code}). The app keeps running; ` +
          `edit locks are unavailable until you restart it.`,
      );
    }
  });
  children.push({ name, child });
  return child;
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => stopAll(0));
}

if (secret.length >= 32) {
  // Only name env files that exist: `--env-file-if-exists` tolerates a missing
  // one but announces it on every single start, which is noise, not news.
  const envFlags = ['.env', '.env.local']
    .filter((f) => existsSync(join(root, f)))
    .map((f) => `--env-file=${f}`);
  start('locks', [...envFlags, join(root, 'src/cms/realtime/lock-server.mjs')], {
    critical: false,
    prefix: true,
  });
  console.log(`[dev:all] relay on :${wsPort}  ·  app on :${port}`);
}

start('app', [nextBin, 'dev', '-p', port], { critical: true, prefix: false });
