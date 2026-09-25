/**
 * The edit-lock WebSocket relay.
 *
 * ## What it is not
 *
 * It is not where locking happens. It holds a room registry and a heartbeat
 * timer, and nothing else — no database handle, no JWT verification, no policy.
 * Every frame is forwarded to the Next app over loopback with the socket's
 * handshake `Cookie` attached, and whatever the app answers is broadcast to the
 * room. That split is deliberate: `modules/auth/session.ts` is `server-only` and
 * imports `next/headers`, so a plain Node process cannot verify a session with
 * it, and a second copy of the auth and schema code here would drift from the
 * first. Keeping this process dumb keeps all of it testable in one place.
 *
 * ## Why a separate process at all
 *
 * The app runs as plain `next start` under PM2, and a Next route handler cannot
 * upgrade an HTTP connection. Rather than replace the boot path with a custom
 * server — which would change dev, prod and every future Next upgrade — this
 * runs beside it as its own PM2 app behind an Nginx `location` that forwards
 * the Upgrade.
 *
 * ## Run it
 *
 *   node --env-file-if-exists=.env src/cms/realtime/lock-server.mjs
 *
 * The `--env-file` flag is not optional in production. A deploy script typically
 * links the shared `.env` into the release and Next loads it itself; a bare Node process
 * does not, so without the flag every variable below is undefined and the relay
 * exits with a secret it never had.
 */
import { WebSocketServer } from 'ws';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.CMS_LOCK_WS_PORT) || 8081;
/** Never 0.0.0.0: Nginx is the only thing that should reach this. */
const HOST = process.env.CMS_LOCK_WS_HOST || '127.0.0.1';
/** prod = whatever `next start` binds (3000); dev = 3002. Never derived. */
const APP_ORIGIN = process.env.CMS_APP_ORIGIN || 'http://127.0.0.1:3000';
const ALLOWED_ORIGIN = process.env.CMS_LOCK_ALLOWED_ORIGIN || process.env.NEXT_PUBLIC_SITE_URL || '';
const SECRET = process.env.CMS_LOCK_INTERNAL_SECRET || '';
const TTL_SECONDS = Number(process.env.CMS_LOCK_TTL_SECONDS) || 60;

/** A third of the TTL, so one dropped heartbeat never expires a live lock. */
const HEARTBEAT_MS = Math.max(5_000, Math.floor((TTL_SECONDS * 1000) / 3));
/**
 * How many resources one socket may watch at once.
 *
 * A signed-in tab is the only thing that gets this far, but "authenticated" is
 * not "trusted with unbounded server memory": without a cap, one socket could
 * enumerate rooms until the registry filled the process.
 */
const MAX_ROOMS_PER_SOCKET = 16;

if (SECRET.length < 32) {
  console.error('[locks] CMS_LOCK_INTERNAL_SECRET missing or under 32 chars — refusing to start.');
  process.exit(1);
}
if (!ALLOWED_ORIGIN) {
  console.error('[locks] CMS_LOCK_ALLOWED_ORIGIN / NEXT_PUBLIC_SITE_URL unset — refusing to start.');
  process.exit(1);
}

/** Must match `LOCK_WS_PATH` in src/cms/admin/locks/ws-url.ts. Not imported —
 *  this file is plain ESM with no build step and must not pull in TypeScript. */
const WS_PATH = '/_ws/locks';

const RESOURCE_TYPES = new Set(['document', 'order', 'reservation']);
const ACTIONS = new Set(['acquire', 'release', 'takeover', 'observe']);
const KEY_PATTERN = /^[A-Za-z0-9:_-]{1,64}$/;

/** room name → Set<socket>. Mirrors `roomKey()` in core/locks/protocol.ts. */
const rooms = new Map();

function roomKey(type, key) {
  return `${type}:${key}`;
}

function join(ws, room) {
  if (!rooms.has(room)) rooms.set(room, new Set());
  rooms.get(room).add(ws);
  ws.rooms.add(room);
}

function leaveAll(ws) {
  for (const room of ws.rooms) {
    const set = rooms.get(room);
    if (!set) continue;
    set.delete(ws);
    if (set.size === 0) rooms.delete(room);
  }
  ws.rooms.clear();
}

function broadcast(room, payload) {
  const set = rooms.get(room);
  if (!set) return;
  const text = JSON.stringify(payload);
  for (const peer of set) {
    if (peer.readyState === peer.OPEN) peer.send(text);
  }
}

/**
 * The CSRF boundary.
 *
 * The loopback POST carries the victim's `cms_session` cookie and sends no
 * `Origin`, and `isSameOrigin()` treats an absent Origin as same-origin — so
 * the app's usual belt does not apply to it and this check is the only one
 * there is. Without it, any page on the internet could open a socket here and
 * drive locks as whoever is signed in.
 */
function verifyClient({ origin, req }, done) {
  if (origin !== ALLOWED_ORIGIN) return done(false, 403, 'Forbidden origin');
  if (!req.headers.cookie) return done(false, 401, 'Unauthenticated');
  return done(true);
}

/** Per-socket token bucket. Rate limiting cannot live in the app: every request
 *  arrives from loopback, so one IP bucket would be shared by the whole team. */
