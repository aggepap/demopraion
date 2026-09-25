/**
 * Core services barrel. The route factory, error types, rate limiter, email,
 * and audit — the shared machinery every module and route builds on.
 */
export {
  createRoute,
  ok,
  created,
  noContent,
  paginated,
  isSameOrigin,
  idParam,
  uuidParam,
} from './api';
export type { RouteConfig, RouteContext, PageMeta } from './api';

export {
  ApiError,
  badRequest,
  invalidInput,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  isDuplicateKeyError,
} from './errors';
export type { ApiErrorCode } from './errors';

export { checkRateLimit, clientIpLabel, getClientIp } from './rate-limit';
export type { RateLimitConfig, RateLimitResult } from './rate-limit';

export { sendGraphMail, escapeHtml, emailColor, formatMoney, formatDate } from './email';
export type { GraphMail } from './email';
export {
  isSuppressed,
  normalizeEmail,
  suppressEmail,
  suppressedAmong,
  unsubscribeSignature,
  unsubscribeSignatureMatches,
  unsubscribeUrl,
} from './email';

export { logAudit, extractRequestMeta } from './audit';
export type { AuditEntry } from './audit';

export { getAdminPath, isAdminPath, isAdminApiPath, siteOrigin, localePrefix } from './paths';

export { slugify, slugifyLocalized, SLUG_MAX_LENGTH } from './slug';

// The provider-agnostic payment seam, shared by commerce and booking. Each
// module keeps its own payment rows; only the contract lives here.
export {
  manualProvider,
  getPaymentProvider,
  registerPaymentProvider,
  paymentProviderKeys,
  isOnlineProvider,
  canRefundOnline,
  encodePaymentSubject,
  decodePaymentSubject,
  PAYMENT_STATUSES,
  PAYMENT_SUBJECTS,
} from './payments';
// Refund bookkeeping. Both modules mutate their own tables, but the arithmetic
// and the "already refunded in full" rule are shared — see `payments/refunds.ts`.
export {
  reconcileProviderRefund,
  refundedSoFar,
  refundTargetRef,
  withRefundClaim,
  resolveRefundAmount,
  REFUNDED_AMOUNT_KEY,
} from './payments/refunds';
export type {
  PaymentProvider,
  PaymentStartContext,
  PaymentStartResult,
  PaymentStatus,
  PaymentSubject,
  PaymentRefundContext,
  PaymentRefundResult,
} from './payments';

export {
  getSetting,
  getSettings,
  setSetting,
  SETTINGS_TAG,
  settingTag,
  MANAGED_SETTINGS,
  MANAGED_SETTING_KEYS,
  SECURITY_REQUIRE_2FA_KEY,
  moduleSettingKey,
  resolveModuleFlags,
  isModuleEnabled,
  I18N_LOCALES_KEY,
  ECOMMERCE_CURRENCY_KEY,
  ECOMMERCE_CURRENCIES,
  DEFAULT_CURRENCY,
  ECOMMERCE_PAYMENT_PROVIDER_KEY,
  DEFAULT_PAYMENT_PROVIDER,
  ECOMMERCE_SHIPPING_KEY,
  ECOMMERCE_COUPONS_KEY,
  ECOMMERCE_GIFTWRAP_FEE_KEY,
  BOOKING_CURRENCY_KEY,
  parseMultiValue,
  formatMultiValue,
  BOOKING_KINDS_KEY,
  BOOKING_KINDS,
  DEFAULT_BOOKING_KINDS,
  BOOKING_MODE_KEY,
  BOOKING_MODES,
  DEFAULT_BOOKING_MODE,
  BOOKING_TIMEZONE_KEY,
  DEFAULT_BOOKING_TIMEZONE,
  BOOKING_REQUEST_EXPIRY_KEY,
  BOOKING_PAYMENT_HOLD_KEY,
  BOOKING_PAYMENT_LINK_EXPIRY_KEY,
  BOOKING_PAYMENT_INSTRUCTIONS_KEY,
  BOOKING_DEPOSIT_PERCENT_KEY,
  BOOKING_NOTIFICATION_EMAILS_KEY,
  BOOKING_DEFAULT_CAPACITY_KEY,
  BOOKING_LEAD_TIME_KEY,
  BOOKING_PAYMENT_PROVIDER_KEY,
  BOOKING_SURCHARGE_STRIPE_KEY,
  BOOKING_SURCHARGE_PAYPAL_KEY,
  BOOKING_SURCHARGE_VIVA_KEY,
  CUSTOM_FIELDS_KEY,
  EXTRA_MANAGED_KEYS,
  ANALYTICS_GA_ID_KEY,
  resolveGaId,
  resolveLocaleSet,
  resolveLocaleSettings,
} from './settings';
export type {
  SettingFieldDef,
  SettingFieldType,
  BookingKindValue,
  LocaleSettings,
  StoredLocaleSettings,
} from './settings';

