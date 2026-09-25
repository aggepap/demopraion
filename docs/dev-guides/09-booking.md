# 09 · Booking: availability, reservations & payments

This guide covers the booking module (`src/cms/modules/booking`): the bookable
"experience" collection and its two kinds, `transport` (a calendar day: boat
charters, tours, transfers) and `stay` (a range of nights: rooms, villas); the
two price engines; the availability rules and the capacity ledger that prevents
double-booking; the reservation lifecycle; how booking uses the shared payment
providers (payment links, deposits, surcharges, refunds, webhook settlement);
customer and operator emails; the expiry sweep; the admin screens (Reservations,
Availability); and the public pages under `src/app/[locale]/booking/**`. The
provider implementations (Stripe, PayPal, Viva), webhook verification and the
generic payment contract are covered in 08. The generic collection/field system
is in 03.

Related guides: [01-architecture.md](01-architecture.md) ·
[02-database.md](02-database.md) · [03-content-model.md](03-content-model.md) ·
[04-admin-ui.md](04-admin-ui.md) · [05-auth-users-security.md](05-auth-users-security.md) ·
[06-media-seo-structured-data.md](06-media-seo-structured-data.md) ·
[07-forms-email-marketing.md](07-forms-email-marketing.md) · [08-commerce.md](08-commerce.md) ·
[10-settings-cron-operations.md](10-settings-cron-operations.md)

> `docs/BOOKING.md` is a design specification written alongside the module. It
> still describes the intent well, but where it and this guide disagree, the code
> (and this guide) wins.

---

## 1. File map

### Module core — `src/cms/modules/booking/`

Import from `@/cms/modules/booking` (`index.ts`) only; the individual files are
internal. A few pure files are also imported directly by client code (noted
below), because they must not pull in `server-only`.

| File | Pure? | Responsibility |
|---|---|---|
| `index.ts` | – | Public surface (re-exports). |
| `collection.ts` | yes | `bookingCollection()` (the `booking` document type, all fields for both kinds) and `bookingTermCollection()` (category / vessel type / departure location taxonomies). Constants `BOOKING_KIND_VALUES`, `ALLOCATION_MODE_VALUES`, `BOOKING_MODE_VALUES`, `FEE_BASIS_VALUES`, `DEFAULT_BOOKING_TYPE = 'booking'`. |
| `fields.ts` | server | `bookingFieldResolver` / `resolveKindField`: narrows or hides the `kind` selector per request based on `booking.kinds`. |
| `data.ts` | yes | Reads `documents.data`: `readBookingKind`, `readItemCapacity`, `readOptions`, `toResourcePricing`, `lowestPrice`, `toSummary`, listing filter/sort (`applyBookingQuery`, `countTermUsage`). |
| `read.ts` | server | I/O half of reading: `getBooking`, `listBookings`, `listBookingTermDocs`, `getBookingCurrency`, `resolveBookingPricing` (document + both price configs + options), `readStoredCapacities`. Re-exports `data.ts`. |
| `pricing.ts` | yes | Transport price engine: `readPricingConfig`, `validatePricingConfig`, `quoteBooking`, season maths (`inSeason`, `findSeason`, `seasonsOverlap`, `seasonSegments`), `toMinor`, `surchargeAmount`. |
| `stay.ts` | yes | Stay price engine: `readStayConfig`, `validateStayConfig`, `quoteStay`, `minNightsFor`, `maxOccupancyFor`. |
| `quote-selection.ts` | yes | `quoteForSelection`: the single dispatch from a selection to the right engine; `overrideDatesFor`. |
| `quote.ts` | server | `priceSelection` (loads calendar price overrides then calls `quoteForSelection`), `quoteBySlug`, and the routes for quote, availability and validate-pricing. |
| `availability.ts` | yes | Calendar rules and slot maths: `dayStatus`, `stayStatus`, `slotRequestsFor`, `staySlotRequestsFor`, `slotClaimFor`, `slotDatePairs`, `resolveCapacity`, `readDayRules`, `readStayRules`, `todayInTimeZone`, `cutoffFor`, `stayNights`. |
| `allocation.ts` | server | The ledger: `allocateSlots` (row-lock + aggregate + insert holds), `confirmHolds`, `releaseHolds`, `getDayStates`, `expireStaleReservations`, `findOverbookedSlots`. |
| `lifecycle.ts` | yes | Status machine: `RESERVATION_TRANSITIONS`, `canTransition`, `holdStateFor`, `initialStatus`, `operatorPaymentDeadline`, `paymentDeadlineForMove`, `holdsKeepDeadline`, `emailForTransition`, `emailForNewReservation`, `RESERVATION_STATUS_LABELS`. |
| `reservations.ts` | server | `createReservation`, `listReservations`, `getReservation` (+ price drift), `competingReservations`, `lookupReservation`, `updateReservationStatus`, and the request/lookup/list/get/update routes. |
| `payments.ts` | server | Payment links (`issuePaymentLink`, `requestPayment`, `redeemPaymentToken`), settlement (`settlementFor`, `recordBookingPayment`, `captureReservationPaymentByRef`), refunds (`refundReservationPayment`), deposit (`resolveDepositAmount`, `amountDueFor`), and the pay / payment-link / payments / refund / expire routes. |
| `payment-actions.ts` | yes | Rules shared by the admin drawer and the API: `paymentLinkRefusal`, `canResendPaymentLink`, `paymentLinkAmount`, `recordPaymentRefusal`, `manualPaymentRefusal`, `refundableAmount`, `refundRefusal`, `parseMoneyInput`. Imported by `src/cms/admin/ReservationPayments.tsx`. |
| `emails.ts` | server | `sendReservationEmails`, `sendStatusEmail`, `sendPaymentLinkEmail`, `customerEmailBody` (pure). All sends are recorded in `reservation_events`. |
| `cancellation.ts` | yes | `readCancellationTerms`, `cancellationEmailHtml`, `richTextToEmailHtml`. Informational only; nothing enforces refunds. |
| `reference.ts` | yes | `formatBookingReference` (`BKG-<year>-<8 Crockford base32>`), `paymentToken`, `hashToken`, `tokenMatches` (constant time), `isTokenLive`. |
| `schedule.ts` | server | Availability calendar backend: `listSchedulableSlots`, `getSchedule`, `setSlotOverride`, `scheduleReadRoute`, `scheduleWriteRoute`. |
| `settings-read.ts` | server | One reader per `booking.*` setting, plus `BOOKING_SETTING_READERS` (asserted against the settings registry in tests). |
| `reservation-filters.ts` | yes | URL <-> filter mapping for the Reservations screen (`parseReservationFilters`, `reservationFiltersQuery`, `toListOptions`, `RESERVATIONS_PAGE_SIZE = 25`). |
| `legacy-facets.ts` | yes | Only for the `db:migrate-booking-facets` migration (old row-based vessel types / departures). Deletable once no DB holds the old shape. |

### Schema and migrations

| Path | Contents |
|---|---|
| `src/cms/db/adapters/mysql/schema/booking.ts` | Drizzle tables `reservations`, `reservation_items`, `booking_slots`, `reservation_holds`, `reservation_payments`, `reservation_events` and the enum value lists. |
| `src/cms/db/adapters/mysql/migrations/0008_low_nebula.sql` | Creates all six tables. |
| `.../0009_free_gideon.sql` | `uniq_reservation_payments_provider_ref`. |
| `.../0010_thick_warstar.sql` | Stay columns: `end_date`, `nights`, `adults`, `children`. |
| `.../0013_next_cerebro.sql` | `payment_started_at`. |
| `src/cms/db/seeds/cli/migrate-booking-options.ts`, `migrate-booking-facets.ts` | One-off data migrations (`npm run db:migrate-booking-options`, `db:migrate-booking-facets`). |

### HTTP glue — `src/app/api/cms/`

`booking/{availability,quote,request,lookup,pay,schedule}/route.ts`,
`bookings/validate-pricing/route.ts`,
`reservations/route.ts`, `reservations/[id]/route.ts`,
`reservations/[id]/{payment-link,payments,refund}/route.ts`,
`reservations/expire/route.ts`. Each is a thin wrapper that 404s when the module
is off (`isModuleEnabled(config, 'booking')`) and delegates to a route factory
from the module.

