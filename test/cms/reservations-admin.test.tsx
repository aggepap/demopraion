/**
 * The Reservations screen: the money actions in the drawer, and a list that can
 * be paged and filtered.
 *
 * The list loaded the 100 newest bookings and filtered them in the browser, so
 * booking 101 could not be found at all. The drawer offered no way to resend a
 * payment link, note a bank transfer or refund — the routes existed with no
 * screen calling them.
 */
import '../setup/react-global';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { ReservationPaymentsPanel, type ReservationPaymentsPanelProps } from '@/cms/admin/ReservationPayments';
import { ReservationFilterBar, ReservationPager } from '@/cms/admin/ReservationsTable';
import {
  DEFAULT_RESERVATION_FILTERS,
  parseReservationFilters,
  reservationFiltersQuery,
  RESERVATIONS_PAGE_SIZE,
  toListOptions,
} from '@/cms/modules/booking/reservation-filters';

const noop = () => {};
const NOW = new Date('2026-09-23T10:00:00Z');

function panel(over: Partial<ReservationPaymentsPanelProps> = {}) {
  const props: ReservationPaymentsPanelProps = {
    reservation: { status: 'awaiting_payment', total: 10000, amountPaid: 0, currency: 'EUR', expiresAt: null },
    payments: [],
    gateway: { online: true, label: 'Card (Stripe)', linkTtlDays: 7 },
    canWrite: true,
    busy: false,
    now: NOW,
    onResend: noop,
    onRecord: noop,
    onRefund: noop,
    ...over,
  };
  return renderToStaticMarkup(<ReservationPaymentsPanel {...props} />);
}

const captured = {
  id: 41,
  provider: 'stripe',
  status: 'captured',
  amount: 3000,
  refundable: 3000,
  refundedAmount: 0,
  createdAt: '2026-09-20T10:00:00.000Z',
};

describe('the payments panel', () => {
  test('shows what has been paid and what is due', () => {
    const html = panel({ reservation: { status: 'confirmed', total: 10000, amountPaid: 3000, currency: 'EUR', expiresAt: null } });
    assert.match(html, /Paid so far/);
    assert.match(html, /Balance due/);
  });

  test('offers "Resend payment link" for a booking awaiting payment through a gateway, and says the old link dies', () => {
    const html = panel();
    assert.match(html, />Resend payment link</);
    assert.match(html, /previous link stops working/i);
  });

  test('does not offer a resend with manual payment', () => {
    assert.doesNotMatch(panel({ gateway: { online: false, label: 'Manual / bank transfer', linkTtlDays: 7 } }), /Resend payment link/);
  });

  test('does not offer a resend for a paid, cancelled or unanswered booking', () => {
    for (const status of ['paid', 'cancelled', 'pending']) {
      const html = panel({ reservation: { status, total: 10000, amountPaid: status === 'paid' ? 10000 : 0, currency: 'EUR', expiresAt: null } });
      assert.doesNotMatch(html, /Resend payment link/, status);
    }
  });

  test('offers "Record payment" with a labelled amount field while money is due', () => {
    const html = panel();
    assert.match(html, />Record payment</);
    assert.match(html, /<label[^>]*for="reservation-record-amount"/);
    assert.match(html, /id="reservation-record-amount"/);
  });

  test('offers no "Record payment" once the booking is paid in full or cancelled', () => {
    assert.doesNotMatch(
      panel({ reservation: { status: 'paid', total: 10000, amountPaid: 10000, currency: 'EUR', expiresAt: null } }),
      /Record payment/,
    );
    assert.doesNotMatch(
      panel({ reservation: { status: 'cancelled', total: 10000, amountPaid: 0, currency: 'EUR', expiresAt: null } }),
      /Record payment/,
    );
  });

  test('offers "Refund" only when a captured gateway payment is refundable, and says where the money goes', () => {
    assert.doesNotMatch(panel(), />Refund</);
    const html = panel({ payments: [captured] });
    assert.match(html, />Refund</);
    assert.match(html, /returned to the customer through/i);
    assert.match(html, /id="reservation-refund-amount"/);
  });

  test('a fully refunded or manual payment offers no refund', () => {
    assert.doesNotMatch(panel({ payments: [{ ...captured, refundable: 0, refundedAmount: 3000 }] }), />Refund</);
    assert.doesNotMatch(panel({ payments: [{ ...captured, provider: 'manual', refundable: 0 }] }), />Refund</);
  });

  test('lists each payment, including what was refunded', () => {
    const html = panel({ payments: [{ ...captured, refundable: 1000, refundedAmount: 2000 }] });
    assert.match(html, /stripe/i);
    assert.match(html, /refunded/i);
  });

  test('a read-only role sees the payments but no action at all', () => {
    const html = panel({ canWrite: false, payments: [captured] });
    assert.match(html, /Paid so far/);
    assert.doesNotMatch(html, /Resend payment link|Record payment|>Refund</);
    assert.doesNotMatch(html, /<input/);
  });
});

