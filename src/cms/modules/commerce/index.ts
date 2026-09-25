/**
 * Commerce module — public surface.
 *
 * Products are `documents` (a `productCollection()` preset), so most of the
 * capability is the existing content stack. This module adds the product
 * schema preset and catalog read helpers, plus the shop that sells them:
 * server-side checkout, orders, payments (manual, Stripe, PayPal, Viva via
 * `core/payments`), stock, coupons, gift cards, shipping and couriers,
 * abandoned carts, wishlists, reviews and feeds. A site enables it with
 * `modules.commerce: true` + a product collection in its config. See
 * docs/dev-guides/08-commerce.md.
 */
export {
  productCollection,
  AVAILABILITY_VALUES,
  VISIBILITY_VALUES,
  BADGE_VALUES,
  CONDITION_VALUES,
  PRODUCT_TYPE_VALUES,
  type ProductCollectionOptions,
} from './collection';

export {
  categoryCollection,
  type CategoryCollectionOptions,
} from './category';

export {
  sizeChartCollection,
  DEFAULT_SIZECHART_TYPE,
  type SizeChartCollectionOptions,
} from './sizechart';

export {
  tagCollection,
  DEFAULT_TAG_TYPE,
  type TagCollectionOptions,
} from './tag';

export {
  projectSizeChart,
  getSizeChartForProduct,
  type ResolvedSizeChart,
} from './sizechart-read';

export {
  listProducts,
  getProduct,
  resolvePrice,
  formatPrice,
  getSiteCurrency,
  listCategories,
  listProductsByCategory,
  getCategoriesByIds,
  applyProductQuery,
  buildFacets,
  buildFacetCounts,
  filterProducts,
  priceBounds,
  productPriceRange,
  facetDisplayFor,
  buildTagFacet,
  filterByVisibility,
  toBadges,
  groupedTotal,
  getGroupedComponents,
  listTags,
  getTagsByIds,
  listProductsByTag,
  type GroupedComponent,
  type ComponentEntry,
  type TagSummary,
  type TagProducts,
  DEFAULT_PRODUCT_TYPE,
  DEFAULT_CATEGORY_TYPE,
  type CatalogContext,
  type ProductBadge,
  type ProductVisibility,
  type ProductSort,
  type ProductQueryOptions,
  type ProductQueryResult,
  type ProductFacet,
  type ProductFacetValue,
  type FacetDisplay,
  type FacetCountValue,
  type FacetWithCounts,
  type ProductTagRef,
  type ProductSummary,
  type ProductVariation,
  type ProductDimensions,
  type GalleryImage,
  type ListProductsOptions,
  type CategorySummary,
  type CategoryProducts,
} from './read';

export {
  quantityRules,
  clampQuantity,
  type QuantityRules,
} from './quantity';

export {
  searchProducts,
  createProductSearchRoute,
  type SearchSuggestion,
} from './search';

export {
  getCompareData,
  type CompareProduct,
} from './compare';

export {
  captureCart,
  cartSubtotalMinor,
  recoverCart,
  recoverUrl,
  markConvertedByEmail,
  findDueForReminder,
  processReminders,
  reminderBudget,
  reminderHtml,
  remindersSentSince,
  listAbandoned,
  createCaptureRoute,
  createRecoverRoute,
  abandonedDeleteRoute,
  safeImageUrl,
  abandonedListRoute,
  abandonedRemindRoute,
  type AbandonedItem,
  type AbandonedStatus,
  type AbandonedSummary,
  type CaptureCartInput,
  type ListAbandonedOptions,
} from './abandoned';

export {
  getPriceControl,
  ECOMMERCE_PRICE_CONTROL_KEY,
  PRICE_CONTROLS,
  DEFAULT_PRICE_CONTROL,
  type PriceControl,
} from './filters';
export {
  addToWishlist,
  customerWishlistRoutes,
  getWishlistConfig,
  listWishlist,
  mergeDeviceWishlist,
  removeFromWishlist,
  resolveWishlistItems,
  wishlistResolveRoute,
  wishlistTrackRoute,
  WISHLIST_STAT_SCOPE,
  type WishlistEntry,
} from './wishlist';
export {
  DEFAULT_WISHLIST_MAX_ITEMS,
  ECOMMERCE_WISHLIST_KEY,
  decodeWishlistCookie,
  encodeWishlistCookie,
  mergeWishlists,
  parseWishlistConfig,
  sameWishlistItem,
  type WishlistConfig,
  type WishlistItem,
} from './wishlist-policy';
export {
  BOXNOW_NOT_CONNECTED,
  checkShippingMethod,
  COURIER_LABELS,
  COURIER_SECRET_DEFS,
  normalizeCountry,
  quoteMethods,
  shipmentActions,
  trackingUrlFor,
  type CourierKey,
  type MethodKind,
  type QuotedMethod,
  type ShippingMethodRow,
  type ShippingZoneRow,
} from './shipping-methods';
export {
  boxNowLockersRoute,
  courierCredentialsRoute,
  createShipment,
  getShippingMethod,
  listShipments,
  listShippingMethods,
  listShippingZones,
  orderShipmentsListRoute,
  orderShipmentsRoute,
  resolveShippingChoices,
  shippingMethodsRoute,
  shippingZoneRoute,
  shippingZonesRoute,
} from './shipping-service';
export { giftCardAmountsUsed, orderStatusAfterRefund, refundableAmount } from './order-admin';
export { COURIERS, courierFor, type CourierAdapter, type Locker } from './couriers';
export {
  applyGiftCards,
  ECOMMERCE_GIFTCARDS_KEY,
  formatGiftCardCode,
  generateGiftCardCode,
  hashGiftCardCode,
  isGiftCardUsable,
  normalizeGiftCardCode,
  parseGiftCardConfig,
  planGiftCardRefund,
  type GiftCardConfig,
  type GiftCardRow,
  type GiftCardStatus,
} from './giftcards/policy';
export {
  creditGiftCard,
  deliverDueGiftCards,
  expireGiftCards,
  findGiftCardByCode,
  getGiftCardConfig,
  issueGiftCardsForOrder,
  quoteGiftCards,
  redeemGiftCards,
  reverseGiftCardRedemptions,
} from './giftcards/service';
export { sendGiftCardEmail } from './giftcards/emails';
export {
  giftCardCheckRoute,
  giftCardHistoryRoute,
  giftCardQuoteRoute,
  giftCardsListRoute,
  giftCardWriteRoute,
} from './giftcards/routes';
export {
  deliverIssuedGiftCard,
  giftCardHistory,
  isGiftCardAmountAllowed,
  validateGiftCardPurchase,
  type GiftCardHistoryEntry,
  type GiftCardPurchase,
} from './giftcards/rules';
export { computeOrderTotals, type OrderTotals, type OrderTotalsInput } from './totals';
export {
  cancelStaleOrders,
  planStaleOrderCancellations,
  parsePendingOrderTtlHours,
  PENDING_ORDER_TTL_KEY,
  DEFAULT_PENDING_ORDER_TTL_HOURS,
  type StaleOrderCandidate,
} from './stale-orders';

