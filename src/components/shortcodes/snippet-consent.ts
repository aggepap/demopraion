/**
 * Whether a script snippet may run for this visitor.
 *
 * A snippet with no consent category connects a service rather than tracks
 * (a chat widget, a booking engine) and runs straight away; any other waits
 * until the visitor has granted its category.
 */
export function snippetMayRun(consentCategory: string | null, categoryGranted: boolean): boolean {
  return consentCategory === null || categoryGranted;
}
