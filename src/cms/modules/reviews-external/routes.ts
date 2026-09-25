import 'server-only';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createRoute } from '../../core/api/handler';
import { idParam } from '../../core/api/params';
import { ok } from '../../core/api/respond';
import { logAudit } from '../../core/audit';
import { badRequest, notFound } from '../../core/errors';
import { setSecret } from '../../core/secrets/service';
import { getSetting, getSettingUncached, setSetting } from '../../core/settings';
import { getDb, schema } from '../../db';
import { PERMISSIONS, requireApiPerm } from '../auth';
import { exchangeGbpCode, gbpAuthorizeUrl, GOOGLE_SECRET_KEYS } from './google';
import { GOOGLE_REVIEWS_KEY } from './mapping';
import { listExternalReviews, listReviewLocations, setReviewHidden } from './read';
import { syncAllReviewLocations, syncReviewLocation } from './sync';

/**
 * Admin routes for the reviews integration.
 *
 * The OAuth pair is the interesting part: `start` mints a state value, stores
 * it, and sends the administrator to Google; `callback` refuses anything whose
 * state does not match what it issued, which is what stops a link in an email
 * from connecting someone else's Google account to this site.
 */

/** Where the one-time OAuth state lives while the round trip happens. */
const OAUTH_STATE_KEY = 'integrations.googleReviews.oauthState';
const STATE_TTL_MS = 10 * 60 * 1000;

export function reviewLocationsRoute() {
  return {
    GET: createRoute({
      guard: () => requireApiPerm(PERMISSIONS.settingsRead),
      handler: async () => ok({ locations: await listReviewLocations() }),
    }),
    POST: createRoute({
      guard: () => requireApiPerm(PERMISSIONS.settingsWrite),
      input: z
        .object({
          slug: z
            .string()
            .trim()
            .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
          label: z.string().trim().min(1).max(191),
          source: z.enum(['gbp', 'places']),
          placeId: z.string().trim().max(191).optional(),
          resourceName: z.string().trim().max(191).optional(),
        })
        .strict(),
      handler: async ({ input, auth }) => {
        await getDb()
          .insert(schema.reviewLocations)
          .values({
            slug: input.slug,
            label: input.label,
            source: input.source,
            placeId: input.placeId ?? null,
            resourceName: input.resourceName ?? null,
          })
          .onDuplicateKeyUpdate({
            set: {
              label: input.label,
              source: input.source,
              placeId: input.placeId ?? null,
              resourceName: input.resourceName ?? null,
            },
          });
        await logAudit({
          userId: auth.userId,
          action: 'reviews.location',
          subjectType: 'review_location',
          subjectId: input.slug,
        });
        return ok({ locations: await listReviewLocations() });
      },
    }),
  };
}

/** "Sync now", and the nightly cron job's handler. */
export function reviewSyncRoute() {
  return createRoute({
    rateLimit: { scope: 'reviews-sync', max: 5, windowMs: 60_000 },
    guard: () => requireApiPerm(PERMISSIONS.settingsWrite),
    input: z.object({ locationId: z.coerce.number().int().positive().optional() }).strict(),
    handler: async ({ input }) =>
      ok(
        input.locationId
          ? { results: [await syncReviewLocation(input.locationId)] }
          : await syncAllReviewLocations()
      ),
  });
}

/** Moderation: hide or show one review. Never edits its text. */
export function reviewHideRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.reviewsWrite),
    input: z.object({ hidden: z.boolean() }).strict(),
    handler: async ({ input, params, auth }) => {
      const id = idParam(params.id);
      await setReviewHidden(id, input.hidden);
      await logAudit({
        userId: auth.userId,
        action: 'review.hide',
        subjectType: 'review',
        subjectId: id,
        after: { hidden: input.hidden },
      });
      return ok({ id, hidden: input.hidden });
    },
  });
}

/** The admin's list of synced reviews, hidden ones included. */
export function reviewsExternalListRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.reviewsRead),
    handler: async () => ok({ reviews: await listExternalReviews({ min: 1 }) }),
  });
}

export function googleOauthStartRoute(opts: { redirectUri: string }) {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.settingsWrite),
    handler: async () => {
      const state = crypto.randomUUID();
      await setSetting(OAUTH_STATE_KEY, { state, at: Date.now() });
      return ok({ url: gbpAuthorizeUrl({ redirectUri: opts.redirectUri, state }) });
    },
  });
}

export function googleOauthCallbackRoute(opts: { redirectUri: string; adminPath: string }) {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.settingsWrite),
    handler: async ({ req, auth }) => {
      const url = new URL(req.url);
      const code = url.searchParams.get('code') ?? '';
      const state = url.searchParams.get('state') ?? '';
      // Uncached: the state was written a moment ago, and a stale read here refuses
      // every attempt after the first.
      const stored = (await getSettingUncached<{ state?: string; at?: number }>(OAUTH_STATE_KEY)) ?? {};

      // One use, ten minutes, and it must be the value this server issued.
      await setSetting(OAUTH_STATE_KEY, null);
      if (
        !code ||
        !state ||
        stored.state !== state ||
        Date.now() - (stored.at ?? 0) > STATE_TTL_MS
      ) {
        throw badRequest('This connection attempt has expired. Start again from Settings.');
      }

      const { refreshToken } = await exchangeGbpCode({ code, redirectUri: opts.redirectUri });
      await setSecret(GOOGLE_SECRET_KEYS.oauthRefreshToken, refreshToken, auth.userId);
      await logAudit({
        userId: auth.userId,
        action: 'secret.set',
        subjectType: 'secret',
        subjectId: GOOGLE_SECRET_KEYS.oauthRefreshToken,
      });
      // Back to the screen that started it, rather than a bare JSON body.
      return NextResponse.redirect(
        new URL(`${opts.adminPath}/settings?tab=Integrations&connected=google`, url.origin)
      );
    },
  });
}

/** The public read behind the shortcodes. */
export async function publicReviews(query: {
  location?: string;
  min?: number;
  limit?: number;
  sort?: 'newest' | 'rating';
}) {
  const config = await getSetting<{ enabled?: boolean }>(GOOGLE_REVIEWS_KEY);
  if (config?.enabled !== true) return [];
  return listExternalReviews(query);
}

export { notFound };
