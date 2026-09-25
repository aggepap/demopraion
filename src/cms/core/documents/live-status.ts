/**
 * Statuses that put a document in front of the public (now or on a timer).
 *
 * Its own module with no imports, so the admin form (a client component) and the
 * write routes share one definition.
 */
export function isLiveStatus(status: string | undefined | null): boolean {
  return status === 'published' || status === 'scheduled';
}
