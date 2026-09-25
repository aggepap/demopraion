/**
 * Where the browser opens its lock socket.
 *
 * The path is shared with the relay (`lock-server.mjs` serves exactly this and
 * refuses anything else), so it lives in one place. Getting it wrong is a silent
 * failure rather than a loud one: the socket never connects, the editor falls
 * back to "live status unavailable", and everything still works — just without
 * any locking at all.
 */
export const LOCK_WS_PATH = '/_ws/locks';

/**
 * `configured` is the dev-only `NEXT_PUBLIC_CMS_LOCK_WS_URL` override, normally
 * written as a bare origin (`ws://localhost:8081`) — nobody setting it should
 * need to know the relay's internal path, so it is appended when absent. An
 * override that names its own path is left alone.
 *
 * Blank means production: derive from the page, which keeps the socket on the
 * document's own origin and therefore inside CSP `connect-src 'self'`.
 */
export function resolveWsUrl(
  configured: string,
  location: { protocol: string; host: string },
): string {
  const sameOrigin = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${LOCK_WS_PATH}`;
  if (!configured) return sameOrigin;
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    // A typo in the env var must not take the admin down with it.
    return sameOrigin;
  }
  if (url.pathname && url.pathname !== '/') return configured;
  return `${url.origin}${LOCK_WS_PATH}`;
}
