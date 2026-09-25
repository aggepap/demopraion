/**
 * "started 4 minutes ago" for the lock banner.
 *
 * Pure and separate from the component so the awkward inputs — a clock skewed
 * between the database and the browser, a timestamp that failed to parse — are
 * unit-testable. Both of those reached users as "in -2 minutes" and
 * "NaN minutes ago" in other codebases; neither is worth shipping to find out.
 */
export function relativeSince(iso: string, now: Date = new Date()): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';
  const seconds = Math.max(0, Math.floor((now.getTime() - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'} ago`;
}