function allow(ws) {
  const now = Date.now();
  const elapsed = now - ws.bucketAt;
  ws.bucketAt = now;
  ws.tokens = Math.min(10, ws.tokens + (elapsed / 10_000) * 10);
  if (ws.tokens < 1) return false;
  ws.tokens -= 1;
  return true;
}

function parseFrame(raw) {
  let frame;
  try {
    frame = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!frame || typeof frame !== 'object') return null;
  const { action, resourceType, resourceKey, sessionId } = frame;
  if (!ACTIONS.has(action) || !RESOURCE_TYPES.has(resourceType)) return null;
  if (typeof resourceKey !== 'string' || !KEY_PATTERN.test(resourceKey)) return null;
  if (typeof sessionId !== 'string' || sessionId.length < 1 || sessionId.length > 36) return null;
  // Rebuilt field by field rather than forwarded: the app decides identity from
  // the cookie, and anything else the payload carried must not reach it.
  return { action, resourceType, resourceKey, sessionId };
}

async function callApp(path, body, headers) {
  const res = await fetch(`${APP_ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const wss = new WebSocketServer({
  host: HOST,
  port: PORT,
  path: WS_PATH,
  maxPayload: 4096,
  perMessageDeflate: false,
  verifyClient,
});

wss.on('connection', (ws, req) => {
  ws.connectionId = randomUUID();
  ws.cookie = req.headers.cookie ?? '';
  /*
   * Passed through so an audit row for a take-over records the person's real
   * address rather than the loopback hop. Nginx rewrites `x-real-ip` on the way
   * in (docs/SITE_STARTER.md, Production requirements), so this is the proxy's value, not the
   * client's — the same header the app trusts everywhere else.
   */
  ws.realIp = req.headers['x-real-ip'] ?? '';
  ws.rooms = new Set();
  ws.tokens = 10;
  ws.bucketAt = Date.now();
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.send(JSON.stringify({ type: 'hello', ttlSeconds: TTL_SECONDS }));

  ws.on('message', async (raw) => {
    if (!allow(ws)) {
      ws.close(1008, 'Too many frames');
      return;
    }
    const frame = parseFrame(String(raw));
    if (!frame) {
      ws.send(JSON.stringify({ type: 'error', message: 'Malformed frame.' }));
      return;
    }
    let result;
    try {
      result = await callApp(
        '/api/cms/locks',
        { ...frame, connectionId: ws.connectionId },
        { cookie: ws.cookie, ...(ws.realIp ? { 'x-real-ip': ws.realIp } : {}) },
      );
    } catch (err) {
      // The app is unreachable. Say so and close: the client treats a dropped
      // socket as "live status unavailable" and stays EDITABLE, which is the
      // required failure mode.
      console.error('[locks] app unreachable', err?.message ?? err);
      ws.close(1013, 'Lock service unavailable');
      return;
    }
    if (result.status === 401 || result.status === 403) {
      ws.close(1008, 'Unauthorised');
      return;
    }
    if (!result.body?.ok) {
      ws.send(JSON.stringify({ type: 'error', message: 'Lock request refused.' }));
      return;
    }
    // The room is named by the APP's answer, never by the client's frame.
    const stateFrame = result.body.data;
    const room = roomKey(stateFrame.resourceType, stateFrame.resourceKey);
    if (frame.action === 'release') {
      const set = rooms.get(room);
      if (set) {
        set.delete(ws);
        if (set.size === 0) rooms.delete(room);
      }
      ws.rooms.delete(room);
    } else {
      if (!ws.rooms.has(room) && ws.rooms.size >= MAX_ROOMS_PER_SOCKET) {
        ws.close(1008, 'Too many rooms');
        return;
      }
      join(ws, room);
    }
    broadcast(room, { type: 'state', ...stateFrame });
  });

  ws.on('close', async () => {
    const held = [...ws.rooms];
    leaveAll(ws);
    try {
      const { body } = await callApp(
        '/api/cms/locks/release',
        { connectionId: ws.connectionId },
        { 'x-cms-lock-secret': SECRET },
      );
      // Only rooms whose lock actually went away are announced — a release from
      // a superseded connection (the F5 race) is a no-op and must not tell the
      // room the document is free when it is not.
      for (const released of body?.data?.released ?? []) {
        broadcast(roomKey(released.resourceType, released.resourceKey), {
          type: 'state',
          ...released,
        });
      }
    } catch (err) {
      console.error('[locks] release failed', err?.message ?? err);
      void held;
    }
  });
});

/**
 * One batched call for every live socket, not one per lock.
 *
 * Also the thing that keeps idle sockets open: a reverse proxy (and Cloudflare,
 * at roughly 100s) culls a WebSocket that has said nothing.
 */
setInterval(() => {
  const ids = [];
  for (const ws of wss.clients) {
    if (ws.readyState !== ws.OPEN) continue;
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
    if (ws.rooms.size > 0) ids.push(ws.connectionId);
  }
  if (ids.length === 0) return;
  callApp('/api/cms/locks/heartbeat', { connectionIds: ids }, { 'x-cms-lock-secret': SECRET }).catch(
    (err) => console.error('[locks] heartbeat failed', err?.message ?? err),
  );
}, HEARTBEAT_MS).unref?.();

console.log(
  `[locks] ws://${HOST}:${PORT}${WS_PATH} → app ${APP_ORIGIN}, origin ${ALLOWED_ORIGIN}, ttl ${TTL_SECONDS}s`,
);
