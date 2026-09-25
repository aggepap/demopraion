import 'server-only';

import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import type { CmsConfig, ResolvedCollection } from '../../config';
import { createRoute } from '../../core/api/handler';
import { revalidateDocument } from '../../core/read/revalidate';
import { localeKeyedPath } from '../../core/seo/locale-path';
import { resolveModuleFlags } from '../../core/settings/modules';
import { isProductionHost, siteOrigin } from '../../core/paths';
import { requireSignatureOrSession, type BridgeAuth } from '../../core/tokens/guard';
import { getDb, schema } from '../../db';
import type { DocumentRow } from '../../db/adapters/mysql/schema/documents';
import { PERMISSIONS } from '../auth/permissions';
import {
  clampPage,
  clampPerPage,
  countDocuments,
  exposedCollections,
  itemFor,
  contentTypeManifest,
  listArchives,
  parseModifiedAfter,
  pmMeta,
  selectDocuments,
  type PmPage,
} from './catalogue';
import { noRouteResponse, pmEnabled } from './gate';
import { decodeRef, PmRefError } from './identity';
import {
  MAX_PAYLOAD_BYTES,
  PayloadError,
  storePayload,
  type PayloadInput,
  type PayloadTarget,
} from './payload';
import { applyImageAlts, parseScope, type AltEntry } from './alts';
import { applyArchiveValues, applyPageValues } from './write';

/**
 * The bridge's HTTP surface.
 *
 * ## Two envelope rules that are easy to "fix" and break
 *
 * 1. **List responses use PM's envelope, not praion's.** Every other list in
 *    this codebase returns `paginated()` → `{ok, items, page, pageSize, total}`.
 *    PM reads `{data, meta:{current_page, per_page, total, last_page}}`. These
 *    routes therefore return raw `NextResponse.json`, and normalising them to
 *    match the house style would break every sync.
 *
 * 2. **Bridge routes set `sameOrigin: false`.** Not because CSRF does not
 *    matter, but because the decision moves into the guard: a signed request is
 *    structurally CSRF-immune (a browser cannot compute an HMAC it has no secret
 *    for), while the *session* path does its own origin check. Leaving the
 *    factory default on would have meant relying on Guzzle happening not to send
 *    an `Origin` header — true today, and a silent 403 the day a proxy adds one.
 */

const BRIDGE_VERSION = '1.0.0';

/** Shared factory config: no `input` schema, because the guard reads the body. */
function bridgeRoute<T>(opts: {
  config: CmsConfig;
  scope: string;
  perm: string;
  rateLimit: { scope: string; max: number };
  handler: (ctx: {
    params: Record<string, string>;
    query: URLSearchParams;
    /** The factory returns the guard's short-circuit responses before the
     *  handler runs, so by here it is always a real principal. */
    auth: BridgeAuth;
  }) => Promise<T>;
}) {
  return createRoute({
    sameOrigin: false,
    rateLimit: { scope: opts.rateLimit.scope, max: opts.rateLimit.max, windowMs: 60_000 },
    guard: requireSignatureOrSession({ scope: opts.scope, perm: opts.perm }),
    handler: async ({ req, params, auth }) => {
      if (!(await pmEnabled(opts.config))) return noRouteResponse();
      const query = new URL(req.url).searchParams;
      return opts.handler({ params, query, auth });
    },
  });
}

/** The locale a bridge request addresses. `/api/**` is excluded from the i18n
 *  proxy, so a bridge route gets no locale from its URL. */
function localeFrom(query: URLSearchParams, config: CmsConfig): string {
  const asked = query.get('locale');
  return asked && config.locales.includes(asked) ? asked : config.defaultLocale;
}

/**
 * `GET /ping` — health and capabilities.
 *
 * PM whitelists what it stores from this, so extra keys are harmless but
 * pointless. Three are load-bearing:
 *
 * - `plugin_version` duplicates `bridge_version` because both
 *   `CmsConnectionService::verifyWordPress()` and
 *   `WooCommerceAdapter::verifyConnection()` read that key.
 * - `woocommerce` must mirror the commerce module, or a healthy praion shop
 *   shows up in PM as "WooCommerce not installed".
 * - `compiled_payloads` is a promise about what reaches the page, so it may only
 *   be true while the render path is actually wired up. If those template edits
 *   are ever reverted, this must go back to `false` in the same change.
 */
