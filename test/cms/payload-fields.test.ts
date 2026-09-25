/**
 * Turning a stored `form_submissions.payload` into displayable fields.
 *
 * The drawer printed `JSON.stringify(payload, null, 2)` into a `<pre>`, so a
 * triager read an enquiry as source code: quoted keys, escaped Greek, and the
 * message — the part they actually need — wrapped inside a 16rem scroll box.
 *
 * Ordering is the part that cannot be skipped. `payload` is a MySQL `json`
 * column, which stores object keys sorted by length and then lexically, so the
 * order the route wrote them in is already gone by the time anything reads the
 * row: a brief comes back Name, Email, Phone, Budget, Locale, Company, Message.
 * The reading order has to be imposed here or there isn't one.
 *
 * Generic on purpose: `quote` submissions carry camelCase keys rather than
 * labels, and a form added later carries keys nobody has seen.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { payloadFields } from '@/cms/admin/payload-fields';

/** A brief, keyed in the order MySQL actually returns it. */
const BRIEF = {
  Name: 'Aggelos Test',
  Email: 'aggepap@gmail.com',
  Phone: '6975609647',
  Budget: '500-1500-month',
  Locale: 'EL',
  Company: 'Compan',
  Message: 'σαφασφασφασ'.repeat(20),
  Website: 'http://localhost:3000',
  Industry: 'professional-services',
  'Company size': '6-15',
  'How found us': 'google',
  'Interested in': 'marketing-retainer',
  'Newsletter opt-in': 'YES',
};

const labels = (payload: Record<string, unknown>) => payloadFields(payload).map((f) => f.label);
const find = (payload: Record<string, unknown>, label: string) =>
  payloadFields(payload).find((f) => f.label === label);

describe('payloadFields', () => {
  test('keeps every field — nothing is dropped on the way to the screen', () => {
    // A field the renderer does not understand still has to be shown. This is
    // the record of an enquiry; silently hiding part of it is the worst outcome.
    assert.deepEqual(new Set(labels(BRIEF)), new Set(Object.keys(BRIEF)));
  });

  test('leads with who the person is, whatever order the row came back in', () => {
    const order = labels(BRIEF);
    assert.deepEqual(order.slice(0, 6), [
      'Name',
      'Email',
      'Phone',
      'Company',
      'Website',
      'Industry',
    ]);
  });

  test('puts the long free text last, as a block', () => {
    const order = labels(BRIEF);
    assert.equal(order.at(-1), 'Message');
    assert.equal(find(BRIEF, 'Message')?.kind, 'block');
  });

  test('classifies the values a triager clicks', () => {
    assert.equal(find(BRIEF, 'Email')?.kind, 'email');
    assert.equal(find(BRIEF, 'Website')?.kind, 'url');
    assert.equal(find(BRIEF, 'Phone')?.kind, 'tel');
    assert.equal(find(BRIEF, 'Industry')?.kind, 'text');
  });

  test('never turns a script URL into a link', () => {
    // The payload is visitor-supplied. `Website` is length-capped and, on three
    // of the six forms, not even URL-validated.
    for (const hostile of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      ' java	script:alert(1)',
    ]) {
      assert.equal(find({ Website: hostile }, 'Website')?.kind, 'text', hostile);
    }
  });

  test('builds the href itself, so the component never assembles one', () => {
    // The only thing standing between visitor-supplied text and an `href` is
    // the classifier above. Keeping the URL here means there is one place to
    // check rather than one per call site.
    assert.equal(find(BRIEF, 'Email')?.href, 'mailto:aggepap@gmail.com');
    assert.equal(find(BRIEF, 'Website')?.href, 'http://localhost:3000');
    assert.equal(find(BRIEF, 'Phone')?.href, 'tel:6975609647');
  });

  test('leaves a plain value with no href at all', () => {
    assert.equal(find(BRIEF, 'Industry')?.href, undefined);
    assert.equal(find({ Website: 'javascript:alert(1)' }, 'Website')?.href, undefined);
  });

  test('strips a phone down to what a dialler accepts', () => {
    assert.equal(find({ Phone: '+30 210 123 4567' }, 'Phone')?.href, 'tel:+302101234567');
  });

  test('does not mistake a written-out address for a mailto', () => {
    assert.equal(find({ Note: 'write to me at a b.gr' }, 'Note')?.kind, 'text');
  });

  test('humanizes a key that is not already a label', () => {
    // `quote` submissions are keyed from the DTO, not from email row labels.
    const fields = payloadFields({ productSlug: 'x', quantity: 2, name: 'Someone' });
    assert.deepEqual(
      new Set(fields.map((f) => f.label)),
      new Set(['Product slug', 'Quantity', 'Name']),
    );
  });

  test('leaves a label that is already written for a person alone', () => {
    assert.deepEqual(labels({ 'Company size': '6-15', 'SEO score': '72' }).sort(), [
      'Company size',
      'SEO score',
    ]);
  });

  test('renders a list as its items rather than as a joined blob', () => {
    const field = find({ Interested: ['seo', 'ads', 'content'] }, 'Interested');
    assert.equal(field?.kind, 'list');
    assert.deepEqual(field?.items, ['seo', 'ads', 'content']);
  });

  test('renders numbers, booleans and null as readable text, never [object Object]', () => {
    const payload = { 'SEO score': 72, 'Wants analysis': true, Phone: null };
    for (const field of payloadFields(payload)) {
      assert.doesNotMatch(field.text ?? '', /\[object Object\]/);
    }
    assert.equal(find(payload, 'SEO score')?.text, '72');
    assert.equal(find(payload, 'Wants analysis')?.text, 'Yes');
    assert.equal(find(payload, 'Phone')?.text, '—');
  });

  test('falls back to JSON for a nested object rather than stringifying it badly', () => {
    const field = find({ Extra: { a: 1 } }, 'Extra');
    assert.equal(field?.kind, 'block');
    assert.match(field?.text ?? '', /"a": 1/);
  });

  test('is empty for an empty payload, so the drawer can say so', () => {
    assert.deepEqual(payloadFields({}), []);
  });

  test('keeps unknown labels in their own order, after the known ones', () => {
    const order = labels({ Zeta: '1', Email: 'a@b.co', Alpha: '2' });
    assert.deepEqual(order, ['Email', 'Zeta', 'Alpha']);
  });

  test('treats a multi-line value as a block even when it is short', () => {
    assert.equal(find({ Note: 'line one\nline two' }, 'Note')?.kind, 'block');
  });
});
