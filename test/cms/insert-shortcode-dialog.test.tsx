import '../setup/react-global';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { ModuleFlagsProvider } from '@/cms/admin/module-flags';
import { InsertShortcodeDialog } from '@/cms/admin/fields/InsertShortcodeDialog';
import { shortcodeList } from '@/cms/core/shortcodes';

/**
 * The "+ Block" dialog in the rich-text editor.
 *
 * It greys out a block whose module is off. The flags never reached it: the
 * field renderer built the editor without them, so Google reviews, Testimonials
 * and the inline popup were greyed on every site, module on or not — and the
 * reason named the module by its internal key ("googleReviews").
 *
 * The admin shell now provides the flags once; the dialog reads them from there.
 */
const render = (flags: Record<string, boolean>) =>
  renderToStaticMarkup(
    <ModuleFlagsProvider flags={flags}>
      <InsertShortcodeDialog shortcodes={shortcodeList()} onInsert={() => {}} onClose={() => {}} />
    </ModuleFlagsProvider>,
  );

/** The opening tag of the button whose label is `label`. */
function buttonFor(html: string, label: string): string {
  const at = html.indexOf(`>${label}</span>`);
  assert.ok(at > 0, `no block labelled ${label}`);
  const open = html.lastIndexOf('<button', at);
  return html.slice(open, html.indexOf('>', open) + 1);
}

const isDisabled = (tag: string) => /\sdisabled=/.test(tag);

describe('InsertShortcodeDialog and module flags', () => {
  test('module blocks are usable when their module is on (flags from the admin shell)', () => {
    const html = render({ googleReviews: true, popups: true });
    assert.ok(!isDisabled(buttonFor(html, 'Google reviews')));
    assert.ok(!isDisabled(buttonFor(html, 'Testimonials')));
    assert.ok(!isDisabled(buttonFor(html, 'Popup (inline)')));
    assert.doesNotMatch(html, /Switch on the/);
  });

  test('a block whose module is off is greyed, with the module named as the Settings screen names it', () => {
    const html = render({ googleReviews: false, popups: true });
    assert.ok(isDisabled(buttonFor(html, 'Google reviews')));
    assert.match(
      html,
      /Switch on the “Google reviews &amp; testimonials” module in Settings → Modules to use this\./,
    );
    assert.doesNotMatch(html, /“googleReviews”/);
  });

  test('blocks with no module are always usable', () => {
    const html = render({});
    assert.ok(!isDisabled(buttonFor(html, 'Countdown')));
    assert.ok(!isDisabled(buttonFor(html, 'Brands')));
  });

  test('without a provider nothing is assumed on', () => {
    const html = renderToStaticMarkup(
      <InsertShortcodeDialog shortcodes={shortcodeList()} onInsert={() => {}} onClose={() => {}} />,
    );
    assert.ok(isDisabled(buttonFor(html, 'Google reviews')));
  });
});
