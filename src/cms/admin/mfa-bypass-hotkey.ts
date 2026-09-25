/**
 * The chord that opens the break-glass dialog on the second-factor step.
 *
 * Pure and separate from the component so it can be tested — this suite has no
 * DOM, and the matching rule is the part with a way to go wrong.
 *
 * ## Why `event.code` and not `event.key`
 *
 * `event.key` is the CHARACTER the layout produced, and with Shift and Alt held
 * it is frequently not `p`: `π` on a Greek layout, something else again where
 * Ctrl+Alt acts as AltGr, `π` on macOS too. A `key === 'p'` check works on the
 * developer's keyboard and silently fails on the operator's — the worst
 * possible failure mode for a mechanism that only matters in an emergency.
 * `event.code` is the physical key and is unaffected by layout or modifiers.
 *
 * Known and accepted: on layouts where AltGr reports as Ctrl+Alt, AltGr+Shift+P
 * also matches. The cost of that false positive is a dialog the user presses
 * Escape on.
 */

/** For documentation and the env comment, so the two cannot drift from the code. */
export const MFA_BYPASS_HOTKEY_LABEL = 'Ctrl + Shift + Alt + P';

export interface HotkeyEvent {
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  /** Physical key. Absent on some synthetic events. */
  code?: string;
  /** Produced character — the layout-dependent fallback. */
  key?: string;
}

export function isMfaBypassHotkey(e: HotkeyEvent): boolean {
  if (!e.ctrlKey || !e.shiftKey || !e.altKey) return false;
  // Meta held is a different gesture, and often an OS-level one.
  if (e.metaKey) return false;
  if (e.code) return e.code === 'KeyP';
  return (e.key ?? '').toLowerCase() === 'p';
}
