'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { cmsApi } from './api-client';
import {
  IDLE_WARNING_SECONDS,
  idleState,
  sessionRefreshAfterSeconds,
} from '../modules/auth/session-idle';
import { Button } from './ui';

/**
 * Signs an inactive administrator out, and says so.
 *
 * ## This is not the security boundary
 *
 * The server rejects a stale cookie whatever this component believes — the JWT
 * `exp` rides the idle window and `requireApiAuth` refuses anything past it.
 * What this adds is a *predictable* experience: a warning before unsaved work
 * disappears, and a clean sign-out with an explanation, rather than the next
 * click returning 401 for no visible reason.
 *
 * ## Why it also sends a keepalive
 *
 * Only a route handler can renew the cookie — `cookies().set()` throws inside a
 * server component, so the page guards cannot slide the window. An admin
 * reading a long article, or filling in a form without saving, generates no API
 * traffic at all and would be signed out mid-sentence. So genuine activity
 * pokes `/api/cms/auth/me`, throttled hard: at most once per refresh cadence,
 * and never while the user is idle.
 *
 * `me` rather than a new endpoint on purpose — it already re-reads permissions
 * from the database, so a session whose account was disabled or de-roled ends
 * here too instead of lingering until the next click.
 *
 * ## Cross-tab
 *
 * Last activity is shared through `localStorage`, because two tabs are one
 * user. Without it, a tab left open on a dashboard signs itself out an hour
 * later while the person is actively working in the tab beside it — and takes
 * the shared cookie with it.
 */
const ACTIVITY_KEY = 'cms:last-activity';

/** Headroom before the server's own expiry, so the sign-out request is still authenticated. */
const SIGN_OUT_GRACE_MS = 10_000;
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