### Admin

| Path | Contents |
|---|---|
| `src/app/admin/(shell)/reservations/page.tsx` | Server page: parses filters from the URL, lists reservations, renders `ReservationsTable`. Requires `reservationsRead`. |
| `src/app/admin/(shell)/availability/page.tsx` | Server page rendering `AvailabilityCalendar`. Requires `scheduleRead`. |
| `src/cms/admin/ReservationsTable.tsx` | Filter bar, pager, table, reservation drawer (actions, price + drift, competing enquiries, history). |
| `src/cms/admin/ReservationPayments.tsx` | Drawer money section: resend link, record payment, refund. |
| `src/cms/admin/AvailabilityCalendar.tsx` | Month grid per slot, per-date override editor, overbooking banner. |
| `src/cms/admin/advisories.ts` | `'booking-pricing'` advisory: runs `validatePricingConfig` / `validateStayConfig` in the browser while editing an experience. |
| `src/cms/admin/api-client.ts` | `sendReservationPaymentLink`, `recordReservationPayment`, `refundReservationPayment`. |

### Public site

| Path | Contents |
|---|---|
| `src/app/[locale]/booking/page.tsx` + `booking-params.ts` | Listing with search, sort, facet filters (`?category=`, `?type=`, `?departure=`, `?q=`, `?sort=`, `?page=`), page size 15. |
| `src/app/[locale]/booking/[slug]/page.tsx` | Experience detail: gallery, quick info, FAQ, cancellation terms, JSON-LD, `BookingForm`. |
| `src/app/[locale]/booking/lookup/{page.tsx,BookingLookupClient.tsx}` | Guest lookup by reference + email. |
| `src/app/[locale]/booking/pay/[reference]/page.tsx` | Payment page opened from the emailed link (`?t=<token>`), `noindex`. |
| `src/components/booking/*` | `BookingForm`, `TransportFields`, `StayFields`, `BookingCalendar`, `use-availability.ts`, `BookingPayClient`, `BookingCard`, `BookingFilters`, `BookingToolbar`, `CancellationTerms`, `QuickInfoList`. |

### Registration

`src/site.config.ts` registers the collections (`bookingTermCollection` x3 with
keys `booking_category`, `vessel_type`, `departure_location`, then
`bookingCollection()`) and `fieldResolvers: { booking: bookingFieldResolver }`.
The module toggle is `modules.booking` (Settings -> Modules).

---

## 2. Data model

### 2.1 Bookable items are documents

An experience is a row in `documents` with `type = 'booking'`. All pricing,
availability and option data lives in `documents.data` (JSON), authored in
**major units** (e.g. `450.00`). Structural fields are `shared: true` so they are
identical across the locale rows of one translation group. Reservations refer to
the item by `booking_id` (per-locale document id, `ON DELETE SET NULL`) **and**
`booking_group_id` (the translation group id, or `doc:<id>` if none), which is the
stable key capacity and reporting use.

Key `data` fields (defined in `collection.ts`):

| Field | Kind | Used by |
|---|---|---|
| `kind` | both | `'transport'` (default) or `'stay'`; `readBookingKind` treats any unknown value as `transport`. |
| `basePrice`, `seasonalPrices[] {id,from,to,price}` | transport | Unit price; seasons are `mm-dd` windows that may wrap the year end. |
| `hasPersons`, `minPersons`, `maxPersons`, `pricingMode` (`multiply` / `group_threshold` / `tiered`), `includedPersons`, `extraPerPerson`, `tiers[] {min,max,total}` | transport | Party-size pricing. |
| `nightlyRate`, `seasonalRates[] {id,from,to,rate,minNights}`, `minNights`, `maxNights`, `checkInDays[]`, `checkOutDays[]` | stay | Nightly pricing and range rules. |
| `baseOccupancy`, `maxOccupancy`, `extraGuestPerNight`, `childrenEnabled`, `childMaxAge`, `childPerNight`, `fees[] {id,label,amount,basis}` | stay | Occupancy and fees. `basis` in `FEE_BASIS_VALUES`. |
| `availableFrom`, `availableTo` (`mm-dd`), `leadTimeHours`, `maxAdvanceDays`, `capacityPerDay` | both | Calendar rules and default capacity. |
| `weekdays[]`, `allocationMode` | transport | Weekday filter; `shared` / `exclusive` / `resource`. |
| `bookingMode` | both | `inherit` / `request` / `instant`. |
| `optionsEnabled`, `optionsLabel`, `options[] {id,name,summary,image,cost,capacityPerDay,seats,seasonal[] {from,to,cost,perPerson,brackets[] {min,max,cost}}}` | both | Options (vessels, rooms, packages). The row's auto-id is the stable option id. |
| `extrasEnabled`, `extrasTitle`, `extrasMultiplyPerPerson`, `extrasPerNight` (stay), `extrasMandatory`, `extrasOptions[] {id,name,price}` | both | Add-ons. Kept as top-level keys so `shared` propagation works. |
| `choices[] {id,title,options[] {value}}` | both | Extra required dropdowns on the form; answers stored in `reservations.selections`. |
| `depositPercent`, `freeCancellationDays`, `cancellationPolicy` | both | Deposit override; informational cancellation terms. |
| `categories`, `types`, `departures` | – | Relations to the three term collections (`types`/`departures` shown for transport only). |

Options are stored **on** the experience, not as shared resources. The consequence
(stated in `data.ts`): two experiences that list the same physical yacht have two
option ids and two calendars, so that yacht can be double-booked across them.

### 2.2 Tables (`schema/booking.ts`)

Money columns are integer **minor units** (cents). Dates are MySQL `DATE`
(string mode, `YYYY-MM-DD`), never timestamps.

#### `reservations`

