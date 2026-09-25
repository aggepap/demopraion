/**
 * The experience collection's shape.
 *
 * The first test here guards a real hazard: `defineConfig` validates relation
 * targets at MODULE LOAD, so a relation pointing at a collection that is no
 * longer registered takes the whole app down — admin included — at import time,
 * with no request needed to trigger it. Loading the real site config in a test
 * is the cheapest possible way to notice.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import config from '@/site.config';
import { bookingCollection, BOOKING_KIND_VALUES } from '@/cms/modules/booking/collection';
import { readOptions } from '@/cms/modules/booking/data';
import { isFieldVisible, visibleFields, walkFields, type Field } from '@/cms/config/fields';
import { buildDataSchema } from '@/cms/config/zod';
import { resolveKindField } from '@/cms/modules/booking/fields';

const collection = bookingCollection();
const byKey = new Map(collection.fields.map((f) => [f.key, f]));

describe('the site config loads', () => {
  test('every relation target is a registered collection', () => {
    const keys = new Set(config.collections.map((c) => c.key));
    for (const c of config.collections) {
      walkFields(c.fields as Field[], (field) => {
        if (field.kind !== 'relation') return;
        assert.equal(keys.has(field.to), true, `${c.key}.${field.key} → missing collection "${field.to}"`);
      });
    }
  });

  test('the three filter vocabularies are registered under fresh keys', () => {
    const keys = config.collections.map((c) => c.key);
    assert.equal(keys.includes('booking'), true);
    assert.equal(keys.includes('booking_category'), true);
    assert.equal(keys.includes('vessel_type'), true);
    assert.equal(keys.includes('departure_location'), true);

    // The OLD keys must stay gone. Vessel types and departure locations were
    // folded into rows on the experience and are documents again — but under
    // new keys, because an install that never ran `db:migrate-booking-options
    // -- --purge` still has rows under these, and reusing the keys would
    // resurrect them as a half-populated vocabulary.
    assert.equal(keys.includes('booking_type'), false);
    assert.equal(keys.includes('departure'), false);
    // Options really are rows on the experience, so this one stays unregistered.
    assert.equal(keys.includes('resource'), false);
  });

  test('a term must be named in the default locale to be created published', () => {
    // `TermPicker` creates terms with `status: 'published'`, which enforces
    // required fields — for a localized field, in every language. It used to
    // seed only the default and the active locale, which are the SAME locale
    // whenever you edit in the default one: creating a departure location from
    // the Greek tab answered "title.en is required" on a drawer with a single
    // name box and nowhere to type an English name. The picker now seeds all of
    // them, so this is the shape it has to produce.
    //
    // Since localized maps became partial (adding a site locale no longer makes
    // every stored document unsaveable), "required" means the DEFAULT locale
    // must be present and non-empty; the others may be missing.
    const vessel = config.collections.find((c) => c.key === 'vessel_type')!;
    const schema = buildDataSchema(vessel.fields as Field[], ['el', 'en'], {
      enforceRequired: true,
      defaultLocale: 'el',
    });
    assert.equal(schema.safeParse({ title: { el: 'Σκάφος', en: 'Σκάφος' } }).success, true);
    assert.equal(schema.safeParse({ title: { el: 'Σκάφος' } }).success, true);
    assert.equal(schema.safeParse({ title: { en: 'Vessel' } }).success, false);
  });

  test('a routeless term has no public surface at all', () => {
    // Filter vocabulary, not pages: no route, so no SEO panel to fill in and
    // nothing for Product Manager to try to score.
    const vessel = config.collections.find((c) => c.key === 'vessel_type')!;
    assert.equal(vessel.routing?.pathTemplate, undefined);
    assert.equal(vessel.seo, false);
    assert.equal(vessel.pmPageType, undefined);
    // Flat: no `parent`, which is what `picker: 'termList'` requires — the tree
    // variant posts `data.parent` on create and a strict schema would 400.
    assert.equal(vessel.fields.some((f) => f.key === 'parent'), false);

    // The hierarchical one keeps its tree. It has no page of its own — a
    // category is a filter on /booking (`?category=`) — so it declares no route
    // for the sitemap or the admin to link to (it used to declare
    // `/booking/category/{slug}`, which 404'd), and no SEO panel for a page
    // that does not exist.
    const category = config.collections.find((c) => c.key === 'booking_category')!;
    assert.equal(category.routing?.pathTemplate, undefined);
    assert.equal(category.seo, false);
    assert.equal(category.fields.some((f) => f.key === 'parent'), true);
  });
});

describe('bookingCollection — the kind discriminator', () => {
  test('`kind` is the first field, shared, and defaults to transport', () => {
    const first = collection.fields[0];
    assert.equal(first.key, 'kind');
    assert.equal(first.kind, 'select');
    // Shared: an experience that were transport in Greek and a stay in English
    // would price two different ways for one reservation.
    assert.equal(first.shared, true);
    assert.equal((first as { default?: string }).default, 'transport');
  });

  test('it offers exactly the two kinds the engine knows about', () => {
    const options = (byKey.get('kind') as { options: { value: string }[] }).options;
    assert.deepEqual(options.map((o) => o.value), [...BOOKING_KIND_VALUES]);
  });
});

describe('bookingCollection — what each kind shows', () => {
  // The Options, Extras and party-size switches are ON in these fixtures on
  // purpose: this block is about what KIND hides, and leaving them off would
  // hide those sections for both kinds and make the comparison vacuous. The
  // switches have their own block below.
  const both = { optionsEnabled: true, extrasEnabled: true, hasPersons: true, pricingMode: 'tiered' };
  const transport = new Set(visibleFields(collection.fields, { ...both, kind: 'transport' }).map((f) => f.key));
  const stay = new Set(visibleFields(collection.fields, { ...both, kind: 'stay' }).map((f) => f.key));

  test('a stay shows no vessels and no departure locations', () => {
    for (const key of ['types', 'departures', 'basePrice', 'seasonalPrices', 'hasPersons', 'pricingMode', 'tiers']) {
      assert.equal(transport.has(key), true, `transport should show ${key}`);
      assert.equal(stay.has(key), false, `stay should hide ${key}`);
    }
  });

  test('transport shows none of the nightly-rate machinery', () => {
    for (const key of ['nightlyRate', 'seasonalRates', 'minNights', 'checkInDays', 'baseOccupancy', 'fees']) {
      assert.equal(stay.has(key), true, `stay should show ${key}`);
      assert.equal(transport.has(key), false, `transport should hide ${key}`);
    }
  });

  test('what both kinds need is shown to both', () => {
    for (const key of [
      'title',
      'categories',
      'options',
      'optionsLabel',
      'extrasEnabled',
      'extrasOptions',
      'choices',
      'availableFrom',
      'capacityPerDay',
      'bookingMode',
      'depositPercent',
      'cancellationPolicy',
    ]) {
      assert.equal(transport.has(key), true, `transport should show ${key}`);
      assert.equal(stay.has(key), true, `stay should show ${key}`);
    }
  });

  test('an experience with no `kind` at all reads as transport', () => {
    // Every experience authored before the field existed. Falling through to
    // "hidden" would empty the form of the only content those documents have.
    const legacy = new Set(visibleFields(collection.fields, {}).map((f) => f.key));
    assert.equal(legacy.has('basePrice'), true);
    assert.equal(legacy.has('types'), true);
    assert.equal(legacy.has('nightlyRate'), false);
  });
});

describe('bookingCollection — the declared sections', () => {
  const declared = collection.sections ?? [];

  test('every declared title matches a real section, and every section is declared', () => {
    // A title that matches nothing is dead config; a section nobody declared
    // falls back to open-and-undescribed, silently.
    const used = new Set(collection.fields.map((f) => f.section).filter(Boolean));
    const named = new Set(declared.map((s) => s.title));
    assert.deepEqual([...used].filter((t) => !named.has(t!)), [], 'sections with no declaration');
    assert.deepEqual([...named].filter((t) => !used.has(t)), [], 'declarations matching no section');
  });

  test('what a sellable listing needs is open; the rest is folded', () => {
    // The point of the whole arrangement: a card that is open is a card
    // claiming attention, so only the ones you cannot publish without get it.
    const open = declared.filter((s) => !s.collapsed).map((s) => s.title);
    assert.deepEqual(open, [
      'The experience',
      'Pricing',
      'Nightly rates',
      'Party size',
      'Nights & arrival',
      'Availability',
    ]);
  });

  test('no kind ever sees more than five open cards', () => {
    for (const kind of ['transport', 'stay']) {
      const titles = new Set(
        visibleFields(collection.fields, { kind, hasPersons: true }).map((f) => f.section),
      );
      const open = declared.filter((s) => !s.collapsed && titles.has(s.title));
      assert.ok(open.length <= 5, `"${kind}" opens ${open.length} cards: ${open.map((s) => s.title).join(', ')}`);
    }
  });

  test('the editorial content sits below the commercial setup', () => {
    const order = declared.map((s) => s.title);
    assert.ok(order.indexOf('Content') > order.indexOf('Availability'));
    assert.ok(order.indexOf('Content') > order.indexOf('Pricing'));
  });
});

describe('bookingCollection — the order sections appear in', () => {
  /** Section titles in declared order, for the fields one kind actually sees. */
  const sectionsFor = (data: Record<string, unknown>): string[] => {
    const seen: string[] = [];
    for (const f of visibleFields(collection.fields, data)) {
      if (f.section && f.section !== seen[seen.length - 1]) seen.push(f.section);
    }
    return seen;
  };

  /*
   * `buildBlocks` starts a new card whenever the section title changes, so a
   * section whose fields are split by another one renders as TWO cards with the
   * same heading. Contiguity is the invariant that keeps the form readable, and
   * it is the thing reordering sections is most likely to break.
   */
  test('no section is split in two by another', () => {
    for (const kind of ['transport', 'stay']) {
      const titles = sectionsFor({ kind, optionsEnabled: true, extrasEnabled: true, hasPersons: true });
      assert.deepEqual(titles, [...new Set(titles)], `"${kind}" repeats a section heading`);
    }
  });

  test('availability follows the pricing, for either kind', () => {
    // What an operator sets up in one pass: what it costs, then when it runs.
    const transport = sectionsFor({ kind: 'transport', hasPersons: true, optionsEnabled: true });
    assert.equal(transport[transport.indexOf('Availability') - 1], 'Party size');

    const stay = sectionsFor({ kind: 'stay', optionsEnabled: true });
    assert.equal(stay[stay.indexOf('Availability') - 1], 'Fees & taxes');
  });

  test('availability comes before the options that are booked against it', () => {
    for (const kind of ['transport', 'stay']) {
      const titles = sectionsFor({ kind, optionsEnabled: true, extrasEnabled: true, hasPersons: true });
      assert.ok(
        titles.indexOf('Availability') < titles.indexOf('Options'),
        `"${kind}" puts Options before Availability`,
      );
    }
  });
});

