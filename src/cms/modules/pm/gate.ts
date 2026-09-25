import 'server-only';

import { NextResponse } from 'next/server';

import type { CmsConfig } from '../../config';
import { resolveModuleFlags } from '../../core/settings/modules';

/**
 * The 404 a disabled bridge answers with.
 *
 * WordPress emits `rest_no_route` and PM's `interpret()` reads that as "this
 * channel does not exist on this version" — informational, not a failure. Praion
 * cannot emit WordPress's code, so PM also accepts a bare `no_route`, and this
 * is where praion emits exactly that. Getting the string wrong turns "the module
 * is off" into "the sync is broken" in PM's UI.
 *
 * Distinct from a missing *record*, which is `not_found` — that difference is
 * the whole point of having two codes.
 */
export const NO_ROUTE_BODY = { ok: false, error: 'no_route' } as const;

export function noRouteResponse(): NextResponse {
  return NextResponse.json(NO_ROUTE_BODY, { status: 404 });
}

/**
 * Is the bridge switched on?
 *
 * Reads the resolved flags rather than `config.modules` directly, so the admin
 * Modules toggle can disable the bridge at runtime without a redeploy — which is
 * the fastest available kill switch if a credential is suspected compromised.
 */
export async function pmEnabled(config: CmsConfig): Promise<boolean> {
  const flags = await resolveModuleFlags(config);
  return flags.pm === true;
}

/**
 * Wrap a bridge handler so every route in the namespace disappears together
 * when the module is off. The static route files always exist; this is what
 * makes them absent.
 */
export function pmModuleGate<T extends unknown[]>(
  config: CmsConfig,
  handler: (...args: T) => Promise<Response>,
): (...args: T) => Promise<Response> {
  return async (...args: T): Promise<Response> => {
    if (!(await pmEnabled(config))) return noRouteResponse();
    return handler(...args);
  };
}
