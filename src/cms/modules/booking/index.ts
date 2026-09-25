/**
 * Booking module — the public surface.
 *
 * A toggleable sibling of `commerce`: bookable items with recurring seasonal
 * pricing, price-replacing resources, extras, and a capacity ledger that makes
 * double-booking impossible. Everything here is inert until `modules.booking`
 * is enabled, and the module depends on nothing in `commerce`, so either can
 * run without the other.
 *
 * Import from `@/cms/modules/booking` only — the individual files are internal.
 */

export {
  bookingCollection,
  bookingTermCollection,
  MD_PATTERN,
  DEFAULT_BOOKING_TYPE,
  BOOKING_KIND_VALUES,
  ALLOCATION_MODE_VALUES,
  BOOKING_MODE_VALUES,
  FEE_BASIS_VALUES,
} from './collection';
export type {
  BookingCollectionOptions,
  BookingTermCollectionOptions,
  BookingKind,
  AllocationMode,
  BookingModeSetting,
  FeeBasis,
} from './collection';

export { bookingFieldResolver, resolveKindField } from './fields';

export {
  quoteStay,
  readStayConfig,
  validateStayConfig,
  minNightsFor,
  maxOccupancyFor,
  FEE_BASIS,
} from './stay';
export type {
  StayPricing,
  StaySelection,
  StayQuote,
  StayQuoteResult,
  StayQuoteFailure,
  StayFee,
  SeasonalRate,
} from './stay';

export {
  getBooking,
  getBookingCurrency,
  resolveBookingPricing,
  readOptions,
  readBookingKind,
  toResourcePricing,
  listBookings,
  listBookingTermDocs,
  countTermUsage,
  termIdsBySlug,
  applyBookingQuery,
  lowestPrice,
  structuredOfferPrice,
  DEFAULT_PATH_PREFIX,
} from './read';
export type {
  ResourceRef,
  ResolvedBooking,
  BookingSummary,
  TermSummary,
  TermDoc,
  BookingTermIndex,
  BookingQuery,
  BookingSort,
} from './read';

export {
  getBookingKinds,
  getBookingMode,
  getBookingTimezone,
  getBookingRecipients,
  getBookingPaymentProvider,
  getRequestExpiryHours,
  getPaymentHoldMinutes,
  getPaymentLinkTtlDays,
  getSurchargeBps,
  getDepositPercentBps,
  getDefaultCapacity,
  getDefaultLeadTimeHours,
  BOOKING_SETTING_READERS,
  DEFAULT_REQUEST_EXPIRY_HOURS,
  DEFAULT_PAYMENT_HOLD_MINUTES,
  DEFAULT_PAYMENT_LINK_EXPIRY_DAYS,
  DEFAULT_CAPACITY_PER_DAY,
  DEFAULT_LEAD_TIME_HOURS,
} from './settings-read';
export type { BookingMode } from './settings-read';

export {
  quoteBySlug,
  priceSelection,
  loadPriceOverrides,
  bookingQuoteRoute,
  bookingAvailabilityRoute,
  bookingValidatePricingRoute,
} from './quote';
export type { QuoteBody, PublicQuote } from './quote';

export {
  bookingSlotKey,
  resourceSlotKey,
  canFit,
  cutoffFor,
  dayStatus,
  daysBetween,
  eachDate,
  isHoldExpired,
  readDayRules,
  readStayRules,
  remainingSeats,
  resolveCapacity,
  slotDatePairs,
  slotRequestsFor,
  staySlotRequestsFor,
  stayNights,
  stayStatus,
  todayInTimeZone,
  weekdayOf,
  ALLOCATION_MODES,
} from './availability';
// `AllocationMode` is exported from `collection.ts` — the field defines it, and
// `availability.ts` restates the same union for its own use.
export type {
  DayRules,
  DayState,
  DayStatus,
  SlotRequest,
  SlotRequestInput,
  StayRules,
  StayCheck,
  StaySlotRequestInput,
} from './availability';

export {
  listSchedulableSlots,
  getSchedule,
  setSlotOverride,
  scheduleReadRoute,
  scheduleWriteRoute,
} from './schedule';
export type { SchedulableSlot, ScheduleDay, SlotOverrideInput } from './schedule';

export {
  allocateSlots,
  confirmHolds,
  releaseHolds,
  getDayStates,
  expireStaleReservations,
  findOverbookedSlots,
} from './allocation';
export type { DayStateRow, OverbookedSlot, SlotUsage } from './allocation';

export {
  canTransition,
  allowedTransitions,
  isTerminal,
  holdStateFor,
  consumesCapacity,
  initialStatus,
  emailForTransition,
  RESERVATION_STATUSES,
  RESERVATION_TRANSITIONS,
  RESERVATION_STATUS_LABELS,
  bookedDatesText,
} from './lifecycle';
export type { ReservationEmail } from './lifecycle';

export {
  formatBookingReference,
  referenceSuffix,
  isBookingReference,
  normalizeReference,
  paymentToken,
  hashToken,
  tokenMatches,
  isTokenLive,
  REFERENCE_ALPHABET,
} from './reference';

export {
  createReservation,
  listReservations,
  listReservationExperiences,
  getReservation,
  competingReservations,
  lookupReservation,
  updateReservationStatus,
  reservationRequestSchema,
  bookingRequestRoute,
  bookingLookupRoute,
  reservationsListRoute,
  reservationGetRoute,
  reservationUpdateRoute,
} from './reservations';
export type {
  ReservationRequestInput,
  CreateReservationResult,
  ListReservationsOptions,
  StatusChangeResult,
} from './reservations';

export { sendReservationEmails, sendStatusEmail, sendPaymentLinkEmail } from './emails';

export {
  issuePaymentLink,
  requestPayment,
  redeemPaymentToken,
  recordBookingPayment,
  captureReservationPaymentByRef,
  refundReservationPayment,
  settlementFor,
  amountDueFor,
  resolveDepositAmount,
  paymentLinkUrl,
  paymentReturnUrl,
  listPaymentsForReservation,
  bookingPayGetRoute,
  bookingPayStartRoute,
  paymentLinkRoute,
  recordPaymentRoute,
  refundReservationRoute,
  bookingExpireRoute,
} from './payments';
export type { IssuedLink } from './payments';

export {
  // The engine
  quoteBooking,
  readPricingConfig,
  validatePricingConfig,
  // Season maths — shared with the availability engine and the admin editors
  monthDayToInt,
  dateToMonthDay,
  seasonSegments,
  inSeason,
  findSeason,
  seasonsOverlap,
  findBracket,
  clampPersons,
  toMinor,
  surchargeAmount,
  PRICING_MODE_VALUES,
} from './pricing';
export type {
  BookingPricing,
  MonthDay,
  SeasonRange,
  SeasonalPrice,
  PersonBracket,
  ResourceSeasonalRule,
  ResourcePricing,
  ExtraOption,
  ExtrasConfig,
  TieredRule,
  PricingMode,
  PricingIssue,
  QuoteSelection,
  QuoteLine,
  QuoteLineKind,
  QuoteApplied,
  Quote,
  QuoteFailure,
  QuoteResult,
} from './pricing';