describe('bookingCollection — party size and pricing mode', () => {
  const shown = (data: Record<string, unknown>) =>
    new Set(visibleFields(collection.fields, { kind: 'transport', ...data }).map((f) => f.key));

  // WAS: `hasPersons` was a switch that hid nothing, and every mode's fields
  // were on screen at once whichever mode was chosen — so an editor filled in
  // the price bands under "per person" and got a price that ignored them.
  test('the party-size block is off until the switch is on', () => {
    const off = shown({});
    for (const key of ['minPersons', 'maxPersons', 'pricingMode', 'includedPersons', 'tiers']) {
      assert.equal(off.has(key), false, `${key} should be hidden while per-party pricing is off`);
    }
    assert.equal(off.has('hasPersons'), true, 'the switch itself is always offered');
  });

  test('each mode shows only its own fields', () => {
    const perPerson = shown({ hasPersons: true, pricingMode: 'multiply' });
    assert.equal(perPerson.has('includedPersons'), false);
    assert.equal(perPerson.has('extraPerPerson'), false);
    assert.equal(perPerson.has('tiers'), false);

    const group = shown({ hasPersons: true, pricingMode: 'group_threshold' });
    assert.equal(group.has('includedPersons'), true);
    assert.equal(group.has('extraPerPerson'), true);
    assert.equal(group.has('tiers'), false);

    const banded = shown({ hasPersons: true, pricingMode: 'tiered' });
    assert.equal(banded.has('tiers'), true);
    assert.equal(banded.has('includedPersons'), false);
    assert.equal(banded.has('extraPerPerson'), false);
  });

  test('an unset mode reads as the declared default, not as hidden', () => {
    // Otherwise every experience saved before the gating existed would open
    // with its whole pricing block missing.
    const unset = shown({ hasPersons: true });
    assert.equal(unset.has('pricingMode'), true);
    assert.equal(unset.has('tiers'), false, 'the default is per-person, not banded');
  });

  test('a season names its dates, not its position in the list', () => {
    // "Season 1" is true of every season. Which one an editor is looking at is
    // the range, and a collapsed row that will not say so has to be opened.
    const seasonal = collection.fields.find((f) => f.key === 'seasonalPrices') as {
      summaryTemplate?: string;
    };
    assert.equal(seasonal.summaryTemplate, '{from} – {to}');
  });

  test('a price band is three numbers, addressed as a range', () => {
    const tiers = collection.fields.find((f) => f.key === 'tiers') as {
      fields: {
        key: string;
        required?: boolean;
        hidden?: boolean;
        boundsFrom?: { min?: string; max?: string };
      }[];
      summaryTemplate?: string;
      inlineFields?: boolean;
    };
    const visible = tiers.fields.filter((f) => !f.hidden);
    assert.deepEqual(visible.map((f) => f.key), ['min', 'max', 'total']);
    // All three are required: a band missing an end covers nothing definite.
    assert.equal(visible.every((f) => f.required), true);
    // …and the key bands replaced is still declared, hidden and optional, so a
    // document saved under the old shape survives its next save rather than
    // 422-ing on a key the strict schema does not recognise.
    const legacy = tiers.fields.find((f) => f.key === 'persons');
    assert.ok(legacy, 'the legacy `persons` key must stay declared');
    assert.equal(legacy.hidden, true);
    assert.equal(legacy.required, undefined);
    // The ends are bounded by the experience's own party-size range, so a band
    // cannot be spun past a party the form would never offer.
    for (const key of ['min', 'max']) {
      const sub = visible.find((f) => f.key === key)!;
      assert.deepEqual(sub.boundsFrom, { min: 'minPersons', max: 'maxPersons' });
    }
    // Numbers only, so a collapsed row needs to be told how to read itself.
    assert.match(tiers.summaryTemplate ?? '', /\{min\}.*\{max\}.*\{total\}/);
    assert.equal(tiers.inlineFields, true);
  });
});