export function pmPingRoute(config: CmsConfig) {
  return bridgeRoute({
    config,
    scope: 'pm:read',
    perm: PERMISSIONS.contentRead,
    rateLimit: { scope: 'pm-ping', max: 30 },
    handler: async () => {
      const flags = await resolveModuleFlags(config);
      const origin = siteOrigin();
      const pageTypes = [
        ...new Set(exposedCollections(config).map((c) => c.pmPageType!)),
        ...Object.keys(config.pm.archives),
      ];

      return NextResponse.json({
        ok: true,
        plugin_version: BRIDGE_VERSION,
        bridge_version: BRIDGE_VERSION,
        cms_version: 'praion-cms/2.x',
        capabilities: {
          // True only because the render path actually ships: `localizedMetadata`
          // folds `head_meta` in, and `PmStructuredData` emits the compiled graph
          // on the product, page and article templates. This flag is a promise
          // about what reaches the page, and claiming it while the payload sat
          // unread in a table is the exact failure it exists to prevent.
          compiled_payloads: true,
          field_values: false,
          field_definitions: false,
          archive_field_values: true,
          seo_override_flag: true,
          pull_channel: false,
          setup_string: true,
          sitemap: false,
          social_tag_override: true,
          // Stored but not rendered, so reported as unsupported: silently
          // discarding a value PM believes it published is the failure mode the
          // capability block exists to prevent.
          alternates: false,
          image_alts: true,
          woocommerce: flags.commerce === true,
          production_host: isProductionHost(origin, config.productionOrigin),
          locales: config.locales,
          default_locale: config.defaultLocale,
          page_types: pageTypes,
          // What those types actually are on this site. Built from the same
          // collection config the read endpoints use, so it cannot claim a
          // field is writable that the next push would refuse.
          content_types: contentTypeManifest(config),
        },
      });
    },
  });
}

/** Resolve a document row plus its collection, asserting the declared type. */
async function resolveDocument(
  config: CmsConfig,
  id: number,
  expectedType?: string,
): Promise<{ row: DocumentRow; collection: ResolvedCollection } | null> {
  const [row] = await getDb()
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.id, id))
    .limit(1);
  if (!row) return null;

  const collection = config.collectionByKey.get(row.type);
  if (!collection?.pmPageType) return null;

  // PM's `remote_type` is advisory — we resolve on the ref — but the resolved
  // document must actually declare the requested type. That assertion is what
  // lets four collections share `wp_post` safely, and what stops a stale PM
  // record from writing an article's title onto a product.
  if (expectedType && collection.pmPageType !== expectedType) return null;

  return { row, collection };
}

const notFound = () => NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });

/**
 * `GET /pages` — archives first, then documents of every exposed collection.
 *
 * `modified_after` filters documents on `updated_at`. Archives have no such
 * stamp of their own in this phase, so a filtered request omits them rather than
 * claiming they changed.
 */
export function pmPagesListRoute(config: CmsConfig) {
  return bridgeRoute({
    config,
    scope: 'pm:read',
    perm: PERMISSIONS.contentRead,
    rateLimit: { scope: 'pm-read', max: 120 },
    handler: async ({ query }) => {
      const page = clampPage(query.get('page'));
      const perPage = clampPerPage(query.get('per_page'));
      const locale = localeFrom(query, config);
      const modifiedAfter = parseModifiedAfter(query.get('modified_after'));

      const collections = exposedCollections(config);
      const types = collections.map((c) => c.key);

      const archives = modifiedAfter ? [] : await listArchives(config, locale);
      const documentTotal = await countDocuments({
        types,
        locale,
        modifiedAfter,
        limit: 0,
        offset: 0,
      });
      const total = archives.length + documentTotal;

      const offset = (page - 1) * perPage;
      const data: unknown[] = [];

      if (offset < archives.length) {
        data.push(...archives.slice(offset, offset + perPage));
      }
      const remaining = perPage - data.length;
      if (remaining > 0) {
        const documentOffset = Math.max(0, offset - archives.length);
        const rows = await selectDocuments({
          types,
          locale,
          modifiedAfter,
          limit: remaining,
          offset: documentOffset,
        });
        const byKey = new Map(collections.map((c) => [c.key, c]));
        for (const row of rows) {
          const collection = byKey.get(row.type);
          if (collection) data.push(await itemFor(config, collection, row));
        }
      }

      const body: PmPage<unknown> = { data, meta: pmMeta(page, perPage, total) };
      return NextResponse.json(body);
    },
  });
}

