import '../setup/react-global';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { BrandSettings } from '@/cms/admin/BrandSettings';
import { BASE_PALETTE, PALETTE_TOKENS, parseBrandIdentity } from '@/cms/core/brand/policy';

/**
 * Settings → Branding. One screen for who the site is and what colours it wears,
 * so an owner never needs a developer (or a code deploy) to change either.
 */

const render = (palette = BASE_PALETTE) =>
  renderToStaticMarkup(
    <BrandSettings initialIdentity={parseBrandIdentity(null, { name: 'Acme' })} initialPalette={palette} />,
  );

describe('BrandSettings', () => {
  test('the identity fields are labelled', () => {
    const html = render();
    for (const label of ['Site name', 'Legal name', 'Tagline', 'Email', 'Phone', 'Logo', 'Favicon']) {
      assert.ok(html.includes(label), label);
    }
    assert.ok(html.includes('value="Acme"'));
  });

  test('every colour token has a picker', () => {
    const html = render();
    for (const token of PALETTE_TOKENS) {
      assert.ok(html.includes(token.label), token.key);
    }
  });

  test('the base palette raises no contrast warning', () => {
    assert.ok(!render().includes('role="alert"'));
  });

  test('text that would be unreadable on the page background is flagged', () => {
    const html = render({ ...BASE_PALETTE, 'text-primary': '#f5f5f5' });
    assert.match(html, /role="alert"/);
    assert.match(html, /Main text/);
  });
});