describe('the "what you sell" setting decides whether the kind is asked', () => {
  const kindField = byKey.get('kind')!;
  const shown = (allowed: string[], storedKind?: string) => {
    const resolved = resolveKindField(kindField, allowed, storedKind);
    return {
      visible: resolved.hidden !== true,
      default: (resolved as { default?: string }).default,
      options: (resolved as { options?: { value: string }[] }).options?.map((o) => o.value) ?? [],
    };
  };

  test('selling every kind keeps the selector untouched', () => {
    assert.equal(shown(['transport', 'stay']).visible, true);
    assert.deepEqual(shown(['transport', 'stay']).options, [...BOOKING_KIND_VALUES]);
  });

  test('selling one kind hides it and makes that kind the default', () => {
    // An editor creating a villa on a villas-only site is not asked a question
    // with exactly one answer.
    assert.equal(shown(['stay']).visible, false);
    assert.equal(shown(['stay']).default, 'stay');
    assert.equal(shown(['transport']).visible, false);
    assert.equal(shown(['transport']).default, 'transport');
  });

  test('a document already saved as another kind keeps its selector', () => {
    // Otherwise a transport experience on a site that later narrowed to stays
    // is stranded: its transport fields on screen, and no control to change it.
    const stranded = shown(['stay'], 'transport');
    assert.equal(stranded.visible, true);
    // …and its own kind stays among the choices, or it could not be saved back.
    assert.equal(stranded.options.includes('transport'), true);
    assert.equal(stranded.options.includes('stay'), true);
    // A document that agrees is still hidden.
    assert.equal(shown(['stay'], 'stay').visible, false);
  });

  test('an empty or unknown allow-list widens rather than narrows', () => {
    // Narrowing on bad input would take away the operator's ability to author,
    // which is the one failure they could not work around.
    assert.equal(shown([]).visible, true);
    assert.deepEqual(shown([]).options, [...BOOKING_KIND_VALUES]);
    assert.equal(shown(['nonsense']).visible, true);
  });

  test('the hidden field is still stored and validated', () => {
    // `hidden` only stops it rendering. The default is what zod stamps onto a
    // new document, so `data.kind` is explicit from the first save.
    const resolved = resolveKindField(kindField, ['stay'], undefined);
    const schema = buildDataSchema([resolved], ['en', 'el']);
    const parsed = schema.safeParse({});
    assert.equal(parsed.success, true);
    assert.equal((parsed.success ? (parsed.data as Record<string, unknown>) : {}).kind, 'stay');
  });

  test('a hidden kind still drives showIf, so the right half of the form shows', () => {
    // Two separate mechanisms: `hidden` stops the renderer drawing the field
    // (`FieldInput`), while `showIf` decides which OTHER fields apply. The
    // second must keep working off a value the editor can no longer see.
    const resolved = collection.fields.map((f) => (f.key === 'kind' ? resolveKindField(f, ['stay'], undefined) : f));
    assert.equal(resolved.find((f) => f.key === 'kind')?.hidden, true, 'the selector itself is not drawn');

    const keys = new Set(visibleFields(resolved, {}).map((f) => f.key));
    assert.equal(keys.has('nightlyRate'), true, 'the stay fields are shown');
    assert.equal(keys.has('basePrice'), false, 'and the transport fields are not');
    assert.equal(keys.has('types'), false);
  });

  test('the selector never sits alone in a section, so no empty card can appear', () => {
    // `hidden` fields still reach `buildBlocks`, so a section whose only field
    // was `kind` would render a heading over nothing.
    const section = kindField.section;
    const others = collection.fields.filter((f) => f.section === section && f.key !== 'kind');
    assert.ok(others.length > 0, `"${section}" would be empty with the kind selector hidden`);
  });

  test('adding a third kind needs no change here', () => {
    // The rule is "how many kinds may be authored", not "which two". A select
    // with three options, narrowed to one, still hides and defaults correctly.
    const threeKinds = {
      ...kindField,
      options: [
        { value: 'transport', label: 'Transport' },
        { value: 'stay', label: 'Stay' },
        { value: 'tour', label: 'Tour' },
      ],
    } as typeof kindField;
    const one = resolveKindField(threeKinds, ['tour'], undefined) as { hidden?: boolean; default?: string };
    assert.equal(one.hidden, true);
    assert.equal(one.default, 'tour');

    const two = resolveKindField(threeKinds, ['transport', 'tour'], undefined) as {
      hidden?: boolean;
      options?: { value: string }[];
    };
    assert.equal(two.hidden, undefined);
    assert.deepEqual(two.options?.map((o) => o.value), ['transport', 'tour']);
  });
});