| Column | Notes |
|---|---|
| `id`, `reference` (unique, `BKG-2026-XXXXXXXX`) | Reference is random, not sequential. |
| `status` | `pending`, `awaiting_payment`, `confirmed`, `paid`, `cancelled`, `expired`. |
| `mode` | `request` / `instant`, resolved at submit and frozen. |
| `allocation_mode` | `shared` / `exclusive` / `resource` (always `resource` for a stay). |
| `booking_id` (FK documents, set null), `booking_group_id`, `booking_slug`, `booking_title` | Item snapshot. |
| `resource_id` | Legacy; always written `null` now (options are rows, not documents). |
| `resource_group_id` | Option id, or `''` (never NULL: it participates in slot keys and unique indexes). |
| `resource_label` | Option name at booking time. |
| `slot_date` | Transport: the day. Stay: **check-in**. |
| `end_date`, `nights` | Stay: check-out and night count. Transport: `NULL` and `0` — `nights > 0` is how stored rows are told apart. |
| `slot_label` | First form answer, truncated to 64 chars, for the admin list. |
| `persons`, `adults`, `children` | Stay: `persons = adults + children`. |
| `email` (lower-cased), `customer_name`, `phone`, `locale`, `notes`, `admin_notes` | `admin_notes` is not written anywhere in the module today. |
| `currency`, `subtotal`, `total`, `deposit_amount`, `amount_paid` | `total` = sum of `reservation_items.amount`. `deposit_amount` is written when a payment link is issued (it holds the link's target amount). |
| `pricing_snapshot` JSON | The **inputs**: `{ config, selection }` (selection minus customer). Items are the outputs; never store both. |
| `selections` JSON | `choices` answers. |
| `payment_token_hash`, `payment_token_expires_at`, `payment_link_sent_at` | SHA-256 of the link token; plaintext only exists in the email. Nulled on settlement, rotated on reissue. |
| `payment_started_at` | Claim that makes starting a payment exclusive (see 4.8). |
| `expires_at` | Deadline for `pending` (request lapse) or `awaiting_payment` (payment deadline). |
| `email_status`, `email_error` | Mirror of the latest customer email outcome. |
| `version` | Optimistic lock for status changes. |

Indexes: `(status, slot_date)`, `(booking_group_id, slot_date)`,
`(resource_group_id, slot_date)`, `email`, `(status, expires_at)` (the sweep),
`created_at`.

#### `reservation_items`

The priced breakdown and the only copy of it: `kind` (`base`, `person`,
`resource`, `extra`, `surcharge`, `discount`), `code` (stable machine key, e.g.
`season:<id>`, `resource:<id>`, `extra:<id>`, `fee:<id>`, `tier:5-10`,
`date_override`, `nightly`, `extra_guests`, `children`), `label`, `ref_id`,
`quantity`, `unit_amount`, `amount`, `position`. Cascade-deleted with the
reservation.

#### `booking_slots`

One row per `(slot_key, slot_date)` — unique `uniq_booking_slots_key_date`. Three
jobs:

1. Per-date overrides: `capacity` (NULL = inherit), `closed`, `price_override`
   (minor units), `note`.
2. The **mutex row** `allocateSlots` locks with `SELECT ... FOR UPDATE`.
3. `version` bumped on each allocation (belt and braces).

`slot_key` is `exp:<bookingGroupId>` (the experience) or `res:<optionId>` (an
option). Rows are created lazily by allocation or by the Availability screen; an
override that says nothing is deleted, not stored as nulls.

#### `reservation_holds`

The seat ledger. One row per `(reservation, slot_key, slot_date)` (unique
`uniq_reservation_holds_res_slot`), with `seats` and `state` (`held`,
`confirmed`, `released`) and `expires_at` (meaningful only while `held`). Seats
taken on a date are **always derived** by summing these rows under the slot lock;
there is no counter column. A stay writes one row per night; the check-out date
is not held.

#### `reservation_payments`

`provider` (`manual`, `stripe`, `paypal`, `viva`), `provider_ref`, `status`
(`pending`, `authorized`, `captured`, `failed`, `refunded`), `amount` (a refund row
is **negative**), `currency`, `method`, `is_deposit`, `error`, `metadata`
(surcharge, refund claims `refundOf`, PayPal `captureId`, ...). Unique
`(provider, provider_ref)` makes a replayed webhook a duplicate-key error; NULL
refs (manual rows) do not collide.

#### `reservation_events`

Timeline: `kind` (`status.<to>`, `payment.captured`, `payment.refunded`,
`email.<which>`, `email.admin_new_request`), `from_status`, `to_status`,
`actor_user_id` (NULL for system/cron), `recipient`, `email_status`
(`pending`/`sent`/`failed`/`skipped`), `email_error`, `detail`.

Audit log entries (`logAudit`) are written in addition, with actions
`booking.create`, `booking.status`, `booking.payment_link`, `booking.payment`,
`booking.refund`, `booking.schedule.set`, `booking.schedule.clear`.

---

## 3. The two kinds

Both kinds share the document type, options, extras, the ledger, the reservation
tables, the payment flow, emails and admin. They differ in exactly these places:

| Concern | `transport` | `stay` |
|---|---|---|
| Form fields shown | `showIf: { field: 'kind', equals: 'transport' }` | `equals: 'stay'` |
| Price engine | `quoteBooking` (`pricing.ts`) | `quoteStay` (`stay.ts`) |
| Selection | one `date`, `persons` | `date` (check-in) + `endDate` (check-out), `adults`, `children` |
| Calendar rules | `readDayRules` + `dayStatus` (season window, weekdays, lead time, max advance) | `readStayRules` + `stayStatus` (range valid, min/max nights, check-in/check-out weekdays, then `dayStatus` per night with `weekdays` cleared) |
| Slot claim | `slotRequestsFor` by `allocationMode` | `staySlotRequestsFor`: always one seat of one unit per night |
| Dates held | `[date]` | `stayNights(checkIn, checkOut)` = check-in .. night before check-out |
| Stored row | `nights = 0`, `end_date = NULL` | `nights > 0`, `end_date` set |
| Availability screen | experience slot + each option slot | options only, if it has any; otherwise the experience slot |
| Listing "from" price | lowest of `basePrice`, seasonal prices, option costs | lowest of `nightlyRate`, seasonal rates, option costs |

The dispatch points are: `readBookingKind` (`data.ts`), `quoteForSelection`
(`quote-selection.ts`), `createReservation` (`isStay` branches),
`slotClaimFor` (`availability.ts`, by `nights > 0`),
`bookingAvailabilityRoute` and `bookingValidatePricingRoute` (`quote.ts`),
`listSchedulableSlots` (`schedule.ts`), the advisory in `admin/advisories.ts`,
`lowestPrice` (`data.ts`), and the public `BookingForm` (`TransportFields` vs
`StayFields`).

`booking.kinds` (site setting) controls which kinds can be **authored**: the
field resolver hides the `kind` selector if exactly one kind is sold, but keeps
it visible on a document already saved as another kind so it is never stranded.
It does not change how existing experiences are priced.

---

## 4. How it works

### 4.1 Pricing

All prices are computed in minor units per component (`toMinor(unit) * qty`, never
`toMinor(unit * qty)`), so lines always sum to the total. Both engines return the
same `Quote` shape (`lines`, `subtotal`, `total`, `persons`, `unitAmount`,
`applied`), which is what `reservation_items`, emails and the drawer consume.

**Transport — `quoteBooking(cfg, sel)`:**

1. No `basePrice` (and not a tiered-only config) -> `price_on_request`.
2. `validatePricingConfig(cfg)` non-empty -> `invalid_config` (the public quote
   route strips the `issues`; the admin sees them via advisories).
3. `persons = clampPersons(...)` (clamped, not rejected).
4. Unit price precedence: `basePrice` -> first matching season
   (`findSeason`, first match wins; overlaps are refused by validation) ->
   calendar `dateOverrides.base` (ignored in `tiered` mode) -> chosen option:
   option `cost` -> option seasonal rule (`cost`, or a person bracket if
   `perPerson`) -> `dateOverrides.option`. An option **replaces** the base price
   (if its resolved cost > 0), it is not added.
5. Party size: option person-bracket (group total) beats `tiered` beats
   `multiply` / `group_threshold`. `multiply` = unit x persons;
   `group_threshold` = unit + `extraPerPerson` x (persons − `includedPersons`);
   `tiered` = the band's `total`.
6. Extras: `extra_required` if mandatory and none chosen; `unknown_extra` on a bad
   id; each extra x persons if `extrasMultiplyPerPerson`.
7. A total of 0 -> `price_on_request`.

**Stay — `quoteStay(cfg, sel)`:**

1. `missing_dates`, `invalid_range`, then `validateStayConfig`, then
   `min_nights` (via `minNightsFor`: the **arrival** night's season minimum,
   never below the general minimum) and `max_nights`.
2. Option lookup (`unknown_resource`), then occupancy: `adults` clamped 1..99,
   `children` only if `childrenEnabled`; guests above `maxOccupancyFor` (the
   experience's `maxOccupancy`, else the option's `seats`, else unlimited) ->
   `over_occupancy` (refused, not clamped).
3. Per-night rate (`rateForNight`): option calendar override -> option seasonal
   cost -> option cost (if > 0) -> experience calendar override -> seasonal rate
   -> `nightlyRate`. Consecutive nights with the same rate collapse into one line.
4. Extra adults above `baseOccupancy` x `extraGuestPerNight` x nights; children x
   `childPerNight` x nights.
5. Extras: x guests if per-person, x nights if `extrasPerNight`.
6. Fees by `basis`: `per_stay` (1), `per_night`, `per_person`,
   `per_person_per_night`; stored as `kind: 'surcharge'` lines.

**Calendar price overrides.** `booking_slots.price_override` is loaded by
`loadPriceOverrides(resolved, sel)` for the selection's dates only: the `exp:`
slot feeds `base` / `nightly`, the chosen option's `res:` slot feeds `option`.
The same `priceSelection` path is used by the public quote, `createReservation`
and the admin price-drift check, so all three agree.

**Surcharges** (`booking.surchargePercent.{stripe,paypal,viva}`) are *not* part
of the quote. They are added at payment time (`resolvePaymentTerms` in
`payments.ts`), stored in the payment row's `metadata.surcharge`, and excluded
from the credit against the balance.

### 4.2 Availability computation

Rules come from the document (`readDayRules` / `readStayRules`); exceptions come
from `booking_slots`; usage comes from `reservation_holds`.

`dayStatus(day, rules, seats, now, timeZone)` returns the **first** failing check,
in this order:

| Order | Status | Condition |
|---|---|---|
| 1 | `past` | `date < todayInTimeZone(now, booking.timezone)` |
| 2 | `out_of_season` | outside `availableFrom..availableTo` (wrap-aware) |
| 3 | `wrong_weekday` | `weekdays` set and date's weekday not in it (transport only) |
| 4 | `too_far` | `maxAdvanceDays > 0` and further ahead |
| 5 | `too_soon` | `now > cutoffFor(date, leadTimeHours, booking.timezone)` |
| 6 | `closed` | `booking_slots.closed` |
| 7 | `full` | `capacity − held − confirmed < seats` |
| – | `open` | otherwise |

`stayStatus` adds range checks first (`invalid_range`, `min_nights`,
`max_nights`, `bad_checkin_day`, `bad_checkout_day`), then runs `dayStatus` on
each night with `weekdays: null`, and reports the failing night's date.

Capacity per slot/date is `resolveCapacity(defaultCapacity, override)`: the
override's `capacity` if not NULL (may be 0), else the default (min 1). Defaults:
item slot -> `readItemCapacity(data, booking.defaultCapacity)`; option slot ->
the option row's `capacityPerDay` (default 1).

Usage (`getDayStates`, and `readUsage` inside allocation) counts `confirmed`
holds plus `held` holds whose `expires_at` is NULL or in the future. An expired
hold stops counting immediately, before the sweep runs.

**What each reservation claims** (`slotRequestsFor` / `staySlotRequestsFor`):

| Case | Slots and seats |
|---|---|
| transport `shared` | `exp:<group>`: `persons` seats, capacity = item capacity |
| transport `exclusive` | `exp:<group>`: 1 seat, capacity forced to 1 |
| transport `resource` | `exp:<group>`: `persons` seats (item capacity) **and**, if an option is chosen, `res:<option>`: 1 seat (option `capacityPerDay`) |
| stay with option | `res:<option>`: 1 seat per night |
| stay without option | `exp:<group>`: 1 seat per night (item capacity) |

A stay with an option deliberately does **not** also hold the experience slot, so
two rooms of one hotel can be booked for the same night.

**Public endpoint.** `GET /api/cms/booking/availability` computes up to 92 days:
it reads the `res:<resourceId>` slot when `resourceId` is given, else the `exp:`
slot, uses `seats = 1` for a stay and `persons` (default 1) for transport, and
returns `{ days: [{date,status,bookable,remaining}], kind, rules }` where `rules`
carries the person limits and, for stays, min/max nights, check-in/out days,
occupancy and child settings for the date picker. The result is advisory; the
authoritative check is `allocateSlots` under the lock.

### 4.3 Allocation and concurrency (`allocation.ts`)

`allocateSlots(tx, reservationId, slotDates, requests, holdExpiresAt, state)` must
run inside the caller's transaction. For each `(request, date)` pair from
`slotDatePairs` — sorted by `slotKey` then date, a single global lock order that
prevents deadlocks between overlapping stays or item/option pairs:

1. `INSERT ... ON DUPLICATE KEY UPDATE` the `booking_slots` row (race-safe
   materialisation).
2. `SELECT ... FOR UPDATE` that row — concurrent allocators serialise here.
3. Sum held + confirmed seats (`readUsage`, using the app's `now`, not SQL
   `NOW()`).
4. `closed` -> 409 "`<date>` is not available."; not enough seats -> 409
   "`<date>` is no longer available.". The throw rolls back the whole
   transaction, including earlier pairs and the reservation insert.
5. Insert the `reservation_holds` row (`expires_at` only when `held`).
6. Bump `booking_slots.version`.

`confirmHolds` sets all of a reservation's holds to `confirmed` (clears
`expires_at`); `releaseHolds` sets them to `released`. Neither re-checks capacity.

