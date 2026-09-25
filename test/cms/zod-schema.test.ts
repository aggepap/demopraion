import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { f } from '@/cms/config/fields';
import { buildDataSchema } from '@/cms/config/zod';

const LOCALES = ['en', 'el'];
const ok = (schema: ReturnType<typeof buildDataSchema>, data: unknown) => schema.safeParse(data).success;

describe('buildDataSchema — an image that has been cleared', () => {
  test("an optional image accepts '' and stores nothing", () => {
    // How a cleared form field arrives. `.optional()` tolerates an absent key,
    // not an empty value, so `''` used to fail `.uuid()` — which meant the
    // picker's Clear button could never be saved, anywhere in the admin.
    const s = buildDataSchema([f.image('avatar')], LOCALES);
    const parsed = s.safeParse({ avatar: '' });
    assert.equal(parsed.success, true);
    const data = (parsed.success ? parsed.data : {}) as Record<string, unknown>;
    assert.equal('avatar' in data, true);
    assert.equal(data.avatar, undefined);
  });

  test('a real uuid still passes and junk still fails', () => {
    const s = buildDataSchema([f.image('avatar')], LOCALES);
    assert.equal(ok(s, { avatar: '0191d4c2-6f3a-7c4e-9b2d-8f1a2b3c4d5e' }), true);
    assert.equal(ok(s, { avatar: 'not-a-uuid' }), false);
  });

  test('a required image is not satisfied by an empty value', () => {
    const s = buildDataSchema([f.image('avatar', { required: true })], LOCALES, {
      enforceRequired: true,
    });
    assert.equal(ok(s, { avatar: '' }), false);
  });
});

describe('buildDataSchema — localized fields', () => {
  // Under zod v4, `z.record(z.enum(locales), …)` requires EVERY locale key, so
  // adding a locale to the site made every stored document unsaveable. The map
  // is partial now: present locales are validated, missing ones are fine, and a
  // required field going live must carry the DEFAULT locale.
  test('a localized value may omit locales, but not invent them', () => {
    const s = buildDataSchema([f.text('title', { localized: true })], LOCALES);
    assert.equal(ok(s, { title: { en: 'Hi', el: 'Γεια' } }), true);
    assert.equal(ok(s, {}), true); // the field itself is optional
    assert.equal(ok(s, { title: { en: 'Hi' } }), true); // regression: a newly added `el` is missing
    assert.equal(ok(s, { title: { fr: 'x' } }), false); // fr not a site locale
    assert.equal(ok(s, { title: { en: 42 } }), false); // present locales are still validated
  });

  test('adding a locale does not break a document saved before it existed', () => {
    const before = { title: { en: 'Hi', el: 'Γεια' } };
    const s = buildDataSchema([f.text('title', { localized: true, required: true })], [...LOCALES, 'de'], {
      enforceRequired: true,
      defaultLocale: 'en',
    });
    assert.equal(ok(s, before), true);
  });

  test('a required localized field going live needs the default locale, non-empty', () => {
    // `enforceRequired` is what a publish/schedule write passes; a draft write
    // omits it, because an unfinished document must still be saveable.
    const s = buildDataSchema([f.text('title', { localized: true, required: true })], LOCALES, {
      enforceRequired: true,
      defaultLocale: 'el',
    });
    assert.equal(ok(s, {}), false);
    assert.equal(ok(s, { title: { en: 'x', el: 'y' } }), true);
    assert.equal(ok(s, { title: { el: 'y' } }), true); // default alone suffices
    assert.equal(ok(s, { title: { en: 'x' } }), false); // default missing
    assert.equal(ok(s, { title: { en: 'x', el: '' } }), false); // default empty
  });

  test('without defaultLocale the first listed locale is the one required', () => {
    const s = buildDataSchema([f.text('title', { localized: true, required: true })], LOCALES, {
      enforceRequired: true,
    });
    assert.equal(ok(s, { title: { en: 'x' } }), true);
    assert.equal(ok(s, { title: { el: 'y' } }), false);
  });

  test('required is not enforced on a draft write', () => {
    const draft = buildDataSchema([f.text('title', { localized: true, required: true })], LOCALES);
    assert.equal(ok(draft, {}), true);
    // A wrong TYPE is still rejected — only requiredness is relaxed.
    assert.equal(ok(draft, { title: 'not-a-locale-map' }), false);
  });

  test('locales are threaded into repeater children (regression: recursion dropped locales)', () => {
    // If locales weren't threaded, the nested enum would be the `['*']` placeholder
    // and a real `{ en, el }` map would fail — so this passing proves threading.
    const s = buildDataSchema([f.repeater('rows', [f.text('t', { localized: true, required: true })])], LOCALES);
    assert.equal(ok(s, { rows: [{ t: { en: 'x', el: 'y' } }] }), true);
    assert.equal(ok(s, { rows: [{ t: { en: 'x' } }] }), true);
    assert.equal(ok(s, { rows: [{ t: { fr: 'x' } }] }), false);
  });

  test('locales are threaded into group children', () => {
    const s = buildDataSchema([f.group('g', [f.text('t', { localized: true })])], LOCALES);
    assert.equal(ok(s, { g: { t: { en: 'x', el: 'y' } } }), true);
    assert.equal(ok(s, { g: { t: { fr: 'x' } } }), false);
  });
});