/** `GET /pages/{type}/{ref}` — one page, document or archive. */
export function pmPageGetRoute(config: CmsConfig) {
  return bridgeRoute({
    config,
    scope: 'pm:read',
    perm: PERMISSIONS.contentRead,
    rateLimit: { scope: 'pm-read', max: 120 },
    handler: async ({ params, query }) => {
      const locale = localeFrom(query, config);

      let ref;
      try {
        ref = decodeRef(params.type ?? '', params.ref ?? '');
      } catch (err) {
        if (err instanceof PmRefError) return notFound();
        throw err;
      }

      if (ref.kind === 'archive') {
        const archives = await listArchives(config, locale);
        const match = archives.find((a) => a.remote_type === ref.type);
        return match ? NextResponse.json({ data: match }) : notFound();
      }

      const resolved = await resolveDocument(config, ref.id, params.type);
      if (!resolved) return notFound();
      return NextResponse.json({ data: await itemFor(config, resolved.collection, resolved.row) });
    },
  });
}

/** `GET /products` — the same catalogue narrowed to `pmPageType === 'product'`. */
export function pmProductsListRoute(config: CmsConfig) {
  return bridgeRoute({
    config,
    scope: 'pm:read',
    perm: PERMISSIONS.contentRead,
    rateLimit: { scope: 'pm-read', max: 120 },
    handler: async ({ query }) => {
      const page = clampPage(query.get('page'));
      const perPage = clampPerPage(query.get('per_page'));
      const locale = localeFrom(query, config);
      const modifiedAfter = parseModifiedAfter(query.get('modified_after'));

      const collections = config.collections.filter((c) => c.pmPageType === 'product');
      const types = collections.map((c) => c.key);
      const q = { types, locale, modifiedAfter, limit: perPage, offset: (page - 1) * perPage };

      const [total, rows] = await Promise.all([
        countDocuments({ ...q, limit: 0, offset: 0 }),
        selectDocuments(q),
      ]);

      const byKey = new Map(collections.map((c) => [c.key, c]));
      const data = [];
      for (const row of rows) {
        const collection = byKey.get(row.type);
        if (collection) data.push(await itemFor(config, collection, row));
      }

      const body: PmPage<unknown> = { data, meta: pmMeta(page, perPage, total) };
      return NextResponse.json(body);
    },
  });
}

/**
 * The push body PM sends.
 *
 * `expected_version` is accepted and validated but unused by phase-1 PM — having
 * it in the contract now means PM can opt into real compare-and-swap later
 * without a protocol change.
 *
 * `values` is capped: without a ceiling, one request could hand us ten thousand
 * keys to translate.
 */
/**
 * A push body that is too many BYTES, as opposed to too many keys.
 *
 * `parsePushBody` caps the number of top-level keys at 64 and says nothing about
 * their size, so 64 keys of unbounded length passed every check and went into the
 * `data` JSON column — which is then read on every render of that page and held
 * in the read cache. The `/payload` route has bounded its raw body since it was
 * written; the two push routes never did, and they are the ones that persist.
 *
 * Checked on the raw text for the same reason `/payload` does it: cheaper to
 * refuse the bytes than to walk what they parse into.
 */
function pushBodyTooLarge(rawBody: string): boolean {
  return rawBody.length > MAX_PAYLOAD_BYTES;
}

const tooLargeResponse = () =>
  NextResponse.json(
    { ok: false, error: 'invalid_input', message: 'Payload is too large.' },
    { status: 413 },
  );

function parsePushBody(body: unknown): { values: Record<string, unknown>; expectedVersion?: number } | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const values = record.values;
  if (!values || typeof values !== 'object' || Array.isArray(values)) return null;
  const keys = Object.keys(values as Record<string, unknown>);
  if (keys.length > 64) return null;

  const expected = record.expected_version;
  return {
    values: values as Record<string, unknown>,
    expectedVersion: typeof expected === 'number' && Number.isSafeInteger(expected) ? expected : undefined,
  };
}

