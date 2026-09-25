'use client';

import { useEffect } from 'react';

import type { LockHolder, LockResourceType } from '../../core/locks/protocol';
import { useLockActions, useLockSnapshot } from './EditLockProvider';
import type { LockPhase } from './phase';
import { lockPhase } from './rooms';

export interface EditLock {
  phase: LockPhase;
  /** True only when somebody ELSE holds it — the one thing the UI disables on. */
  readOnly: boolean;
  holder: LockHolder | null;
  takeOver: () => void;
}

const NO_LOCK: EditLock = { phase: 'unlocked', readOnly: false, holder: null, takeOver: () => {} };

/**
 * Claim the lock on one resource for as long as this component is mounted.
 *
 * `enabled` is how a screen opts out: a brand-new document has nothing to lock,
 * and a reader without write permission must not lock a document out from under
 * someone who can actually edit it.
 *
 * Re-subscribes when `key` changes, which is not hypothetical — a document's
 * translation group is assigned by the server on first save, so the key a form
 * starts with is not the key it ends up on.
 */
export function useEditLock({
  type,
  key,
  enabled,
}: {
  type: LockResourceType;
  key: string;
  enabled: boolean;
}): EditLock {
  const actions = useLockActions();
  const snapshot = useLockSnapshot();
  const active = Boolean(snapshot?.enabled) && enabled && key.length > 0;
  const subscribe = actions?.subscribe;

  /*
   * Depends on `subscribe` — which never changes — and NOT on the snapshot.
   *
   * Reading the room data here instead would re-run this effect on every state
   * frame: the cleanup releases and writes state, that write produces the next
   * frame, and the two chase each other until React gives up with "Maximum
   * update depth exceeded". That is why the provider keeps its callbacks in a
   * separate context from its data.
   */
  useEffect(() => {
    if (!subscribe || !active) return;
    return subscribe(type, key);
  }, [subscribe, active, type, key]);

  if (!snapshot || !actions || !active) return NO_LOCK;

  const holder = snapshot.rooms[`${type}:${key}`]?.holder ?? null;
  const phase = lockPhase({
    connected: snapshot.connected,
    holder,
    currentUserId: snapshot.currentUserId,
    sessionId: snapshot.sessionId,
  });

  return {
    phase,
    readOnly: phase === 'theirs',
    holder,
    takeOver: () => actions.takeOver(type, key),
  };
}
