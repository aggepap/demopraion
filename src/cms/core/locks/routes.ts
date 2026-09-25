import 'server-only';

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createRoute, ok } from '../api';
import { ApiError, forbidden } from '../errors';
import { checkRateLimit, clientIpLabel } from '../rate-limit';
import { timingSafeEquals } from '../tokens/crypto';
import { hasPerm, PERMISSIONS, requireApiPerm } from '../../modules/auth';
import { lockInternalSecret } from './config';
import { acquireLock, heartbeatLocks, readLock, releaseConnection, releaseLock } from './service';
import {
  clientFrame,
  LOCK_INTERNAL_HEADER,
  lockResourceTypes,
  type LockResourceType,
} from './protocol';
import { holderView } from './policy';

/**
 * What the relay forwards: the browser's frame, plus the ids that identify the
 * socket it arrived on. The relay supplies `connectionId`; it is never taken
 * from the browser, or a tab could release somebody else's lock.
 */
const gatewayBody = clientFrame.extend({
  sessionId: z.string().min(1).max(36),
  connectionId: z.string().min(1).max(36),
});

/**
 * The permission a resource's lock demands.
 *
 * Holding a lock is not a read: it stops other people working. Gating this on
 * `cms.access` alone would let anyone who can merely open the admin take every
 * document hostage from the editors — a denial of service by someone with no
 * right to change a word of it. The permission to lock is the permission to
 * write, per resource, and the UI's `enabled` flags are only a courtesy on top.
 */
const LOCK_PERMISSION: Record<LockResourceType, string> = {
  document: PERMISSIONS.contentWrite,
  order: PERMISSIONS.ordersWrite,
  reservation: PERMISSIONS.reservationsWrite,
};

/**
 * `POST /api/cms/locks` — the one endpoint the relay calls on a client's behalf.
 *
 * The IP rate limit that every other route carries is deliberately absent:
 * requests arrive from the relay over loopback, so `getClientIp` sees a single
 * address for the whole admin team and one busy tab would spend everyone's
 * budget. The relay throttles per socket instead, and this bucket is per USER,
 * which is the axis that survives the loopback hop. (`mdx-preview.ts` buckets by
 * user id for the same reason.)
 */
export function lockGatewayRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.access),
    input: gatewayBody,
    handler: async ({ input, auth, req }) => {
      const needed = LOCK_PERMISSION[input.resourceType];
      if (!hasPerm(auth.permissions, needed)) throw forbidden();

      const limit = checkRateLimit('cms-locks', String(auth.userId), {
        max: 120,
        windowMs: 60_000,
      });
      if (!limit.allowed) {
        throw new ApiError('rate_limited', 'Too many lock requests.', {
          headers: { 'Retry-After': String(limit.retryAfterSeconds) },
        });
      }

      const claimant = {
        userId: auth.userId,
        userName: auth.name,
        sessionId: input.sessionId,
        connectionId: input.connectionId,
      };
      const target = { resourceType: input.resourceType, resourceKey: input.resourceKey };

      switch (input.action) {
        case 'acquire':
          return ok(await acquireLock({ ...target, claimant, ip: clientIpLabel(req) }));
        case 'takeover':
          return ok(
            await acquireLock({ ...target, claimant, force: true, ip: clientIpLabel(req) }),
          );
        case 'release':
          return ok(await releaseLock({ ...target, connectionId: input.connectionId }));
        case 'observe': {
          const lock = await readLock(input.resourceType, input.resourceKey);
          return ok({ ...target, holder: lock ? holderView(lock) : null });
        }
      }
    },
  });
}

/**
 * The relay's own credential.
 *
 * A nuisance boundary, not a privilege one: the endpoints behind it can only
 * renew or delete rows already matching a `connection_id`, never create a lock
 * or move one to another user — that path goes through the session cookie. Do
 * not later "harden" this into something load-bearing.
 */
function requireRelay(req: NextRequest): NextResponse | null {
  const secret = lockInternalSecret();
  if (!secret || !timingSafeEquals(req.headers.get(LOCK_INTERNAL_HEADER), secret)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  return null;
}

const heartbeatBody = z.object({
  connectionIds: z.array(z.string().min(1).max(36)).max(500),
});

/** `POST /api/cms/locks/heartbeat` — one batched call for every live socket. */
export function lockHeartbeatRoute() {
  return createRoute({
    guard: (req) => requireRelay(req),
    input: heartbeatBody,
    handler: async ({ input }) => ok({ renewed: await heartbeatLocks(input.connectionIds) }),
  });
}

const relayReleaseBody = z.object({
  connectionId: z.string().min(1).max(36),
  resourceType: z.enum(lockResourceTypes).optional(),
  resourceKey: z.string().max(64).optional(),
});

/**
 * `POST /api/cms/locks/release` — a socket closed.
 *
 * Without a resource it drops everything that socket held, which is the normal
 * case: a closed tab releases every room it was in at once.
 */
export function lockRelayReleaseRoute() {
  return createRoute({
    guard: (req) => requireRelay(req),
    input: relayReleaseBody,
    handler: async ({ input }) => {
      if (input.resourceType && input.resourceKey) {
        return ok({
          released: [
            await releaseLock({
              resourceType: input.resourceType,
              resourceKey: input.resourceKey,
              connectionId: input.connectionId,
            }),
          ],
        });
      }
      return ok({ released: await releaseConnection(input.connectionId) });
    },
  });
}
