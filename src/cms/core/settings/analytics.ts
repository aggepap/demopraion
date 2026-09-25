/**
 * Resolving the GA4 measurement ID.
 *
 * One function because two readers must not disagree: `AnalyticsLoader` decides
 * whether to load gtag, and the cookie declaration decides whether to say so. A
 * loader that honoured the build-time env var while the declaration only looked
 * at the setting would put an env-configured site back where it started —
 * tracking without a declaration.
 *
 * A leaf module with no imports: `AnalyticsLoader` is a client component, and
 * `process.env.NEXT_PUBLIC_*` is inlined into the client bundle at build time.
 */

export const ANALYTICS_GA_ID_KEY = 'analytics.gaMeasurementId';

/**
 * The admin-managed setting, falling back to the build-time env var.
 *
 * Anything that is not a non-empty string — null from an unset row, a number
 * written straight into the database — reads as unset. Returns '' for "no
 * analytics", which is falsy at every call site.
 */
export function resolveGaId(stored: unknown): string {
  const fromSetting = typeof stored === 'string' ? stored.trim() : '';
  if (fromSetting) return fromSetting;
  return process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim() ?? '';
}
