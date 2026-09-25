import 'server-only';

import { z } from 'zod';

import { PERMISSIONS, requireApiPerm } from '../../modules/auth';
import { logAudit } from '../audit';
import { createRoute } from '../api/handler';
import { uuidParam } from '../api/params';
import { noContent, ok, paginated } from '../api/respond';
import { notFound } from '../errors';
import { countMedia, deleteMedia, listMedia, MEDIA_PAGE_MAX, mediaPageLimit, setMediaAltText } from '../media/service';

const mediaListQuery = z.object({
  limit: z.coerce.number().int().positive().max(MEDIA_PAGE_MAX).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  /** Filename fragment. The grid had no way to narrow hundreds of files to one. */
  search: z.string().trim().max(191).optional(),
});

/** GET /api/cms/media — one page of media files (with serve URLs), newest first. */
export function mediaListRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.mediaRead),
    query: mediaListQuery,
    handler: async ({ query }) => {
      /*
       * The same envelope as every other list in the admin.
       *
       * This route returned a bare array under `data` while documents, reviews, orders
       * and submissions all use `paginated()` — two conventions for the same thing, and
       * the one that was different was also the one with no total, so the media grid
       * could not say how many files there were or how far "Load more" had to go.
       */
      const limit = mediaPageLimit(query?.limit);
      const [items, total] = await Promise.all([listMedia(query ?? {}), countMedia(query?.search)]);
      return paginated(items, {
        page: Math.floor((query?.offset ?? 0) / Math.max(1, limit)) + 1,
        pageSize: limit,
        total,
      });
    },
  });
}

/** DELETE /api/cms/media/:uuid — remove a media file (disk + row). */
/**
 * `PATCH /api/cms/media/:uuid` — edit a file's default alt text.
 *
 * Added because the PM bridge writes `media_files.alt_text`, and a column only a
 * machine can set is worse than one that does not exist: an editor would see alt
 * text on the site with no way to correct it.
 */
export interface MediaUpdateDeps {
  requirePerm: (key: string) => Promise<{ userId: number } | Response>;
  setAltText: (uuid: string, altText: string | null) => Promise<boolean>;
  audit: typeof logAudit;
}

/*
 * The collaborators are injectable so the permission and validation paths can be
 * tested without a session store or a database; the route file passes nothing.
 */
export function mediaUpdateRoute(deps: Partial<MediaUpdateDeps> = {}) {
  const requirePerm = deps.requirePerm ?? requireApiPerm;
  const setAltText = deps.setAltText ?? setMediaAltText;
  const audit = deps.audit ?? logAudit;
  return createRoute({
    guard: () => requirePerm(PERMISSIONS.mediaWrite),
    input: z.object({ altText: z.string().max(512).nullish() }),
    handler: async ({ params, input, auth }) => {
      const uuid = uuidParam(params.uuid, 'media id');
      // Normalised once, so what is stored, audited and echoed back agree — the
      // screen shows the echoed value as the saved one.
      const altText = input.altText?.trim() ? input.altText.trim() : null;
      const updated = await setAltText(uuid, altText);
      if (!updated) throw notFound('No such media file.');
      await audit({
        userId: auth.userId,
        action: 'media.update',
        subjectType: 'media_file',
        subjectId: uuid,
        after: { altText },
      });
      return ok({ uuid, altText });
    },
  });
}

export function mediaDeleteRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.mediaWrite),
    handler: async ({ params, auth }) => {
      // The uuid goes on to `unlink()`. `uuidParam` is the first of three checks
      // — see `media/service.ts` (row must exist) and `media/storage.ts` (the
      // resolved path must stay under the upload directory).
      const uuid = uuidParam(params.uuid, 'media id');
      const deleted = await deleteMedia(uuid);
      if (!deleted) throw notFound('No such media file.');
      await logAudit({
        userId: auth.userId,
        action: 'media.delete',
        subjectType: 'media_file',
        subjectId: uuid,
      });
      return noContent();
    },
  });
}