describe('reservation list filters in the URL', () => {
  test('parse the query string, ignoring anything invalid', () => {
    const f = parseReservationFilters(
      new URLSearchParams('status=paid&search=Maria&needsAction=1&experience=grp-1&from=2026-08-01&to=2026-08-31&page=3'),
    );
    assert.deepEqual(f, {
      status: 'paid',
      search: 'Maria',
      needsAction: true,
      experience: 'grp-1',
      from: '2026-08-01',
      to: '2026-08-31',
      page: 3,
    });
    const junk = parseReservationFilters({ status: 'nope', from: '08/01/2026', page: '-4', search: ['a', 'b'] });
    assert.deepEqual(junk, { ...DEFAULT_RESERVATION_FILTERS, search: 'a' });
  });

  test('round-trip, leaving defaults out', () => {
    assert.equal(reservationFiltersQuery(DEFAULT_RESERVATION_FILTERS), '');
    const f = { ...DEFAULT_RESERVATION_FILTERS, experience: 'grp-1', from: '2026-08-01', page: 2 };
    assert.deepEqual(parseReservationFilters(new URLSearchParams(reservationFiltersQuery(f))), f);
  });

  test('become the list query, paged server-side', () => {
    const opts = toListOptions({ ...DEFAULT_RESERVATION_FILTERS, experience: 'grp-1', from: '2026-08-01', page: 2 });
    assert.equal(opts.bookingGroupId, 'grp-1');
    assert.equal(opts.from, '2026-08-01');
    assert.equal(opts.page, 2);
    assert.equal(opts.pageSize, RESERVATIONS_PAGE_SIZE);
  });
});

describe('the filter bar', () => {
  const html = renderToStaticMarkup(
    <ReservationFilterBar
      filters={{ ...DEFAULT_RESERVATION_FILTERS, experience: 'grp-2' }}
      experiences={[
        { id: 'grp-1', title: 'Sunset cruise' },
        { id: 'grp-2', title: 'Villa Rosa' },
      ]}
      onChange={noop}
    />,
  );

  test('keeps Needs action, status and search', () => {
    assert.match(html, /Needs action/);
    assert.match(html, /All statuses/);
    assert.match(html, /Reference, name or email/);
  });

  test('adds an experience filter and a date range, all labelled', () => {
    assert.match(html, /All experiences/);
    assert.match(html, /<option value="grp-2" selected="">Villa Rosa<\/option>/);
    assert.match(html, /aria-label="Experience"/);
    assert.match(html, /type="date"[^>]*aria-label="From date"|aria-label="From date"[^>]*type="date"/);
    assert.match(html, /aria-label="To date"/);
  });
});

describe('the pager', () => {
  test('says where you are and disables what cannot be done', () => {
    const first = renderToStaticMarkup(<ReservationPager page={1} pageSize={25} total={60} onPage={noop} />);
    assert.match(first, /Page 1 of 3/);
    assert.match(first, /60 bookings/);
    assert.match(first, /<button[^>]*disabled=""[^>]*>Prev<\/button>/);
    assert.doesNotMatch(first, /<button[^>]*disabled=""[^>]*>Next<\/button>/);
    const last = renderToStaticMarkup(<ReservationPager page={3} pageSize={25} total={60} onPage={noop} />);
    assert.match(last, /<button[^>]*disabled=""[^>]*>Next<\/button>/);
  });

  test('stays out of the way on a single page', () => {
    assert.equal(renderToStaticMarkup(<ReservationPager page={1} pageSize={25} total={3} onPage={noop} />), '');
  });
});

describe('the page and the API use the server-side filters', () => {
  test('the admin page reads the URL and pages on the server', () => {
    const page = readFileSync(new URL('../../src/app/admin/(shell)/reservations/page.tsx', import.meta.url), 'utf8');
    assert.match(page, /searchParams/);
    assert.match(page, /parseReservationFilters\(/);
    assert.doesNotMatch(page, /pageSize: 100/);
  });

  test('the list API accepts an experience filter', () => {
    const src = readFileSync(new URL('../../src/cms/modules/booking/reservations.ts', import.meta.url), 'utf8');
    assert.match(src, /experience: z\.string\(\)/);
  });
});
