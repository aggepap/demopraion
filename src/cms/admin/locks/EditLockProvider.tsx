'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import type { LockHolder, LockResourceType } from '../../core/locks/protocol';
import { applyRoomState, removeRoom, type Rooms } from './rooms';
import { editSessionId } from './session-id';
import { resolveWsUrl } from './ws-url';

/**
 * One WebSocket for the whole admin shell.
 *
 * ## This is not the boundary
 *
 * Exactly like `IdleLogout`, what this adds is a predictable experience, not a
 * guarantee. The server refuses a save that would land on somebody else's
 * editing session whatever this component believes, and `expectedVersion` still
 * stands behind that. What the socket buys is finding out *before* you have
 * typed for ten minutes.
 *
 * ## One socket, not one per editor
 *
 * Rooms are multiplexed over a single connection held by the shell, so clicking
 * between orders does not open and close a socket each time, and documents,
 * orders and reservations all share one implementation.
 *
 * ## It must never block
 *
 * The state machine starts at "no lock" — editable — and only ever becomes
 * read-only on an explicit frame naming somebody else. If the relay is down,
 * nobody acquires, so nobody is blocked, and the admin behaves exactly as it
 * did before this feature existed. A collaboration nicety that could make the
 * CMS read-only because a sidecar died would be worse than no feature at all.
 */

/**
 * TWO contexts, and the split is deliberate.
 *
 * A consumer subscribes from an effect, and that effect's dependency list has
 * to contain whatever it calls. When the actions and the room data travelled
 * together, the context object's identity changed on every state frame — so
 * every editor's effect tore down and resubscribed, the teardown wrote state,
 * and React aborted with "Maximum update depth exceeded". Splitting them makes
 * that impossible to reintroduce: `LockActionsContext` holds only stable
 * callbacks and never changes after mount, so depending on it is always safe.
 */
export interface LockActions {
  subscribe: (type: LockResourceType, key: string) => () => void;
  takeOver: (type: LockResourceType, key: string) => void;
}

export interface LockSnapshot {
  /** Per browser TAB, so a refresh keeps its own lock. Empty before mount. */
  sessionId: string;
  currentUserId: number;
  connected: boolean;
  enabled: boolean;
  rooms: Rooms;
}

const LockActionsContext = createContext<LockActions | null>(null);
const LockSnapshotContext = createContext<LockSnapshot | null>(null);

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 15_000;

/** Never fires: this tab's id does not change once it exists. */
const subscribeNothing = () => () => {};

function roomName(type: LockResourceType, key: string): string {
  return `${type}:${key}`;
}

export function EditLockProvider({
  children,
  wsUrl,
  enabled,
  currentUserId,
}: {
  children: ReactNode;
  /** Blank in production: the client derives it from `location`, which keeps the
   *  socket on the document's own origin so CSP `connect-src 'self'` covers it. */
  wsUrl: string;
  enabled: boolean;
  currentUserId: number;
}) {
  const [connected, setConnected] = useState(false);
  const [rooms, setRooms] = useState<Rooms>({});

  const socket = useRef<WebSocket | null>(null);
  const backoff = useRef(RECONNECT_MIN_MS);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** How many components want each room, so the last one out sends the release. */
  const subscribers = useRef(new Map<string, number>());
  /*
   * Empty on the server and through the first client render, the tab's id after
   * that. `crypto.randomUUID()` and `sessionStorage` do not exist on the server,
   * so this cannot be a plain `useState` initialiser without a hydration
   * mismatch — and discovering hydration by setting state in an effect would
   * schedule an extra render pass for something React already knows.
   * `useHydrated` uses this same shape for the same reason.
   */
  const sessionId = useSyncExternalStore(
    subscribeNothing,
    editSessionId,
    () => '',
  );

  const send = useCallback(
    (action: string, type: LockResourceType, key: string) => {
      const ws = socket.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(
        JSON.stringify({ action, resourceType: type, resourceKey: key, sessionId: editSessionId() }),
      );
    },
    [],
  );

  useEffect(() => {
    if (!enabled || !sessionId) return;
    let closed = false;

    const url = resolveWsUrl(wsUrl, location);

    const connect = () => {
      if (closed) return;
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        schedule();
        return;
      }
      socket.current = ws;

      ws.onopen = () => {
        backoff.current = RECONNECT_MIN_MS;
        setConnected(true);
        // Re-acquire everything this tab still has open. A reconnect after the
        // relay restarted must put the locks back, not leave the editor
        // believing it holds something the server has forgotten.
        for (const [room, count] of subscribers.current) {
          if (count <= 0) continue;
          const [type, ...rest] = room.split(':');
          send('acquire', type as LockResourceType, rest.join(':'));
        }
      };

      ws.onmessage = (event) => {
        let frame: { type?: string; resourceType?: string; resourceKey?: string; holder?: LockHolder | null };
        try {
          frame = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (frame.type !== 'state' || !frame.resourceType || !frame.resourceKey) return;
        const room = roomName(frame.resourceType as LockResourceType, frame.resourceKey);
        // `applyRoomState` keeps the same object when the holder has not moved,
        // so a heartbeat re-broadcast does not re-render every open editor.
        setRooms((prev) => applyRoomState(prev, room, frame.holder ?? null));
      };

      ws.onclose = () => {
        setConnected(false);
        socket.current = null;
        schedule();
      };
      ws.onerror = () => ws.close();
    };

    const schedule = () => {
      if (closed || retry.current) return;
      // Jittered, so a relay restart does not bring every admin's tab back in
      // the same millisecond.
      const wait = backoff.current + Math.random() * 500;
      retry.current = setTimeout(() => {
        retry.current = null;
        backoff.current = Math.min(backoff.current * 2, RECONNECT_MAX_MS);
        connect();
      }, wait);
    };

    connect();
    return () => {
      closed = true;
      if (retry.current) clearTimeout(retry.current);
      retry.current = null;
      socket.current?.close();
      socket.current = null;
    };
  }, [enabled, sessionId, wsUrl, send]);

  const subscribe = useCallback(
    (type: LockResourceType, key: string) => {
      const room = roomName(type, key);
      const next = (subscribers.current.get(room) ?? 0) + 1;
      subscribers.current.set(room, next);
      if (next === 1) send('acquire', type, key);
      return () => {
        const left = (subscribers.current.get(room) ?? 1) - 1;
        subscribers.current.set(room, left);
        if (left <= 0) {
          subscribers.current.delete(room);
          send('release', type, key);
          setRooms((prev) => removeRoom(prev, room));
        }
      };
    },
    [send],
  );

  const takeOver = useCallback(
    (type: LockResourceType, key: string) => send('takeover', type, key),
    [send],
  );

  // Stable for the life of the provider: both callbacks close over refs only.
  const actions = useMemo(() => ({ subscribe, takeOver }), [subscribe, takeOver]);
  const snapshot = useMemo(
    () => ({ sessionId, currentUserId, connected, enabled, rooms }),
    [sessionId, currentUserId, connected, enabled, rooms],
  );

  return (
    <LockActionsContext.Provider value={actions}>
      <LockSnapshotContext.Provider value={snapshot}>{children}</LockSnapshotContext.Provider>
    </LockActionsContext.Provider>
  );
}

/** Stable callbacks. Safe to put in a dependency array. */
export function useLockActions(): LockActions | null {
  return useContext(LockActionsContext);
}

/** Changing data. Never put this in a dependency array that drives a subscribe. */
export function useLockSnapshot(): LockSnapshot | null {
  return useContext(LockSnapshotContext);
}
