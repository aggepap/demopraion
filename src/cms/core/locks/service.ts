import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';

import { getDb, schema } from '../../db';
import { logAudit } from '../audit';
import { ApiError, isDuplicateKeyError } from '../errors';
import { lockTtlSeconds, locksEnabled } from './config';
import { documentLockKey } from './keys';
import {
  decideAcquire,
  decideRelease,
  decideWrite,
  expiresAtFrom,
  holderView,
  type LockClaimant,
  type LockRecord,
} from './policy';
import type { LockResourceType, LockState } from './protocol';

/** The stored row, narrowed to what the policy reasons about. */
function toRecord(row: schema.EditingLockRow): LockRecord {
  return {
    resourceType: row.resourceType as LockResourceType,
    resourceKey: row.resourceKey,
    userId: row.userId,
    userName: row.userName,
    sessionId: row.sessionId,
    connectionId: row.connectionId,
    acquiredAt: row.acquiredAt,
    heartbeatAt: row.heartbeatAt,
    expiresAt: row.expiresAt,
  };
}

function state(type: LockResourceType, key: string, row: LockRecord | null): LockState {
  return { resourceType: type, resourceKey: key, holder: row ? holderView(row) : null };
}

/**
 * The current holder, or null.
 *
 * Expiry is judged here rather than by a sweeper: there is no cron in this
 * codebase (see `reservation_holds`, which does the same), and a lock that
 * outlived its holder must stop blocking people the moment it lapses, not
 * whenever something next happens to run.
 */
export async function readLock(
  resourceType: LockResourceType,
  resourceKey: string,
): Promise<LockRecord | null> {
  if (!locksEnabled()) return null;
  const [row] = await getDb()
    .select()
    .from(schema.editingLocks)
    .where(
      and(
        eq(schema.editingLocks.resourceType, resourceType),
        eq(schema.editingLocks.resourceKey, resourceKey),
      ),
    )
    .limit(1);
  if (!row) return null;
  const record = toRecord(row);
  return record.expiresAt.getTime() <= Date.now() ? null : record;
}

/**
 * Take or renew a lock.
 *
 * `force` is the "Take over" button: the decision is overridden, but everything
 * else — the transaction, the row shape, the broadcast — is identical, so a
 * seized lock cannot end up in a state an ordinary one could not.
 */
export async function acquireLock(input: {
  resourceType: LockResourceType;
  resourceKey: string;
  claimant: LockClaimant;
  force?: boolean;
  ip?: string;
}): Promise<LockState> {
  if (!locksEnabled()) {
    return state(input.resourceType, input.resourceKey, null);
  }
  try {
    return await runAcquire(input);
  } catch (err) {
    /*
     * Two first-acquires on the same resource race into the same gap in
     * `uniq_editing_locks_resource`. MariaDB usually serialises them, but
     * "usually" is not a guarantee and the loser surfaced as a bare 409
     * "Already exists." — which reads to the user as though somebody held the
     * lock when nobody did. Re-read and re-decide once: by then the winner's
     * row exists and the loser gets the honest "held by other".
     */
    if (!isDuplicateKeyError(err)) throw err;
    return await runAcquire(input);
  }
}

async function runAcquire(input: {
  resourceType: LockResourceType;
  resourceKey: string;
  claimant: LockClaimant;
  force?: boolean;
  ip?: string;
}): Promise<LockState> {
  const { resourceType, resourceKey, claimant } = input;
  const ttl = lockTtlSeconds();
  const db = getDb();

  const outcome = await db.transaction(async (tx) => {
    // `for('update')` on the unique key, the same mutex shape `booking_slots`
    // and `orders.ts` use to serialise their own writers.
    const [existingRow] = await tx
      .select()
      .from(schema.editingLocks)
      .where(
        and(
          eq(schema.editingLocks.resourceType, resourceType),
          eq(schema.editingLocks.resourceKey, resourceKey),
        ),
      )
      .limit(1)
      .for('update');

    /*
     * Whole seconds, because that is what a MySQL `timestamp` column stores.
     * Without the floor, the state returned by the very first acquire carried
     * millisecond precision while every read after it came back truncated — so
     * the "since" a client was handed on acquire never matched the "since" the
     * next broadcast gave it, and a renewal looked like a new lock.
     */
    const now = new Date(Math.floor(Date.now() / 1000) * 1000);
    const existing = existingRow ? toRecord(existingRow) : null;
    const { decision, expiresAt } = decideAcquire(existing, claimant, now, ttl);

    if (decision === 'held-by-other' && !input.force) {
      // Unreachable with `existing === null`: `decideAcquire` only returns
      // `held-by-other` when there is a live row to be held by.
      return { taken: false as const, holder: existing as LockRecord, previous: null };
    }

    const values = {
      resourceType,
      resourceKey,
      userId: claimant.userId,
      userName: claimant.userName,
      sessionId: claimant.sessionId,
      connectionId: claimant.connectionId,
      heartbeatAt: now,
      expiresAt,
    };
    // A renewal keeps the original start time, so the banner keeps saying how
    // long the person has really been in the document rather than resetting to
    // "just now" on every heartbeat.
    const acquiredAt = decision === 'renewed' && existing ? existing.acquiredAt : now;

    if (existingRow) {
      await tx
        .update(schema.editingLocks)
        .set({ ...values, acquiredAt })
        .where(eq(schema.editingLocks.id, existingRow.id));
    } else {
      await tx.insert(schema.editingLocks).values({ ...values, acquiredAt });
    }

    return {
      taken: true as const,
      holder: { ...values, acquiredAt } satisfies LockRecord,
      // Only a genuine seizure has a previous holder worth recording.
      previous: decision === 'held-by-other' && existing ? existing : null,
    };
  });

  if (outcome.taken && outcome.previous) {
    await logAudit({
      userId: claimant.userId,
      action: 'lock.takeover',
      subjectType: resourceType,
      subjectId: resourceKey,
      before: { holder: outcome.previous.userName, userId: outcome.previous.userId },
      after: { holder: claimant.userName, userId: claimant.userId },
      ip: input.ip,
    });
  }

  return state(resourceType, resourceKey, outcome.holder);
}

