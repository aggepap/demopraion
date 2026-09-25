import 'server-only';

import { createHash } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import { logAudit } from '../../core/audit';
import { getDb, schema } from '../../db';
import type { BridgePrincipal } from '../../core/tokens/guard';
import { revalidatePayload } from '../../core/seo/resolve';

/**
 * Storing the `<head>` payload Product Manager compiles.
 *
 * ## Do not trust this data
 *
 * It arrives from a different system with its own attack surface and lands, via
 * the render path, inside `dangerouslySetInnerHTML` on a public page. This module
 * is the last checkpoint before that. Everything below — the size cap, the node
 * cap, the `</script` refusal, the `__proto__` refusal, the string clamps — is
 * there because the alternative is a stored-XSS or a defacement on every page
 * carrying the payload.
 */

/** A generous ceiling that still bounds the row and the JSON parse. */
export const MAX_PAYLOAD_BYTES = 256 * 1024;
const MAX_JSONLD_NODES = 100;
const MAX_STRING = 5_000;
const MAX_HEAD_META_KEYS = 40;

export interface PayloadInput {
  remote_type?: unknown;
  remote_id?: unknown;
  path?: unknown;
  locale?: unknown;
  head_meta?: unknown;
  jsonld?: unknown;
  alternates?: unknown;
  seo_override?: unknown;
  compiled_at?: unknown;
}

export class PayloadError extends Error {}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Reject the three keys that turn a JSON blob into prototype pollution.
 *
 * The payload is walked and re-serialised on the render path, and a
 * `__proto__` key surviving into an object spread is a process-wide mutation in
 * a server that handles every request.
 */
function assertNoPollution(value: unknown, depth = 0): void {
  if (depth > 20) throw new PayloadError('Payload is nested too deeply.');
  if (Array.isArray(value)) {
    for (const item of value) assertNoPollution(item, depth + 1);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      throw new PayloadError(`Refusing a payload containing a "${key}" key.`);
    }
    assertNoPollution(child, depth + 1);
  }
}

/**
 * Refuse any string that could close the script element it will be printed into.
 *
 * The render path escapes as well, and this is deliberate belt-and-braces: an
 * escaping bug in one place should not be a full XSS on every page carrying the
 * payload. Checked case-insensitively because `</ScRiPt` closes it just as well.
 */
