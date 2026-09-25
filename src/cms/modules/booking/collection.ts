/**
 * Booking collection presets.
 *
 * A bookable item is an ordinary `document` (type = 'booking' by default), so
 * it reuses the whole content stack — admin CRUD, validation, versioning,
 * publishing, translation groups, the read layer, revalidation. These factories
 * stamp the field shape so every site gets a consistent schema without
 * hand-writing it. A site opts in by adding them to its config `collections`
 * and setting `modules.booking: true`.
 *
 * ONE experience covers two very different products, told apart by `kind`:
 *
 *   transport — a charter for a calendar DAY. Priced per person, per group with
 *               an extra-person charge over a threshold, or by an explicit
 *               total per party size. Has vessels and departure points.
 *   stay      — a room or villa for a RANGE OF NIGHTS. Priced per night, with
 *               occupancy rules, fees and taxes. Has neither.
 *
 * `showIf` is what keeps that from being one overwhelming form: each kind sees
 * only its own fields. Fields belonging to the other kind stay in `data`
 * untouched, so switching back and forth loses nothing.
 *
 * An experience's `options` — the vessels, rooms or packages it sells — are
 * stored ON the experience rather than in a shared pool, so an editor publishes
 * a villa from one screen. The trade this makes is stated at `options` below.
 * Its vessel types and departure locations are NOT: those are shared documents
 * picked from the form, so renaming one propagates instead of splitting the
 * filter in two.
 *
 * Prices are authored in MAJOR units (450.00); the `reservations` tables store
 * minor units. Structural fields are `shared: true` so a price can never drift
 * between the Greek and English rows of the same item.
 */
import type { IconName } from '../../admin/ui/icon-names';
import {
  defineCollection,
  f,
  listingPathOf,
  MONTH_DAY_PATTERN,
  type CollectionDefinition,
  type Field,
  type UnpublishRedirectDefinition,
} from '../../config';

/** `mm-dd`. A season recurs every year, so it deliberately has no year.
 *  Re-exported for callers outside the module; the fields themselves use the
 *  `monthDay` kind, which carries this same pattern. */
export const MD_PATTERN = MONTH_DAY_PATTERN;

export const DEFAULT_BOOKING_TYPE = 'booking';

/** What is being sold. Decides which half of the form and which price engine. */
export const BOOKING_KIND_VALUES = ['transport', 'stay'] as const;
export type BookingKind = (typeof BOOKING_KIND_VALUES)[number];

/** How a date's capacity is consumed. See `availability.ts` for the mechanics. */
export const ALLOCATION_MODE_VALUES = ['shared', 'exclusive', 'resource'] as const;
export type AllocationMode = (typeof ALLOCATION_MODE_VALUES)[number];

/** Whether a customer asks first or books outright. `inherit` follows Settings. */
export const BOOKING_MODE_VALUES = ['inherit', 'request', 'instant'] as const;
export type BookingModeSetting = (typeof BOOKING_MODE_VALUES)[number];

/** What a fee multiplies by. `per_person` is once per guest for the whole stay;
 *  `per_person_per_night` is the shape a tourist tax usually takes. */
export const FEE_BASIS_VALUES = ['per_stay', 'per_night', 'per_person', 'per_person_per_night'] as const;
export type FeeBasis = (typeof FEE_BASIS_VALUES)[number];

const TRANSPORT_ONLY = { field: 'kind', equals: 'transport' } as const;
const STAY_ONLY = { field: 'kind', equals: 'stay' } as const;

/* Section switches. Each block collapses to its own toggle until it is turned
 * on, so an experience that sells no options and no extras shows two checkboxes
 * instead of two screens of settings it will never use. A boolean's value is
 * compared as a string, and an absent one reads as hidden — which is what makes
 * "off until you ask for it" the default. */
const OPTIONS_ON = { field: 'optionsEnabled', equals: 'true' } as const;
const EXTRAS_ON = { field: 'extrasEnabled', equals: 'true' } as const;

/* Party size, and the mode that decides which of its fields mean anything.
 * WAS: every mode's fields were on screen at once and which belonged to which
 * lived only in a `description`, behind a hover. An editor filling in the tier
 * table while "per person" was selected got a price that ignored it. */
const PERSONS_ON = { field: 'hasPersons', equals: 'true' } as const;
const MODE_GROUP = { field: 'pricingMode', equals: 'group_threshold' } as const;
const MODE_TIERED = { field: 'pricingMode', equals: 'tiered' } as const;

const WEEKDAY_OPTIONS = [
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
  { value: '0', label: 'Sunday' },
];

/* ────────────────────────────────────────────────────────────────────────── */
/* Terms — the shared taxonomy                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

export interface BookingTermCollectionOptions {
  key: string;
  label: string;
  labelPlural: string;
  icon?: IconName;
  pathTemplate?: string;
  /** Hierarchical terms get the tree picker with its "Manage" modal. */
  hierarchical?: boolean;
  /**
   * Whether the term carries the SEO panel. Defaults to "only if it has a
   * public route": a term with no `pathTemplate` has no URL, so metadata for it
   * would describe a page that does not exist and could not be indexed.
   */
  seo?: boolean;
  extraFields?: Field[];
}