`findOverbookedSlots(from, to)` reports slot/dates whose held+confirmed seats
exceed `booking_slots.capacity`. The Availability screen shows these as a banner.

### 4.4 Reservation lifecycle (`lifecycle.ts`)

```
request mode:              pending ──accept──► awaiting_payment ──paid──► paid
instant + online gateway:                      awaiting_payment ──paid──► paid
instant + manual provider:                     confirmed ──paid──► paid
                                  │ cancel / expire
                                  ▼
                            cancelled · expired   (terminal)
```

Allowed transitions (`RESERVATION_TRANSITIONS`):

| From | To |
|---|---|
| `pending` | `awaiting_payment`, `confirmed`, `cancelled`, `expired` |
| `awaiting_payment` | `paid`, `confirmed`, `cancelled`, `expired` |
| `confirmed` | `awaiting_payment`, `paid`, `cancelled` |
| `paid` | `cancelled` |
| `cancelled`, `expired` | none |

Nothing returns to `pending`. A refund is a payment row, not a status.

What each status means to the ledger (`holdStateFor`):

| Status | Hold state | Consumes capacity |
|---|---|---|
| `pending` | none (an enquiry holds nothing) | no |
| `awaiting_payment` | `held` (with deadline) | yes, until `expires_at` |
| `confirmed`, `paid` | `confirmed` | yes |
| `cancelled`, `expired` | `released` | no |

Entry status (`initialStatus(mode, hasOnlinePayment)`): `request` -> `pending`;
`instant` -> `awaiting_payment` if the configured booking provider is online,
else `confirmed`. `mode` is the item's `bookingMode` unless `inherit`, in which
case `booking.mode`.

**Deadlines (`expires_at`):**

| Situation | Deadline |
|---|---|
| New `pending` | now + `booking.requestExpiryHours` (default 72 h). Lapsing releases nothing. |
| New `awaiting_payment` (instant + gateway) | now + `booking.paymentHoldMinutes` (default 20 min); the link's token expiry is capped to the same instant. |
| Operator move into `awaiting_payment` from `pending` | now + `booking.paymentLinkExpiryDays` (default 7 d) — `operatorPaymentDeadline`. |
| Move into `awaiting_payment` from `confirmed` (collect a balance) | none — `paymentDeadlineForMove` returns null so the sweep never releases a confirmed date. |
| (Re)issuing a link while `awaiting_payment` with non-confirmed holds | reservation and `held` holds get the link's expiry (`holdsKeepDeadline`). |
| Secured by payment | cleared. |

**`updateReservationStatus(id, to, opts)`** (admin PATCH, and internally by
`issuePaymentLink`):

1. Read the row (outside the tx); `canTransition` or 409.
2. In one transaction: `released` -> `releaseHolds`; `confirmed` from a held/confirmed
   state -> `confirmHolds`; a hold state from **no** hold (`pending` ->
   `awaiting_payment` / `confirmed`) -> read capacities from the stored document
   (`readStoredCapacities`, inside the tx), compute the claim with
   `slotClaimFor(row)` and `allocateSlots` — **this is where accepting the second
   of two competing enquiries fails with 409**.
3. Update `status`, `version + 1`, `expires_at` guarded by `version =
   current.version`; zero affected rows -> 409 and the hold work rolls back.
4. Insert `status.<to>` event; audit `booking.status`.
5. Unless `notify: false`: moving to `awaiting_payment` calls `requestPayment`
   (issue link + email with a gateway, or payment instructions for manual);
   anything else calls `sendStatusEmail`.

The drawer's "Mark paid" does not come through here when a balance is due: the
update route sends `status: 'paid'` to `markReservationPaid`, which records the
balance as a `manual` payment (see 4.7) and lets the settlement move the status.

### 4.5 Booking sequence (public)

```
Browser (BookingForm)                         Server
─────────────────────                         ──────
GET  /api/cms/booking/availability  ───────►  rules + day states (advisory)
POST /api/cms/booking/quote         ───────►  resolveBookingPricing → priceSelection
      (on every change)                        (never trusts client prices)
POST /api/cms/booking/request       ───────►  createReservation:
                                               1. acceptTerms required (400)
                                               2. resolveBookingPricing (404)
                                               3. priceSelection → 409 on refusal
                                               4. every `choices` id answered (409)
                                               5. calendar rules: stayStatus /
                                                  dayStatus with capacity "free"
                                               6. mode + initialStatus
                                               7. tx: insert reservation + items;
                                                  allocateSlots if held/confirmed
                                               8. audit booking.create
                                               9. awaiting_payment → issuePaymentLink
                                                  (failure is logged, not thrown)
                                              10. sendReservationEmails
      ◄── 201 { reference, status, total, currency, redirectUrl, expiresAt }
if redirectUrl: navigate to /booking/pay/<ref>?t=<token>
```

