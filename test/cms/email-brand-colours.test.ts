import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * Emails wear the site's colours, not Praion's.
 *
 * The templates used to carry Praion's navy (#1b2430) and gold (#b8860b) as
 * literals, so every site built from this core sent Praion-coloured mail. A
 * template now asks for a brand token (`emailColor('midnight-navy')`) and
 * `sendGraphMail` fills it from Settings → Branding. The unsubscribe page is not
 * mail but has the same problem, so it reads the palette directly.
 */

const BRAND_LITERALS = /#1b2430|#b8860b|#b8873b/i;

const TEMPLATES = [
  'src/cms/modules/customers/emails.ts',
  'src/cms/modules/commerce/giftcards/emails.ts',
  'src/cms/modules/commerce/abandoned.ts',
  'src/cms/modules/commerce/orders.ts',
  'src/cms/modules/booking/emails.ts',
];

for (const file of TEMPLATES) {
  test(`${file} takes its colours from the brand`, () => {
    const src = readFileSync(file, 'utf8');
    assert.doesNotMatch(src, BRAND_LITERALS);
    assert.match(src, /emailColor\(/);
  });
}

test('the unsubscribe page takes its colours from the brand', () => {
  const src = readFileSync('src/cms/modules/commerce/unsubscribe.ts', 'utf8');
  assert.doesNotMatch(src, BRAND_LITERALS);
  assert.match(src, /getBrand\(/);
});
