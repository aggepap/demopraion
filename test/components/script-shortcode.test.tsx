import '../setup/react-global'; // must precede any component import

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { ScriptSnippetView } from '@/components/shortcodes/ScriptSnippetView';
import { snippetMayRun } from '@/components/shortcodes/snippet-consent';

/**
 * What a `[script name="…"]` leaves in the page.
 *
 * The script element itself is injected by `next/script` after hydration, so a
 * static render cannot show it; what can be pinned is the anchor a widget
 * mounts into, and the consent decision that decides whether it runs at all.
 */

const snippet = {
  slug: 'chat-widget',
  kind: 'inline' as const,
  code: 'window.__snippetRan = true;',
  src: null,
  lazy: false,
  consentCategory: null,
};

describe('ScriptSnippetView', () => {
  test('leaves an anchor where the shortcode was placed', () => {
    const html = renderToStaticMarkup(<ScriptSnippetView snippet={snippet} />);
    assert.match(html, /<div data-script-snippet="chat-widget"><\/div>/);
  });

  test('never writes the code into the server HTML as text', () => {
    const html = renderToStaticMarkup(<ScriptSnippetView snippet={snippet} />);
    assert.doesNotMatch(html, /__snippetRan/);
  });
});

describe('snippetMayRun', () => {
  test('a snippet with no consent category runs straight away', () => {
    assert.equal(snippetMayRun(null, false), true);
  });

  test('a consent-gated snippet waits for its category', () => {
    assert.equal(snippetMayRun('analytics', false), false);
    assert.equal(snippetMayRun('analytics', true), true);
  });
});
