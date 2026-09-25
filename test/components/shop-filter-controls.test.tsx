import '../setup/react-global'; // must precede any component import

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { PriceRangeSlider } from '@/components/shop/filters/PriceRangeSlider';
import { SwatchFacet } from '@/components/shop/filters/SwatchFacet';

/**
 * What the two new filter controls put in the page.
 *
 * Both are things a mouse makes obvious and a keyboard or a screen reader does
 * not, so the accessible shape is the part pinned here: a swatch whose only
 * distinguishing feature is its colour is invisible to anyone who cannot see
 * it, and a two-handle slider that is not two focusable sliders cannot be
 * operated without a pointer at all.
 */

const values = [
  { label: 'Red', color: '#ff0000', count: 3 },
  { label: 'Blue', color: '#0000ff', count: 0 },
];

describe('SwatchFacet', () => {
  const html = renderToStaticMarkup(
    <SwatchFacet name="Color" values={values} selected={['Red']} onToggle={() => {}} />
  );

  test('each value is a real button, not a coloured div', () => {
    assert.equal((html.match(/<button/g) ?? []).length, 2);
  });

  test('the accessible name says the colour and how many products it has', () => {
    assert.match(html, /aria-label="Red \(3\)"/);
    assert.match(html, /aria-label="Blue \(0\)"/);
  });

  test('selection is announced, not merely drawn', () => {
    assert.match(
      html,
      /aria-label="Red \(3\)"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*aria-label="Red \(3\)"/
    );
    assert.match(
      html,
      /aria-label="Blue \(0\)"[^>]*aria-pressed="false"|aria-pressed="false"[^>]*aria-label="Blue \(0\)"/
    );
  });

  test('a selected swatch is marked by something other than its colour', () => {
    // A ring in the brand colour is not a distinction for anyone who cannot
    // see colour, so the selected swatch also carries a check mark.
    assert.match(html, /aria-hidden="true"/);
    assert.match(html, /<svg/);
  });

  test('a value with nothing behind it is disabled rather than hidden', () => {
    assert.match(html, /aria-label="Blue \(0\)"[^>]*disabled|disabled[^>]*aria-label="Blue \(0\)"/);
  });

  test('the group is labelled by the attribute name', () => {
    assert.match(html, /Color/);
    assert.match(html, /role="group"/);
  });
});

describe('PriceRangeSlider', () => {
  const html = renderToStaticMarkup(
    <PriceRangeSlider
      bounds={{ min: 10, max: 100 }}
      value={{ min: 20, max: 80 }}
      currency="EUR"
      labels={{ min: 'Minimum price', max: 'Maximum price' }}
      onCommit={() => {}}
    />
  );

  test('renders two focusable sliders', () => {
    assert.equal((html.match(/role="slider"/g) ?? []).length, 2);
    assert.equal((html.match(/tabindex="0"/g) ?? []).length, 2);
  });

  test('each handle states its range and its position', () => {
    assert.match(html, /aria-valuemin="10"/);
    assert.match(html, /aria-valuemax="100"/);
    assert.match(html, /aria-valuenow="20"/);
    assert.match(html, /aria-valuenow="80"/);
  });

  test('the spoken value is money, not a bare number', () => {
    assert.match(html, /aria-valuetext="[^"]*20[^"]*"/);
    assert.match(html, /aria-valuetext="[^"]*(€|EUR)[^"]*"/);
  });

  test('each handle is named, so "slider" is not all a screen reader says', () => {
    assert.match(html, /aria-label="Minimum price"/);
    assert.match(html, /aria-label="Maximum price"/);
  });
});