The request route has a honeypot (`_hp`): a filled value returns a fake 201 with
reference `BKG-0000-00000000`. Rate limit 5/min.

### 4.6 Operator accept sequence (request mode)

1. Drawer "Accept & send payment link" -> `PATCH /api/cms/reservations/:id
   {status:'awaiting_payment'}` (edit-lock checked via
   `assertNotLockedByOther('reservation', ...)`).
2. `updateReservationStatus` claims the date under the lock (409 if taken).
3. `requestPayment`: with an online provider, `issuePaymentLink` then
   `sendPaymentLinkEmail`; otherwise (or if the link fails)
   `sendStatusEmail(..., 'awaiting_payment')`, which includes
   `booking.paymentInstructions` for manual payment.
4. Customer pays on `/booking/pay/<ref>?t=...`, or the operator records the
   transfer.

Calling `issuePaymentLink` on a `pending` reservation first promotes it via
`updateReservationStatus(..., 'awaiting_payment', { notify: false })`, so a link
can never exist for a date that was not claimed.

### 4.7 Payments (booking-specific integration)

Provider resolution: `getPaymentProvider(await getBookingPaymentProvider())`
from `src/cms/core/payments`. `isOnlineProvider` is simply "key is not
`manual`". Online providers are only in the registry if the route bundle imported
`@/cms/core/payments/register`; the booking request, pay, payment-link, refund
and reservation GET/PATCH routes and the pay page all do.

