import { useSyncExternalStore } from 'react';

/** Never fires: the flag only differs between server and client. */
const subscribeNothing = () => () => {};

/**
 * False on the server and through the first client render, true once React has taken
 * over.
 *
 * The reason this matters is not cosmetic. A control that is server-rendered but not
 * yet hydrated accepts typing into the DOM and then loses it: React's first render
 * resets a controlled input to its own state, so the text vanishes with no error and
 * no indication anything was dropped. `DocumentForm` learned this the hard way (F-008)
 * and gated its whole fieldset on it; the moderation screens were server-rendered the
 * same way and never got the guard, so a search typed a beat too early silently
 * searched for nothing.
 *
 * `useSyncExternalStore` rather than an effect: setting state in an effect to discover
 * hydration schedules an extra render pass for something React already knows.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
}