describe('bookingCollection — options carry their own identity', () => {
  const options = byKey.get('options') as Extract<Field, { kind: 'repeater' }>;

  test('rows get a stable auto id, and the repeater is shared across locales', () => {
    // The id IS the availability key (`res:<id>`) and the value stored in
    // `reservations.resource_group_id`. If it differed per locale, a Greek
    // booking and an English booking would hold two different calendars.
    assert.equal(options.autoId, true);
    assert.equal(options.shared, true);
    assert.equal(options.fields.some((f) => f.key === 'id' && f.hidden), true);
  });

  test('a row holds its own name, price, capacity and seats — no relation', () => {
    const keys = options.fields.map((f) => f.key);
    for (const key of ['name', 'cost', 'capacityPerDay', 'seats', 'seasonal']) {
      assert.equal(keys.includes(key), true, `options row should hold ${key}`);
    }
    assert.equal(options.fields.some((f) => f.kind === 'relation'), false);
  });

  test('the experience relates to its three vocabularies and nothing else', () => {
    const relations: string[] = [];
    walkFields(collection.fields, (field) => {
      if (field.kind === 'relation') relations.push(field.key);
    });
    assert.deepEqual(relations, ['categories', 'types', 'departures']);
  });
});

describe('bookingCollection — the Options and Extras switches', () => {
  const shown = (data: Record<string, unknown>) =>
    new Set(visibleFields(collection.fields, data).map((f) => f.key));

  test('each section collapses to its own toggle until it is turned on', () => {
    // The point of the switch: an experience that sells neither shows two
    // checkboxes instead of two screens of settings it will never use.
    const off = shown({ kind: 'transport' });
    for (const key of ['optionsEnabled', 'extrasEnabled']) {
      assert.equal(off.has(key), true, `${key} is the switch, so it always shows`);
    }
    for (const key of ['optionsLabel', 'options', 'extrasTitle', 'extrasOptions', 'extrasMultiplyPerPerson', 'extrasMandatory']) {
      assert.equal(off.has(key), false, `${key} should be hidden while its section is off`);
    }
  });

  test('turning one on reveals only its own fields', () => {
    const optionsOnly = shown({ kind: 'transport', optionsEnabled: true });
    assert.equal(optionsOnly.has('optionsLabel'), true);
    assert.equal(optionsOnly.has('options'), true);
    assert.equal(optionsOnly.has('extrasOptions'), false);

    const extrasOnly = shown({ kind: 'transport', extrasEnabled: true });
    assert.equal(extrasOnly.has('extrasOptions'), true);
    assert.equal(extrasOnly.has('extrasTitle'), true);
    assert.equal(extrasOnly.has('options'), false);
  });

  test('"multiply extras by nights" needs BOTH a stay and extras switched on', () => {
    assert.equal(shown({ kind: 'stay', extrasEnabled: true }).has('extrasPerNight'), true);
    // Either one alone is a reason to hide it.
    assert.equal(shown({ kind: 'stay', extrasEnabled: false }).has('extrasPerNight'), false);
    assert.equal(shown({ kind: 'transport', extrasEnabled: true }).has('extrasPerNight'), false);
  });

  test('the Options switch does not gate what is already sold', () => {
    // `extrasEnabled` is read by `readExtras` and genuinely turns extras off.
    // `optionsEnabled` must NOT: `readOptions` feeds `readStoredCapacities`, which
    // the operator-accept path calls for reservations already taken, so a flag
    // flipped in the admin would change the capacity used to settle a booking
    // made months earlier.
    const data = { options: [{ id: 'a', name: 'Yacht', capacityPerDay: 3 }], optionsEnabled: false };
    assert.equal(readOptions(data, 'en').length, 1);
  });
});