/**
 * A shared taxonomy — service categories, vessel types, departure locations.
 *
 * Vessel types and departure points were folded into rows on the experience
 * during the transport/stay cutover, on the grounds that the vocabulary was
 * whatever the experiences said it was. They are documents again, because a
 * term now has to be renamed ONCE and propagate: with the vocabulary embedded,
 * "rename" meant rewriting `data.types[].label` across every experience that
 * used it, which is a version snapshot, an audit row and a publish-permission
 * decision per document per rename — a hand-rolled cascading update over a JSON
 * column, where `document_relations` already has a foreign key.
 *
 * What made that fold-in attractive is kept: `TermPicker`'s Manage drawer
 * creates, renames and deletes terms inline, so an editor still publishes an
 * experience from a single screen. That drawer is the same reason categories
 * were allowed to stay documents when the others left.
 *
 * `hierarchical` adds the `parent` self-relation and the tree picker; without
 * it the terms are flat and get the same drawer with the nesting removed.
 */
export function bookingTermCollection(opts: BookingTermCollectionOptions): CollectionDefinition {
  return defineCollection({
    key: opts.key,
    label: opts.label,
    labelPlural: opts.labelPlural,
    icon: opts.icon ?? 'tag',
    module: 'booking',
    titlePath: 'title',
    seo: opts.seo ?? Boolean(opts.pathTemplate),
    // Only exposed to PM when the site gives it a public path — a term with no
    // route is an internal grouping, not a page anything could rank.
    pmPageType: opts.pathTemplate ? 'product_category' : undefined,
    pmGroup: 'Booking',
    routing: opts.pathTemplate ? { pathTemplate: opts.pathTemplate } : {},
    fields: [
      f.text('title', {
        label: opts.label,
        required: true,
        maxLength: 191,
        localized: true,
        description: 'The name shown in the filters on the public listing and in the picker on each experience.',
      }),
      f.textarea('description', {
        label: 'Description',
        localized: true,
        rows: 3,
        description: 'Optional text about this entry, for pages that show one.',
      }),
      ...(opts.hierarchical
        ? [
            f.relation('parent', {
              label: 'Parent',
              to: opts.key,
              picker: 'categoryTree',
              shared: true,
              description: 'Leave empty for a top-level entry.',
            }),
          ]
        : []),
      ...(opts.extraFields ?? []),
    ],
  });
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Booking — the bookable item                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

export interface BookingCollectionOptions {
  key?: string;
  label?: string;
  labelPlural?: string;
  icon?: IconName;
  /** Route template for the public detail page. Default `/booking/{slug}`. */
  pathTemplate?: string;
  categoryKey?: string;
  /** Collection keys of the two filter vocabularies. Both must be registered
   *  BEFORE this collection — `defineConfig` rejects a relation whose target
   *  does not exist yet. */
  vesselTypeKey?: string;
  departureKey?: string;
  extraFields?: Field[];
}

function bookingUnpublishRedirect(pathTemplate: string): UnpublishRedirectDefinition | undefined {
  const listing = listingPathOf(pathTemplate);
  return listing
    ? { taxonomyField: 'categories', fallbackPath: listing, termPathTemplate: `${listing}?category={slug}` }
    : undefined;
}

export function bookingCollection(opts: BookingCollectionOptions = {}): CollectionDefinition {
  const categoryKey = opts.categoryKey ?? 'booking_category';
  const vesselTypeKey = opts.vesselTypeKey ?? 'vessel_type';
  const departureKey = opts.departureKey ?? 'departure_location';

  return defineCollection({
    key: opts.key ?? DEFAULT_BOOKING_TYPE,
    label: opts.label ?? 'Experience',
    labelPlural: opts.labelPlural ?? 'Experiences',
    icon: opts.icon ?? 'sailboat',
    // Tied to the booking module: hidden from the admin until the Modules
    // toggle enables booking (the schema still lives here in code).
    module: 'booking',
    titlePath: 'title',
    // An experience is a public, indexed page with its own metadata and JSON-LD,
    // so it is a legitimate SEO surface. `wp_post` rather than `product`: PM's
    // product type expects a price and a SKU, and booking prices are seasonal
    // and per-person rather than a single number.
    pmPageType: 'wp_post',
    pmFieldMap: { short_description: 'subtitle' },
    pmGroup: 'Booking',
    pmDescription: 'Bookable experiences — tours, charters, transfers and stays.',
    // Pricing coherence — gaps and overlaps between price bands — is a statement
    // about several fields at once, so it reaches the editor through the
    // advisory registry rather than through any one field's validation.
    advisories: 'booking-pricing',
    /*
     * How the editor reads, top to bottom: name the thing, price it, say when it
     * runs — then the parts that only some experiences have.
     *
     * Open by default is reserved for what a sellable listing cannot go without,
     * because a card that is open is a card claiming attention. Everything else
     * starts folded behind a heading that says what it is for, turning a wall of
     * fourteen expanded panels into four questions and a contents page. A folded
     * card still opens itself when it holds a validation message, so nothing can
     * be refused from inside one. Titles here must match `section` verbatim.
     */
    sections: [
      { title: 'The experience' },
      {
        title: 'Organization',
        collapsed: true,
        description: 'Drives the filters on /booking. Set once, rarely revisited.',
      },
      { title: 'Pricing' },
      { title: 'Nightly rates' },
      { title: 'Party size', description: 'Only for experiences whose price depends on how many come.' },
      { title: 'Nights & arrival' },
      { title: 'Occupancy', collapsed: true },
      { title: 'Fees & taxes', collapsed: true, description: 'Cleaning, tourist tax and the like. Each is its own line on the guest’s price breakdown.' },
      { title: 'Availability' },
      {
        title: 'Options',
        collapsed: true,
        description: 'The vessels, rooms or packages a customer picks between. A single villa needs none.',
      },
      { title: 'Extras', collapsed: true, description: 'Add-ons offered alongside the booking.' },
      {
        title: 'Content',
        collapsed: true,
        description: 'Photos, the facts strip and the FAQ — everything the public page shows beyond the price.',
      },
      { title: 'Booking form', collapsed: true, description: 'Extra questions asked at checkout, and the note under the form.' },
      { title: 'Cancellation & deposit', collapsed: true },
    ],
    routing: { pathTemplate: opts.pathTemplate ?? '/booking/{slug}' },
    // Unpublished, an experience's URL redirects to the listing filtered by its
    // first live category (categories are filters on the listing, not pages of
    // their own), or to the unfiltered listing when it has none.
    unpublishRedirect: bookingUnpublishRedirect(opts.pathTemplate ?? '/booking/{slug}'),
    fields: [
      // Fields marked `shared` are identical across all languages — the whole
      // pricing and availability model, so it cannot drift between locales.
      // Note they must stay TOP-LEVEL: the editor derives shared keys from
      // top-level fields only, so a shared field nested inside a group would
      // quietly stop propagating.

      // ── The experience ─────────────────────────────────────────────────
      // First, and shared: `kind` decides what the rest of this form even is,
      // so it must be the same in every language. An experience that were
      // transport in Greek and a stay in English would price two different ways
      // for the same reservation.
      f.select('kind', {
        label: 'Booking type',
        shared: true,
        section: 'The experience',
        default: 'transport',
        options: [
          { value: 'transport', label: 'Transport — boat, helicopter, transfer (booked by the day)' },
          { value: 'stay', label: 'Stay — room, villa, apartment (booked by the night)' },
        ],
        description: 'Decides which pricing, availability and booking-form fields apply below.',
      }),
      f.text('title', {
        label: 'Experience name',
        required: true,
        maxLength: 255,
        section: 'The experience',
        description: 'The page heading, and the name on cards, reservations and emails.',
      }),
      f.text('subtitle', {
        label: 'Short tagline',
        maxLength: 255,
        section: 'The experience',
        description: 'One line under the name on the page and on cards.',
      }),
      f.richText('description', {
        label: 'Description',
        section: 'The experience',
        description: 'The full text of the experience page.',
      }),
      // ── Organization ───────────────────────────────────────────────────
      f.relation('categories', {
        label: 'Service categories',
        to: categoryKey,
        many: true,
        picker: 'categoryTree',
        shared: true,
        section: 'Organization',
        description: 'What kind of service this is. Shown as a filter on /booking.',
      }),
      // Vessel types and departure locations are shared documents, picked here.
      // Top-level on purpose: `extractRelationLinks` only indexes top-level
      // relation fields, and the delete cascade that keeps a removed term from
      // leaving dangling references depends on those rows existing.
      f.relation('types', {
        label: 'Vessel types',
        to: vesselTypeKey,
        many: true,
        picker: 'termList',
        pickerNoun: { singular: 'vessel type', plural: 'vessel types' },
        shared: true,
        section: 'Organization',
        showIf: TRANSPORT_ONLY,
        description: 'Pick from the vessel types already in use, or add one. Shown as a filter on /booking.',
      }),
      f.relation('departures', {
        label: 'Departure locations',
        to: departureKey,
        many: true,
        picker: 'termList',
        pickerNoun: { singular: 'departure location', plural: 'departure locations' },
        shared: true,
        section: 'Organization',
        showIf: TRANSPORT_ONLY,
        description:
          'Where this experience leaves from. Pick from the locations already in use, or add one. ' +
          'Shown as a filter on /booking.',
      }),

      // ── Pricing (transport) ────────────────────────────────────────────
      f.number('basePrice', {
        label: 'Base price',
        min: 0,
        shared: true,
        section: 'Pricing',
        showIf: TRANSPORT_ONLY,
        description:
          'Major units, e.g. 450.00. Leave empty to show "price on request". ' +
          'Not used when the pricing mode is a fixed total per party-size range.',
      }),
      f.repeater(
        'seasonalPrices',
        [
          f.text('id', { hidden: true }),
          f.monthDay('from', { label: 'From', required: true, description: 'First day of the season (month and day, every year).' }),
          f.monthDay('to', { label: 'To', required: true, description: 'Last day of the season, included.' }),
          f.number('price', {
            label: 'Price',
            required: true,
            min: 0,
            description: 'Used instead of the base price on these dates. Major units, e.g. 520.00.',
          }),
        ],
        {
          label: 'Seasonal prices',
          itemLabel: 'Season',
          // A season IS its date range — "Season 1" says nothing an editor
          // scanning a list of them could use.
          summaryTemplate: '{from} – {to}',
          autoId: true,
          noOverlap: { from: 'from', to: 'to' },
          shared: true,
          section: 'Pricing',
          showIf: TRANSPORT_ONLY,
          description:
            'Replaces the base price on matching dates. Ranges may not overlap; a range that wraps the new year (Nov → Feb) is fine.',
        },
      ),

      // ── Party size (transport) ─────────────────────────────────────────
      f.boolean('hasPersons', {
        label: 'Priced per party size',
        shared: true,
        section: 'Party size',
        showIf: TRANSPORT_ONLY,
        description:
          'Turn on when the price depends on how many people come. Off means one price per booking, ' +
          'however many travel.',
      }),
      f.number('minPersons', {
        label: 'Minimum persons',
        min: 1,
        max: 999,
        integer: true,
        default: 1,
        shared: true,
        section: 'Party size',
        showIf: [TRANSPORT_ONLY, PERSONS_ON],
        description: 'The smallest party that can book. The booking form will not offer fewer.',
      }),
      f.number('maxPersons', {
        label: 'Maximum persons',
        min: 1,
        max: 999,
        integer: true,
        default: 999,
        shared: true,
        section: 'Party size',
        showIf: [TRANSPORT_ONLY, PERSONS_ON],
        description: 'The largest party that can book in one reservation.',
      }),
      f.select('pricingMode', {
        label: 'Pricing mode',
        shared: true,
        section: 'Party size',
        showIf: [TRANSPORT_ONLY, PERSONS_ON],
        default: 'multiply',
        options: [
          { value: 'multiply', label: 'Per person — base price × number of people' },
          { value: 'group_threshold', label: 'Flat price up to N people, then a charge per extra person' },
          { value: 'tiered', label: 'Fixed total per party-size range — 5 to 10 people, one price' },
        ],
        description: 'Each mode has its own fields below; the other modes’ fields are hidden.',
      }),
      f.number('includedPersons', {
        label: 'Persons included in the flat price',
        // The literal floor stays: it is what `zod` enforces on save, and a flat
        // price covering nobody is meaningless. Only the ceiling follows the
        // experience — covering more people than it accepts is a number with
        // nothing behind it.
        min: 1,
        boundsFrom: { max: 'maxPersons' },
        integer: true,
        shared: true,
        section: 'Party size',
        showIf: [TRANSPORT_ONLY, PERSONS_ON, MODE_GROUP],
        description: 'The base price covers this many people. Anyone beyond them is charged separately.',
      }),
      f.number('extraPerPerson', {
        label: 'Charge per extra person',
        min: 0,
        shared: true,
        section: 'Party size',
        showIf: [TRANSPORT_ONLY, PERSONS_ON, MODE_GROUP],
        description: 'Charged for each person above the included count.',
      }),
      f.repeater(
        'tiers',
        [
          // Bounded by the experience's own party-size range: a band for 20
          // people on a boat that seats 12 prices a booking that cannot be made.
          f.number('min', {
            label: 'From persons',
            required: true,
            integer: true,
            boundsFrom: { min: 'minPersons', max: 'maxPersons' },
            description: 'Smallest party this band covers.',
          }),
          f.number('max', {
            label: 'To persons',
            required: true,
            integer: true,
            boundsFrom: { min: 'minPersons', max: 'maxPersons' },
            description: 'Largest party this band covers, included.',
          }),
          f.number('total', {
            label: 'Total for this party size',
            required: true,
            min: 0,
            description: 'The price for the whole party, not per person.',
          }),
          /*
           * The key bands replaced: one row per exact head count.
           *
           * Declared, hidden and optional, because the object schema is
           * `.strict()` — without it every experience saved under the old shape
           * answers the first save with `Unrecognized key: "persons"` and a 422,
           * which is a dead end for an editor who changed nothing. Reading it is
           * `readPricingConfig`'s job: an exact count is the band [n, n].
           */
          f.number('persons', { hidden: true, integer: true, min: 1 }),
        ],
        {
          label: 'Party-size prices',
          itemLabel: 'Price band',
          summaryTemplate: '{min}–{max} persons · {total}',
          inlineFields: true,
          shared: true,
          section: 'Party size',
          showIf: [TRANSPORT_ONLY, PERSONS_ON, MODE_TIERED],
          description:
            'One row per party-size range, e.g. 5 to 10 persons for 1000. The amount is the TOTAL for ' +
            'the whole party — it is not multiplied, and no extra-person charge is added on top. ' +
            'Ranges must not overlap, and together they must cover the minimum to the maximum. ' +
            'The base price is not used in this mode.',
        },
      ),

      // ── Nightly rates (stay) ───────────────────────────────────────────
      f.number('nightlyRate', {
        label: 'Rate per night',
        min: 0,
        shared: true,
        section: 'Nightly rates',
        showIf: STAY_ONLY,
        description:
          'Major units, e.g. 180.00. Leave empty to show "price on request". A chosen option replaces this rate.',
      }),
      f.repeater(
        'seasonalRates',
        [
          f.text('id', { hidden: true }),
          f.monthDay('from', { label: 'From', required: true, description: 'First night of the season (month and day, every year).' }),
          f.monthDay('to', { label: 'To', required: true, description: 'Last night of the season, included.' }),
          f.number('rate', {
            label: 'Rate per night',
            required: true,
            min: 0,
            description: 'Charged for each night that falls in this season, instead of the rate per night.',
          }),
          f.number('minNights', {
            label: 'Minimum nights in this season',
            min: 1,
            integer: true,
            description: 'Optional — e.g. 7 nights in August. Overrides the general minimum.',
          }),
        ],
        {
          label: 'Seasonal rates',
          itemLabel: 'Season',
          summaryTemplate: '{from} – {to}',
          autoId: true,
          noOverlap: { from: 'from', to: 'to' },
          shared: true,
          section: 'Nightly rates',
          showIf: STAY_ONLY,
          description:
            'Each night is priced by the season it falls in, so a stay crossing a boundary is billed correctly. ' +
            'Ranges may not overlap; a range that wraps the new year (Nov → Feb) is fine.',
        },
      ),

      // ── Nights & arrival (stay) ────────────────────────────────────────
      f.number('minNights', {
        label: 'Minimum nights',
        min: 1,
        integer: true,
        default: 1,
        shared: true,
        section: 'Nights & arrival',
        showIf: STAY_ONLY,
        description: 'The shortest stay that can be booked. A season can set its own minimum.',
      }),
      f.number('maxNights', {
        label: 'Maximum nights',
        min: 1,
        integer: true,
        shared: true,
        section: 'Nights & arrival',
        showIf: STAY_ONLY,
        description: 'Leave empty for no limit.',
      }),
      f.select('checkInDays', {
        label: 'Check-in days',
        multiple: true,
        shared: true,
        section: 'Nights & arrival',
        showIf: STAY_ONLY,
        options: WEEKDAY_OPTIONS,
        description: 'Leave all unchecked to allow arrival on any day. Check only Saturday for a Sat-to-Sat villa.',
      }),
      f.select('checkOutDays', {
        label: 'Check-out days',
        multiple: true,
        shared: true,
        section: 'Nights & arrival',
        showIf: STAY_ONLY,
        options: WEEKDAY_OPTIONS,
        description: 'Leave all unchecked to allow departure on any day.',
      }),

      // ── Occupancy (stay) ───────────────────────────────────────────────
      f.number('baseOccupancy', {
        label: 'Guests included in the rate',
        min: 1,
        integer: true,
        default: 2,
        shared: true,
        section: 'Occupancy',
        showIf: STAY_ONLY,
        description: 'How many guests the nightly rate covers. Each guest above this pays the extra-guest charge.',
      }),
      f.number('maxOccupancy', {
        label: 'Maximum guests',
        min: 1,
        integer: true,
        shared: true,
        section: 'Occupancy',
        showIf: STAY_ONLY,
        description: 'Leave empty to use the option’s "sleeps" figure, or to allow any number.',
      }),
      f.number('extraGuestPerNight', {
        label: 'Charge per extra guest, per night',
        min: 0,
        shared: true,
        section: 'Occupancy',
        showIf: STAY_ONLY,
        description: 'Charged for each guest above the included count, for every night.',
      }),
      f.boolean('childrenEnabled', {
        label: 'Accept children at a different rate',
        shared: true,
        section: 'Occupancy',
        showIf: STAY_ONLY,
        description: 'Adds a children count to the booking form, charged at the child rate below. Off: every guest counts as an adult.',
      }),
      f.number('childMaxAge', {
        label: 'A child is under',
        min: 1,
        max: 21,
        integer: true,
        default: 12,
        shared: true,
        section: 'Occupancy',
        showIf: STAY_ONLY,
        description: 'Shown to the guest on the booking form.',
      }),
      f.number('childPerNight', {
        label: 'Charge per child, per night',
        min: 0,
        shared: true,
        section: 'Occupancy',
        showIf: STAY_ONLY,
        description: 'Children count towards the maximum guests but not towards the included guests.',
      }),

      // ── Fees & taxes (stay) ────────────────────────────────────────────
      f.repeater(
        'fees',
        [
          f.text('id', { hidden: true }),
          f.text('label', {
            label: 'Name',
            required: true,
            localized: true,
            maxLength: 191,
            description: 'The line the guest sees on the price breakdown, e.g. Cleaning fee.',
          }),
          f.number('amount', {
            label: 'Amount',
            required: true,
            min: 0,
            description: 'Major units, multiplied as set in “Charged”.',
          }),
          f.select('basis', {
            label: 'Charged',
            required: true,
            default: 'per_stay',
            description: 'What the amount is multiplied by: nothing, the nights, the guests, or both.',
            options: [
              { value: 'per_stay', label: 'Once per booking' },
              { value: 'per_night', label: 'Per night' },
              { value: 'per_person', label: 'Per guest, once' },
              { value: 'per_person_per_night', label: 'Per guest, per night' },
            ],
          }),
        ],
        {
          label: 'Fees & taxes',
          itemLabel: 'Fee',
          autoId: true,
          shared: true,
          section: 'Fees & taxes',
          showIf: STAY_ONLY,
          description:
            'Cleaning fees, tourist tax and the like. Each becomes its own line on the price breakdown, ' +
            'so the guest can see what they are paying for.',
        },
      ),

      // ── Availability ───────────────────────────────────────────────────
      f.monthDay('availableFrom', {
        label: 'Season opens',
        shared: true,
        section: 'Availability',
        description: 'First bookable date each year. Leave both open and close empty to sell all year.',
      }),
      f.monthDay('availableTo', {
        label: 'Season closes',
        shared: true,
        section: 'Availability',
        description: 'A close date before the open date means the season wraps the new year.',
      }),
      f.select('allocationMode', {
        label: 'How a date is used up',
        shared: true,
        section: 'Availability',
        showIf: TRANSPORT_ONLY,
        default: 'shared',
        options: [
          { value: 'shared', label: 'Shared — several bookings share the day, up to the capacity' },
          { value: 'exclusive', label: 'Exclusive — one booking takes the whole day' },
          { value: 'resource', label: 'Per option — the chosen option is what gets used up' },
        ],
        description: 'A stay always allocates per option (or per experience when it has none).',
      }),
      f.number('capacityPerDay', {
        label: 'Places per day',
        min: 1,
        integer: true,
        shared: true,
        section: 'Availability',
        description:
          'Transport: total persons bookable on one date. Stay with no options: how many bookings the property ' +
          'takes per night (usually 1). Leave empty to use the site default.',
      }),
      f.number('leadTimeHours', {
        label: 'Cut-off (hours before)',
        min: 0,
        integer: true,
        shared: true,
        section: 'Availability',
        description: 'How close to the start a booking can still be made.',
      }),
      f.number('maxAdvanceDays', {
        label: 'Bookable up to (days ahead)',
        min: 0,
        integer: true,
        shared: true,
        section: 'Availability',
        description: 'How far into the future dates can be booked, in calendar days. Empty or 0 means no limit.',
      }),
      f.select('weekdays', {
        label: 'Available weekdays',
        multiple: true,
        shared: true,
        section: 'Availability',
        showIf: TRANSPORT_ONLY,
        options: WEEKDAY_OPTIONS,
        description: 'Leave all unchecked for every day. A stay uses the check-in/check-out days instead.',
      }),
      f.select('bookingMode', {
        label: 'Booking mode',
        shared: true,
        section: 'Availability',
        default: 'inherit',
        options: [
          { value: 'inherit', label: 'Use the site default' },
          { value: 'request', label: 'Request first — you confirm, then the customer pays' },
          { value: 'instant', label: 'Instant — the customer books and pays straight away' },
        ],
        description: 'Whether a booking waits for your confirmation first. “Use the site default” follows Settings → Booking.',
      }),

      // ── Options ────────────────────────────────────────────────────────
      /*
       * A form switch, not a pricing rule.
       *
       * `extrasEnabled` is read by `readExtras` and genuinely turns extras off.
       * This one deliberately is not: `readOptions` feeds `readStoredCapacities`,
       * which the operator-accept path calls for reservations ALREADY taken, so
       * a flag flipped in the admin would change the capacity used to settle a
       * booking made months earlier. It hides the fields; it does not retract
       * what is already sold.
       */
      f.boolean('optionsEnabled', {
        label: 'Offer options',
        shared: true,
        section: 'Options',
        description:
          'Turn on when the customer chooses between vessels, room types or packages. ' +
          'A single villa needs no picker.',
      }),
      f.text('optionsLabel', {
        label: 'Option picker label',
        localized: true,
        maxLength: 191,
        section: 'Options',
        showIf: OPTIONS_ON,
        description: 'What the customer sees above the choice, e.g. "Choose your yacht" or "Choose your villa".',
      }),
      /*
       * The thing the customer actually picks: a specific yacht, a specific
       * villa, or a board package ("breakfast included"). Whatever it is,
       * choosing it REPLACES the base price / nightly rate — it is not added.
       *
       * A row's `id` is its identity everywhere else in the system: the
       * availability ledger keys on `res:<id>`, and `reservations.resource_
       * group_id` stores it. `autoId` mints a uuid, which is unique across
       * every experience and stable across locales because this repeater is
       * `shared`.
       *
       * The trade, stated plainly: options belong to ONE experience. Listing
       * the same yacht under two experiences creates two rows with two ids and
       * therefore two calendars, and it can be booked on both for the same
       * date. That is the deliberate cost of not maintaining a shared pool.
       */
      f.repeater(
        'options',
        [
          f.text('id', { hidden: true }),
          f.text('name', {
            label: 'Name',
            required: true,
            maxLength: 191,
            localized: true,
            description: 'What the customer picks, e.g. the yacht’s or the villa’s name.',
          }),
          f.textarea('summary', {
            label: 'Short description',
            localized: true,
            rows: 2,
            description: 'A line or two under the name in the picker.',
          }),
          f.image('image', { label: 'Photo', description: 'Shown beside this option in the picker.' }),
          f.number('cost', {
            label: 'Price',
            min: 0,
            required: true,
            description:
              'Replaces the base price (transport) or the rate per night (stay) when this option is chosen — it is not added to it.',
          }),
          f.number('capacityPerDay', {
            label: 'Bookings per day',
            min: 1,
            integer: true,
            default: 1,
            description:
              'How many separate bookings this option can take on one date. 1 means booking it closes the date.',
          }),
          f.number('seats', {
            label: 'Sleeps / seats',
            min: 1,
            integer: true,
            description: 'The most people it holds. Used as the guest limit for a stay when no maximum is set.',
          }),
          f.repeater(
            'seasonal',
            [
              f.text('id', { hidden: true }),
              f.monthDay('from', { label: 'From', required: true, description: 'First day of the season (month and day, every year).' }),
              f.monthDay('to', { label: 'To', required: true, description: 'Last day of the season, included.' }),
              f.number('cost', {
                label: 'Cost',
                min: 0,
                description: 'Replaces this option’s price on these dates.',
              }),
              f.boolean('perPerson', {
                label: 'Price by party size',
                description: 'Transport only. Use the brackets below instead of the single cost.',
              }),
              f.repeater(
                'brackets',
                [
                  f.number('min', {
                    label: 'From persons',
                    required: true,
                    integer: true,
                    boundsFrom: { min: 'minPersons', max: 'maxPersons' },
                    description: 'Smallest party this bracket covers.',
                  }),
                  f.number('max', {
                    label: 'To persons',
                    required: true,
                    integer: true,
                    boundsFrom: { min: 'minPersons', max: 'maxPersons' },
                    description: 'Largest party this bracket covers, included.',
                  }),
                  f.number('cost', {
                    label: 'Total for this party size',
                    required: true,
                    min: 0,
                    description: 'The price for the whole party, not per person.',
                  }),
                ],
                {
                  label: 'Group brackets',
                  itemLabel: 'Bracket',
                  summaryTemplate: '{min}–{max} persons · {cost}',
                  inlineFields: true,
                  // Row-scoped: a `showIf` inside a repeater reads the row it
                  // belongs to, so this follows the season's own toggle.
                  showIf: { field: 'perPerson', equals: 'true' },
                  description:
                    'A matching bracket is the TOTAL: no multiplication and no extra-person charge on top. Brackets must not overlap and must cover the whole party range.',
                },
              ),
            ],
            {
              label: 'Seasonal costs',
              itemLabel: 'Season',
              summaryTemplate: '{from} – {to}',
              autoId: true,
              noOverlap: { from: 'from', to: 'to' },
              description: 'Different prices for this option at different times of year. Ranges may not overlap.',
            },
          ),
        ],
        {
          label: 'Options',
          itemLabel: 'Option',
          autoId: true,
          shared: true,
          section: 'Options',
          showIf: OPTIONS_ON,
          description: 'One row per thing the customer can choose. Picking one REPLACES the base rate.',
        },
      ),

      // ── Extras ─────────────────────────────────────────────────────────
      f.boolean('extrasEnabled', {
        label: 'Offer extras',
        shared: true,
        section: 'Extras',
        description: 'Turn on to offer paid add-ons on the booking form, e.g. lunch or a transfer.',
      }),
      f.text('extrasTitle', {
        label: 'Extras section title',
        localized: true,
        maxLength: 191,
        section: 'Extras',
        showIf: EXTRAS_ON,
        description: 'Heading above the extras on the booking form.',
      }),
      f.boolean('extrasMultiplyPerPerson', {
        label: 'Multiply extras by party size',
        shared: true,
        section: 'Extras',
        showIf: EXTRAS_ON,
        description: 'Charge each chosen extra once per person (or guest) rather than once per booking.',
      }),
      f.boolean('extrasPerNight', {
        label: 'Multiply extras by nights',
        shared: true,
        section: 'Extras',
        // Both must hold: it is meaningless on transport, which has no nights,
        // and meaningless when nothing is being sold as an extra.
        showIf: [STAY_ONLY, EXTRAS_ON],
        description: 'Charge each chosen extra once per night rather than once per booking.',
      }),
      f.boolean('extrasMandatory', {
        label: 'At least one extra is required',
        shared: true,
        section: 'Extras',
        showIf: EXTRAS_ON,
        description: 'The booking cannot be completed until the customer picks an extra.',
      }),
      f.repeater(
        'extrasOptions',
        [
          f.text('id', { hidden: true }),
          f.text('name', {
            label: 'Name',
            required: true,
            localized: true,
            description: 'The add-on as the customer sees it, e.g. Lunch on board.',
          }),
          f.number('price', {
            label: 'Price',
            required: true,
            min: 0,
            description: 'Added to the total when chosen. Major units, e.g. 25.00.',
          }),
        ],
        {
          label: 'Extras',
          itemLabel: 'Extra',
          autoId: true,
          shared: true,
          section: 'Extras',
          showIf: EXTRAS_ON,
          description: 'The add-ons a customer can tick on the booking form.',
        },
      ),

      // ── Content — the listing's own words and pictures ─────────────────
      // Below the commercial setup on purpose: an operator makes an experience
      // sellable first and dresses it afterwards, often in a later sitting.
      f.repeater(
        'gallery',
        [
          f.image('image', { label: 'Image', description: 'A photo of the experience. The first is the main one on cards.' }),
          f.text('alt', {
            label: 'Alt text',
            description: 'Describes the image for screen readers and search engines.',
          }),
        ],
        {
          label: 'Gallery',
          itemLabel: 'Image',
          shared: true,
          section: 'Content',
          description: 'Photos in display order. The same images are used in every language.',
        },
      ),

      // ── Quick info — the only expression of "duration" ─────────────────
      f.repeater(
        'quickInfo',
        [
          f.text('id', { hidden: true }),
          f.text('icon', { label: 'Icon', description: 'A lucide icon name, e.g. clock, users, map-pin.' }),
          f.text('label', { label: 'Label', required: true, localized: true, description: 'What the item is, e.g. Duration.' }),
          f.text('value', { label: 'Value', required: true, description: 'The figure, e.g. 4.' }),
          f.text('suffix', { label: 'Suffix', localized: true, description: 'e.g. hours, people, nautical miles.' }),
        ],
        {
          label: 'Quick info',
          itemLabel: 'Item',
          autoId: true,
          shared: true,
          section: 'Content',
          description: 'The icon row on the card and detail page. Duration lives here.',
        },
      ),

      // ── FAQ (ported from the ACF `faq` repeater) ───────────────────────
      f.repeater(
        'faq',
        [
          f.text('id', { hidden: true }),
          f.text('question', { label: 'Question', required: true, localized: true, description: 'Asked as a customer would ask it.' }),
          f.richText('answer', { label: 'Answer', localized: true, description: 'Shown when the question is opened.' }),
        ],
        {
          label: 'FAQ',
          itemLabel: 'Question',
          autoId: true,
          section: 'Content',
          description: 'Shown on the detail page, and eligible for FAQ structured data.',
        },
      ),

      // ── Booking form questions ─────────────────────────────────────────
      f.repeater(
        'choices',
        [
          f.text('id', { hidden: true }),
          f.text('title', {
            label: 'Question',
            required: true,
            localized: true,
            description: 'The dropdown’s label on the booking form.',
          }),
          f.repeater(
            'options',
            [f.text('value', { label: 'Option', required: true, description: 'One answer the customer can pick.' })],
            {
              label: 'Options',
              itemLabel: 'Option',
              min: 1,
              description: 'The answers in the dropdown. The chosen one is saved on the reservation.',
            },
          ),
        ],
        {
          label: 'Booking form questions',
          itemLabel: 'Question',
          autoId: true,
          shared: true,
          section: 'Booking form',
          description: 'Extra required dropdowns on the booking form, e.g. "Choose a departure time".',
        },
      ),
      f.richText('formNote', {
        label: 'Note on the booking form',
        section: 'Booking form',
        description: 'Shown under the booking form on the experience page — what to bring, house rules, and so on.',
      }),

      // ── Cancellation & deposit ─────────────────────────────────────────
      // Both kinds: a charter is cancelled as often as a villa is.
      f.number('depositPercent', {
        label: 'Deposit %',
        min: 0,
        max: 100,
        integer: true,
        shared: true,
        section: 'Cancellation & deposit',
        description:
          'Overrides the site-wide deposit (Settings → Booking → Deposit) for this experience. Leave empty or 0 to use the site default; 100 asks for the full amount up front.',
      }),
      f.number('freeCancellationDays', {
        label: 'Free cancellation up to (days before)',
        min: 0,
        integer: true,
        shared: true,
        section: 'Cancellation & deposit',
        description:
          'Shown on the experience page and in the confirmation email as "Free cancellation up to N days before". For information only — refunds are not enforced automatically. Leave empty if cancellations are never free.',
      }),
      f.richText('cancellationPolicy', {
        label: 'Cancellation policy',
        section: 'Cancellation & deposit',
        description: 'Shown on the experience page and included in the confirmation email and the payment receipt.',
      }),

      ...(opts.extraFields ?? []),
    ],
  });
}