/** Give up a lock, if this socket is still the one holding it. */
export async function releaseLock(input: {
  resourceType: LockResourceType;
  resourceKey: string;
  connectionId: string;
}): Promise<LockState> {
  if (!locksEnabled()) return state(input.resourceType, input.resourceKey, null);
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.editingLocks)
    .where(
      and(
        eq(schema.editingLocks.resourceType, input.resourceType),
        eq(schema.editingLocks.resourceKey, input.resourceKey),
      ),
    )
    .limit(1);

  const existing = row ? toRecord(row) : null;
  if (decideRelease(existing, input.connectionId) === 'ignore') {
    return state(input.resourceType, input.resourceKey, existing);
  }
  // `decideRelease` only says 'release' when it was given a row.
  if (row) await db.delete(schema.editingLocks).where(eq(schema.editingLocks.id, row.id));
  return state(input.resourceType, input.resourceKey, null);
}

/**
 * Drop every lock a closed socket held, and report which rooms changed so the
 * relay can tell the people waiting.
 */
export async function releaseConnection(connectionId: string): Promise<LockState[]> {
  if (!locksEnabled()) return [];
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.editingLocks)
    .where(eq(schema.editingLocks.connectionId, connectionId));
  if (rows.length === 0) return [];
  await db.delete(schema.editingLocks).where(eq(schema.editingLocks.connectionId, connectionId));
  return rows.map((r) => state(r.resourceType as LockResourceType, r.resourceKey, null));
}

/**
 * Push the expiry of every lock held by a live socket forward.
 *
 * Batched by the relay into one call for all its connections, so the cost is
 * one statement per heartbeat interval rather than one per editor.
 */
export async function heartbeatLocks(connectionIds: readonly string[]): Promise<number> {
  if (!locksEnabled() || connectionIds.length === 0) return 0;
  const now = new Date();
  await getDb()
    .update(schema.editingLocks)
    .set({ heartbeatAt: now, expiresAt: expiresAtFrom(now, lockTtlSeconds()) })
    .where(inArray(schema.editingLocks.connectionId, [...connectionIds]));
  return connectionIds.length;
}

/**
 * Refuse a write that would land on top of somebody else's editing session.
 *
 * Called from the route layer rather than from `updateDocument`, so the PM
 * bridge (`modules/pm/write.ts`) and the seed CLIs are untouched. They are not
 * humans in an editor: the bridge already degrades per-field on conflict, and
 * locking it would turn a Product Manager push into a silent partial failure
 * whenever somebody happened to have a tab open.
 *
 * This sits ALONGSIDE `expectedVersion`, which remains the thing that actually
 * prevents a lost write. This one exists so two people rarely get that far.
 */
export async function assertNotLockedByOther(
  resourceType: LockResourceType,
  resourceKey: string,
  callerUserId: number | null,
): Promise<void> {
  if (!locksEnabled()) return;
  const existing = await readLock(resourceType, resourceKey);
  if (decideWrite(existing, callerUserId, new Date()) === 'allowed') return;
  throw new ApiError(
    'conflict',
    // `decideWrite` only says 'blocked' when there is a live holder.
    `${existing ? existing.userName : 'Somebody else'} is editing this right now, and saving would overwrite their work. ` +
      `Open the editor and use "Take over" if you need it.`,
  );
}

/**
 * The lock key for a stored document.
 *
 * The client derives the same key from the variants the editor page loaded, and
 * the two MUST agree — a mismatch would not fail loudly, it would quietly leave
 * the document unlocked. They agree because `getDocumentGroup` returns `[row]`
 * for a document with no `translation_group_id`, so the client's
 * `min(variantIds)` is that row's own id, which is what this returns.
 */
export function documentLockKeyFor(doc: {
  id: number;
  translationGroupId: string | null;
}): string {
  return documentLockKey({ translationGroupId: doc.translationGroupId, variantIds: [doc.id] });
}
