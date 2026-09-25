/**
 * Fires a GA4 event via gtag.js. No-ops when gtag is not loaded — gtag is
 * injected client-side only after cookie consent (see AnalyticsLoader), so
 * `window.gtag` is undefined for SSR, in dev, and before consent.
 *
 * The Window.gtag type is declared ambiently in AnalyticsLoader.tsx; we
 * intentionally do not re-declare it here to avoid a conflicting duplicate.
 */
export function trackEvent(name: string, params?: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  if (typeof window.gtag !== 'function') return;
  window.gtag('event', name, params);
}