describe('buildDataSchema — scalar kinds', () => {
  test('rejects unknown keys at every level (.strict)', () => {
    const s = buildDataSchema([f.text('a')], LOCALES);
    assert.equal(ok(s, { a: 'x' }), true);
    assert.equal(ok(s, { a: 'x', extra: 1 }), false);
    const nested = buildDataSchema([f.group('g', [f.text('a')])], LOCALES);
    assert.equal(ok(nested, { g: { a: 'x', bogus: 1 } }), false);
  });

  test('number honours integer / min / max', () => {
    const s = buildDataSchema([f.number('n', { integer: true, min: 0, max: 10 })], LOCALES);
    assert.equal(ok(s, { n: 5 }), true);
    assert.equal(ok(s, { n: 5.5 }), false);
    assert.equal(ok(s, { n: -1 }), false);
    assert.equal(ok(s, { n: 11 }), false);
  });

  test('color requires #rrggbb, image requires a uuid', () => {
    const c = buildDataSchema([f.color('c')], LOCALES);
    assert.equal(ok(c, { c: '#ff0000' }), true);
    assert.equal(ok(c, { c: 'red' }), false);
    const img = buildDataSchema([f.image('img')], LOCALES);
    assert.equal(ok(img, { img: '018f0e0e-7a2a-7c3a-9b1a-2b3c4d5e6f70' }), true);
    assert.equal(ok(img, { img: 'nope' }), false);
  });

  test('relation many is an array of positive integers', () => {
    const s = buildDataSchema([f.relation('r', { to: 'x', many: true })], LOCALES);
    assert.equal(ok(s, { r: [1, 2] }), true);
    assert.equal(ok(s, { r: [0] }), false);
    assert.equal(ok(s, { r: [1.5] }), false);
  });

  test('select single vs multiple, and empty-options fallback', () => {
    const single = buildDataSchema([f.select('s', { options: [{ value: 'a' }, { value: 'b' }] })], LOCALES);
    assert.equal(ok(single, { s: 'a' }), true);
    assert.equal(ok(single, { s: 'c' }), false);
    assert.equal(ok(single, { s: ['a'] }), false);
    const multi = buildDataSchema([f.select('s', { options: [{ value: 'a' }], multiple: true })], LOCALES);
    assert.equal(ok(multi, { s: ['a'] }), true);
    assert.equal(ok(multi, { s: 'a' }), false);
    const free = buildDataSchema([f.select('s', { options: [] })], LOCALES);
    assert.equal(ok(free, { s: 'anything' }), true);
  });

  test('date accepts parseable strings only', () => {
    const s = buildDataSchema([f.date('d')], LOCALES);
    assert.equal(ok(s, { d: '2026-01-01' }), true);
    assert.equal(ok(s, { d: 'not-a-date' }), false);
  });

  test('monthDay accepts a bare mm-dd only', () => {
    const s = buildDataSchema([f.monthDay('m')], LOCALES);
    assert.equal(ok(s, { m: '06-01' }), true);
    assert.equal(ok(s, { m: '12-31' }), true);
    assert.equal(ok(s, { m: '13-01' }), false);
    assert.equal(ok(s, { m: '00-01' }), false);
    assert.equal(ok(s, { m: '06-32' }), false);
    assert.equal(ok(s, { m: '6-1' }), false);
    assert.equal(ok(s, { m: '06/01' }), false);
    // Yearless by design — a season recurs, so a full date is the wrong shape.
    assert.equal(ok(s, { m: '2026-06-01' }), false);
  });

  test("monthDay accepts '' so an unfinished draft still saves", () => {
    // `required` means "must be there to go live", not "must be there to save",
    // and `.optional()` tolerates an absent key rather than an empty value — so
    // a half-filled season row has to be able to carry ''.
    const s = buildDataSchema([f.monthDay('m', { required: true })], LOCALES);
    assert.equal(ok(s, { m: '' }), true);
  });

  test('a required monthDay is not satisfied by an empty value on publish', () => {
    // Regression guard for keeping the validator a plain ZodString: the
    // publish-time non-empty check is gated on `instanceof z.ZodString`, so a
    // `.refine()`-based schema would silently let an empty season boundary go
    // live — which is what the `date` kind above still does.
    const s = buildDataSchema([f.monthDay('m', { required: true })], LOCALES, {
      enforceRequired: true,
    });
    assert.equal(ok(s, { m: '' }), false);
    assert.equal(ok(s, { m: '06-01' }), true);
  });

  test('non-localized default is applied when the value is absent', () => {
    const s = buildDataSchema([f.text('t', { default: 'hi' })], LOCALES);
    const parsed = s.safeParse({});
    assert.equal(parsed.success, true);
    assert.equal((parsed.success && (parsed.data as { t?: string }).t) || null, 'hi');
  });

  test('variations rows are strict objects', () => {
    const s = buildDataSchema([f.variations('v')], LOCALES);
    assert.equal(ok(s, { v: [{ id: '1', options: { Color: 'Red' } }] }), true);
    assert.equal(ok(s, { v: [{ id: '1', options: { Color: 'Red' }, price: 9.5, stock: 3 }] }), true);
    assert.equal(ok(s, { v: [{ id: '1', options: { Color: 'Red' }, bogus: 1 }] }), false);
  });
});
