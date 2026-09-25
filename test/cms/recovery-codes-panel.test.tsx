import '../setup/react-global';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { RecoveryCodesPanel } from '@/cms/admin/RecoveryCodesPanel';

/**
 * The one-and-only showing of a set of recovery codes.
 *
 * What is asserted here is the shape of the screen, because the failure this
 * locks down was a shape failure rather than a logic one: the panel wrote to
 * the clipboard and said nothing at all. For an ordinary copy button that is a
 * small rudeness; for a credential the user will never be shown again it is a
 * request to take it on faith that something happened — and when the clipboard
 * API is missing (any admin served over plain HTTP on a LAN address) the silent
 * path was also the failing one.
 *
 * Only the initial render is exercised — this suite has no DOM and cannot
 * click — so the assertions are about what must be PRESENT for the interactive
 * behaviour to be reachable and announceable at all.
 */
const CODES = ['2CSP-Q79D', 'GPMW-PMAS', 'C62A-YG6M'];

function render(extra: Record<string, unknown> = {}) {
  return renderToStaticMarkup(<RecoveryCodesPanel codes={CODES} siteName="Praion" {...extra} />);
}

describe('RecoveryCodesPanel', () => {
  test('shows every code', () => {
    const html = render();
    for (const code of CODES) assert.ok(html.includes(code), `missing ${code}`);
  });

  test('offers both a copy and a download route', () => {
    /*
     * Download is not a nicety alongside Copy — it is the fallback for the case
     * Copy cannot serve. A clipboard needs a secure context and survives only
     * until the next copy; these codes have to outlive a lost phone.
     */
    const html = render();
    assert.match(html, /Copy codes/);
    assert.match(html, /Download/);
  });

  test('renders the live region BEFORE anything is announced', () => {
    /*
     * The bug this prevents is subtle and silent: a `role="status"` node that
     * is added to the page at the same moment its text appears is unreliably
     * announced, because assistive tech has to already be observing it. So the
     * region must exist, empty, in the very first render.
     */
    const html = render();
    assert.match(html, /role="status"/);
    assert.match(html, /aria-live="polite"/);
  });

  test('says the codes are single-use and shown only once', () => {
    const html = render();
    assert.match(html, /once/i);
    assert.match(html, /only time/i);
  });

  test('lets the codes be selected, so a failed clipboard is still recoverable', () => {
    // `select-all` is what makes "select the codes above and copy them" — the
    // advice the error message gives — actually easy to follow.
    assert.match(render(), /select-all/);
  });

  test('renders trailing actions passed as children', () => {
    // The login step puts "I have saved them" here; the account screen passes
    // nothing. Both must work from the same component.
    const html = renderToStaticMarkup(
      <RecoveryCodesPanel codes={CODES}>
        <button type="button">I have saved them</button>
      </RecoveryCodesPanel>,
    );
    assert.match(html, /I have saved them/);
  });

  test('accepts an overridden heading', () => {
    assert.match(render({ heading: 'Save these new recovery codes now.' }), /Save these new/);
  });
});
