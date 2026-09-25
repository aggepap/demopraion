import 'server-only';

import { cache } from 'react';

import type { CmsConfig } from '../../config';
import { getSetting } from '../settings';
import { resolveModuleFlags } from '../settings/modules';
import { BOOKING_KINDS_KEY, parseMultiValue } from '../settings/schema';
import { parseSchemaPolicy, SCHEMA_POLICY_KEY, type SchemaPolicy, type SchemaPolicyHints } from './policy';

/**
 * The structured-data read layer. Goes through `getSetting`, so it shares the
 * `cms:settings` tag — a save in Settings → Structured data is live on the next
 * request — and its failure mode: an unreachable database reads as nothing
 * stored, which gives every category its default rather than failing the page.
 */

export * from './policy';
export * from './nodes';

/** What the site sells, for the default business type. */
export async function schemaPolicyHints(config: CmsConfig): Promise<SchemaPolicyHints> {
  const moduleFlags = await resolveModuleFlags(config);
  const bookingKinds = moduleFlags.booking ? parseMultiValue(await getSetting(BOOKING_KINDS_KEY)) : [];
  return { moduleFlags, bookingKinds };
}

export const getSchemaPolicy = cache(async (config: CmsConfig): Promise<SchemaPolicy> => {
  const [raw, hints] = await Promise.all([getSetting(SCHEMA_POLICY_KEY), schemaPolicyHints(config)]);
  return parseSchemaPolicy(raw, hints);
});