function assertNoScriptBreakout(value: unknown, depth = 0): void {
  if (depth > 20) return;
  if (typeof value === 'string') {
    if (/<\/script/i.test(value)) {
      throw new PayloadError('Refusing a payload containing "</script".');
    }
    if (value.length > MAX_STRING) {
      throw new PayloadError(`A payload value exceeds ${MAX_STRING} characters.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertNoScriptBreakout(item, depth + 1);
    return;
  }
  if (isRecord(value)) {
    for (const child of Object.values(value)) assertNoScriptBreakout(child, depth + 1);
  }
}

/** Every JSON-LD node must declare a `@type`, or it is not structured data. */
function validateJsonLd(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) && !Array.isArray(value)) {
    throw new PayloadError('`jsonld` must be an object or an array.');
  }

  const nodes = Array.isArray(value)
    ? value
    : Array.isArray((value as Record<string, unknown>)['@graph'])
      ? ((value as Record<string, unknown>)['@graph'] as unknown[])
      : [value];

  if (nodes.length > MAX_JSONLD_NODES) {
    throw new PayloadError(`Too many structured-data nodes (limit ${MAX_JSONLD_NODES}).`);
  }
  for (const node of nodes) {
    if (!isRecord(node) || typeof node['@type'] !== 'string') {
      throw new PayloadError('Every structured-data node must carry an "@type".');
    }
  }

  assertNoPollution(value);
  assertNoScriptBreakout(value);
  return value;
}

function validateHeadMeta(value: unknown): Record<string, string | null> | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) throw new PayloadError('`head_meta` must be an object.');

  const keys = Object.keys(value);
  if (keys.length > MAX_HEAD_META_KEYS) {
    throw new PayloadError(`Too many head_meta keys (limit ${MAX_HEAD_META_KEYS}).`);
  }
  assertNoPollution(value);
  /*
   * Same guard as `jsonld`, for the same reason.
   *
   * Today `head_meta` is folded into Next's typed `Metadata` object
   * (`src/lib/seo/metadata.ts`), which escapes what it renders — so this is not
   * closing a live hole. It is closing the asymmetry: the module's whole premise
   * is that the PM SaaS is an external writer whose payloads are not trusted, and
   * two sibling fields from the same untrusted body should not have two different
   * standards. The next render path that concatenates a meta value into raw HTML
   * would otherwise inherit a gap nobody chose.
   */
  assertNoScriptBreakout(value);

  const out: Record<string, string | null> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (raw === null || raw === undefined) {
      out[key] = null;
      continue;
    }
    if (typeof raw !== 'string') {
      throw new PayloadError(`head_meta.${key} must be a string.`);
    }
    if (raw.length > MAX_STRING) {
      throw new PayloadError(`head_meta.${key} is too long.`);
    }
    out[key] = raw;
  }
  return out;
}

function validateAlternates(value: unknown): { hreflang: string; href: string }[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) throw new PayloadError('`alternates` must be an array.');
  return value
    .filter(isRecord)
    .slice(0, 40)
    .map((row) => ({
      hreflang: String(row.hreflang ?? '').slice(0, 20),
      href: String(row.href ?? '').slice(0, 512),
    }))
    .filter((row) => row.hreflang !== '' && row.href !== '');
}

/**
 * Stable hash of the meaningful content.
 *
 * Keys are sorted so a re-serialisation with a different property order is not
 * mistaken for a change — bulk re-pushes are the normal case, and treating one
 * as a write would purge the cache for nothing.
 */
export function payloadHash(input: {
  headMeta: unknown;
  jsonld: unknown;
  alternates: unknown;
  seoOverride: boolean;
}): string {
  const canonical = JSON.stringify(input, (_key, value: unknown) => {
    if (isRecord(value)) {
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
    }
    return value;
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export interface StoredPayload {
  written: number;
  errors: Record<string, string>;
  skipped: string[];
}

export interface PayloadTarget {
  path: string;
  locale: string;
  documentId: number | null;
  remoteType: string | null;
}

/**
 * Validate and store one compiled payload.
 *
 * An identical hash is a no-op: no write, and **no revalidation**. Purging the
 * cache for a payload that did not change is a self-inflicted traffic spike, and
 * PM re-pushes the whole set routinely.
 */
export async function storePayload(
  target: PayloadTarget,
  input: PayloadInput,
  principal: BridgePrincipal,
): Promise<StoredPayload> {
  const headMeta = validateHeadMeta(input.head_meta);
  const jsonld = validateJsonLd(input.jsonld);
  const alternates = validateAlternates(input.alternates);
  const seoOverride = input.seo_override === true;

  const hash = payloadHash({ headMeta, jsonld, alternates, seoOverride });

  const db = getDb();
  const [existing] = await db
    .select({ id: schema.pmHeadPayloads.id, payloadHash: schema.pmHeadPayloads.payloadHash })
    .from(schema.pmHeadPayloads)
    .where(
      and(
        eq(schema.pmHeadPayloads.path, target.path),
        eq(schema.pmHeadPayloads.locale, target.locale),
      ),
    )
    .limit(1);

  if (existing && existing.payloadHash === hash) {
    return { written: 0, errors: {}, skipped: ['payload'] };
  }

  const compiledAt =
    typeof input.compiled_at === 'string' && !Number.isNaN(new Date(input.compiled_at).getTime())
      ? new Date(input.compiled_at)
      : new Date();

  const values = {
    path: target.path,
    locale: target.locale,
    remoteType: target.remoteType,
    documentId: target.documentId,
    headMeta,
    jsonld,
    alternates,
    seoOverride,
    source: 'pm',
    payloadHash: hash,
    compiledAt,
  };

  if (existing) {
    await db.update(schema.pmHeadPayloads).set(values).where(eq(schema.pmHeadPayloads.id, existing.id));
  } else {
    await db.insert(schema.pmHeadPayloads).values(values);
  }

  revalidatePayload(target.path);

  await logAudit({
    userId: principal.userId,
    actorLabel: principal.actorLabel,
    action: 'pm.payload.write',
    subjectType: 'pm_head_payload',
    subjectId: target.path,
    after: { locale: target.locale, seoOverride, hash },
  });

  return { written: 1, errors: {}, skipped: [] };
}

/** Remove a stored payload — the one-statement revocation of PM's influence. */
export async function deletePayload(path: string, locale: string): Promise<void> {
  await getDb()
    .delete(schema.pmHeadPayloads)
    .where(and(eq(schema.pmHeadPayloads.path, path), eq(schema.pmHeadPayloads.locale, locale)));
  revalidatePayload(path);
}
