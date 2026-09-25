import 'server-only';

import { z } from 'zod';

import type { CmsConfig } from '../../config';
import { PERMISSIONS, requireApiPerm } from '../../modules/auth';
import { createRoute } from '../api/handler';
import { ok } from '../api/respond';
import { badRequest } from '../errors';
import { resolveCollectionWithCustomFields } from '../fields/resolve';
import { buildImportTemplate, mdxBodyField, parseDocumentMarkdown } from '../import';
import { assertCollection } from './collections';

/**
 * Download a template / parse a filled-in one. Parameterised by the site config,
 * like every other route factory here; the file under `src/app/api/cms/**` is
 * wiring.
 *
 * ## Why this is JSON and not multipart
 *
 * The only caller is the admin, which can `await file.text()` before it posts —
 * so the file arrives as a string and `createRoute` handles it like any other
 * body. That keeps the same-origin check, the rate limit, the permission guard,
 * the zod schema and the uniform error shape, all of which the one hand-written
 * multipart route in this codebase (`media/upload`) had to re-apply by hand
 * after going a whole release without two of them.
 *
 * Multipart would buy nothing here in any case: `sniffMime` decides a file's
 * type from its magic bytes, and markdown has none — the only real check is
 * whether the thing parses, which is what this route does.
 */

const MAX_SOURCE_BYTES = 512 * 1024;

const parseBody = z.object({
  /** Used to derive the slug and the locale. Not trusted for anything else. */
  filename: z.string().max(255).optional(),
  source: z
    .string()
    .max(MAX_SOURCE_BYTES, `That file is too large — the limit is ${MAX_SOURCE_BYTES / 1024} KB of text.`),
});

/** The collection as the form will see it, so import and editor agree on the fields. */
async function importCollection(config: CmsConfig, key: string) {
  await assertCollection(config, key);
  const collection = await resolveCollectionWithCustomFields(config, key);
  if (!mdxBodyField(collection.fields)) {
    /*
     * Refused rather than half-supported. A collection with no markdown body —
     * a product, a category, a page whose body is TipTap JSON — has no sensible
     * home for everything under the closing `---`, and importing only the
     * frontmatter would look like it worked while dropping the actual writing.
     */
    throw badRequest(`"${key}" has no markdown body, so there is nothing to import a .md file into.`);
  }
  return collection;
}

/** GET /api/cms/:collection/import — the template for this collection. */
export function importTemplateRoute(config: CmsConfig) {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.contentWrite),
    handler: async ({ params }) => {
      const collection = await importCollection(config, params.collection);
      const body = buildImportTemplate(collection, {
        locales: config.locales,
        defaultLocale: config.defaultLocale,
      });
      return new Response(body, {
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          // `filename` is built from the collection key, which `defineConfig`
          // already constrains — no user input reaches this header.
          'Content-Disposition': `attachment; filename="${collection.key}-template.md"`,
          'Cache-Control': 'no-store',
        },
      });
    },
  });
}

/** POST /api/cms/:collection/import — parse a file. Writes nothing. */
export function importParseRoute(config: CmsConfig) {
  return createRoute({
    /*
     * `contentWrite`, not `contentPublish`, and no audit entry: this route reads
     * a string and returns an object. The document is created later by the
     * ordinary create route, which is where publish rights and the audit log
     * belong — duplicating either here would record an authoring event that may
     * never happen.
     */
    guard: () => requireApiPerm(PERMISSIONS.contentWrite),
    rateLimit: { scope: 'cms-content-import', max: 30, windowMs: 60_000 },
    input: parseBody,
    handler: async ({ params, input }) => {
      const collection = await importCollection(config, params.collection);

      const result = await parseDocumentMarkdown({
        collection,
        source: input.source,
        filename: input.filename,
        locales: config.locales,
      });

      /*
       * A `collection:` naming a different type is refused, not ignored. Every
       * editorial collection here shares the same header/body/schema anatomy, so
       * an answer imported onto the article screen would fill in most fields and
       * quietly drop the ones that differ — the failure would surface as a page
       * missing its how-to block, long after anyone remembers the import.
       */
      if (result.document.collection && result.document.collection !== collection.key) {
        result.errors.unshift({
          message: `This file says it is a "${result.document.collection}", but you are importing into "${collection.key}". Open the ${result.document.collection} screen, or change the "collection" line in the file.`,
        });
      }

      return ok({
        collection: collection.key,
        document: result.document,
        errors: result.errors,
        warnings: result.warnings,
      });
    },
  });
}
