import 'server-only';

import { z } from 'zod';

import { createRoute, noContent, ok } from '../../core';
import { localeOrDefault } from '../../core/paths';
import { PERMISSIONS, requireApiPerm } from '../auth';
import { newsletterSubscribeBody } from './logic';
import {
  deleteSubscriber,
  getSubscriber,
  listSubscribers,
  setSubscribed,
  subscribe,
  type SubscriberFilter,
} from './subscribers';

/**
 * A visitor submits once, maybe twice if they mistype. Five a minute per IP is
 * generous for a person and useless for a script, and it sits behind whatever
 * nginx already absorbs — the same shape as the contact endpoint's budget.
 */
const SUBSCRIBE_RATE_LIMIT = { scope: 'newsletter-subscribe', max: 5, windowMs: 60 * 1000 } as const;

/**
 * Public signup. `POST /api/newsletter`.
 *
 * Always answers 200 on a well-formed body, including for a tripped honeypot —
 * telling a bot its field was read is a map to getting past the trap.
 *
 * It DOES report an address that is already on the list, which is a deliberate
 * trade made against enumeration: this endpoint will confirm membership for any
 * address someone can type. It was made because a visitor who signs up twice
 * was being told "you're subscribed" a second time, which reads as though the
 * first attempt had failed. The per-IP budget above is what bounds the probing
 * it opens up; if that trade ever stops being worth it, this is the one line to
 * change.
 */
export function newsletterSubscribeRoute(opts: {
  /** The site's default locale (`config.defaultLocale`), stored when a signup arrives without one. */
  defaultLocale: string;
}) {
  return createRoute({
    rateLimit: SUBSCRIBE_RATE_LIMIT,
    input: newsletterSubscribeBody,
    handler: async ({ input, req }) => {
      // Honeypot: a bot filled a field no person can see. Answer with the
      // plainest success and write nothing — reporting anything else would
      // tell it that the field was read.
      if (input._hp && input._hp.length > 0) return ok({ status: 'subscribed' });

      const status = await subscribe({
        email: input.email,
        source: input.source,
        locale: localeOrDefault(input.locale, opts.defaultLocale),
        ua: req.headers.get('user-agent'),
      });
      return ok({ status });
    },
  });
}

const listQuery = z.object({
  status: z.enum(['all', 'active', 'unsubscribed']).optional(),
  search: z.string().trim().max(191).optional(),
  page: z.coerce.number().int().optional(),
  pageSize: z.coerce.number().int().optional(),
});

/** `GET /api/cms/newsletter` — the admin list. */
export function subscribersListRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.newsletterRead),
    query: listQuery,
    handler: async ({ query }) => {
      const result = await listSubscribers({
        status: query?.status as SubscriberFilter | undefined,
        search: query?.search,
        page: query?.page,
        pageSize: query?.pageSize,
      });
      // The same shape `paginated` produces, plus the tab counts — those ride
      // along with the page rather than living in a second endpoint, because
      // they are read on every render of the same screen.
      return Response.json({
        ok: true,
        items: result.items,
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        pageCount: Math.max(1, Math.ceil(result.total / Math.max(1, result.pageSize))),
        counts: result.counts,
      });
    },
  });
}

const updateBody = z.object({ subscribed: z.boolean() });

/** `PATCH /api/cms/newsletter/:id` — unsubscribe or resubscribe. */
export function subscriberUpdateRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.newsletterWrite),
    input: updateBody,
    handler: async ({ params, input }) => {
      const row = await setSubscribed(Number(params.id), input.subscribed);
      if (!row) return Response.json({ ok: false, error: 'not_found' }, { status: 404 });
      return ok(row);
    },
  });
}

/** `DELETE /api/cms/newsletter/:id` — erasure, not unsubscribe. */
export function subscriberDeleteRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.newsletterWrite),
    handler: async ({ params }) => {
      const id = Number(params.id);
      const existing = await getSubscriber(id);
      if (!existing) return Response.json({ ok: false, error: 'not_found' }, { status: 404 });
      await deleteSubscriber(id);
      return noContent();
    },
  });
}