// Admin-defined custom fields: pure descriptor + helpers, plus the server-side
// resolver that merges them into a collection.
export {
  CUSTOM_FIELD_KINDS,
  CUSTOM_GROUP_RENDER,
  CUSTOM_FIELDS_DATA_KEY,
  CUSTOM_KEY_PATTERN,
  EMPTY_CUSTOM_FIELDS,
  sanitizeCustomFieldsConfig,
  customFieldsForCollection,
  visibleCustomFields,
  documentCategoryIds,
  compileCustomFields,
  withCustomFields,
  groupCustomFieldValues,
} from './fields';
export type {
  CustomFieldKind,
  CustomGroupRender,
  LocalizedLabel,
  CustomFieldOption,
  CustomFieldDef,
  CustomFieldGroup,
  CustomFieldsConfig,
  CustomFieldGroupValues,
} from './fields';
export {
  getAllCustomFields,
  getCustomFieldsConfig,
  getSeoFieldOverrides,
  getSeoFieldsFor,
  resolveCollectionWithCustomFields,
  mergeCustomFields,
} from './fields/resolve';

export {
  SEO_FIELD_DEFS,
  SEO_FIELDS_DATA_KEY,
  SEO_TABS,
  ROBOTS_OPTIONS,
  ROBOTS_DEFAULT,
  robotsValue,
  robotsColumns,
} from './seo/fields';
export type { SeoFieldDef, SeoTab, SeoStorage, SeoColumn } from './seo/fields';
export {
  emptySeoOverrides,
  compileSeoGroup,
  resolveSeoFields,
  sanitizeSeoFieldOverrides,
  seoFieldsByTab,
} from './seo/field-overrides';
export type { SeoFieldOverrides } from './seo/field-overrides';

export {
  createDocument,
  updateDocument,
  deleteDocument,
  getDocumentById,
  getDocumentGroup,
  listDocuments,
  listDocumentGroups,
  listVersions,
  restoreVersion,
  deriveDocumentTitle,
  documentVersionNumber,
  syncDocumentRelations,
  extractRelationLinks,
  previewTargetFor,
} from './documents';
export type {
  DocumentWriteInput,
  DocumentWriteOptions,
  DocumentPatch,
  DocumentSummary,
  DocumentVariant,
  DocumentGroupSummary,
  DocumentVersionSummary,
  ListDocumentsOptions,
  ListDocumentsResult,
  ListDocumentGroupsOptions,
  ListDocumentGroupsResult,
} from './documents';

export {
  getPublishedDocument,
  getDocumentPreview,
  getPublishedByPath,
  listPublishedDocuments,
  listPublishedByRelation,
  loadRelatedDocuments,
  revalidateDocument,
  revalidateType,
  typeTag,
  docTag,
  pathTag,
} from './read';

/*
 * Public form submissions. The write side is exported because the site's own
 * `/api/contact` route needs it: it used to only send an email, so this table had a
 * reader and no writer and `/admin/submissions` could never show anything (F-064).
 */
export {
  appendSubmissionPayload,
  createSubmission,
  markSubmissionDelivered,
  markSubmissionUndelivered,
  type NewSubmissionInput,
} from './forms/service';

/*
 * The public consent surface. Exported because the banner is a site component, not
 * an admin one: the categories an admin declares had no reader outside the admin, so
 * the Cookies screen governed nothing a visitor ever saw (F-065).
 */
export {
  cookiePolicyVersion,
  getConsentOptions,
  getPublicCookieDeclaration,
  recordConsent,
  type ConsentRecord,
} from './cookies/service';
