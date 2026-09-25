'use client';

import { useEffect, useState } from 'react';

/**
 * Counts down to a date.
 *
 * The target is validated as an ISO date by the registry before it reaches
 * here, so this only has to deal with "already past" and "not a date the
 * browser understands". It renders the static target on the server and starts
 * ticking after mount — a countdown rendered on the server would be wrong by
 * however long the page sat in a cache.
 */
export function Countdown({
  to,
  label,
  expired,
}: {
  to: string;
  label?: string;
  expired?: string;
}) {
  const target = new Date(to).getTime();
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!Number.isFinite(target)) return;
    const tick = () => setRemaining(target - Date.now());
    const timer = setInterval(tick, 1000);
    // The first value comes from the interval's own tick a second later, so
    // nothing is set synchronously in the effect body.
    const initial = setTimeout(tick, 0);
    return () => {
      clearInterval(timer);
      clearTimeout(initial);
    };
  }, [target]);

  if (!Number.isFinite(target)) return null;
  if (remaining !== null && remaining <= 0) {
    return expired ? <p className="font-body text-text-muted text-sm">{expired}</p> : null;
  }

  const units =
    remaining === null
      ? null
      : {
          days: Math.floor(remaining / 86_400_000),
          hours: Math.floor((remaining % 86_400_000) / 3_600_000),
          minutes: Math.floor((remaining % 3_600_000) / 60_000),
          seconds: Math.floor((remaining % 60_000) / 1000),
        };

  return (
    <div className="border-border-soft my-6 flex flex-col items-center gap-2 rounded-sm border bg-white p-6">
      {label ? <p className="font-body text-text-muted text-sm">{label}</p> : null}
      {/* Polite, not assertive: a ticking clock must not interrupt a screen
          reader every second. */}
      <p
        aria-live="polite"
        className="font-display text-midnight-navy text-2xl font-semibold tabular-nums"
      >
        {units
          ? `${units.days}d ${String(units.hours).padStart(2, '0')}:${String(units.minutes).padStart(2, '0')}:${String(units.seconds).padStart(2, '0')}`
          : new Date(to).toISOString().slice(0, 10)}
      </p>
    </div>
  );
}