export {
  submitQuote,
  createQuoteRoute,
  type QuoteInput,
  type QuoteRequestMeta,
  type QuoteRouteOptions,
} from './quote';

export {
  createOrder,
  parseMoneyMajor,
  getGiftWrapFee,
  listOrders,
  getOrder,
  updateOrderStatus,
  saveOrder,
  lookupOrder,
  orderStats,
  exportOrdersCsv,
  sendOrderEmails,
  sendOrderStatusEmail,
  createCheckoutRoute,
  createOrderLookupRoute,
  ordersListRoute,
  orderGetRoute,
  orderUpdateRoute,
  orderRefundRoute,
  orderCreateRoute,
  orderSaveRoute,
  orderExportRoute,
  type CheckoutInput,
  type OrderEditInput,
  type OrderEditItem,
  type CheckoutCustomer,
  type CheckoutLine,
  type ListOrdersOptions,
  type OrderStats,
  type OrderReportFilter,
} from './orders';

export {
  getShippingConfig,
  computeShipping,
  quoteShipping,
  createShippingQuoteRoute,
  normalisePickup,
  pickupAvailable,
  findPickupLocation,
  DEFAULT_SHIPPING_CONFIG,
  DEFAULT_PICKUP_CONFIG,
  type ShippingConfig,
  type ShippingMethod,
  type DeliveryMethod,
  type ShippingWeightTier,
  type ShippingZone,
  type PaymentSurcharge,
  type PickupConfig,
  type PickupLocation,
} from './shipping';

export {
  getCoupons,
  validateCoupon,
  computeDiscount,
  normaliseCoupon,
  quoteCoupon,
  couponUsageError,
  countCouponRedemptions,
  createCouponRoute,
  type Coupon,
  type CouponType,
  type CouponResult,
  type CouponReason,
} from './coupons';

export {
  FEED_FORMATS,
  resolveFeedFormat,
  productDocToFeed,
  listFeedProducts,
  availabilityToMerchant,
  availabilityToSkroutz,
  xmlEscape,
  buildSkroutzXml,
  buildGoogleMerchantXml,
  renderFeed,
  type FeedFormat,
  type FeedProduct,
  type FeedMeta,
  type RenderedFeed,
} from './feeds';

export {
  submitReview,
  listApprovedReviews,
  getRatingAggregate,
  getProductGroupId,
  computeRatingAggregate,
  listReviews,
  orderQualifiesForBadge,
  reviewStats,
  updateReviewStatus,
  deleteReview,
  createReviewRoute,
  reviewsListRoute,
  reviewStatsRoute,
  reviewUpdateRoute,
  reviewDeleteRoute,
  type ReviewInput,
  type ReviewStatus,
  type RatingAggregate,
  type PublicReview,
  type ReviewSummary,
  type ReviewStats,
  type ListReviewsOptions,
  type ListReviewsResult,
  type ReviewRouteOptions,
} from './reviews';

export {
  manualProvider,
  getPaymentProvider,
  getConfiguredPaymentProvider,
  isOnlineProvider,
  canRefundOnline,
  paymentProviderKeys,
  recordPayment,
  capturePaymentByRef,
  refundOrderPayment,
  listPaymentsForOrder,
  syncPaymentsForOrderStatus,
  type PaymentProvider,
  type PaymentStartContext,
  type PaymentStartResult,
  type PaymentStatus,
  type PaymentRefundContext,
  type PaymentRefundResult,
} from './payments';

// The unsubscribe endpoint for the abandoned-cart reminder — the only
// unsolicited mail this module sends. See `unsubscribe.ts` for why GET and POST
// do different things.
export { unsubscribeConfirmRoute, unsubscribeSubmitRoute } from './unsubscribe';