const invalidBody = () =>
  NextResponse.json(
    { ok: false, error: 'invalid_input', message: 'Expected {values: {...}}.' },
    { status: 422 },
  );

/** `PATCH /pages/{type}/{ref}` — the write path. */
export function pmPageWriteRoute(config: CmsConfig) {
  return bridgeRoute({
    config,
    scope: 'pm:write',
    perm: PERMISSIONS.contentWrite,
    rateLimit: { scope: 'pm-write', max: 60 },
    handler: async ({ params, query, auth }) => {
      if (pushBodyTooLarge(auth.rawBody)) return tooLargeResponse();
      const parsed = parsePushBody(auth.body);
      if (!parsed) return invalidBody();

      const locale = localeFrom(query, config);

      let ref;
      try {
        ref = decodeRef(params.type ?? '', params.ref ?? '');
      } catch (err) {
        if (err instanceof PmRefError) return notFound();
        throw err;
      }

      if (ref.kind === 'archive') {
        const archive = config.pm.archives[ref.type];
        if (!archive) return notFound();
        return NextResponse.json(
          await applyArchiveValues(config, archive.path, locale, parsed.values, auth.principal),
        );
      }

      // Assert the resolved document really is the type PM addressed, before
      // writing anything.
      const resolved = await resolveDocument(config, ref.id, params.type);
      if (!resolved) return notFound();

      return NextResponse.json(
        await applyPageValues(config, ref, parsed.values, auth.principal, {
          expectedVersion: parsed.expectedVersion,
        }),
      );
    },
  });
}

/**
 * `PATCH /products/{id}` — a thin alias.
 *
 * It exists because `pushProduct()` addresses products by bare id while
 * `pushPage()` uses type + ref.
 */
export function pmProductWriteRoute(config: CmsConfig) {
  return bridgeRoute({
    config,
    scope: 'pm:write',
    perm: PERMISSIONS.contentWrite,
    rateLimit: { scope: 'pm-write', max: 60 },
    handler: async ({ params, auth }) => {
      if (pushBodyTooLarge(auth.rawBody)) return tooLargeResponse();
      // `pushProduct` sends the values unwrapped, unlike `pushPage`.
      const body = auth.body;
      const parsed =
        parsePushBody(body) ??
        (body && typeof body === 'object' && !Array.isArray(body)
          ? { values: body as Record<string, unknown>, expectedVersion: undefined }
          : null);
      if (!parsed) return invalidBody();

      let ref;
      try {
        ref = decodeRef('product', params.id ?? '');
      } catch (err) {
        if (err instanceof PmRefError) return notFound();
        throw err;
      }
      if (ref.kind !== 'document') return notFound();

      const resolved = await resolveDocument(config, ref.id, 'product');
      if (!resolved) return notFound();

      return NextResponse.json(
        await applyPageValues(config, ref, parsed.values, auth.principal, {
          expectedVersion: parsed.expectedVersion,
        }),
      );
    },
  });
}

/**
 * `PATCH /payload` — store a compiled `<head>` payload.
 *
 * When both `remote_id` and `path` arrive, **`remote_id` wins**: praion knows
 * its own permalinks better than PM does, and PM's copy can be stale by a slug
 * change. The disagreement is logged rather than silently resolved, because a
 * persistent one means PM's catalogue needs a resync.
 */
