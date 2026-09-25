import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { localizedText, localizedValue } from '@/cms/core/content/localized';
import { toPopupPayload } from '@/cms/modules/popups/read';
import { testimonialCard } from '@/components/shortcodes/Testimonials';

/**
 * A `localized` field is stored as `{ el: …, en: … }`. Popups and testimonials
 * passed that map through `String()`, so a visitor read "[object Object]" as the
 * popup's title, its button and every testimonial quote — and a popup body, a
 * map of two rich-text documents, rendered as nothing at all.
 */
describe('localizedText', () => {
  test('a plain string is returned as it is', () => {
    assert.equal(localizedText('Hello', 'en', 'el'), 'Hello');
  });

  test('a map gives the value for the current locale', () => {
    assert.equal(localizedText({ el: 'Γεια', en: 'Hello' }, 'en', 'el'), 'Hello');
  });

  test('a missing or blank translation falls back to the default locale', () => {
    assert.equal(localizedText({ el: 'Γεια' }, 'en', 'el'), 'Γεια');
    assert.equal(localizedText({ el: 'Γεια', en: '   ' }, 'en', 'el'), 'Γεια');
  });

  test('with neither, any language that has text is better than nothing', () => {
    assert.equal(localizedText({ de: 'Hallo' }, 'en', 'el'), 'Hallo');
  });

  test('nothing usable is an empty string, never "[object Object]"', () => {
    assert.equal(localizedText(undefined, 'en', 'el'), '');
    assert.equal(localizedText(null, 'en', 'el'), '');
    assert.equal(localizedText({}, 'en', 'el'), '');
    assert.equal(localizedText({ en: { nested: true } }, 'en', 'el'), '');
    assert.equal(localizedText(42, 'en', 'el'), '42');
  });
});

describe('localizedValue (rich text)', () => {
  const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
  const empty = { type: 'doc', content: [] };

  test('an unlocalized document is returned as it is', () => {
    const d = doc('x');
    assert.equal(localizedValue(d, 'en', 'el'), d);
  });

  test('a per-locale map gives the current locale, then the default one', () => {
    const el = doc('el');
    const en = doc('en');
    assert.equal(localizedValue({ el, en }, 'en', 'el'), en);
    assert.equal(localizedValue({ el }, 'en', 'el'), el);
    assert.equal(localizedValue({ el, en: empty }, 'en', 'el'), el);
  });

  test('absent is null', () => {
    assert.equal(localizedValue(undefined, 'en', 'el'), null);
    assert.equal(localizedValue({}, 'en', 'el'), null);
  });
});

describe('popups resolve their localized fields', () => {
  const body = { el: { type: 'doc', content: [{ type: 'paragraph' }] }, en: { type: 'doc', content: [{ type: 'paragraph' }] } };
  const row = {
    id: 3,
    slug: 'offer',
    data: {
      title: { el: 'Προσφορά', en: 'Offer' },
      buttonLabel: { el: 'Δείτε', en: 'See it' },
      buttonUrl: '/shop',
      body,
    },
  };

  test('title, button text and body are the current language', () => {
    const p = toPopupPayload(row, 'en', 'el');
    assert.equal(p.title, 'Offer');
    assert.equal(p.buttonLabel, 'See it');
    assert.equal(p.body, body.en);
  });

  test('an untranslated popup shows the main language instead of "[object Object]"', () => {
    const p = toPopupPayload(
      { ...row, data: { ...row.data, title: { el: 'Προσφορά' }, buttonLabel: { el: 'Δείτε' } } },
      'en',
      'el',
    );
    assert.equal(p.title, 'Προσφορά');
    assert.equal(p.buttonLabel, 'Δείτε');
  });

  test('a popup saved before the fields were localized still reads', () => {
    const p = toPopupPayload({ ...row, data: { ...row.data, title: 'Plain', buttonLabel: 'Go' } }, 'en', 'el');
    assert.equal(p.title, 'Plain');
    assert.equal(p.buttonLabel, 'Go');
  });
});

describe('testimonials resolve their localized quote', () => {
  test('the quote is the current language, with the main language as fallback', () => {
    const data = { title: 'Maria', role: 'Guest', quote: { el: 'Τέλεια', en: 'Perfect' }, rating: '5' };
    assert.equal(testimonialCard(data, 'en', 'el').quote, 'Perfect');
    assert.equal(testimonialCard({ ...data, quote: { el: 'Τέλεια' } }, 'en', 'el').quote, 'Τέλεια');
  });

  test('name, role, rating and photo come through', () => {
    const card = testimonialCard({ title: 'Maria', role: 'Guest', quote: 'Hi', rating: '4', photo: 'abc' }, 'el', 'el');
    assert.deepEqual(card, { name: 'Maria', role: 'Guest', quote: 'Hi', rating: 4, photo: 'abc' });
  });

  test('no rating and no photo are absent, not zero or "undefined"', () => {
    const card = testimonialCard({ title: 'Maria', quote: 'Hi', rating: '' }, 'el', 'el');
    assert.equal(card.rating, null);
    assert.equal(card.photo, '');
    assert.equal(card.role, '');
  });
});