function readShared(): number {
  try {
    const raw = localStorage.getItem(ACTIVITY_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : 0;
  } catch {
    // Private mode, or storage disabled. The component still works, just
    // per-tab — never let this break the admin.
    return 0;
  }
}

function writeShared(at: number): void {
  try {
    localStorage.setItem(ACTIVITY_KEY, String(at));
  } catch {
    /* see readShared */
  }
}

export function IdleLogout({
  idleSeconds,
  adminPath,
}: {
  /** Resolved server-side from `ADMIN_SESSION_IDLE_MINUTES`, so both halves agree. */
  idleSeconds: number;
  adminPath: string;
}) {
  const [warning, setWarning] = useState(false);
  /*
   * When the SERVER says this session dies, in epoch ms — learned from
   * `/auth/me` and re-learned on every keepalive.
   *
   * The client cannot derive it. Its own idle clock starts at the last user
   * action, while the cookie's expiry starts at the last keepalive, and the
   * keepalive is throttled — so the cookie always dies at or BEFORE the local
   * deadline. Signing out on the local clock alone therefore means the logout
   * request 401s, and the event never reaches the audit log, which is the one
   * place someone would look to find out why they were signed out.
   */
  const serverExpiry = useRef(0);
  // Seeded in the effect below, not here: `Date.now()` during render is an
  // impure call, and React may re-render this component at any time.
  const lastActivity = useRef(0);
  const lastPing = useRef(0);
  const signingOut = useRef(false);

  const signOut = useCallback(async () => {
    // Guarded because the tick and a manual click can race, and two logouts
    // means two redirects.
    if (signingOut.current) return;
    signingOut.current = true;
    try {
      await cmsApi.logout('idle');
    } catch {
      // The cookie is expired either way; the redirect is what matters.
    }
    // A full navigation, not a router push: every cached RSC payload in memory
    // was rendered for a session that no longer exists.
    window.location.href = `/${adminPath}/login?timeout=1`;
  }, [adminPath]);

  /**
   * Record activity and, if due, refresh the session.
   *
   * Split from `markActive` because it touches no React state: the mount effect
   * needs exactly this half, and calling a setState from an effect body is both
   * a lint error and a cascading render.
   */
  const touch = useCallback(() => {
    const now = Date.now();
    lastActivity.current = now;
    writeShared(now);

    // Same cadence the server uses to decide a refresh is due, scaled to the
    // window for the same reason: a flat minute never fires inside a short one.
    if (now - lastPing.current >= sessionRefreshAfterSeconds(idleSeconds) * 1000) {
      lastPing.current = now;
      // Fire and forget — a failed keepalive is not worth interrupting anyone
      // over, and the next tick will notice if the session really is gone. The
      // response is how this component learns the server's own expiry.
      void fetch('/api/cms/auth/me', { method: 'GET', credentials: 'same-origin' })
        .then((r) => (r.ok ? r.json() : null))
        .then((body) => {
          const at = body?.data?.sessionExpiresAt;
          if (typeof at === 'number') serverExpiry.current = at * 1000;
        })
        .catch(() => {});
    }
  }, [idleSeconds]);

  const markActive = useCallback(() => {
    touch();
    setWarning(false);
  }, [touch]);

  useEffect(() => {
    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, markActive, { passive: true });
    }
    // Coming back to the tab is activity, and is also the moment a timer that
    // was throttled while the tab was hidden needs to catch up.
    const onVisible = () => {
      if (document.visibilityState === 'visible') markActive();
    };
    document.addEventListener('visibilitychange', onVisible);

    const onStorage = (e: StorageEvent) => {
      if (e.key !== ACTIVITY_KEY) return;
      const shared = readShared();
      if (shared > lastActivity.current) {
        lastActivity.current = shared;
        setWarning(false);
      }
    };
    window.addEventListener('storage', onStorage);

    return () => {
      for (const evt of ACTIVITY_EVENTS) window.removeEventListener(evt, markActive);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('storage', onStorage);
    };
  }, [markActive]);

  useEffect(() => {
    /*
     * Mounting IS activity — somebody opened or navigated to an admin page — so
     * the window starts now. It also sends the first keepalive, which is how
     * the component learns when the server thinks this session dies; without
     * that first call it would have only its own clock to go on, and would sign
     * out too late to be audited.
     */
    lastActivity.current = Math.max(lastActivity.current, readShared());
    touch();

    // Polling rather than one long setTimeout: a timer scheduled an hour ahead
    // does not survive a laptop sleeping, and would fire late by exactly the
    // time the machine was closed — which is the case this feature is for.
    const tick = setInterval(() => {
      const now = Date.now();
      /*
       * Leave a few seconds of headroom before the cookie the server issued
       * actually expires, so the sign-out request is still authenticated and
       * lands in the audit log as `auth.logout.idle`.
       */
      const serverDeadline = serverExpiry.current ? serverExpiry.current - SIGN_OUT_GRACE_MS : 0;
      if (serverDeadline && now >= serverDeadline) {
        void signOut();
        return;
      }

      const state = idleState(lastActivity.current, now, idleSeconds);
      if (state === 'expired') void signOut();
      else setWarning(state === 'warning');
    }, 5000);

    return () => clearInterval(tick);
  }, [idleSeconds, signOut, touch]);

  if (!warning) return null;

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-labelledby="idle-warning-title"
      className="fixed bottom-4 right-4 z-50 w-full max-w-xs rounded-sm border border-amber-300 bg-amber-50 p-4 shadow-lg"
    >
      <p id="idle-warning-title" className="text-sm font-semibold text-amber-900">
        You are about to be signed out
      </p>
      <p className="mt-1 text-xs text-amber-900">
        You have been inactive for a while. Anything unsaved will be lost.
      </p>
      <div className="mt-3 flex gap-2">
        <Button type="button" onClick={markActive}>
          Stay signed in
        </Button>
        <Button type="button" variant="ghost" onClick={() => void signOut()}>
          Sign out now
        </Button>
      </div>
    </div>
  );
}

export { IDLE_WARNING_SECONDS };
