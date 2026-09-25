import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { SHORTCODES } from '@/cms/core/shortcodes/all';
import { resolveShortcode } from '@/cms/core/shortcodes/registry';
import { parseShortcode } from '@/cms/core/shortcodes/parse';

/** `[script name="…"]` is a real shortcode, available on every site. */
describe('the script shortcode', () => {
  test('is registered and needs no module', () => {
    assert.ok(SHORTCODES.script);
    assert.equal(SHORTCODES.script.module, undefined);
  });

  test('resolves with a snippet slug', () => {
    const resolution = resolveShortcode(SHORTCODES, { name: 'script', attrs: { name: 'chat-widget' } }, {});
    assert.equal(resolution.kind, 'ok');
    assert.deepEqual(resolution.kind === 'ok' && resolution.attrs, { name: 'chat-widget' });
  });

  test('refuses a name that is not a slug, and any other attribute', () => {
    assert.equal(resolveShortcode(SHORTCODES, { name: 'script', attrs: { name: 'Chat Widget' } }, {}).kind, 'invalid');
    assert.equal(
      resolveShortcode(SHORTCODES, { name: 'script', attrs: { name: 'a', src: 'https://evil.example' } }, {}).kind,
      'invalid',
    );
  });

  test('parses from a page body the way the copy button writes it', () => {
    assert.deepEqual(parseShortcode('[script name="chat-widget"]'), { name: 'script', attrs: { name: 'chat-widget' } });
  });
});
