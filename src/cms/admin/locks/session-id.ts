'use client';

/**
 * This tab's identity, stable for the life of the tab.
 *
 * `sessionStorage`, not `localStorage`: storage shared across tabs would make
 * two tabs look like one editor, and the second would silently inherit the
 * first's lock. `sessionStorage` survives F5 — which is the point, so a refresh
 * does not lock you out of the document you are sitting in — but not a new tab.
 *
 * Cached in a module variable because `useSyncExternalStore` calls its snapshot
 * on every render and loops forever if the value is not stable. Each tab has its
 * own module instance, so the cache is exactly per-tab.
 */
const SESSION_KEY = 'cms:edit-session';

let cached: string | null = null;

export function editSessionId(): string {
  if (cached) return cached;
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) {
      cached = existing;
      return cached;
    }
    const fresh = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, fresh);
    cached = fresh;
    return cached;
  } catch {
    // Private mode, or storage disabled. Still works, just per page-load: a
    // refresh then looks like a new tab. Never let this break the admin.
    cached = crypto.randomUUID();
    return cached;
  }
}