export function pmPayloadRoute(config: CmsConfig) {
  return bridgeRoute({
    config,
    scope: 'pm:payload',
    perm: PERMISSIONS.seoWrite,
    rateLimit: { scope: 'pm-payload', max: 120 },
    handler: async ({ query, auth }) => {
      const body = auth.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) return invalidBody();

      // Cheaper to reject on the raw text than to walk a parsed monster.
      if (auth.rawBody.length > MAX_PAYLOAD_BYTES) {
        return NextResponse.json(
          { ok: false, error: 'invalid_input', message: 'Payload is too large.' },
          { status: 413 },
        );
      }

      const input = body as PayloadInput;
      const locale = localeFrom(query, config);

      let target: PayloadTarget | null = null;

      if (typeof input.remote_id === 'string' && input.remote_id !== '') {
        try {
          const ref = decodeRef(
            typeof input.remote_type === 'string' ? input.remote_type : '',
            input.remote_id,
          );
          if (ref.kind === 'archive') {
            const archive = config.pm.archives[ref.type];
            if (archive) {
              target = { path: archive.path, locale, documentId: null, remoteType: ref.type };
            }
          } else {
            const resolved = await resolveDocument(config, ref.id);
            if (resolved) {
              const permalink = resolved.row.canonicalPath;
              if (permalink) {
                if (typeof input.path === 'string' && input.path !== permalink) {
                  console.warn(
                    '[cms/pm] payload path disagreement; using ours',
                    { theirs: input.path, ours: permalink },
                  );
                }
                target = {
                  path: permalink,
                  locale: resolved.row.locale,
                  documentId: resolved.row.id,
                  remoteType: resolved.collection.pmPageType!,
                };
              }
            }
          }
        } catch (err) {
          if (!(err instanceof PmRefError)) throw err;
        }
      }

      // Fall back to the supplied path only when the id resolved nothing.
      if (!target && typeof input.path === 'string' && input.path.startsWith('/')) {
        target = {
          path: input.path,
          locale,
          documentId: null,
          remoteType: typeof input.remote_type === 'string' ? input.remote_type : null,
        };
      }

      if (!target) return notFound();
      // Keyed like every reader asks: unprefixed path + locale. A document's
      // canonical path is `/en/foo` outside the main language, and a payload
      // stored under it was never found by any page.
      target = { ...target, path: localeKeyedPath(target.path, target.locale, config.defaultLocale) };

      try {
        const result = await storePayload(target, input, auth.principal);
        // A no-op push must not purge the cache, so revalidation lives inside
        // `storePayload` and only runs when something actually changed.
        if (result.written > 0 && target.documentId !== null) {
          const [row] = await getDb()
            .select()
            .from(schema.documents)
            .where(eq(schema.documents.id, target.documentId))
            .limit(1);
          if (row) revalidateDocument(row);
        }
        return NextResponse.json(result);
      } catch (err) {
        if (err instanceof PayloadError) {
          return NextResponse.json({ written: 0, errors: { payload: err.message }, skipped: [] });
        }
        throw err;
      }
    },
  });
}

/** `PATCH /pages/{type}/{ref}/image-alts` — alt text for a document's images. */
export function pmImageAltsRoute(config: CmsConfig) {
  return bridgeRoute({
    config,
    scope: 'pm:media',
    perm: PERMISSIONS.mediaWrite,
    rateLimit: { scope: 'pm-write', max: 60 },
    handler: async ({ params, auth }) => {
      const body = auth.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) return invalidBody();
      const record = body as Record<string, unknown>;
      const values = record.values;
      if (!Array.isArray(values) || values.length > 200) return invalidBody();

      let ref;
      try {
        ref = decodeRef(params.type ?? '', params.ref ?? '');
      } catch (err) {
        if (err instanceof PmRefError) return notFound();
        throw err;
      }
      // Archives have no images of their own.
      if (ref.kind !== 'document') return notFound();

      const resolved = await resolveDocument(config, ref.id, params.type);
      if (!resolved) return notFound();

      return NextResponse.json(
        await applyImageAlts(config, ref.id, values as AltEntry[], parseScope(record.scope), auth.principal),
      );
    },
  });
}

/** `GET /products/{id}` — PM addresses products by bare id. */
export function pmProductGetRoute(config: CmsConfig) {
  return bridgeRoute({
    config,
    scope: 'pm:read',
    perm: PERMISSIONS.contentRead,
    rateLimit: { scope: 'pm-read', max: 120 },
    handler: async ({ params }) => {
      let ref;
      try {
        ref = decodeRef('product', params.id ?? '');
      } catch (err) {
        if (err instanceof PmRefError) return notFound();
        throw err;
      }
      if (ref.kind !== 'document') return notFound();

      const resolved = await resolveDocument(config, ref.id, 'product');
      if (!resolved) return notFound();
      return NextResponse.json({ data: await itemFor(config, resolved.collection, resolved.row) });
    },
  });
}
