import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  MAX_CODE_LENGTH,
  externalHost,
  publicSnippet,
  scriptShortcode,
  snippetInputSchema,
} from '@/cms/core/scripts/schema';

/**
 * What an administrator may save as a script snippet.
 *
 * Running their JavaScript is the point of the feature, so the guard here is
 * not "is this code safe" — nothing can say that — but "will this land where it
 * was meant to, and nowhere else": inline code that cannot close its own script
 * element, and external scripts that load only over https from a plain host.
 */

const inline = {
  name: 'Chat widget',
  slug: 'chat-widget',
  kind: 'inline',
  code: "window.__snippetRan = true;",
  consentCategory: null,
  enabled: true,
};

const external = {
  name: 'Booking engine',
  slug: 'booking-engine',
  kind: 'external',
  src: 'https://widget.example.com/loader.js',
  lazy: true,
  consentCategory: 'marketing',
  enabled: true,
};

const errorPaths = (value: unknown): string[] => {
  const result = snippetInputSchema.safeParse(value);
  assert.equal(result.success, false, 'expected the input to be refused');
  return result.error!.issues.map((issue) => issue.path.join('.'));
};

describe('snippetInputSchema — inline', () => {
  test('accepts plain JavaScript and drops the external fields', () => {
    const parsed = snippetInputSchema.parse(inline);
    assert.equal(parsed.kind, 'inline');
    assert.equal(parsed.code, inline.code);
    assert.equal(parsed.src, null);
    assert.equal(parsed.consentCategory, null);
  });

  test('refuses code that would close its own script element', () => {
    assert.deepEqual(errorPaths({ ...inline, code: 'var a = "</script><script>alert(1)";' }), ['code']);
    assert.deepEqual(errorPaths({ ...inline, code: 'var a = "</SCRIPT >";' }), ['code']);
  });

  test('refuses a pasted <script> wrapper, and says to paste only the JavaScript', () => {
    const result = snippetInputSchema.safeParse({ ...inline, code: '  <script>console.log(1)' });
    assert.equal(result.success, false);
    assert.match(result.error!.issues[0].message, /only the JavaScript/i);
  });

  test('refuses empty code and code over the size limit', () => {
    assert.deepEqual(errorPaths({ ...inline, code: '   ' }), ['code']);
    assert.deepEqual(errorPaths({ ...inline, code: 'x'.repeat(MAX_CODE_LENGTH + 1) }), ['code']);
  });

  test('an inline snippet needs code, not a src', () => {
    assert.ok(errorPaths({ ...inline, code: undefined, src: 'https://a.example/x.js' }).includes('code'));
  });
});

describe('snippetInputSchema — external', () => {
  test('accepts an https URL and keeps the lazy flag', () => {
    const parsed = snippetInputSchema.parse(external);
    assert.equal(parsed.kind, 'external');
    assert.equal(parsed.src, external.src);
    assert.equal(parsed.code, null);
    assert.equal(parsed.lazy, true);
  });

  test('refuses anything that is not a plain https URL', () => {
    for (const src of [
      'http://widget.example.com/a.js',
      'javascript:alert(1)',
      'data:text/javascript,alert(1)',
      '//widget.example.com/a.js',
      'https://user:pass@widget.example.com/a.js',
      'not a url',
      `https://a.example/${'x'.repeat(2100)}`,
    ]) {
      assert.deepEqual(errorPaths({ ...external, src }), ['src'], src);
    }
  });
});

describe('snippetInputSchema — shared fields', () => {
  test('the slug is the shortcode key: lowercase kebab-case only', () => {
    for (const slug of ['Chat', 'chat widget', 'chat_widget', '-chat', '', 'a'.repeat(65)]) {
      assert.deepEqual(errorPaths({ ...inline, slug }), ['slug'], slug);
    }
  });

  test('a name is required and bounded', () => {
    assert.deepEqual(errorPaths({ ...inline, name: ' ' }), ['name']);
    assert.deepEqual(errorPaths({ ...inline, name: 'x'.repeat(121) }), ['name']);
  });

  test('a consent category is either none or a category key', () => {
    assert.equal(snippetInputSchema.parse({ ...inline, consentCategory: 'analytics' }).consentCategory, 'analytics');
    assert.equal(snippetInputSchema.parse({ ...inline, consentCategory: '' }).consentCategory, null);
    assert.deepEqual(errorPaths({ ...inline, consentCategory: 'Not A Key!' }), ['consentCategory']);
  });

  test('undeclared fields are refused rather than stored', () => {
    assert.ok(errorPaths({ ...inline, id: 5 }).length > 0);
  });

  test('an unknown kind is refused', () => {
    assert.ok(errorPaths({ ...inline, kind: 'html' }).includes('kind'));
  });
});

describe('externalHost', () => {
  test('names the host that has to be allowed by the security policy', () => {
    assert.equal(externalHost('https://widget.example.com/loader.js?v=2'), 'https://widget.example.com');
  });
  test('is null for anything that is not a URL', () => {
    assert.equal(externalHost(null), null);
    assert.equal(externalHost('nope'), null);
  });
});

describe('publicSnippet', () => {
  test('passes only what the browser needs — never the notes or the row id', () => {
    const view = publicSnippet({
      id: 7,
      slug: 'chat-widget',
      name: 'Chat widget',
      kind: 'inline',
      code: 'x()',
      src: null,
      lazy: false,
      consentCategory: null,
      enabled: true,
      notes: 'API key is in 1Password',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    assert.deepEqual(Object.keys(view).sort(), ['code', 'consentCategory', 'kind', 'lazy', 'slug', 'src']);
  });
});

describe('scriptShortcode', () => {
  test('is what an editor pastes into a page', () => {
    assert.equal(scriptShortcode('chat-widget'), '[script name="chat-widget"]');
  });
});