describe('bookingCollection — the filter facets', () => {
  const expected: Record<string, string> = { types: 'vessel_type', departures: 'departure_location' };

  for (const [key, target] of Object.entries(expected)) {
    test(`${key} is a shared, transport-only relation to ${target}`, () => {
      const field = byKey.get(key) as Extract<Field, { kind: 'relation' }>;
      assert.equal(field.kind, 'relation');
      assert.equal(field.to, target);
      assert.equal(field.many, true);
      assert.equal(field.shared, true);
      // `termList`, not `categoryTree`: these collections have no `parent`.
      assert.equal(field.picker, 'termList');
      assert.equal(isFieldVisible(field, { kind: 'stay' }), false);
    });
  }

  test('the picker names itself after the thing it manages', () => {
    // Otherwise the drawer on a vessel-type field says "Manage categories".
    const field = byKey.get('types') as Extract<Field, { kind: 'relation' }>;
    assert.deepEqual(field.pickerNoun, { singular: 'vessel type', plural: 'vessel types' });
  });

  test('both are TOP-LEVEL, which is what makes the delete cascade work', () => {
    // `extractRelationLinks` only indexes top-level relation fields. Nested in a
    // group or repeater, these would never reach `document_relations` and
    // deleting a term would leave references nothing could find.
    for (const key of ['types', 'departures']) {
      assert.equal(collection.fields.some((f) => f.key === key), true, `${key} must be top-level`);
    }
  });

  test('the stored shape is ids — the OLD rows no longer validate', () => {
    // This is the migration's deadline, pinned. The READ path degrades quietly
    // on an unmigrated document (`relationIds` drops non-numbers), but its next
    // SAVE is a 400, so `db:migrate-booking-facets` has to run in the same
    // window as the deploy rather than at leisure afterwards.
    const schema = buildDataSchema(collection.fields, ['en', 'el']);
    assert.equal(schema.safeParse({ kind: 'transport', types: [1, 2] }).success, true);
    assert.equal(
      schema.safeParse({ kind: 'transport', types: [{ id: 'x', label: { en: 'Yacht' } }] }).success,
      false,
    );
  });
});

describe('unpublish redirect', () => {
  test('an unpublished experience sends visitors to the listing filtered by its category, else the listing', () => {
    // `booking_category` has no page of its own: categories are filters on /booking.
    assert.deepEqual(bookingCollection().unpublishRedirect, {
      taxonomyField: 'categories',
      fallbackPath: '/booking',
      termPathTemplate: '/booking?category={slug}',
    });
  });

  test('a custom experience path moves both with it', () => {
    assert.deepEqual(bookingCollection({ pathTemplate: '/trips/{slug}' }).unpublishRedirect, {
      taxonomyField: 'categories',
      fallbackPath: '/trips',
      termPathTemplate: '/trips?category={slug}',
    });
  });

  test('the real site config registers both with a redirect', () => {
    assert.ok(config.collectionByKey.get('booking')?.unpublishRedirect);
    assert.ok(config.collectionByKey.get('product')?.unpublishRedirect);
  });
});
