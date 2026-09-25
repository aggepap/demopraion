/**
 * The wire contract between the browser, the WebSocket relay and the app.
 *
 * Deliberately free of `server-only` and of any I/O: the admin client imports
 * it for the frame shapes, the route imports it to validate what the relay
 * forwarded. `modules/auth/session-idle.ts` is shared across the same boundary
 * for the same reason.
 */
import { z } from 'zod';

import { isValidResourceKey } from './keys';

/**
 * Identifies the relay to the app on the heartbeat and release endpoints.
 *
 * This is a nuisance boundary, not a privilege boundary, and it must not be
 * "hardened" into one later: both endpoints can only renew or delete a row that
 * already matches a `connection_id` they were given. Neither can create a lock
 * or move one to a different user — that path goes through the session cookie.
 */
export const LOCK_INTERNAL_HEADER = 'x-cms-lock-secret';

export const lockResourceTypes = ['document', 'order', 'reservation'] as const;
export type LockResourceType = (typeof lockResourceTypes)[number];

/** Room names are namespaced by type: an order and a document may both be "12". */
export function roomKey(type: LockResourceType, key: string): string {
  return `${type}:${key}`;
}

/**
 * What a browser may ask for.
 *
 * `.strip()` is the point of this schema, not a detail: the relay forwards
 * frames verbatim, so anything the payload could smuggle through would be
 * attacker-controlled. Identity is read from the signed session cookie on the
 * forwarded request and never from the frame — a `userId` here is dropped.
 */
export const clientFrame = z
  .object({
    action: z.enum(['acquire', 'release', 'takeover', 'observe']),
    resourceType: z.enum(lockResourceTypes),
    resourceKey: z.string().refine(isValidResourceKey, 'Malformed resource key.'),
    /** The tab's own id. Optional on the wire so an `observe` frame from a tab
     *  that has not generated one yet is still valid; the gateway requires it
     *  for anything that takes a lock. */
    sessionId: z.string().max(36).optional(),
  })
  .strip();

export type ClientFrame = z.infer<typeof clientFrame>;

/** Who holds a resource, as broadcast to everyone watching it. */
export interface LockHolder {
  userId: number;
  userName: string;
  /** Lets a tab recognise its own lock. Not a credential — see `decideWrite`. */
  sessionId: string;
  /** ISO timestamp, so the banner can say "started 4 minutes ago". */
  since: string;
}

/** A room's current state, pushed to every socket watching it. */
export interface LockState {
  resourceType: LockResourceType;
  resourceKey: string;
  holder: LockHolder | null;
}
