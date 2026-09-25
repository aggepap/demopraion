/**
 * The chord that opens the break-glass dialog.
 *
 * Matched on `event.code` rather than `event.key`, and that is the whole reason
 * this is a tested module rather than three `&&`s inside a component.
 * `event.key` is the CHARACTER produced, which with Shift and Alt held is
 * frequently not "p" at all: on a Greek layout it is "π", on several European
 * layouts Ctrl+Alt is AltGr and produces something else again, and on macOS
 * Alt+p is "π" too. A `key === 'p'` check therefore works on the developer's
 * keyboard and silently fails on the operator's — the worst possible failure
 * mode for a mechanism that only matters in an emergency.
 *
 * `event.code` is the physical key, unchanged by layout or modifiers.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isMfaBypassHotkey, MFA_BYPASS_HOTKEY_LABEL } from '@/cms/admin/mfa-bypass-hotkey';

function ev(over: Partial<Record<string, unknown>> = {}) {
  return {
    ctrlKey: true,
    shiftKey: true,
    altKey: true,
    metaKey: false,
    code: 'KeyP',
    key: 'P',
    ...over,
  } as Parameters<typeof isMfaBypassHotkey>[0];
}

describe('isMfaBypassHotkey', () => {
  test('matches Ctrl+Shift+Alt+P', () => {
    assert.equal(isMfaBypassHotkey(ev()), true);
  });

  test('matches regardless of what character the layout produced', () => {
    // The case that breaks a `key`-based check: the physical P key is still
    // KeyP, but the character is not "p".
    for (const key of ['π', 'Π', 'Dead', '∏', 'P', 'p']) {
      assert.equal(isMfaBypassHotkey(ev({ key })), true, key);
    }
  });

  test('needs all three modifiers', () => {
    assert.equal(isMfaBypassHotkey(ev({ ctrlKey: false })), false, 'no ctrl');
    assert.equal(isMfaBypassHotkey(ev({ shiftKey: false })), false, 'no shift');
    assert.equal(isMfaBypassHotkey(ev({ altKey: false })), false, 'no alt');
  });

  test('does not fire with Meta held', () => {
    // Cmd/Win + the chord is a different gesture and often an OS one; matching
    // it would make the dialog appear during unrelated shortcuts.
    assert.equal(isMfaBypassHotkey(ev({ metaKey: true })), false);
  });

  test('does not fire on another key', () => {
    for (const code of ['KeyO', 'KeyQ', 'Digit1', 'Enter', 'Escape']) {
      assert.equal(isMfaBypassHotkey(ev({ code })), false, code);
    }
  });

  test('falls back to the character when `code` is absent', () => {
    // Some synthetic and older-browser events carry no `code`. Better a
    // layout-dependent match than no match at all.
    assert.equal(isMfaBypassHotkey(ev({ code: undefined, key: 'p' })), true);
    assert.equal(isMfaBypassHotkey(ev({ code: undefined, key: 'P' })), true);
    assert.equal(isMfaBypassHotkey(ev({ code: undefined, key: 'q' })), false);
    assert.equal(isMfaBypassHotkey(ev({ code: '', key: 'p' })), true);
  });

  test('exposes a label that matches what it actually listens for', () => {
    // So documentation and behaviour cannot drift apart.
    assert.match(MFA_BYPASS_HOTKEY_LABEL, /Ctrl/i);
    assert.match(MFA_BYPASS_HOTKEY_LABEL, /Shift/i);
    assert.match(MFA_BYPASS_HOTKEY_LABEL, /Alt/i);
    assert.match(MFA_BYPASS_HOTKEY_LABEL, /P\b/);
  });
});
