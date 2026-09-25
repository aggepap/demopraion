import type { LockHolder } from '../../core/locks/protocol';
import type { LockPhase } from './phase';

/**
 * The room map, and the rules for changing it without causing a render loop.
 *
 * ## Why identity is load-bearing here
 *
 * The provider hands `rooms` down through context, so **allocating a new object
 * re-renders every editor on screen and re-runs their effects**. An update that
 * always returned a fresh object span forever: a consumer's effect cleaned up,
 * the cleanup changed the identity, the identity change re-ran the effect, and
 * round again — fast enough for React to abort with "Maximum update depth
 * exceeded", and it happened even with the relay down, when nothing had changed
 * at all.
 *
 * So both updaters below return the SAME reference when nothing really changed.
 * That is not a micro-optimisation; it is the loop guard.
 */
export interface RoomState {
  holder: LockHolder | null;
}

export type Rooms = Record<string, RoomState>;

function sameHolder(a: LockHolder | null, b: LockHolder | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.userId === b.userId &&
    a.userName === b.userName &&
    a.sessionId === b.sessionId &&
    a.since === b.since
  );
}

/** Record a room's holder. Unchanged holder ⇒ unchanged map. */
export function applyRoomState(rooms: Rooms, room: string, holder: LockHolder | null): Rooms {
  const current = rooms[room];
  // Heartbeats, reconnects and re-acquires all re-broadcast a holder that has
  // not moved, so this is the common case rather than the rare one.
  if (current && sameHolder(current.holder, holder)) return rooms;
  return { ...rooms, [room]: { holder } };
}

/** Forget a room. Absent room ⇒ unchanged map. */
export function removeRoom(rooms: Rooms, room: string): Rooms {
  if (!(room in rooms)) return rooms;
  const next = { ...rooms };
  delete next[room];
  return next;
}

/**
 * What this tab's relationship to a resource is.
 *
 * `unavailable` is deliberately NOT a kind of locked: with no connection nobody
 * has acquired anything, so nothing is held and the editor stays usable. The
 * server's own refusal is what protects the data.
 */
export function lockPhase(input: {
  connected: boolean;
  holder: LockHolder | null;
  currentUserId: number;
  sessionId: string;
}): LockPhase {
  if (!input.connected) return 'unavailable';
  if (!input.holder) return 'unlocked';
  if (input.holder.userId !== input.currentUserId) return 'theirs';
  return input.holder.sessionId === input.sessionId ? 'mine' : 'mine-elsewhere';
}
