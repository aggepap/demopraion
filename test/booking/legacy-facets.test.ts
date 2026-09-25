/**
 * The pre-migration facet rows, as `db:migrate-booking-facets` reads them.
 *
 * The load-bearing assertion here is that a term's slug comes out of the
 * migration IDENTICAL to the one the site derived at read time. That slug is
 * the public filter key: get it wrong and every `/booking?type=…` URL in the
 * wild answers 200 with an empty result.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  collectLegacyFacetTerms,
  isMigratedFacet,
  legacyFacetSlugs,
  type LegacyDoc,
} from '@/cms/modules/booking/legacy-facets';

const doc = (over: Partial<LegacyDoc> & { data: unknown }): LegacyDoc => ({
  id: 1,
  slug: 'x',
  locale: 'el',
  updatedAt: new Date('2026-01-01'),
  ...over,
});

describe('isMigratedFacet', () => {
  test('ids are migrated, rows are not', () => {
    assert.equal(isMigratedFacet([1, 2]), true);
    assert.equal(isMigratedFacet([]), true);
    assert.equal(isMigratedFacet([{ id: 'a', label: 'Yacht' }]), false);
    assert.equal(isMigratedFacet(undefined), false);
  });
});

describe('legacyFacetSlugs', () => {
  test('author order is kept', () => {
    const slugs = legacyFacetSlugs([{ label: { el: 'Πάρος' } }, { label: { el: 'Μύκονος' } }]);
    assert.deepEqual(slugs, ['paros', 'mykonos']);
  });

  test('a pinned slug wins over the derived one', () => {
    assert.deepEqual(legacyFacetSlugs([{ slug: 'old-port', label: { en: 'Mykonos Old Port' } }]), ['old-port']);
  });

  test('a row with no usable name is dropped, not collapsed onto empty', () => {
    // Otherwise every unnameable row would merge into one bogus term.
    assert.deepEqual(legacyFacetSlugs([{ label: '' }, {}]), []);
  });

  test('one document naming a term twice points at it once', () => {
    assert.deepEqual(legacyFacetSlugs([{ label: 'Yacht' }, { slug: 'yacht' }]), ['yacht']);
  });
});

describe('collectLegacyFacetTerms', () => {
  test('the same name on two experiences becomes ONE term', () => {
    // This is the whole point of the change: "Mykonos" typed on five
    // experiences is one filter entry, not five.
    const scan = collectLegacyFacetTerms(
      [
        doc({ id: 1, data: { departures: [{ label: { el: 'Μύκονος', en: 'Mykonos' } }] } }),
        doc({ id: 2, data: { departures: [{ label: { el: 'Μύκονος', en: 'Mykonos' } }] } }),
      ],
      'departures',
      'el',
    );
    assert.deepEqual(scan.terms, [{ slug: 'mykonos', title: { el: 'Μύκονος', en: 'Mykonos' } }]);
  });

  test('the slug matches what the site derived, so old filter URLs still resolve', () => {
    // Greek is transliterated rather than discarded — an ASCII-only slug would
    // be empty for every term on a Greek-default site.
    const scan = collectLegacyFacetTerms(
      [doc({ data: { departures: [{ label: { el: 'Παλιό Λιμάνι', en: 'Old Port' } }] } })],
      'departures',
      'el',
    );
    // 'el' sorts first, so Greek decides — exactly as `slugifyLocalized` does.
    assert.equal(scan.terms[0].slug, 'palio-limani');
  });

  test('a pinned slug is carried over verbatim', () => {
    const scan = collectLegacyFacetTerms(
      [doc({ data: { departures: [{ slug: 'old-port', label: { en: 'Mykonos Old Port' } }] } })],
      'departures',
      'el',
    );
    assert.equal(scan.terms[0].slug, 'old-port');
  });

  test('locale maps are unioned across experiences', () => {
    // One experience translated the name and another did not; the term keeps
    // both languages rather than whichever it saw first.
    const scan = collectLegacyFacetTerms(
      [
        doc({ id: 1, data: { types: [{ slug: 'yacht', label: { el: 'Σκάφος' } }] } }),
        doc({ id: 2, data: { types: [{ slug: 'yacht', label: { en: 'Yacht' } }] } }),
      ],
      'types',
      'el',
    );
    assert.deepEqual(scan.terms[0].title, { el: 'Σκάφος', en: 'Yacht' });
  });

  test('a disagreement keeps the newest name and REPORTS the loser', () => {
    // The losing wording is about to stop existing, so it cannot be resolved
    // silently — someone has to be able to see what was overwritten.
    const scan = collectLegacyFacetTerms(
      [
        doc({ id: 1, slug: 'old', updatedAt: new Date('2026-01-01'), data: { types: [{ slug: 'yacht', label: { en: 'Speed boat' } }] } }),
        doc({ id: 2, slug: 'new', updatedAt: new Date('2026-06-01'), data: { types: [{ slug: 'yacht', label: { en: 'Speedboat' } }] } }),
      ],
      'types',
      'en',
    );
    assert.deepEqual(scan.terms[0].title, { en: 'Speedboat' });
    assert.equal(scan.conflicts.length, 1);
    assert.match(scan.conflicts[0], /Speed boat/);
    assert.match(scan.conflicts[0], /Speedboat/);
  });

  test('an unlocalized legacy label is attributed to the canonical locale', () => {
    const scan = collectLegacyFacetTerms([doc({ data: { types: [{ label: 'Yacht' }] } })], 'types', 'el');
    assert.deepEqual(scan.terms[0].title, { el: 'Yacht' });
  });

  test('a nameless row is reported as dropped rather than migrated', () => {
    const scan = collectLegacyFacetTerms([doc({ data: { types: [{ id: 'x' }] } })], 'types', 'el');
    assert.deepEqual(scan.terms, []);
    assert.equal(scan.dropped.length, 1);
  });

  test('terms come back in a stable order', () => {
    const scan = collectLegacyFacetTerms(
      [doc({ data: { departures: [{ label: 'Paros' }, { label: 'Mykonos' }] } })],
      'departures',
      'en',
    );
    assert.deepEqual(scan.terms.map((t) => t.slug), ['mykonos', 'paros']);
  });
});