**Payment link** (`issuePaymentLink`): generates a 32-char token, stores
`hashToken(token)`, `payment_token_expires_at = min(opts.expiresAt, now + linkTtlDays)`,
`payment_link_sent_at`, and `deposit_amount = amount`, where `amount` is
`opts.amount` or `paymentLinkAmount(status, resolveDepositAmount(total, itemPercent))`
(a `confirmed` booking's link asks for the full `total`). Reissuing rotates the
hash, which kills the previous link. URL:
`<siteOrigin><localePrefix>/booking/pay/<reference>?t=<token>`.

**Deposit** (`resolveDepositAmount`): the item's `depositPercent` if > 0, else
`booking.depositPercent`; 0 or >= 100 means full amount; otherwise
`max(1, round(total * bps / 10000))`.

**Amount due** (`amountDueFor`): `max(0, (deposit_amount || total) − amount_paid)`.

**Pay page / pay start** (`bookingPayGetRoute`, `bookingPayStartRoute`):
`redeemPaymentToken` returns null for unknown reference, wrong/expired token or a
`paid`/`cancelled`/`expired` reservation (uniform 404). Start then:
refuses if nothing is due; takes the `payment_started_at` claim with one
conditional UPDATE (`PAYMENT_START_CLAIM_MS = 2 min`) or 409; computes the
surcharge; calls `provider.start({ subject:'reservation', subjectId, reference,
amount: chargeable, currency, email, returnUrl })`; releases the claim on a thrown
or `failed` start; records a `pending` payment row (or `captured` if the provider
says so) and returns `{ redirectUrl, clientSecret, ... }`. The provider always
comes from settings, never from the request body.

**Settlement** (`settlementFor(reservation, credit)`, pure):

| Paid after credit | Target |
|---|---|
| `>= total` | `paid` |
| `>= deposit_amount` (deposit > 0) | `confirmed` |
| otherwise | unchanged, not secured |

If the target is not a legal transition, fall back to `confirmed`; if that is
also illegal (terminal row) the settlement is `refused`: the payment row is kept
but `amount_paid` is not credited and the booking is flagged for action. When
secured, the holds are first re-checked by `confirmHoldsChecked` (a lapsed hold
or a date now over capacity is refused → recorded, flagged, not credited); then
the token and `expires_at` are cleared, holds are confirmed and a
`payment.captured` event is written.

- `recordBookingPayment` (admin "Record payment", and the pay-start recorder)
  reads the reservation `FOR UPDATE` inside the transaction; with
  `enforceBalance` it applies `manualPaymentRefusal` (409 for a dead/settled
  booking, 400 for a bad amount). Emails the status change after commit.
- `captureReservationPaymentByRef` (called from `core/payments/webhooks.ts`
  `applyToReservation`) finds the row by `(provider, provider_ref)` `FOR UPDATE`;
  a repeat of the same status is a no-op; only `captured` touches the
  reservation. The webhook caller sends the status email only if this call moved
  it.

**Refunds** (`refundReservationPayment`): two-phase, like commerce. Inside a
locked tx: the payment must belong to the reservation in the URL (else 404), be
`captured`, and its provider must implement `refund`; `refundRefusal` rejects
amounts above what is left; the claim is written into `metadata` via
`withRefundClaim`. Then the provider is called outside the tx; a thrown call
**keeps** the claim (manual review), a `failed` answer releases it. On success a
negative `refunded` row is inserted, `amount_paid` is reduced and a
`payment.refunded` event is written. The reservation status never changes on
refund; cancel it separately.

### 4.8 Emails (`emails.ts`)

Sent through `sendGraphMail` (see 07). Every send goes through `sendAndRecord`,
which never throws, writes an `email.<which>` event with the outcome and, for
customer mail, mirrors `email_status` / `email_error` onto the reservation.

| Trigger | Customer email (`ReservationEmail`) | Operator |
|---|---|---|
| New `pending` | `request_received` | `admin_new_request` to each `booking.notificationEmails` address (reply-to = customer); a `skipped` event if none configured |
| New `awaiting_payment` | `payment_link` (with URL, or instructions/contact text if the link failed) | same |
| New `confirmed` (instant, manual) | `confirmed` + manual payment instructions if money is owed + cancellation terms | same |
| -> `awaiting_payment` | `payment_link` (via `requestPayment`) | – |
| -> `confirmed` | `confirmed` + cancellation terms | – |
| -> `paid` | `receipt` + cancellation terms | – |
| -> `cancelled` | `cancelled` | – |
| -> `expired` (sweep or admin) | `expired` (different wording if it was `awaiting_payment`) | – |
| Link reissued | `payment_link` via `sendPaymentLinkEmail` | – |

Copy is hard-coded Greek/English in `customerEmailBody` and `LABELS` (any other
locale gets English). The summary block shows reference, `slot_date`, persons,
option and the item breakdown.

### 4.9 Expiry sweep (cron)

`expireStaleReservations(now)` selects `pending` and `awaiting_payment` rows with
`expires_at <= now`, and for each one, in its own transaction, moves it to
`expired` guarded by the status it was read with (a concurrent payment/accept
wins), releases holds, writes `status.expired`; after commit it sends the
`expired` email (errors are logged per row so one failure does not stop the
sweep).

The sweep is the `booking-expire` job of the unified cron map
(`src/app/api/cms/cron/[job]/route.ts`), authorised by `x-cron-secret` matching
`CMS_CRON_SECRET`; like every job there it answers 404 while the booking module
is off. Schedule it e.g. every 5 minutes:

```bash
curl -fsS -X POST -H "x-cron-secret: $CMS_CRON_SECRET" https://example.com/api/cms/cron/booking-expire
```

The older endpoint `POST /api/cms/reservations/expire` still runs the same
sweep, authorised by `x-cron-secret` matching `BOOKING_CRON_SECRET`
(`authorizeCronRequest`: at least 32 characters, constant-time compare), or else
an admin session with `reservationsWrite`:

```bash
curl -fsS -X POST -H "x-cron-secret: $BOOKING_CRON_SECRET" https://example.com/api/cms/reservations/expire
# → { "ok": true, "data": { "expired": 3 } }
```

Held seats stop counting at their `expires_at` whether or not the sweep has run;
the sweep is what changes the status, releases the rows and tells the customer.

### 4.10 Price drift and competing enquiries

`getReservation` returns `drift = { quoted, current, changed }` by re-pricing
`pricing_snapshot.selection` with today's rules (`priceSelection`), or null if it
cannot. `competingReservations(id)` lists other `pending`/`awaiting_payment`/
`confirmed` reservations for the same `booking_group_id` and the same
`slot_date`.

---

## 5. HTTP API

All routes return 404 when `modules.booking` is off. Money is minor units unless
noted.

### Public

| Method | Path | Auth | Rate limit | Purpose |
|---|---|---|---|---|
| GET | `/api/cms/booking/availability?slug&from&to[&locale][&persons][&resourceId]` | none | 60/min | Day statuses for up to 92 days, plus date-picker rules. |
| POST | `/api/cms/booking/quote` | none | 60/min | Body `{slug, locale?, date?, endDate?, persons?, adults?, children?, resourceId?, extraIds[]}` -> `{quote, currency, kind, nights, resources}`. `invalid_config` issues stripped. |
| POST | `/api/cms/booking/request` | none (honeypot) | 5/min | Body = quote body + `answers{}`, `customer{name,email,phone?}`, `notes?`, `acceptTerms` (must be true), `_hp`. 201 `{reference,status,total,currency,redirectUrl,expiresAt}`. 409 on unavailable/unpriceable. |
| POST | `/api/cms/booking/lookup` | none | 20/min | `{reference, email}` -> read-only summary (no token). |
| GET | `/api/cms/booking/pay?reference&t` | token | 10/min | What is owed: `amountDue`, `surcharge`, `chargeable`, `isDeposit`, provider. |
| POST | `/api/cms/booking/pay` | token | 10/min | `{reference, t}` -> start payment; `{redirectUrl, clientSecret, ...}`. |

Gateway webhooks that settle reservations are the provider endpoints described in
08 (`core/payments/webhooks.ts`).

### Admin

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/api/cms/reservations?search&status&from&to&needsAction&experience&page&pageSize` | `reservationsRead` | Paged list (max 100/page). |
| GET | `/api/cms/reservations/:id` | `reservationsRead` | Reservation, items, payments (+`refundable`, `refundedAmount`), events, holds, `drift`, `competing`, `payment {online,label,linkTtlDays}`. |
| PATCH | `/api/cms/reservations/:id` | `reservationsWrite` + no foreign edit lock | `{status, reason?, notify?}` -> `updateReservationStatus`. |
| POST | `/api/cms/reservations/:id/payment-link` | `reservationsWrite` (20/min) | `{amount?}`; refused by `paymentLinkRefusal`; issues and emails a link; returns `{url, expiresAt, amount}`. |
| POST | `/api/cms/reservations/:id/payments` | `reservationsWrite` | `{amount, method?, providerRef?, isDeposit?}`: record an out-of-band payment (provider `manual`). |
| POST | `/api/cms/reservations/:id/refund` | `reservationsWrite` (20/min) | `{paymentId, amount?, reason?}`. |
| POST | `/api/cms/reservations/expire` | `x-cron-secret` = `BOOKING_CRON_SECRET`, or `reservationsWrite` (5/min) | Expiry sweep. |
| GET | `/api/cms/booking/schedule?from&to[&slotKey][&defaultCapacity][&locale]` | `scheduleRead` | `{slots, slot, days, overbooked}` for the Availability screen (<= 92 days). |
| PUT | `/api/cms/booking/schedule` | `scheduleWrite` | `{slotKey, slotDate, capacity?, closed?, price? (MAJOR units), note?}`; an all-empty body deletes the override. |
| POST | `/api/cms/bookings/validate-pricing` | `contentWrite` | `{data, locale?}` -> `{issues}` from the engine matching `data.kind`. |

Permission keys are in `src/cms/modules/auth/permissions.ts`:
`cms.booking.reservations.read|write`, `cms.booking.schedule.read|write` (see 05).

---

## 6. Admin UI

### Experiences editor

The `booking` collection is a normal document collection (03, 04) with sections
("The experience", "Pricing", "Nightly rates", "Party size", "Nights & arrival",
"Occupancy", "Fees & taxes", "Availability", "Options", "Extras", "Content",
"Booking form", "Cancellation & deposit"). `showIf` hides the other kind's
fields; their values stay in `data`. The `'booking-pricing'` advisory runs the
pure validators in the browser and maps engine paths (`resources.N`,
`extras.options`) to form paths (`options.M`, `extrasOptions`) via
`bookingPathRenamer`. Advisories never block a save; the engines refuse a bad
config at quote time instead.

### Reservations (`/admin/reservations`)

- Filters in the URL (`status`, `search`, `needsAction`, `experience` =
  translation group id, `from`/`to` on the booked date, `page`), server-side
  paging, 25 per page. "Needs action" and the header count cover `pending`
  requests and bookings flagged with a payment that could not be applied
  (red "payment to resolve" badge; a banner in the drawer with "Mark resolved").
- The table shows stay ranges (`slot_date -> end_date`, N nights), an `instant`
  badge and a "not sent" badge when the last customer email failed.
- The drawer (`ReservationsTable`) takes an edit lock (`useEditLock` type
  `reservation`) and offers one primary action by status: `pending` -> "Accept &
  send payment link/instructions" (to `awaiting_payment`); `awaiting_payment` /
  `confirmed` -> "Mark paid" (records the outstanding balance as a manual
  payment). Plus "Cancel booking" (releases the date, refunds nothing; hidden
  where the API would refuse it, e.g. `expired`). It shows competing enquiries, the frozen price with a drift warning,
  booking details, payments and the event history (failed / skipped emails
  flagged).
- `ReservationPaymentsPanel`: "Resend payment link" (online provider and
  `canResendPaymentLink`), "Record payment" (`canRecordPayment`, amount typed in
  major units via `parseMoneyInput`), "Refund" (payments with `refundable > 0`).
  The same `payment-actions.ts` rules decide what is shown and what the API
  accepts.

### Availability (`/admin/availability`)

`AvailabilityCalendar` lists slots from `listSchedulableSlots` (published
experiences in the default locale; stays with options contribute only their
options, transport contributes the experience and each option), shows a month
grid with held/confirmed/capacity, override markers and an overbooking banner,
and edits one date at a time: capacity (blank = inherit), closed, price override
(major units; meaning explained by `priceOverrideHelp`) and a note. Write controls
are disabled without `scheduleWrite`. Lowering capacity below what is already
held is allowed on purpose; the result surfaces via `findOverbookedSlots`.

---

## 7. Configuration

### Module and collections

- `modules.booking` toggle (Settings -> Modules). Off: all booking endpoints and
  pages 404; screens are hidden; data is kept.
- `src/site.config.ts`: `bookingCollection(opts)` accepts `key`, `label`,
  `labelPlural`, `icon`, `pathTemplate` (default `/booking/{slug}`),
  `categoryKey`, `vesselTypeKey`, `departureKey`, `extraFields`. Note that many
  helpers (`listBookings`, `listSchedulableSlots`, `getBooking`) default to type
  `'booking'`; changing `key` needs the `type` option passed through.

### Settings (`src/cms/core/settings/schema.ts`, group "Booking")

| Key | Reader | Default | Effect |
|---|---|---|---|
| `booking.kinds` | `getBookingKinds` | both | Which kinds can be authored (field resolver). Invalid/empty -> both. |
| `booking.mode` | `getBookingMode` | `request` | Default flow for items set to `inherit`. |
| `booking.currency` | `getBookingCurrency` | `ecommerce.currency`, then `DEFAULT_CURRENCY` | Quote currency. |
| `booking.timezone` | `getBookingTimezone` | `Europe/Athens` | What "today" is; invalid zones fall back. |
| `booking.notificationEmails` | `getBookingRecipients` | none | Operator notification recipients (split on newline, comma, semicolon). |
| `booking.requestExpiryHours` | `getRequestExpiryHours` | 72 | `pending` lapse. |
| `booking.paymentHoldMinutes` | `getPaymentHoldMinutes` | 20 | Instant-checkout hold. |
| `booking.paymentLinkExpiryDays` | `getPaymentLinkTtlDays` | 7 | Link TTL and operator-accept payment deadline. |
| `booking.depositPercent` | `getDepositPercentBps` | 0 (full) | Site deposit; items override with `depositPercent`. |
| `booking.defaultCapacity` | `getDefaultCapacity` | 1 | Capacity for items without `capacityPerDay`. |
| `booking.leadTimeHours` | `getDefaultLeadTimeHours` | 0 | Default cut-off; the admin placeholder shows the same `0`. |
| `booking.paymentProvider` | `getBookingPaymentProvider` | `manual` | Provider for booking money. |
| `booking.paymentInstructions` | `getPaymentInstructions` | '' | Manual-payment text in approval/confirmation emails. |
| `booking.surchargePercent.stripe` / `.paypal` / `.viva` | `getSurchargeBps` | 0 | Payment-time surcharge. |

Readers are total: blank or malformed values fall back rather than throw.

### Environment

| Variable | Purpose |
|---|---|
| `BOOKING_CRON_SECRET` | Shared secret for `POST /api/cms/reservations/expire`, at least 32 characters. If unset or shorter, only an admin session can run it there. The unified `/api/cms/cron/booking-expire` uses `CMS_CRON_SECRET` instead. |
| Provider keys (`STRIPE_*`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, PayPal, Viva) | See 08. |
| Graph mail settings | See 07. |

---

## 8. Extending

### Recipe: add a pricing rule

Example: a "weekend supplement" for transport.

1. **Field.** Add it in `bookingCollection()` (`collection.ts`) in the right
   section, `shared: true` if it affects price, with `showIf: TRANSPORT_ONLY`.
   Keep it top-level (shared propagation only works for top-level fields).
2. **Config.** Add the property to `BookingPricing` and read it in
   `readPricingConfig` (neutralise it when its switch is off, as the person
   fields are).
3. **Validation.** Add any invariant to `validatePricingConfig` with a stable
   `code` and a `path` the form owns (extend `bookingPathRenamer` in
   `admin/advisories.ts` if the engine path differs from the form path).
4. **Engine.** Apply it in `quoteBooking` at the right precedence, emitting its
   own `QuoteLine` (`kind` from `QuoteLineKind`, a stable `code`, a label that
   states its multiplier). Keep per-component `toMinor`.
5. **Stay equivalent**, if needed: same steps in `StayPricing`,
   `readStayConfig`, `validateStayConfig`, `quoteStay`.
6. **Everything else is automatic**: quote, request, drift check and admin
   drawer all go through `quoteForSelection`, and stored items/emails consume
   `lines`.
7. **Listing price**: update `lowestPrice` in `data.ts` if the rule can lower the
   advertised "from" price.
8. **Tests**: `test/booking/pricing.test.ts` / `stay.test.ts` for the maths,
   `validate.test.ts` / `advisories.test.ts` for validation.

If the rule needs a new `reservation_items.kind`, add it to
`reservationItemKindValues` **and** generate a migration (the column is an
enum).

### Recipe: change the hold duration

There are three durations and one guard; pick the right one:

| What | Where |
|---|---|
| Instant-checkout payment hold | Setting `booking.paymentHoldMinutes`; code default `DEFAULT_PAYMENT_HOLD_MINUTES` in `settings-read.ts`. Applied in `createReservation`. |
| Operator-accepted payment deadline and link lifetime | Setting `booking.paymentLinkExpiryDays`; default `DEFAULT_PAYMENT_LINK_EXPIRY_DAYS`. Applied via `operatorPaymentDeadline` in `updateReservationStatus` and `issuePaymentLink`. |
| Unanswered request lapse (holds nothing) | Setting `booking.requestExpiryHours`; default `DEFAULT_REQUEST_EXPIRY_HOURS`. |
| Double-start guard on the pay page | `PAYMENT_START_CLAIM_MS` in `payments.ts` (not a hold). |

Prefer the setting; change the code default only for all sites. Keep the sweep
frequency well below the shortest hold (holds stop counting on time regardless,
but the status and customer email wait for the sweep). Existing reservations keep
the `expires_at` they were given; only new holds and re-issued links pick up the
new value. `test/booking/settings.test.ts` asserts every `booking.*` setting has
a reader, so add both when introducing a new duration setting.

### Recipe: add a new booking kind

Only `transport` and `stay` exist. A third kind (for example "slot" — timed
entries within a day) touches:

1. **Declared lists** (must stay in sync): `BOOKING_KIND_VALUES` in
   `collection.ts`, `BOOKING_KINDS` in `core/settings/schema.ts` (and the option
   list of the `booking.kinds` setting), the `kind` select's options, and the
   `SchedulableSlot['kind']` union in `schedule.ts` (hard-coded
   `'transport' | 'stay'`).
2. **Fields**: a `KIND_ONLY` `showIf` and the kind's fields/sections. `fields.ts`
   needs no change.
3. **Engine**: a pure `<kind>.ts` with `read<Kind>Config`, `validate<Kind>Config`
   and `quote<Kind>` returning the common `Quote` shape (plus anything the
   ledger needs, like `nightDates`). Add the config to `ResolvedBooking` in
   `read.ts` and dispatch in `quoteForSelection` / `overrideDatesFor`
   (`quote-selection.ts`). Today anything not `stay` falls through to the
   transport engine, so a missing branch fails silently.
4. **Availability**: rules reader + status function in `availability.ts`, and
   the slot claim. The stored row must be enough to re-derive the claim in
   `slotClaimFor` (currently it distinguishes kinds by `nights > 0`); you may
   need a new reservation column (and migration) such as the kind itself or a
   time slot.
5. **Reservation creation**: `createReservation` branches on `isStay` for the
   calendar check, the claim, `holdDates`, `nights`, `adults`/`children` and
   `end_date`; `priceRefusalMessage` / `unavailableMessage` for new reasons.
6. **Endpoints**: `bookingAvailabilityRoute` (which ledger, `seats`, `rules`
   payload), `bookingValidatePricingRoute`, `priceDrift` (already generic via
   `priceSelection`).
7. **Admin**: `bookingPricing` advisory in `admin/advisories.ts`,
   `listSchedulableSlots`, `priceOverrideHelp`, the Reservations table/drawer
   date and party rendering (keyed on `nights`).
8. **Public**: `BookingForm` and a `<Kind>Fields` component, `BookingCard`
   price label, `lowestPrice` in `data.ts`, structured-data category
   (`categoryForCollection('booking', { kind })`, `bookingTransport` /
   `bookingStay` in `core/structured-data/policy.ts`), and translations.
9. **Emails**: the summary shows only `slot_date`; extend `summaryHtml` if the
   kind needs more.
10. **Tests**: extend `collection.test.ts` (kind discriminator/sections),
    `availability.test.ts` (`slotClaimFor`), `price-override.test.ts`
    (`quoteForSelection`) and add an engine test file.

### Recipe: add a customer email

Add the identifier to `ReservationEmail` (`lifecycle.ts`), map the trigger in
`emailForTransition` or `emailForNewReservation`, add copy to
`customerEmailBody` (both languages), and send through `sendCustomerEmail` so the
outcome is recorded. Cover it in `lifecycle.test.ts` / `accept-and-emails.test.ts`.

---

## 9. Testing

Tests use Node's built-in runner through `tsx`. Most booking tests exercise the
pure files directly; a few (e.g. `accept-and-emails.test.ts`) assert on source
text of server files. None needs a database.

```bash
# one file
npx tsx --tsconfig ./tsconfig.test.json --test test/booking/stay.test.ts
# the booking folder
npx tsx --tsconfig ./tsconfig.test.json --test test/booking/*.test.ts
# everything (package.json "test")
npm test
```

| File | Covers |
|---|---|
| `test/booking/pricing.test.ts` | Month-day parsing, seasons (wrap-around, overlap), brackets, `clampPersons`, `quoteBooking` modes and precedence. |
| `test/booking/validate.test.ts` | `validatePricingConfig` (seasons, persons, modes, resources, extras). |
| `test/booking/stay.test.ts` | `stayNights`, `quoteStay` (rates, options, nights rules, occupancy, fees, extras). |
| `test/booking/price-override.test.ts` | Calendar price overrides for transport, options and stays; `quoteForSelection`; `priceOverrideHelp`. |
| `test/booking/availability.test.ts` | `remainingSeats`, `todayInTimeZone`, date helpers, `dayStatus`, `slotRequestsFor`, `slotClaimFor`, lock ordering. |
| `test/booking/calendar.test.ts` | Public date-picker helpers (month maths, availability reasons, fetch window). |
| `test/booking/lifecycle.test.ts` | Transitions, `holdStateFor`, email mapping, labels, references/tokens. |
| `test/booking/accept-and-emails.test.ts` | Payment deadlines, accept issuing a real payment request, approval and expiry emails, instructions setting. |
| `test/booking/settlement.test.ts` | `settlementFor`, `amountDueFor`, surcharge accounting. |
| `test/booking/payment-actions.test.ts` | Drawer/API money rules, `parseMoneyInput`. |
| `test/booking/payment-link-url.test.ts` | `paymentLinkUrl`, `paymentReturnUrl`. |
| `test/booking/settings.test.ts` | Every `booking.*` managed setting has a reader; group coherence. |
| `test/booking/collection.test.ts` | Collection shape, kind discriminator, per-kind fields and sections. |
| `test/booking/data.test.ts` | `readBookingKind`, `readItemCapacity`, `readOptions`, `toResourcePricing`, `lowestPrice`, listing helpers. |
| `test/booking/advisories.test.ts` | The `booking-pricing` advisory and its path mapping. |
| `test/booking/legacy-facets.test.ts` | The facet migration reader. |
| `test/cms/reservations-admin.test.tsx` | Reservations admin UI. |
| `test/components/booking-cancellation.test.tsx` | Public cancellation terms component. |
| `test/core/payments.test.ts` | Includes the `reservation` payment subject encoding. |
| `test/site/module-gate.test.ts` | Module gating of routes (includes booking). |

Concurrency (`allocateSlots` under real row locks), webhooks end-to-end and the
expiry sweep against a database are not covered by automated tests; verify those
manually against a dev MySQL.

---

## 10. Gotchas and invariants

**Server decides price and availability.** The client's totals are never read.
`createReservation` re-prices through `priceSelection` and re-checks capacity
under the lock. Keep it that way for any new entry point.

**Timezones.**
- Booking dates are calendar `DATE`s. "Today" is `todayInTimeZone(now,
  booking.timezone)`; weekdays are computed in UTC from the date string, which
  is correct for a pure date.
- `cutoffFor(date, leadTimeHours, timeZone)` anchors on midnight of the date in
  `booking.timezone` (`zonedMidnight`, DST-aware via `Intl`), the same zone
  "today" uses. It used to anchor on UTC midnight, closing Athens cut-offs 2–3
  hours late. The `timeZone` argument defaults to `'UTC'` only for callers
  outside `dayStatus`.
- Hold expiry is compared with a JS `Date` bound as a parameter, never SQL
  `NOW()`, because mysql2 writes timestamps in the Node process's zone. Do not
  "simplify" these predicates to `NOW()`.

**Overbooking and concurrency.**
- Only `allocateSlots` may add holds, and only inside a transaction. The lock
  order (`slotDatePairs`) must be preserved.
- Payments never call the unchecked `confirmHolds`; both settlement paths
  (`recordBookingPayment`, `captureReservationPaymentByRef`) go through
  `confirmHoldsChecked`, which refuses a lapsed or released hold
  (`holdConfirmationVerdict`) and re-checks a live one under the
  `booking_slots` lock (`isOverCapacity`). A refused confirmation, and a
  `refused` settlement on a cancelled/expired booking, record the payment row
  but credit nothing; `flagForAttention` sets `reservations.metadata.attention`
  (`hold_lapsed` / `no_capacity` / `booking_closed`), kills the payment token and
  writes a `payment.needs_action` event. The booking then appears under "Needs
  action" until a refund clears the flag or the operator uses "Mark resolved"
  (`PATCH { resolveAttention: true }`). Operator status moves
  (`updateReservationStatus` → `confirmed`/`paid` from `awaiting_payment`)
  still use the unchecked `confirmHolds`: that is an explicit human decision.
- A payment on a `pending` enquiry (no holds, verdict `none`) settles to
  `confirmed` without claiming a date — `issuePaymentLink` promotes enquiries
  first, so this is a backstop path only.
- Request mode lets any number of `pending` enquiries target one date; the 409
  happens at accept. `competingReservations` only matches the same `slot_date`,
  so overlapping stays with different check-in dates are not listed.
- `findOverbookedSlots(from, to, defaultCapacityFor)` judges a date with no
  capacity override against the slot's default (the schedule route passes each
  `listSchedulableSlots` default; `exclusive` transport's experience slot is 1)
  and counts `held` rows only while unexpired, by the app clock. A slot whose
  default is unknown (experience unpublished) is judged only by an override.
- The public availability endpoint reads exactly the slots a booking would
  claim (`slotRequestsForKind` + `readAllocationMode`, shared with
  `createReservation`) and combines them with `combinedDayStatus`: `shared` /
  `exclusive` transport read only `exp:`, `resource` reads `exp:` and `res:`,
  a stay reads its unit. The form sends `persons` for transport
  (`availabilityParams`), so fullness is judged for the real party size.
- Options are per experience: the same physical asset listed on two experiences
  is two calendars.

**Payments.**
- Online providers exist only in bundles that import
  `@/cms/core/payments/register`; without it every provider resolves to
  `manual` and `isOnlineProvider` is false (instant bookings would be
  `confirmed` instead of `awaiting_payment`). New routes that resolve a provider
  must import it.
- The token is a bearer credential stored only as a hash; the API never returns
  it (`paymentLinkRoute` returns the URL to the admin only because the admin
  just caused the email). Do not log URLs containing `?t=`.
- `deposit_amount` is overwritten on each link issue and is the target amount of
  the current link, not a fixed "deposit". `amountDueFor` depends on it.
- "Mark paid" (PATCH `status: 'paid'`) goes through `markReservationPaid`: with
  a balance due (`markPaidPlan`) it records that balance as a `manual` payment
  via `recordBookingPayment({ enforceBalance: true })`, so the row,
  `amount_paid` and status agree; with nothing due it is a plain status move.
- Refunds target `refundTargetRef(row)` (`core/payments/refunds.ts`, shared
  with order refunds): Viva refunds the transaction (`metadata.transactionId`,
  no fallback — a Viva row without one is refused with 409, since the order
  code in `provider_ref` is never a valid target), PayPal the `captureId`,
  others `provider_ref`. The Viva webhook stores a reversal's id as
  `reversalTransactionId` so it never overwrites the capture's `transactionId`.
- Surcharges are excluded from the credit; the refundable figure of a payment row
  includes the surcharge.
- Refund failures that throw keep the refund claim in `metadata` deliberately;
  clearing it is a manual decision.

**Cancellations.**
- Cancelling releases holds and emails the customer; it refunds nothing.
  `freeCancellationDays` and `cancellationPolicy` are information only.
- `expired` and `cancelled` are terminal; the drawer offers "Cancel booking"
  only where `canTransition(status, 'cancelled')` holds.

**Other.**
- `reservations.version` guards status changes; a zero-row update rolls back the
  hold work and returns 409. Other writers (`issuePaymentLink`, settlement,
  sweep) guard by status or row lock rather than `version`.
- `readStoredCapacities` resolves the option with locale `'el'`; harmless for
  capacity because option ids are locale-independent.
- `GET /api/cms/reservations` accepts `needsAction` as `true`/`false`/`1`/`0`
  only (`reservationsListQuery`); never use `z.coerce.boolean()` for a query
  flag — it turns the string `'false'` into `true`. `needsAction` matches
  `pending` rows and rows carrying `metadata.attention`.
- Emails, the lookup response and the pay page print dates with
  `bookedDatesText` (`lifecycle.ts`): a stay shows `check-in → check-out (N
  nights)`. Anything new that shows a booking's date to a guest should use it.
- The detail page's JSON-LD `Offer` price comes from `structuredOfferPrice`:
  transport's `basePrice`, a stay's lowest nightly price (`lowestPrice`).
- `booking_category` has no route: categories are filters on `/booking`
  (`?category=`), there is no category page template, so the collection
  declares no `pathTemplate` (and therefore no SEO panel). Adding one needs a
  page under `src/app/[locale]/booking/` and the generator
  (`new-site/scripts/generate.mjs`) updated together.
- `BOOKING_CRON_SECRET` is checked with `authorizeCronRequest`: shorter than
  32 characters (`CRON_SECRET_MIN_LENGTH`) and it authorises nothing.
- `reservations.admin_notes` and `reservations.resource_id` exist but are not
  written by current code.
