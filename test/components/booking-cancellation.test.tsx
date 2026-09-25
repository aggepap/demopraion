/**
 * Cancellation terms and the booking-form note.
 *
 * Three experience fields — "Cancellation policy", "Free cancellation up to
 * (days before)" and "Note on the booking form" — could be filled in and were
 * shown nowhere: not on the experience page, not in any email. The policy's help
 * text even promised it was in the confirmation email.
 */
import '../setup/react-global';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { CancellationTerms } from '@/components/booking/CancellationTerms';
import {
  cancellationEmailHtml,
  hasRichTextContent,
  readCancellationTerms,
  richTextToEmailHtml,
} from '@/cms/modules/booking/cancellation';
import { bookingCollection } from '@/cms/modules/booking/collection';

const doc = (...paragraphs: string[]) => ({
  type: 'doc',
  content: paragraphs.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
});

describe('readCancellationTerms', () => {
  test('reads both fields', () => {
    const t = readCancellationTerms({ freeCancellationDays: 7, cancellationPolicy: doc('Refunds minus fees.') });
    assert.equal(t.freeCancellationDays, 7);
    assert.ok(t.policy);
  });

  test('empty means none — including a blank editor and an empty string', () => {
    const t = readCancellationTerms({ freeCancellationDays: '', cancellationPolicy: { type: 'doc', content: [{ type: 'paragraph' }] } });
    assert.equal(t.freeCancellationDays, null);
    assert.equal(t.policy, null);
  });

  test('0 days is a real value (free until the day itself); a negative or junk value is not', () => {
    assert.equal(readCancellationTerms({ freeCancellationDays: 0 }).freeCancellationDays, 0);
    assert.equal(readCancellationTerms({ freeCancellationDays: '3' }).freeCancellationDays, 3);
    assert.equal(readCancellationTerms({ freeCancellationDays: -1 }).freeCancellationDays, null);
    assert.equal(readCancellationTerms({ freeCancellationDays: 'soon' }).freeCancellationDays, null);
  });
});

describe('hasRichTextContent', () => {
  test('true only when there is text', () => {
    assert.equal(hasRichTextContent(doc('x')), true);
    assert.equal(hasRichTextContent(doc('   ')), false);
    assert.equal(hasRichTextContent(null), false);
    assert.equal(hasRichTextContent('plain'), false);
  });
});

describe('richTextToEmailHtml', () => {
  test('paragraphs and lists come through, text escaped', () => {
    const html = richTextToEmailHtml({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Fees <apply> & more', marks: [{ type: 'bold' }] }] },
        {
          type: 'bulletList',
          content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'One' }] }] }],
        },
      ],
    });
    assert.match(html, /<strong>Fees &lt;apply&gt; &amp; more<\/strong>/);
    assert.match(html, /<ul[^>]*><li[^>]*>.*One.*<\/li><\/ul>/);
  });

  test('never passes through markup or a link scheme from the document', () => {
    const html = richTextToEmailHtml({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'click', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }],
        },
      ],
    });
    assert.doesNotMatch(html, /javascript:/);
  });
});

describe('the cancellation block in the confirmation email', () => {
  test('carries the free-cancellation window and the policy, in the customer’s language', () => {
    const en = cancellationEmailHtml({ freeCancellationDays: 7, policy: doc('No refunds after that.') }, 'en');
    assert.match(en, /Cancellation policy/);
    assert.match(en, /Free cancellation up to 7 days before/);
    assert.match(en, /No refunds after that\./);
    const el = cancellationEmailHtml({ freeCancellationDays: 1, policy: null }, 'el');
    assert.match(el, /Δωρεάν ακύρωση/);
  });

  test('is empty when the experience states nothing', () => {
    assert.equal(cancellationEmailHtml({ freeCancellationDays: null, policy: null }, 'en'), '');
  });
});

describe('CancellationTerms on the experience page', () => {
  const labels = { title: 'Cancellation policy', freeCancellation: 'Free cancellation up to 7 days before' };

  test('shows the heading, the free-cancellation line and the policy', () => {
    const html = renderToStaticMarkup(
      <CancellationTerms freeCancellationDays={7} policy={doc('Refunds minus fees.')} labels={labels} />,
    );
    assert.match(html, /<h2[^>]*>Cancellation policy<\/h2>/);
    assert.match(html, /Free cancellation up to 7 days before/);
    assert.match(html, /Refunds minus fees\./);
  });

  test('renders nothing when the experience states nothing', () => {
    assert.equal(
      renderToStaticMarkup(<CancellationTerms freeCancellationDays={null} policy={null} labels={labels} />),
      '',
    );
  });
});

describe('the experience page uses them', () => {
  const page = readFileSync(new URL('../../src/app/[locale]/booking/[slug]/page.tsx', import.meta.url), 'utf8');

  test('renders the cancellation terms', () => {
    assert.match(page, /<CancellationTerms/);
    assert.match(page, /t\('freeCancellation'/);
  });

  test('renders the booking-form note with the form', () => {
    assert.match(page, /data\.formNote/);
  });

  test('the storefront messages exist in both languages', () => {
    for (const locale of ['en', 'el']) {
      const messages = JSON.parse(readFileSync(new URL(`../../messages/${locale}.json`, import.meta.url), 'utf8'));
      assert.equal(typeof messages.booking.cancellationTitle, 'string', locale);
      assert.match(messages.booking.freeCancellation, /\{days/, locale);
    }
  });
});

describe('the experience editor’s help texts tell the truth', () => {
  const field = (key: string) => bookingCollection().fields.find((f) => f.key === key);

  test('Deposit %: empty or 0 uses the site default', () => {
    const d = field('depositPercent')?.description ?? '';
    assert.match(d, /site default/i);
    assert.doesNotMatch(d, /0 or empty charges the full amount/);
  });

  test('Cancellation policy: shown on the experience page and in the confirmation email', () => {
    const d = field('cancellationPolicy')?.description ?? '';
    assert.match(d, /experience page/i);
    assert.match(d, /confirmation email/i);
  });

  test('Free cancellation: says where it appears and that it is not enforced', () => {
    const d = field('freeCancellationDays')?.description ?? '';
    assert.match(d, /experience page/i);
    assert.match(d, /not enforced|information only/i);
  });
});

describe('the confirmation emails include the policy', () => {
  test('emails.ts appends the cancellation block to confirmed and receipt emails', () => {
    const src = readFileSync(new URL('../../src/cms/modules/booking/emails.ts', import.meta.url), 'utf8');
    assert.match(src, /cancellationEmailHtml\(/);
    assert.match(src, /which === 'confirmed' \|\| which === 'receipt'/);
  });
});
