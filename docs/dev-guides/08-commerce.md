# 08 · Commerce: shop, orders, payments, shipping & customers

This guide covers the shop side of the CMS: the product catalogue (products, variations, categories, tags, size charts), how the storefront reads it, the client-side cart, server-side checkout, orders and their lifecycle, stock, coupons, gift wrap, gift cards, the payment-provider layer in `src/cms/core/payments` (which booking also uses), webhooks and refunds, shipping (the legacy JSON engine and the newer zone/method tables), couriers and vouchers, abandoned carts, wishlists, reviews, product feeds, and the optional `customers` module (storefront accounts). It is written against the code in `src/cms/modules/commerce`, `src/cms/modules/customers`, `src/cms/core/payments`, `src/app/api/cms/**` and `src/app/[locale]/{shop,checkout,cart,order,account,wishlist}`. Older prose docs (`docs/ECOMMERCE.md`, `docs/ECOMMERCE-ADDENDUM.md`, `docs/user-guides/src/03-katastima.md`) predate parts of this. Where they disagree with the code, the code is correct.

Related guides: [01-architecture.md](01-architecture.md) · [02-database.md](02-database.md) · [03-content-model.md](03-content-model.md) · [04-admin-ui.md](04-admin-ui.md) · [05-auth-users-security.md](05-auth-users-security.md) · [06-media-seo-structured-data.md](06-media-seo-structured-data.md) · [07-forms-email-marketing.md](07-forms-email-marketing.md) · [09-booking.md](09-booking.md) · [10-settings-cron-operations.md](10-settings-cron-operations.md)

---

## 1. At a glance

| Concern | Where it lives | Storage |
|---|---|---|
| Products, categories, tags, size charts | Collection presets in `src/cms/modules/commerce/{collection,category,tag,sizechart}.ts` | `documents` (see 03) |
| Catalogue reads for the storefront | `src/cms/modules/commerce/read.ts`, `sizechart-read.ts`, `search.ts`, `compare.ts` | `documents` |
| Cart | Browser only: `src/components/shop/cart/CartProvider.tsx` (`localStorage`) | none on the server until checkout |
| Checkout and orders | `src/cms/modules/commerce/orders.ts`, `totals.ts`, `order-admin.ts` | `orders`, `order_items` |
| Stock movement | `src/cms/modules/commerce/stock.ts` | `documents.data.stock` / `data.variations[].stock` |
| Payments (commerce rows) | `src/cms/modules/commerce/payments.ts` | `payments` |
| Payment provider seam (shared with booking) | `src/cms/core/payments/*` | none (booking uses `reservation_payments`) |
| Shipping, legacy engine | `src/cms/modules/commerce/shipping.ts` | `site_settings['ecommerce.shipping']` |
| Shipping, methods engine | `shipping-methods.ts` (pure), `shipping-service.ts` (DB and routes) | `shipping_zones`, `shipping_methods`, `shipments` |
| Couriers | `src/cms/modules/commerce/couriers/*` | `integration_secrets` (BoxNow credentials) |
| Coupons | `src/cms/modules/commerce/coupons.ts` | `site_settings['ecommerce.coupons']` |
| Gift cards | `src/cms/modules/commerce/giftcards/*` | `gift_cards`, `gift_card_transactions`, `payments` |
| Abandoned carts | `src/cms/modules/commerce/abandoned.ts`, `unsubscribe.ts` | `abandoned_carts` |
| Wishlist | `wishlist.ts`, `wishlist-policy.ts` | `wishlist_items` (signed in), `localStorage` or cookie (guest) |
| Reviews | `src/cms/modules/commerce/reviews.ts` | `product_reviews` |
| Feeds (Skroutz, BestPrice, Shopflix, Google) | `src/cms/modules/commerce/feeds.ts`, `src/app/feeds/[feed]/route.ts` | `documents` |
| Customer accounts | `src/cms/modules/customers/*` | `customers`, `customer_addresses`, `customer_tokens` |

Module flags live in `src/site.config.ts` under `modules` (`commerce`, `customers`, both `false` in the base). `resolveModuleFlags` / `isModuleEnabled` (`src/cms/core/settings/modules.ts`) let a `module.<name>` row in `site_settings` override the config at runtime. Every commerce route binder in `src/app/api/cms/**` checks the flag itself and answers `404 {ok:false,error:'not_found'}` when the module is off. The module code in `src/cms/modules/commerce` never imports the site config. Anything site-specific (default locale, whether newsletter or customers are enabled) is passed in as a route-factory option.

---

## 2. File map

### 2.1 `src/cms/modules/commerce/`

| File | Responsibility |
|---|---|
| `index.ts` | Public barrel |
| `collection.ts` | `productCollection()` preset: the product field schema, plus `AVAILABILITY_VALUES`, `VISIBILITY_VALUES`, `BADGE_VALUES`, `CONDITION_VALUES`, `PRODUCT_TYPE_VALUES` |
| `category.ts`, `tag.ts`, `sizechart.ts` | `categoryCollection()`, `tagCollection()`, `sizeChartCollection()` presets |
| `sizechart-read.ts` | `projectSizeChart`, `getSizeChartForProduct` (checks the product first, then its categories) |
| `read.ts` | Storefront catalogue reads: `listProducts`, `getProduct`, `resolvePrice`, facets, filtering and sorting (`applyProductQuery`, `filterProducts`, `buildFacetCounts`, `priceBounds`), categories and tags (a category or tag page shows the term's row in its own locale, `pickTermRow`, and lists products related to any locale's row of it), grouped products, `formatPrice`, `getSiteCurrency` |
| `quantity.ts` | `quantityRules`, `clampQuantity`. Pure and client-safe, shared by the buy box, the cart drawer and checkout |
| `filters.ts` | `getPriceControl` (the `ecommerce.filters.priceControl` setting: slider or from/to fields) |
| `search.ts` | `searchProducts`, `createProductSearchRoute` (header search suggestions) |
| `compare.ts` | `getCompareData` (up to 4 products side by side) |
| `orders.ts` | `createOrder` (checkout), `saveOrder` (admin editor), `updateOrderStatus`, `lookupOrder`, listing, stats, CSV export, order emails, and every order route factory |
| `totals.ts` | `computeOrderTotals`. The only place the order total formula lives |
| `order-admin.ts` | Pure admin rules: `refundableAmount`, `orderStatusAfterRefund`, `planOrderLines`, `giftCardAmountsUsed`, `CLOSED_ORDER_STATUSES`, `refundStillOwed` |
| `order-status.ts` | `ORDER_STATUS_TRANSITIONS`, `canMoveOrderStatus`: the moves an admin may make. Pure and client-safe (`OrdersTable` imports it) |
| `orderable.ts` | `orderableRow`, `lineUnavailableReason`: whether a checkout line may be sold at all. Pure |
| `payments.ts` | Commerce `payments` rows: `getConfiguredPaymentProvider`, `recordPayment`, `capturePaymentByRef`, `refundOrderPayment`, `syncPaymentsForOrderStatus`, `listPaymentsForOrder`. Also re-exports the core seam |
| `stock.ts` | `decrementStockForOrder`, `restockOrder`, `availableStock`, `applyStockDelta` |
| `stale-orders.ts` | `cancelStaleOrders` cron job, and the pure planner `planStaleOrderCancellations` |
| `shipping.ts` | Legacy engine: `getShippingConfig`, `computeShipping`, `quoteShipping`, pickup helpers, `createShippingQuoteRoute` |
| `shipping-methods.ts` | Pure methods engine: `quoteMethods`, `checkShippingMethod`, `normalizeCountry`, `trackingUrlFor`, `COURIER_LABELS`, `COURIER_SECRET_DEFS`, `shipmentActions` |
| `shipping-service.ts` | Zones, methods and shipments against the DB, `resolveShippingChoices`, `createShipment`, admin routes, `boxNowLockersRoute`, `courierCredentialsRoute` |
| `couriers/index.ts` | `CourierAdapter` interface, `COURIERS` registry, `courierFor` |
| `couriers/boxnow.ts` | BoxNow adapter: token and locker caches, `createVoucher`, `listLockers` |
| `coupons.ts` | `getCoupons`, `normaliseCoupon`, `validateCoupon`, `computeDiscount`, usage counting, `quoteCoupon`, `createCouponRoute` |
| `giftcards/policy.ts` | Pure logic: code generation and hashing, `applyGiftCards`, `planGiftCardRefund`, `parseGiftCardConfig` |
| `giftcards/service.ts` | DB side: `redeemGiftCards`, `reverseGiftCardRedemptions`, `issueGiftCardsForOrder`, `deliverDueGiftCards`, `expireGiftCards`, `creditGiftCard`, `quoteGiftCards` |
| `giftcards/rules.ts` | `validateGiftCardPurchase`, `isGiftCardAmountAllowed`, `giftCardHistory`, `deliverIssuedGiftCard` |
| `giftcards/routes.ts` | Public check and quote routes; admin list, history, issue and void |
| `giftcards/settle.ts` | `settleFullyCoveredOrder` (an order paid entirely by gift cards) |
| `giftcards/emails.ts` | `sendGiftCardEmail` |
| `abandoned.ts` | Cart capture and recovery, the reminder job, admin list, delete and remind routes |
| `unsubscribe.ts` | Unsubscribe from abandoned-cart reminders (GET confirms, POST acts) |
| `wishlist.ts`, `wishlist-policy.ts` | Server half (setting, live resolve, customer rows) and the pure half (cookie format, merge) |
| `reviews.ts` | Submission, verified-purchase rule, rating aggregate, moderation routes |
| `feeds.ts` | Skroutz, BestPrice and Shopflix XML (`<mywebstore>`), Google Merchant RSS |
| `quote.ts` | `submitQuote`, `createQuoteRoute`. The older "request a quote" flow |

### 2.2 `src/cms/core/payments/`

| File | Responsibility |
|---|---|
| `index.ts` | Provider-agnostic contract (`PaymentProvider`, `PaymentStartContext`, …), the registry (`registerPaymentProvider`, `getPaymentProvider`), `manualProvider`, `encodePaymentSubject` / `decodePaymentSubject`. No DB and no `server-only` |
| `register.ts` | Side-effect module that registers `stripeProvider`, `paypalProvider` and `vivaProvider`. Import it in every route that resolves a provider |
| `stripe.ts` | Stripe PaymentIntents (in-page Payment Element) and refunds |
| `paypal.ts` | PayPal Orders v2 (hosted redirect), capture, refund, webhook verification |
| `viva.ts` | Viva.com Smart Checkout (hosted redirect), transaction confirmation, refund |
| `events.ts` | Pure reduction of Stripe, PayPal and Viva events to a `PaymentOutcome` |
| `webhooks.ts` | The three webhook route factories and the dispatch (`applyOutcome` → `applyToOrder` / `applyToReservation`), plus `settleCapturedOrder` |
| `refunds.ts` | Refund claim arithmetic shared by commerce and booking: `refundedSoFar`, `withRefundClaim`, `resolveRefundAmount`, `reconcileProviderRefund`, and `refundTargetRef` (the id a provider's refund call targets) |

### 2.3 `src/cms/modules/customers/`

| File | Responsibility |
|---|---|
| `token.ts` | Customer JWT (`cms_customer` cookie, audience `cms-customer`, key derived by HKDF from `ADMIN_SESSION_SECRET`, 30-day TTL) |
| `session.ts` | Cookie set, read and clear |
| `guards.ts` | `requireApiCustomer` (401 or row), `readCurrentCustomer` (pages). Both compare `token_version` |
| `policy.ts` | Pure rules: `normalizeCustomerEmail`, `isActiveCustomer`, `canClaimGuestOrders`, `publicCustomer`, `anonymisedCustomer`, address flags, export shape |
| `tokens.ts` | One-time verify and reset tokens (only the sha256 is stored) |
| `service.ts` | Register, authenticate, verify, reset, change password, profile, addresses, `claimGuestOrders`, orders, export, delete (anonymise) |
| `checkout.ts` / `checkout-service.ts` | `planCheckoutAccount` (pure), `checkoutPrefill`. `resolveCheckoutCustomerId` and `attachCheckoutAccount` are the checkout binder's hooks |
| `routes.ts` | Storefront account route factories |
| `admin.ts` / `admin-routes.ts` | Admin list, detail, status and resend verification |
| `emails.ts` | Verify, reset, password-changed and already-registered emails |

### 2.4 Admin UI (`src/cms/admin/`, `src/app/admin/(shell)/`)

`OrdersTable.tsx` (list, editor, status pills), `OrderFulfilment.tsx` (payments and refunds, delivery info, shipments), `GiftCardsTable.tsx`, `GiftCardSettings.tsx`, `CouponsManager.tsx`, `ShippingSettings.tsx`, `ShippingMethodsManager.tsx`, `CourierCredentials.tsx`, `AbandonedCartsTable.tsx`, `ReviewsTable.tsx`, `CustomersTable.tsx`, `fields/VariationsEditor.tsx`. Pages: `orders/`, `gift-cards/`, `abandoned/`, `reviews/`, `customers/`, plus the Ecommerce tab of `settings/page.tsx`.

### 2.5 Storefront (`src/app/[locale]/`)

| Path | Purpose |
|---|---|
| `shop/page.tsx` | Catalogue listing and search (`?q=`, `sort`, `page`, `price_min`, `price_max`, `tag`, `attr_<name>`; parsed by `shop/shop-params.ts`) |
| `shop/[slug]/page.tsx` | Product detail (showcase, variations, grouped parts, gift card buy box, reviews, size chart, structured data) |
| `shop/category/[slug]/page.tsx`, `shop/tag/[slug]/page.tsx` | Category and tag listings, same query model |
| `shop/compare/page.tsx` | Compare page (`CompareClient`) |
| `checkout/page.tsx`, `checkout/CheckoutClient.tsx` | Checkout form. Coupon, shipping quote and method chooser, gift cards, gift wrap, account creation, Stripe panel |
| `cart/recover` | Abandoned-cart recovery landing (`RecoverCartClient`) |
| `order/` | Guest order lookup and payment return page (`?ref=`) |
| `account/**` | Customer account pages (login, register, verify, forgot, reset, profile, addresses, orders, privacy) |
| `wishlist/` | Wishlist page |

All shop pages are `dynamic = 'force-dynamic'` and call `notFound()` when commerce is off.

---

## 3. Data model

All tables are MySQL via Drizzle. Schema files: `src/cms/db/adapters/mysql/schema/{commerce,shipping,giftcards,customers,wishlist,abandoned,reviews}.ts`. Commerce-relevant migrations: `0002` (orders, order_items, payments), `0004` (product_reviews), `0005` (abandoned_carts), `0007` (`orders.version`), `0009` (`order_items.variation_id`, `UNIQUE(payments.provider, provider_ref)`), `0018` (customers, and `orders.customer_id`), `0019` (wishlist_items), `0021` (shipping_zones, shipping_methods, shipments, `orders.shipping_method_id`), `0022` (gift_cards, gift_card_transactions). The commerce.ts header still calls these tables "DORMANT (Phase 4)". That is also stale.

**Money:** every `int` money column is in minor units (cents). Product prices in `documents.data` are major units (`data.price = 49.99`). The conversion is `toMinor = Math.round(major * 100)` in `orders.ts`, and `toCents` in `shipping.ts` and `coupons.ts`.

### 3.1 Products live in `documents`

A product is a `documents` row with `type = 'product'` (`DEFAULT_PRODUCT_TYPE`), one row per locale, sharing `slug` and `translation_group_id`. Fields marked `shared: true` in `collection.ts` (price, compareAtPrice, sku, stock, weight, variations, quantity limits, merchant fields) are kept in step across locale rows. Stock writes in `stock.ts` update **every** locale row of the slug. Key `data` keys:

| Key | Notes |
|---|---|
| `title`, `subtitle`, `description`, `gallery[]` | Display |
| `categories[]`, `tags[]`, `sizeChart` | Relations (document ids) |
| `price`, `compareAtPrice` | Major units. A `sale` badge is derived from `compareAtPrice` and is never stored |
| `sku`, `availability` (`in-stock`, `out-of-stock`, `preorder`, `made-to-order`), `stock` | Empty `stock` means untracked (unlimited) |
| `weight`, `weightUnit`, `dimensionUnit`, `dimensions{}` | Weight feeds both shipping engines. `lineWeight` reads it as a plain number (assumed kg) |
| `attributes[]` (`id`, `name`, `swatchType`, `filterDisplay`, `values[]`) | Localised labels |
| `variations[]` (`id`, `options{attrId: valueId}`, `price?`, `stock?`, `sku?`, `weight?`, `enabled?`, `image?`) | A variation's price, stock and SKU override the product's |
| `specs[]` | Label and value rows |
| `productType` (`standard`, `grouped`, `external`, `digital`, `giftcard`) | Changes how the product is bought |
| `components[]` (grouped), `externalUrl` / `externalLabel` (external), `downloads[]` / `downloadLimit` / `downloadExpiryDays` (digital) | Download fields are schema only. No code delivers files or enforces the limits (grep finds them only in `collection.ts`) |
| `featured`, `visibility` (`visible`, `catalog`, `search`, `hidden`), `badges[]`, `badgeLabel`, `menuOrder` | Merchandising |
| `minQty`, `maxQty`, `qtyStep`, `soldIndividually` | Read by `quantityRules` |
| `brand`, `gtin`, `mpn`, `condition` | Feeds and structured data |

### 3.2 `orders`

| Column | Type | Notes |
|---|---|---|
| `id` | int PK | |
| `reference` | varchar(32) unique | `ORD-<year>-<10 Crockford base32 chars>` (`orderSuffix()`, about 50 bits). It is inserted first as a temporary UUID slice and then updated |
| `status` | enum `pending, paid, fulfilled, cancelled, refunded` | `orderStatusValues` |
| `email`, `customer_name`, `locale`, `notes` | | |
| `customer_id` | FK `customers.id`, on delete SET NULL | Set only from the session, never from the body |
| `shipping_method_id` | int, no FK | Chosen method. The name and cost are also snapshotted in metadata |
| `currency` | char(3), default `EUR` | |
| `subtotal`, `total` | int (minor) | `total` is the order's value. Gift cards do not reduce it |
| `metadata` | JSON | See below |
| `version` | int, default 1 | Optimistic-lock counter for the admin editor (F-068) |
| `created_at`, `updated_at` | timestamp | |

Indexes: `(status, created_at)`, `customer_id`, `email`.

`orders.metadata` shape (written by `createOrder`, merged by `saveOrder`, `moveOrderStock` and `flagOrderRefundRequired`):

```ts
{
  shipping: {
    phone, address1, city, postal, country,      // nullable strings
    virtual?: true,                               // digital or gift-card-only order
    method?: 'ship' | 'pickup',
    shippingMethod?: { id, name, courier, kind, cost },  // methods engine snapshot
    locker?: { id, name },                        // BoxNow locker
    pickup?: { id, name, address } | null,        // legacy store pickup
  },
  costs: { shipping, surcharge, discount, giftWrap },    // minor units
  coupon?: string,
  consent: { terms: true, marketing: boolean, at: ISO },
  gift?: { wrap: boolean, message: string | null },
  stockTaken?: boolean,        // stock.ts: are this order's units off the shelf
  stockFailure?: { at, lines[] },   // capture arrived but stock was short
  codAmount?: number,          // cash on delivery: what the courier collects (minor units)
  refundRequired?: { at, reason: 'captured_after_close' | 'stock_short', provider?, providerRef?, orderStatus? },
}
```

### 3.3 `order_items`

`order_id` (cascade), `product_id` (FK documents, SET NULL), `sku`, `name`, `variation_id` (the stable variation id, used for restock), `variant_label` (display text such as "Color: Red, Size: M", or `→ recipient` for a gift card), `unit_price`, `quantity`, `line_total` (minor), and `snapshot` (the full product `data` at purchase time; for a gift card line it also includes `giftCard: {amount, recipientName, recipientEmail, message, sendAt}`).

### 3.4 `payments`

| Column | Notes |
|---|---|
| `order_id` | cascade |
| `provider` | `manual`, `stripe`, `paypal`, `viva`, or `giftcard` (gift card redemptions) |
| `provider_ref` | Stripe PaymentIntent id; PayPal **order** id; Viva **order code** (16-digit string); `giftcard:<id>`; for refund rows, the refund id |
| `status` | enum `pending, authorized, captured, failed, refunded`. `authorized` is declared but nothing writes it |
| `amount` | minor. Refund rows are **negative** |
| `method`, `error` | |
| `metadata` | `captureId` (PayPal), `transactionId` (Viva capture; the refund target), `reversalTransactionId` (Viva reversal), `refundedAmount` (running refund claim), `refundOf` / `reason` (refund rows) |

`UNIQUE(provider, provider_ref)` (`uniq_payments_provider_ref`) is the webhook idempotency anchor.

### 3.5 Shipping tables

| Table | Columns |
|---|---|
| `shipping_zones` | `name` (unique), `countries` JSON (ISO alpha-2, upper-cased on write), `sort` |
| `shipping_methods` | `zone_id` (cascade), `name`, `courier` enum (`acs, speedex, elta, boxnow, pickup, custom`), `kind` enum (`address, locker, pickup`), `cost` (minor), `free_threshold` (minor, null means never free), `weight_tiers` JSON `{minWeight, charge}[]`, `eta_min_days`, `eta_max_days`, `cod_allowed`, `pickup_location_id`, `active`, `sort` |
| `shipments` | `order_id` (cascade), `courier`, `voucher`, `tracking_url`, `external_id`, `status` (default `created`; nothing updates it afterwards), `created_by` (admin user). `UNIQUE(courier, voucher)` |

### 3.6 Gift cards

| Table | Columns |
|---|---|
| `gift_cards` | `code_hash` (HMAC-SHA256 under `CMS_GIFTCARD_PEPPER`, unique), `code_last4`, `code_encrypted` (AES-GCM via `core/tokens/crypto`, so the card can be re-sent), `currency`, `initial_amount`, `balance`, `status` (`scheduled, active, void, expired`), `expires_at`, `order_id`, `order_item_id` (**unique**, the mint idempotency key), `purchaser_email`, `recipient_name`, `recipient_email`, `message`, `send_at`, `sent_at`, `issued_by` |
| `gift_card_transactions` | Ledger: `gift_card_id`, `type` (`issue, redeem, reversal, refund_credit, void, adjust, expire`), signed `amount`, `balance_after`, `order_id`, `payment_id`, `actor`, `note` |

### 3.7 Customers, wishlist, abandoned carts, reviews

| Table | Key points |
|---|---|
| `customers` | `email` unique (lower-cased), `password_hash` (null once anonymised), `email_verified_at`, `status` (`active, disabled`), `token_version`, `marketing_opt_in`, `deleted_at` |
| `customer_addresses` | `customer_id` (cascade), `label`, `name`, `phone`, `address1`, `address2`, `city`, `postal`, `country` (alpha-2), `is_default_shipping`, `is_default_billing` |
| `customer_tokens` | `purpose` (`verify_email`, `reset_password`), `token_hash` (sha256, unique), `expires_at`, `used_at` |
| `wishlist_items` | `(customer_id, product_id, variation_id)` unique. `variation_id` is NOT NULL, default `''` (MySQL treats NULLs as distinct in a unique key) |
| `abandoned_carts` | `token` (UUID, unique), `email`, `items` JSON (client cart lines, major units), `subtotal` (minor), `status` (`pending, reminded, converted`), `reminder_sent_at`, `recovered_at` |
| `product_reviews` | Keyed by `product_group_id` (translation group) so a review shows in every locale. `product_id` (SET NULL), `rating` 1–5, `status` (`pending, approved, rejected`), `verified` |

Coupons, the shipping config, the gift card config, the wishlist config, the gift-wrap fee and the currency are **not** tables. They are `site_settings` keys (section 7).

---

## 4. How it works

### 4.1 Catalogue reads (`read.ts`)

- `listProducts(locale, {limit})` calls `listPublishedDocuments('product', locale)` and projects each document into a `ProductSummary` (price range, badges, facets, tags, visibility). These are cached published reads, revalidated by document tags (see 03).
- The shop, category and tag pages load **all** published products (`limit: 1000` on `shop/page.tsx`), then filter, sort and paginate in memory: `filterByVisibility` → `applyProductQuery` (page size capped at 48) and `buildFacetCounts` (counts across the whole filtered set, not one page). This is fine for small catalogues. It will not scale to thousands of SKUs.
- Visibility: `catalog` context shows `visible` and `catalog`; `search` (when `?q=` is present) shows `visible` and `search`. `hidden` products are reachable only by URL. Detail pages do not filter on visibility.
- Default sort (`newest`) keeps source order and floats `featured` to the top. `manual` sorts by `menuOrder`.
- The price filter matches on range overlap (`productPriceRange`), so variations are included.
- `resolvePrice(data, variationId)` returns the variation price if one is set, otherwise the base price. If `variationId` matches no variation, it silently returns the base price.
- Grouped products: `getGroupedComponents` resolves `components[].product` (a document id in one locale) through its slug to the published row in the requested locale.

### 4.2 Cart (browser only)

`CartProvider` keeps `CartItem[]` in `localStorage` (`STORAGE_KEYS.cart`). `unitPrice` there is major units and **display only**. A line's key is the slug plus the variation (and, for gift cards, the gift card choices). Quantity limits are enforced client-side with the same `clampQuantity` the server uses. Nothing reaches the server until the checkout form captures an abandoned cart or places the order.

### 4.3 Checkout sequence

`POST /api/cms/commerce/checkout` → `src/app/api/cms/commerce/checkout/route.ts` (module gate, `import '@/cms/core/payments/register'`) → `createCheckoutRoute(opts)` → `createOrder()`.

```
Browser (CheckoutClient)                Server
------------------------                ------------------------------------------------------------
1. coupon  ────────────────────────────> POST /commerce/coupon         quoteCoupon (advisory only)
2. address/country ────────────────────> POST /commerce/shipping-quote quoteShipping + resolveShippingChoices
3. gift card codes ────────────────────> POST /commerce/gift-cards/quote  quoteGiftCards (no spend)
4. email typed ────────────────────────> POST /commerce/abandoned-cart captureCart (best effort)
5. Place order ────────────────────────> POST /commerce/checkout
                                          createCheckoutRoute:
                                           a. zod checkoutBody, rate limit 10/min
                                           b. marketingOptIn &&= newsletterEnabled()
                                           c. resolveAccount() -> customerId from session only
                                           d. createOrder():
                                              - reject empty cart / !acceptTerms
                                              - load currency, shipping config, configured provider,
                                                coupons, gift wrap fee, gift card config (parallel)
                                              - pickup checks; advisory coupon usage check
                                              - BEGIN TRANSACTION
                                                for each line:
                                                  SELECT documents WHERE type='product' AND slug=? FOR UPDATE
                                                  orderableRow: published row in locale / any published (none -> 400)
                                                  lineUnavailableReason: external, unknown/disabled variation,
                                                    untracked + availability out-of-stock -> 400
                                                  gift card line -> validateGiftCardPurchase, qty = 1
                                                  else qty = clampQuantity(quantityRules(data))
                                                  ensureStock (check only, no decrement)
                                                  unitPrice = toMinor(resolvePrice) (or gift card amount)
                                                validateCoupon + couponUsageErrorLocked (under lock)
                                                require address unless all-virtual or pickup
                                                shipping: methods engine if shippingMethodId, else computeShipping
                                                computeOrderTotals -> total
                                                INSERT orders (temp ref) -> UPDATE reference ORD-YYYY-XXXXXXXXXX
                                                INSERT order_items
                                                redeemGiftCards(tx) -> amountDue
                                                offline provider + courier delivery -> metadata.codAmount = amountDue
                                              - COMMIT
                                              - amountDue == 0 -> settleFullyCoveredOrder -> return
                                              - provider.start({subject:'order', amount: amountDue, returnUrl})
                                              - recordPayment(status from start)
                                              - offline (manual) -> decrementStockForOrder now
                                              - newsletter opt-in (best effort)
                                              - markConvertedByEmail (abandoned cart)
                                           e. attachAccount() (never fails the order)
                                           f. sendOrderEmails() (customer + admin, best effort)
                                         <- { reference, redirectUrl, clientSecret }
6. redirectUrl -> window.location (PayPal / Viva)
   clientSecret -> <StripeCardPanel> confirms in page, returnUrl /order?ref=...
   neither -> manual: show confirmation
7. Gateway -> POST /api/cms/payments/webhooks/<provider>  (section 4.6)
```

Server-authoritative points worth knowing:

- Prices, quantities, stock, coupon discount, shipping, surcharge and gift wrap are all recomputed server-side. Client prices are ignored.
- `FOR UPDATE` on every locale row of each product serialises concurrent checkouts on the same product. The coupon usage recount runs under the same transaction (`couponUsageErrorLocked`), which closes the race on single-use codes.
- The whole cart checks out in the request's `locale` (`items.map(it => ({...it, locale: input.locale}))`).
- `customerId` comes from `resolveCheckoutCustomerId()` (cookie, then DB row, `token_version` and `status` checks), never from the body.
- `giftWrap` adds `ecommerce.giftWrapFee`, but only when the box is ticked.
- Order emails (`sendOrderEmails`) go out at checkout for **every** provider, before any money is confirmed. The customer text says "we received your order", not "paid".

### 4.4 Totals

`computeOrderTotals` (`totals.ts`):

```
total     = max(0, subtotal − discount + shipping + surcharge + giftWrap)
tendered  = Σ min(tender, total − tendered)        // gift cards
amountDue = total − tendered                       // what the gateway is asked for
```

Every input must be a non-negative safe integer. A fraction throws `RangeError`, which usually means a caller forgot to convert to minor units. Discounts apply to the item subtotal only (`computeDiscount` caps at the subtotal). The free-shipping threshold (either engine) discounts shipping, never the payment surcharge. **Prices are VAT-inclusive** (the `shipping.ts` header says "VAT is included in prices, so there is no tax line"), and there is no tax computation anywhere in the module.

### 4.5 Order lifecycle / state machine

Order status (`orders.status`):

```
                 capture webhook (settleCapturedOrder, stock OK)
                 full gift-card cover (settleFullyCoveredOrder)
                 admin PATCH status=paid (manual transfer confirmed)
   ┌─────────┐ ───────────────────────────────────────────────▶ ┌──────┐   admin PATCH   ┌───────────┐
   │ pending │                                                  │ paid │ ──────────────▶ │ fulfilled │
   └─────────┘ ◀── created by createOrder / saveOrder(null)     └──────┘                 └───────────┘
      │  │                                                          │ full refund (admin route         │
      │  │ stale job (TTL, onlyFrom:'pending')                      │ or provider webhook,             │
      │  │ capture but stock short                                  │ unlessAlready)                    │
      │  │ admin PATCH                                              ▼                                   │
      │  └──────────────▶ ┌───────────┐                       ┌──────────┐ ◀──────────────────────────┘
      │                   │ cancelled │                       │ refunded │
      └── admin PATCH ──▶ └───────────┘                       └──────────┘
```

The admin's moves are limited by `ORDER_STATUS_TRANSITIONS` (`order-status.ts`): pending → paid or cancelled; paid → fulfilled, refunded or cancelled; fulfilled → refunded; cancelled and refunded are final. `orderUpdateRoute` refuses anything else with 409 and makes the move with `onlyFrom: <the status it checked>`, so a move made meanwhile is not overwritten (409 again). The status pills in `OrdersTable` disable the moves the map does not allow. The system's own moves (webhooks, stale job, refunds) call `updateOrderStatus` directly and are not limited by the map. Side effects all live in `updateOrderStatus(id, status, {onlyFrom?, unlessAlready?})`:

| New status | Side effects (in order) |
|---|---|
| any | `UPDATE orders SET status` (conditional on `onlyFrom` / `unlessAlready`; returns `null` and does nothing else if 0 rows changed); `syncPaymentsForOrderStatus` (manual rows only: `paid`→`captured`, `refunded`→`refunded`) |
| `cancelled`, `refunded` | `restockOrder` (idempotent via `metadata.stockTaken`), then `reverseGiftCardRedemptions` (idempotent via existing `reversal` ledger rows) |
| `paid` | `issueGiftCardsForOrder` (idempotent per `order_item_id`, errors swallowed) |
| `fulfilled`, `cancelled`, `refunded` | `sendOrderStatusEmail` (el/en templates in `EMAIL_LABELS`). There is no email for `paid` |

`settleFullyCoveredOrder` writes `status='paid'` **directly**, without going through `updateOrderStatus`. It decrements stock and issues gift cards itself.

Payment row status (`payments.status`):

```
start(): pending ──capture webhook──▶ captured ──webhook reports full refund──▶ refunded
            └────failure webhook────▶ failed
manual:  pending ──admin marks order paid──▶ captured ──admin marks refunded──▶ refunded
giftcard:  captured (written at redemption)
admin refund: capture row stays 'captured' with metadata.refundedAmount += n,
              plus a NEW row {status:'refunded', amount:-n, metadata.refundOf}
```

Stock (`metadata.stockTaken`):

| Event | Stock |
|---|---|
| Checkout with `manual` provider | Decremented immediately after the order commits |
| Checkout with an online provider | Checked only. Decremented at the capture webhook (`settleCapturedOrder`) |
| Full gift-card cover | Decremented in `settleFullyCoveredOrder` |
| Capture webhook when stock is short | Nothing is decremented. `metadata.stockFailure` and `metadata.refundRequired` (`stock_short`) are written and the order is set to `cancelled`. The money is not refunded automatically: the admin panel shows a red notice until the payment is refunded under Payments |
| Capture webhook on a `cancelled` / `refunded` order | Nothing is decremented and the status is not changed. `metadata.refundRequired` (`captured_after_close`) is written; same notice |
| `cancelled` / `refunded` | `restockOrder`, but only if `stockTaken === true` |
| Admin editor save (`saveOrder`) | Never touches stock, payments or email |

`moveOrderStock` locks the order row and every product locale row, refuses a sale if **any** line is short (all-or-nothing), skips lines whose product was deleted, clamps at 0, writes all locale rows, flips `stockTaken` in the same transaction, then calls `revalidateDocument` on the affected rows.

### 4.6 Payments: providers, intents, webhooks

**Contract** (`core/payments/index.ts`):

```ts
interface PaymentProvider {
  key: string; label: string;
  start(ctx: PaymentStartContext): Promise<PaymentStartResult>;   // {status, providerRef?, redirectUrl?, clientSecret?, method?, error?}
  refund?(ctx: PaymentRefundContext): Promise<PaymentRefundResult>; // optional; absent = refunded out of band
}
PaymentStartContext = { subject: 'order' | 'reservation', subjectId, reference, amount /*minor*/, currency, email, returnUrl? }
```

The registry is seeded with `manualProvider`. `getPaymentProvider(key)` **falls back to manual** for unknown keys. Next.js builds a separate module graph per route bundle and there is no boot hook, so any route that resolves a provider must `import '@/cms/core/payments/register'`. Routes that do: checkout, `commerce/shipping-quote`, `orders/[id]`, `orders/[id]/refund`, the three webhooks, the admin settings page, and the booking pay, refund and payment-link routes. The shop uses **one provider site-wide**, chosen by `ecommerce.paymentProvider` (`getConfiguredPaymentProvider`). The customer does not pick a provider at checkout.

| Provider | `start()` | `providerRef` stored | Capture signal | Refund target |
|---|---|---|---|---|
| `manual` | returns `pending`, no redirect | none | Admin sets the order to `paid` | none (no `refund`) |
| `stripe` | `paymentIntents.create` with `automatic_payment_methods`, metadata `{subject, subjectId, reference}`, idempotency key `order:<id>:<amount>` → `clientSecret` | PaymentIntent id | `payment_intent.succeeded` | `refunds.create({payment_intent})` |
| `paypal` | `POST /v2/checkout/orders` (intent CAPTURE, `custom_id = order:<id>`, return and cancel URL = `returnUrl`) → approval `redirectUrl` | PayPal order id | `CHECKOUT.ORDER.APPROVED` (the handler **calls capture itself**) or `PAYMENT.CAPTURE.COMPLETED`; `captureId` stored in metadata | `POST /v2/payments/captures/{captureId}/refund` |
| `viva` | `POST /checkout/v2/orders` (cents, `paymentTimeout: 1800`) → Smart Checkout URL. `returnUrl` is **not** sent; it is configured on the payment source in the Viva portal | order code (string, extracted from raw JSON to avoid precision loss) | Event 1796, **re-read** via `confirmTransaction` (status `F`) | `DELETE /api/transactions/{id}` (Basic auth) against the **transaction** id the webhook stored as `metadata.transactionId` (`refundTargetRef`) |

**Webhooks** (`core/payments/webhooks.ts`). There is one endpoint per provider, shared by commerce and booking. The route binders answer 404 only when both modules are off.

| Route | Authentication | Events acted on |
|---|---|---|
| `POST /api/cms/payments/webhooks/stripe` | `stripe.webhooks.constructEvent(raw, stripe-signature, STRIPE_WEBHOOK_SECRET)`. Invalid → 400 | `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded` (uses `amount_refunded` as the running total) |
| `POST /api/cms/payments/webhooks/paypal` | `verifyPayPalWebhook` (remote `/v1/notifications/verify-webhook-signature` with `PAYPAL_WEBHOOK_ID`). Any failure → 400 | `CHECKOUT.ORDER.APPROVED` (capture), `PAYMENT.CAPTURE.COMPLETED`, `.DENIED`, `.DECLINED`, `.REFUNDED` |
| `GET /api/cms/payments/webhooks/viva` | Returns `{"Key": VIVA_WEBHOOK_VERIFICATION_KEY}` for Viva's registration handshake. 404 if unset | — |
| `POST /api/cms/payments/webhooks/viva` | **Unsigned.** The payload is only a hint. `confirmTransaction(transactionId)` reads the truth over OAuth, and `amountMatches` checks it against our row | 1796 captured, 1797 reversal (refund), 1798 failed |

All three use `createRoute({sameOrigin: false})` with no `input:` schema, because the signature is computed over the raw body, which is read with `req.text()`. They rate-limit at 120/min. Unknown or foreign payments return 200 with `handled:false`, so the gateway stops retrying. A Viva confirmation failure returns 500, so Viva retries.

Dispatch: `applyOutcome` → `applyToOrder` (subject `order`) or `applyToReservation` (subject `reservation`). Viva events carry no subject, so the handler tries reservation first, then order. At most one table can hold the `(provider, provider_ref)` pair. Module code is imported lazily so neither module depends on the other. `applyToOrder`:

1. `capturePaymentByRef` locks the row by `(provider, providerRef)` with `FOR UPDATE`. No row → `orderId: null`. Same status already → no-op (**replay safe**). A refund of a captured row is reconciled with `reconcileProviderRefund` and marks the row `refunded` only when nothing remains. Otherwise it sets the status and merges metadata, and returns `captured: true` only for the call that performed the transition.
2. Refund with `remaining <= 0` → `updateOrderStatus(id, 'refunded', {unlessAlready: true})`.
3. `captured: true` → `settleCapturedOrder`. The stock move is refused under the order lock when the order is `cancelled` or `refunded` (`unlessStatus: CLOSED_ORDER_STATUSES`): the order stays closed and is flagged `refundRequired: captured_after_close`. Otherwise it takes the stock and marks the order `paid` with `onlyFrom: 'pending'` (an order the stale job closed in between is flagged instead; one an admin already moved on is left alone), then issues gift cards. When stock is short it records `stockFailure`, flags `refundRequired: stock_short` and cancels. No refund is made automatically: `getAdminOrder` returns `refundDue` (`refundStillOwed`) while a flagged order still has refundable money, and `OrdersTable` shows it.

### 4.7 Refunds

Admin: `POST /api/cms/orders/[id]/refund {paymentId, amount?, reason?}` → `refundOrderPayment` → `orderStatusAfterRefund` → `updateOrderStatus(..., {unlessAlready:true})` if the refund was full → audit `order.refund`.

`refundOrderPayment`:

1. Transaction, `SELECT payments … FOR UPDATE`. The row must belong to `orderId` (checked **before** the provider is called), `status === 'captured'`, and the provider must have `refund`.
2. `resolveRefundAmount({capturedAmount, alreadyRefunded: metadata.refundedAmount, requested})` → write `metadata.refundedAmount += amount` (**the claim**) → commit.
3. Target = `refundTargetRef(row)` (`core/payments/refunds.ts`): Viva → `metadata.transactionId` (no fallback: the order code is never a valid target, so the claim is released and 409 returned); others → `metadata.captureId` if present, otherwise `provider_ref`. A Viva reversal webhook stores its own id as `reversalTransactionId` so it cannot overwrite the capture's.
4. Call `provider.refund`. If the provider answers `failed`, the claim is released and the handler returns 409. If the call **throws**, the claim is kept and the error is rethrown: the result is ambiguous, and holding the claim prevents a double refund. An operator then has to clear `metadata.refundedAmount` by hand once the gateway state is known. The three shipped providers catch their own errors and return `failed`, so in practice the throw path is rare.
5. Insert a negative `refunded` row with `metadata.refundOf`.

A partial refund leaves the order status alone. Only a full refund moves it to `refunded`, which restocks and reverses gift cards. The provider's refund webhook applies the same rule, and `unlessAlready` stops a second email. `OrderFulfilment` gets `refundable` per payment from `getAdminOrder` (`refundableAmount`: captured, positive, provider can refund online, minus the claim). Manual and gift card rows always report 0.

The "Mark refunded" and "Cancel" status pills in `OrdersTable` do **not** move money (`ORDER_STATUS_CONFIRM`).

### 4.8 Stale-order cancellation

The cron job `commerce-stale-orders` → `cancelStaleOrders`. TTL is `ecommerce.pendingOrderTtlHours` (default 48; 0 turns it off; anything unparseable falls back to the default). A candidate order is `pending`, older than the TTL, has at least one payment, has **no** `manual` payment, and has no payment in `authorized` or `captured`. The batch size is 200. Each candidate is cancelled with `onlyFrom: 'pending'`, so a capture that lands in the meantime wins.

### 4.9 Shipping

There are two engines. `createOrder` chooses between them per request:

```
allVirtual                     -> shipping = surcharge = 0
body.shippingMethodId present  -> methods engine: resolveShippingChoices(...) must contain that id,
                                  locker kind requires lockerId; cost/surcharge from the quote
otherwise                      -> legacy computeShipping(ecommerce.shipping, ...)
```

**Cash on delivery.** The shop has one payment provider, so an order is paid on delivery when that provider is offline (`manual`, also the key the COD surcharge is configured on). Then `resolveShippingChoices` gets `codSelected: true` (checkout and the shipping estimate), so methods with `cod_allowed` off are not offered, and `createOrder` writes `metadata.codAmount = amountDue` (after gift cards) for an order a courier delivers (not a download, not a pickup). `saveOrder` rebases it on the edited total (`rebaseCodAmount`). The legacy engine has no per-method COD flag.

**Legacy engine** (`shipping.ts`, settings key `ecommerce.shipping`, charges in major units): `method` is `flat`, `weight` (base plus the highest `weightTiers[].minWeight` reached) or `zone` (country match on `zones[].countries`, else `baseCharge`). `freeThreshold` applies to all three. `paymentSurcharges[]` are keyed by provider (e.g. a COD fee on `manual`). `pickup {enabled, charge, locations[]}` handles store collection: pickup charges `pickup.charge` and ignores zones, tiers and the threshold.

**Methods engine** (`shipping-methods.ts` pure, `shipping-service.ts` DB): `resolveShippingChoices` returns `[]` when no methods exist, so the legacy engine keeps working unchanged. Otherwise it normalises the country (`normalizeCountry` maps a few Greek and Cypriot spellings to `GR` / `CY`), picks the first zone by `sort` that contains the country, and returns the zone's active methods with `cost = base + weightCharge` (0 above `freeThreshold`) and `surcharge` from the legacy `paymentSurcharges`. Surcharges live in one place for both engines. `checkShippingMethod` refuses a `locker` method whose courier is not BoxNow, a `pickup` method whose pickup location does not exist, and ETA min greater than max.

The storefront quote route (`POST /api/cms/commerce/shipping-quote`) returns both the legacy estimate and `methods`. It imports `payments/register`, so it resolves the same provider (and surcharge) as checkout, and it applies the same cash-on-delivery rule (below). For the methods list it uses the **client-supplied `subtotalCents`** and `totalWeight: 0`, so a weight-tiered method can show a lower price than checkout will charge. Checkout re-quotes with real weight and subtotal.

### 4.10 Couriers, vouchers and shipments

`CourierAdapter` (`couriers/index.ts`): `{key, label, createVoucher?, listLockers?, trackingUrl}`.

| Courier | Book from CMS | Lockers | Tracking URL |
|---|---|---|---|
| `acs`, `speedex`, `elta` | No. Book in their portal and paste the voucher | — | yes (`TRACKING_URLS`) |
| `boxnow` | Yes: `POST {BOXNOW_API_URL}/delivery-requests` | Yes: `/destinations/`, cached 24 h, prefix-filtered by postcode, max 50 | `https://boxnow.gr/track/…` |
| `pickup`, `custom` | No | — | none |

BoxNow credentials are integration secrets `courier.boxnow.clientId` and `courier.boxnow.clientSecret` (`COURIER_SECRET_DEFS`), stored encrypted through `core/secrets` and edited in `CourierCredentials.tsx` via `GET/POST /api/cms/shipping/couriers` (`secretsRoutes`: `settingsRead` / `settingsWrite`, write-only values). The access token is cached in memory until 60 s before expiry. `BOXNOW_API_URL` defaults to the **stage** API (`https://api-stage.boxnow.gr/api/v1`).

Voucher flow: the admin clicks Create voucher in `OrderFulfilment` → `POST /api/cms/orders/[id]/shipments {courier, voucher?}` → `createShipment`. When a voucher is supplied, the handler only records it and builds the tracking URL. Without one, it calls `adapter.createVoucher` using `metadata.shipping.locker.id`, the phone, the email, and `codAmount` (only when the order is not `paid`). `codAmount` is written at checkout for cash-on-delivery orders (section 4.9), so a BoxNow voucher for an unpaid COD order is booked `cod`; a prepaid or already-paid order is booked `prepaid`. It then inserts into `shipments` (unique per courier and voucher) and writes an `order.shipment` audit row. Creating a shipment does **not** change the order status. Moving to `fulfilled` is a separate admin action.

### 4.11 Coupons

Coupons are stored as a JSON array in `ecommerce.coupons`, edited by `CouponsManager`. `normaliseCoupon` coerces the values on read (percent clamped to 0–100). Validation (`validateCoupon`) is case-insensitive and checks `active`, expiry (`expiresAt` plus a one-day grace), `minSubtotal` (major units), then the discount. Usage limits are **derived from orders** (`json_extract(metadata,'$.coupon')`, excluding cancelled and refunded). There is no redemption table. The public coupon route ignores the `email` it receives: per-customer limits are enforced only at checkout.

### 4.12 Gift cards

Config: `ecommerce.giftCards` → `parseGiftCardConfig` `{enabled, presets[] (minor), allowCustom, minAmount (default 1000), maxAmount (default 50000), expiryMonths (default 24, 0 means never)}`. `CMS_GIFTCARD_PEPPER` (at least 32 chars) is required for any issue, redeem or lookup.

- **Purchase:** a product with `productType: 'giftcard'`. Each cart line carries `giftCard {amount, recipientEmail, …, sendAt}`. `validateGiftCardPurchase` checks the amount against the config. Quantity is forced to 1, the line is virtual (no shipping), and the choices are stored on `order_items.snapshot.giftCard`.
- **Minting:** `issueGiftCardsForOrder` runs when the order becomes `paid` (webhook, full gift-card cover, or admin). It creates one card per line in `scheduled` status, with `send_at` set to the chosen date or now. Idempotent through `UNIQUE(order_item_id)` and a pre-check.
- **Delivery:** the cron job `giftcard-deliver` → `deliverDueGiftCards` claims `sent_at` conditionally, sets the card `active`, decrypts the code and emails it. A failed send leaves `sent_at` set, and an admin can re-send. Hand-issued cards (`POST /api/cms/gift-cards`) are `active` immediately.
- **Redemption:** inside the checkout transaction, `redeemGiftCards` locks each card by hash, runs `applyGiftCards` (card must be usable, same currency, up to the balance and the amount due), then for each card makes a ledger `movement` (a conditional `UPDATE … WHERE balance = <read>`) and inserts a `payments` row `{provider:'giftcard', providerRef:'giftcard:<id>', status:'captured'}`. Gift cards are a tender, not a discount: `orders.total` is unchanged.
- **Reversal:** on `cancelled` or `refunded`, `reverseGiftCardRedemptions` writes `reversal` rows (once per order).
- **Expiry:** the cron job `giftcard-expire` sets `active` cards past `expires_at` to `expired`.
- **Public balance check:** `POST /api/cms/commerce/gift-cards/check` (5/min plus captcha) gives one uniform "cannot be used" answer for every failure.
- `planGiftCardRefund` and `creditGiftCard` exist but nothing calls them. Partial refunds onto a gift card are not wired up.

### 4.13 Abandoned carts

`CheckoutClient` posts `{email, items}` to `POST /api/cms/commerce/abandoned-cart` (20/min) → `captureCart`. Reminders go out `COMMERCE_ABANDONED_DELAY_MINUTES` (default 60) after capture, capped at `COMMERCE_ABANDONED_DAILY_MAX` (default 200) per rolling 24 h. Recipients on the suppression list are skipped. Reminders are triggered by the cron job `commerce-abandoned-reminders`, or by `POST /api/cms/abandoned-carts/remind` (header `x-cron-secret: COMMERCE_CRON_SECRET`, checked with `authorizeCronRequest` so a secret shorter than 32 characters authorises nothing, or an `ordersWrite` session). The recovery link `/cart/recover?token=…` stays valid for 14 days (`RECOVERY_TTL_MS`). `markConvertedByEmail` runs after every checkout. The unsubscribe endpoint (`/api/cms/commerce/unsubscribe`) is deliberately not module-gated.

### 4.14 Wishlist, reviews, compare, feeds

- **Wishlist:** config `ecommerce.wishlist` (`parseWishlistConfig`). Guests keep the list in `localStorage` with a cookie fallback (`12:red,34` format). Signed-in customers use `wishlist_items` via `/api/cms/customer/wishlist` (GET, or POST with `action: add | remove | merge`). `wishlist/resolve` returns live prices and stock. `wishlist/track` bumps an anonymous `stat_counters` row.
- **Reviews:** public `POST /api/cms/commerce/review` (3/min, honeypot `_hp`). Reviews land as `pending`. `verified` is set when `orderReference` plus email resolve through `lookupOrder` to an order that is not cancelled or refunded and contains any locale row of the product (`orderQualifiesForBadge`). Moderation is at `/api/cms/reviews*` (`reviewsRead` / `reviewsWrite`).
- **Compare:** `GET /api/cms/commerce/compare?slugs=a,b&locale=` (up to 4).
- **Feeds:** `GET /feeds/{skroutz|bestprice|shopflix|google|google-merchant|merchant}[.xml]`, rendered from the default locale, `Cache-Control: public, max-age=3600`. Products the catalogue view would hide are excluded.

### 4.15 Customers module

- **Session:** a `cms_customer` httpOnly cookie holding an HS256 JWT (iss `cms`, aud `cms-customer`, key = HKDF(`ADMIN_SESSION_SECRET`, `cms-customer-session`)). It cannot be used as an admin token. Every account request re-reads the row and compares `token_version`. Password change, sign-out-everywhere and delete all bump it.
- **Registration at checkout:** `attachCheckoutAccount` runs after the order is committed. If an account was requested, the module is enabled, nobody is signed in and the password passes `passwordMessage`, it calls `registerCustomer`, links **this** order, and sends the verification email. Earlier guest orders with the same email are attached only after the email is verified (`claimGuestOrders`, on verify or reset).
- **Deletion:** the customer is anonymised (`anonymisedCustomer`), `orders.customer_id` is nulled, and addresses and tokens are deleted. Orders are kept.
- **Checkout prefill** (`checkoutPrefill`): the default shipping address wins, and the email is always the account's.
- **Addresses:** `customerAddressesRoute` (GET, POST) and `customerAddressRoute` (PATCH, DELETE) in `routes.ts` are mounted at `src/app/api/cms/customer/addresses/route.ts` and `addresses/[id]/route.ts`, which `AccountPanels.AddressesPanel` posts to. The page itself reads addresses directly from `listCustomerAddresses`.

---

## 5. HTTP API

`createRoute` (see 01 and 05) provides zod validation, rate limits, the same-origin check (on by default) and the `{ok, data}` envelope. "Gate" is the module flag checked by the binder in `src/app/api/cms/**`. All paths are under `/api/cms` unless shown otherwise.

### 5.1 Public storefront

| Method | Path | Gate | Auth / limit | Purpose |
|---|---|---|---|---|
| POST | `/commerce/checkout` | commerce | none, 10/min | Place an order (`createCheckoutRoute`) |
| POST | `/commerce/order-lookup` | commerce | none, 20/min | Guest lookup by reference and email → `publicOrder` (payment rows allow-listed) |
| POST | `/commerce/coupon` | commerce | 30/min | Quote a coupon for a cart |
| POST | `/commerce/shipping-quote` | commerce | 60/min | Legacy estimate plus method list |
| GET | `/commerce/lockers?postal=` | commerce | 60/min | BoxNow lockers near a postcode |
| POST | `/commerce/gift-cards/check` | commerce | 5/min plus captcha | Gift card balance |
| POST | `/commerce/gift-cards/quote` | commerce | 20/min | What codes would cover (`amountDue` in minor units) |
| POST / GET | `/commerce/abandoned-cart` | commerce | 20/min / 60/min | Capture cart / recover by `?token=` |
| GET | `/commerce/search?q=&locale=` | commerce | 60/min | Search suggestions |
| GET | `/commerce/compare?slugs=&locale=` | commerce | 120/min | Compare data |
| GET | `/commerce/quick-view?slug=&locale=` | commerce | 120/min | Quick-view modal data |
| POST | `/commerce/review` | commerce | 3/min, honeypot | Submit a review |
| GET / POST | `/commerce/unsubscribe` | **none** | 30/min | Confirm / perform unsubscribe from cart reminders |
| POST | `/wishlist/resolve` | commerce | 60/min | Resolve ids to live entries |
| POST | `/wishlist/track` | commerce | 60/min | Anonymous "added" counter |
| POST | `/payments/webhooks/stripe` | commerce or booking | Stripe signature, 120/min | Webhook |
| POST | `/payments/webhooks/paypal` | commerce or booking | PayPal verification, 120/min | Webhook |
| GET / POST | `/payments/webhooks/viva` | commerce or booking | handshake key / API re-read, 30 and 120/min | Webhook |
| GET | `/feeds/[feed]` (no `/api/cms`) | commerce | none | Marketplace XML |

### 5.2 Customer account (`requireApiCustomer` unless noted)

| Method | Path | Gate | Notes |
|---|---|---|---|
| POST | `/customer/register` | customers | 5/min plus captcha |
| POST | `/customer/login` | customers | 10/min |
| POST | `/customer/logout` | customers | |
| POST | `/customer/verify` | customers | token, 20/min |
| POST | `/customer/forgot` | customers | 5/min plus captcha |
| POST | `/customer/reset` | customers | token and password, 10/min |
| POST | `/customer/password` | customers | current and new password |
| GET | `/customer/me` | customers | |
| PATCH | `/customer/profile` | customers | |
| GET | `/customer/orders`, `/customer/orders/[reference]` | customers | own orders only |
| GET | `/customer/export` | customers | JSON download, 5/min, audited |
| POST | `/customer/delete` | customers | re-asks for the password, anonymises |
| GET / POST | `/customer/wishlist` | commerce **and** customers | `currentCustomerId = resolveCheckoutCustomerId` |
| GET / POST | `/customer/addresses` | customers | list / add, 30/min |
| PATCH / DELETE | `/customer/addresses/[id]` | customers | edit / delete one of the customer's own, 30/min |

### 5.3 Admin

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/orders?search=&status=&page=&pageSize=` | `ordersRead` | List |
| POST | `/orders` | `ordersWrite` | Manual order (`saveOrder(null)`) |
| GET | `/orders/[id]` | `ordersRead` | `getAdminOrder` (payments with `refundable`, shipments) |
| PATCH | `/orders/[id]` `{status}` | `ordersWrite` | `updateOrderStatus` plus audit `order.status` |
| PUT | `/orders/[id]` | `ordersWrite` | Full edit. Requires `expectedVersion` (409 on mismatch) and respects editing locks (`assertNotLockedByOther('order', …)`) |
| POST | `/orders/[id]/refund` | `ordersWrite`, 20/min | Refund via gateway |
| GET / POST | `/orders/[id]/shipments` | `ordersRead` / `ordersWrite`, 30/min | List / create shipment or voucher |
| GET | `/orders/export?status=&from=&to=` | `ordersRead` | CSV (formula-injection safe) |
| GET / POST | `/gift-cards` | `ordersRead` / `ordersWrite` | List / issue by hand |
| GET / PATCH | `/gift-cards/[id]` | `ordersRead` / `ordersWrite` | Ledger history / `{status: void or active}` |
| GET | `/abandoned-carts` | `ordersRead` | List |
| DELETE | `/abandoned-carts/[id]` | `ordersWrite` | Delete |
| POST | `/abandoned-carts/remind` | `ordersWrite` or `x-cron-secret` | Run the reminder job |
| GET | `/reviews`, `/reviews/stats` | `reviewsRead` | Moderation list / stats |
| PATCH / DELETE | `/reviews/[id]` | `reviewsWrite` | Status / delete |
| GET / POST | `/shipping/zones` | `settingsRead` / `settingsWrite` | Zones and methods / upsert zone by name |
| PATCH / DELETE | `/shipping/zones/[id]` | `settingsWrite` | Edit / delete (cascades to methods) |
| POST | `/shipping/methods` | `settingsWrite` | Create method |
| PATCH / DELETE | `/shipping/methods/[id]` | `settingsWrite` | Edit (also toggles and reorders) / delete |
| GET / POST | `/shipping/couriers` | `settingsRead` / `settingsWrite` | BoxNow credentials (write-only) |
| GET | `/customers` | `customersRead` (customers gate) | List |
| GET / PATCH | `/customers/[id]` | `customersRead` / `customersWrite` | Detail / `{status?, resendVerification?}` |
| POST | `/cron/[job]` | `x-cron-secret: CMS_CRON_SECRET` | Jobs: `commerce-stale-orders`, `giftcard-deliver`, `giftcard-expire`, `commerce-abandoned-reminders` (see 10) |

Coupons, the shipping config, the gift card config and the wishlist config are written through the generic site-settings API (`cmsApi.updateSiteSettings`, see 10).

---

## 6. Admin UI

| Screen | Component(s) | Notes |
|---|---|---|
| Orders (`/admin/orders`) | `OrdersTable`, `OrderFulfilment` | Stats header (`orderStats`: revenue excludes cancelled and refunded), status filter, search, CSV export link. The editor sends each line back with its `id` (`planOrderLines` keeps the snapshot and variation) and `expectedVersion`. `canWrite = hasPerm(ordersWrite)`: read-only users get a disabled editor. Status pills show `ORDER_STATUS_HELP`; moves `ORDER_STATUS_TRANSITIONS` does not allow are disabled. Cancel and refunded ask for confirmation (`ORDER_STATUS_CONFIRM`). A red notice (`REFUND_DUE_TEXT`) shows while `refundDue` is set. `OrderFulfilment` shows payments with a Refund action when `refundable > 0`, delivery info (method, locker, pickup) and shipments (`shipmentActions`: create a voucher only for BoxNow, type in a tracking number for the others) |
| Gift cards (`/admin/gift-cards`) | `GiftCardsTable` | List (last 4 characters only), history, issue, void or reactivate |
| Reviews (`/admin/reviews`) | `ReviewsTable` | Moderation queue |
| Abandoned carts (`/admin/abandoned`) | `AbandonedCartsTable` | List, delete, "Send reminders" |
| Customers (`/admin/customers`) | `CustomersTable` | Customers module only. Disable or enable, re-send verification. Admins can never see or set passwords |
| Settings → Ecommerce → Shipping | `ShippingSettings`, `ShippingMethodsManager`, `CourierCredentials` | Legacy config (surcharge rows per `paymentProviderKeys()`), zones and methods, BoxNow keys. A database missing migration 0021 shows an inline error rather than breaking the tab |
| Settings → Ecommerce → Coupons, Wishlist, Gift cards | `CouponsManager`, `WishlistSettings`, `GiftCardSettings` | Structured JSON settings |
| Settings → Ecommerce (generic fields) | settings schema | `ecommerce.currency`, `ecommerce.paymentProvider`, `ecommerce.giftWrapFee`, `ecommerce.filters.priceControl`, `ecommerce.pendingOrderTtlHours` |
| Product editor | collection presets, `fields/VariationsEditor.tsx` | Variations are generated from the attributes |

Sidebar entries are added in `src/app/admin/(shell)/layout.tsx` (group `ecommerce`), gated on the module flag and the permission. Every page also calls `notFound()` when the module is off.

---

## 7. Configuration

### 7.1 Site config and modules

```ts
// src/site.config.ts
modules: { commerce: true, customers: true /* optional */, newsletter: … },
collections: [categoryCollection(), sizeChartCollection(), tagCollection(), productCollection(), …],
```

The flags can be overridden at runtime from the admin Modules toggle (`module.<name>` in `site_settings`).

### 7.2 Settings keys (`site_settings`)

| Key | Type | Default | Read by |
|---|---|---|---|
| `ecommerce.currency` | `EUR`, `USD`, `GBP` | `EUR` | `getSiteCurrency` |
| `ecommerce.paymentProvider` | `manual`, `stripe`, `paypal`, `viva` (`PAYMENT_PROVIDER_OPTIONS`) | `manual` | `getConfiguredPaymentProvider` |
| `ecommerce.shipping` | JSON `ShippingConfig` | `DEFAULT_SHIPPING_CONFIG` (flat, 0) | `getShippingConfig` |
| `ecommerce.coupons` | JSON `Coupon[]` | `[]` | `getCoupons` |
| `ecommerce.giftWrapFee` | major-unit string | 0 | `getGiftWrapFee` / `createOrder` |
| `ecommerce.giftCards` | JSON `GiftCardConfig` | disabled | `getGiftCardConfig` |
| `ecommerce.wishlist` | JSON `WishlistConfig` | see `parseWishlistConfig` | `getWishlistConfig` |
| `ecommerce.filters.priceControl` | `slider` or `fields` | `slider` | `getPriceControl` |
| `ecommerce.pendingOrderTtlHours` | whole hours as a string | 48 | `cancelStaleOrders` |
| `notifications.inquiryEmails` | comma- or newline-separated | mailer default | admin copy of the order email |

### 7.3 Environment variables (names only; see `.env.example`)

| Variable | Used by |
|---|---|
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `stripe.ts` (the secret key is read lazily at the first call), `StripeCardPanel` |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_ENV` (`sandbox` default, or `live`) | `paypal.ts` |
| `VIVA_CLIENT_ID`, `VIVA_CLIENT_SECRET`, `VIVA_ENV` (`demo` default, or `live`), `VIVA_MERCHANT_ID`, `VIVA_API_KEY` (refunds only), `VIVA_WEBHOOK_VERIFICATION_KEY` | `viva.ts` |
| `CMS_GIFTCARD_PEPPER` (at least 32 chars) | gift cards. **Rotating it makes every existing code unredeemable** |
| `BOXNOW_API_URL` | BoxNow base URL (stage by default) |
| `CMS_CRON_SECRET` | `/api/cms/cron/[job]` |
| `COMMERCE_CRON_SECRET` (at least 32 chars, like `CMS_CRON_SECRET`) | legacy `/api/cms/abandoned-carts/remind` |
| `COMMERCE_ABANDONED_DELAY_MINUTES`, `COMMERCE_ABANDONED_DAILY_MAX` | reminder timing and cap |
| `ADMIN_SESSION_SECRET` | also derives the customer JWT key |

Webhook URLs to register with the gateways: `https://<site>/api/cms/payments/webhooks/{stripe|paypal|viva}`. For Viva, set `VIVA_WEBHOOK_VERIFICATION_KEY` **before** registering, and configure the success and failure redirect on the Viva payment source to point at `/order`.

### 7.4 Scheduling

The site needs an external scheduler (there is no in-process cron). `.env.example` suggests running `commerce-stale-orders` hourly and `commerce-abandoned-reminders` every 15 minutes. `giftcard-deliver` must run at least daily for scheduled cards. See 10.

---

## 8. Extending

### 8.1 Recipe: add a payment provider

1. **Implement** `src/cms/core/payments/<name>.ts` with `import 'server-only'`. Export `const <name>Provider: PaymentProvider = { key, label, start, refund? }`.
   - `start(ctx)` must return `status: 'pending'` (money is not ours until the webhook) plus exactly one of `redirectUrl` (hosted page) or `clientSecret` (in-page form), and a `providerRef` you can match from the webhook. Amounts arrive in minor units.
   - Round-trip `ctx.subject` and `ctx.subjectId` if the gateway allows it (`encodePaymentSubject`). If it cannot (like Viva), the dispatcher falls back to looking up the payment row.
   - If the gateway supports idempotency keys, derive one from `(subject, subjectId, amount)` as Stripe does.
   - `refund` should catch errors and return `{status:'failed', error}` for definite refusals. Throw only when the outcome is genuinely unknown (the claim is then held).
   - Read secrets from `process.env` lazily, inside functions, so an unconfigured deploy fails at call time rather than at import.
2. **Register** it in `register.ts` (`registerPaymentProvider(<name>Provider)`).
3. **Expose** it in `PAYMENT_PROVIDER_OPTIONS` (`src/cms/core/settings/schema.ts`). The same list serves commerce and booking selects and the API allowlist. Add a label to `PROVIDER_LABELS` in `OrderFulfilment.tsx`.
4. **Events:** add a pure reducer in `events.ts` (`<name>Outcome(event): PaymentOutcome | null`) mapping to `captured`, `failed` or `refunded`, with `refundedTotal` when the gateway states one.
5. **Webhook:** add `<name>WebhookRoute()` in `webhooks.ts` with `createRoute({ sameOrigin: false, rateLimit })`. Read `req.text()`, verify authenticity (signature or authenticated re-read) **before** parsing, then call `applyOutcome`. Return 200 for events you ignore, 400 for failed verification, 5xx only when you want a retry.
6. **Mount** `src/app/api/cms/payments/webhooks/<name>/route.ts`: gate on `commerce || booking` and `import '@/cms/core/payments/register'`.
7. **Front end:** a redirect provider needs nothing, because `CheckoutClient` follows `redirectUrl`. An in-page provider needs a panel like `StripeCardPanel` wired to `clientSecret`.
8. **Env:** document the variable names in `.env.example`.
9. **Tests:** pure event reduction and amount handling go in `test/core/` (see `payments.test.ts`, `viva.test.ts`).
10. Check the booking side (`src/cms/modules/booking/payments.ts`, guide 09). It uses the same registry, and its refund also reads `metadata.captureId`.

### 8.2 Recipe: add a courier

1. Add the key to `courierValues` in `schema/shipping.ts` **and** generate a migration (it is a MySQL enum on both `shipping_methods.courier` and `shipments.courier`). Add it to `CourierKey`, `COURIER_LABELS` and `TRACKING_URLS` in `shipping-methods.ts`, and to the three `z.enum([...])` lists in `shipping-service.ts` (`methodBody`, `orderShipmentsRoute`) that repeat the list.
2. Tracking only: add `manualAdapter('<key>', COURIER_LABELS.<key>)` to `COURIERS` in `couriers/index.ts`.
3. Bookable from the CMS: create `couriers/<key>.ts` implementing `CourierAdapter` with `createVoucher` (and `listLockers` for a locker network). Follow `boxnow.ts`: `AbortSignal.timeout`, in-memory token cache, `throw new Error(<human message>)` (`createShipment` surfaces it as a 400 to the admin).
4. Credentials: append definitions to `COURIER_SECRET_DEFS` (`courier.<key>.<name>`, `module: 'commerce'`). `CourierCredentials` and `courierCredentialsRoute` pick them up. Read them with `getSecret(key)`.
5. Update `shipmentActions()` so the order panel offers voucher creation, and extend `LOCKER_COURIERS` / `checkShippingMethod` if the courier has lockers.
6. Extend `test/commerce/shipping-methods.test.ts` / `shipping-admin.test.ts`.

### 8.3 Recipe: add an order status

The status is a MySQL enum and several modules switch on it.

1. `orderStatusValues` in `schema/commerce.ts`, plus a migration altering `orders.status`.
2. `updateOrderStatus` (`orders.ts`): decide whether the new status restocks (`RESTOCKING_STATUSES`), reverses gift cards, issues gift cards, or emails the customer (`STATUS_EMAIL` plus `EMAIL_LABELS.el` and `.en` strings).
3. `syncPaymentsForOrderStatus` (`payments.ts`): map it to a manual payment status if it implies money moved.
4. Reporting: `orderStats` excludes `cancelled` and `refunded` from revenue. Decide whether the new status counts.
5. Coupon usage (`countCouponRedemptions`) and the verified-review rule (`NON_PURCHASE_STATUSES` in `reviews.ts`) both exclude "not a purchase" statuses.
6. Stale-order job: only `pending` is considered. Review `planStaleOrderCancellations` if the new status is a waiting state.
7. Admin: `STATUSES`, `STATUS_COLORS`, `ORDER_STATUS_HELP` (and `ORDER_STATUS_CONFIRM` if destructive) in `OrdersTable.tsx`. Customer account and guest lookup views display the raw status, so check their translations in the `messages/` files.
8. Tests: `test/commerce/order-admin.test.ts`, `stale-orders.test.ts`, `test/cms/order-fulfilment.test.tsx` (it pins the confirm wording).

### 8.4 Other extension points

- **Custom product fields:** `productCollection({ extraFields: [...] })`. Remember that `createOrder`, `stock.ts`, `reviews.ts`, `feeds.ts` and `read.ts` hard-code the document type `'product'` (`DEFAULT_PRODUCT_TYPE`), so a site that changes `key` also breaks checkout and stock.
- **Checkout hooks:** `createCheckoutRoute({ newsletterEnabled, resolveAccount, attachAccount, defaultLocale })` is the seam for anything the site should do around an order without the module importing site code.
- **Review notifications:** `createReviewRoute({ notify })`.

---

## 9. Testing

Tests use `node:test` via `tsx`. They are pure-function and wiring tests. There is no DB harness, so the DB-bound paths (`createOrder`, `moveOrderStock`, `capturePaymentByRef`) are covered by testing their pure rules plus source-inspection "wiring" tests (e.g. `test/commerce/refund-webhook-wiring.test.ts` reads `webhooks.ts` and asserts the call shape).

Run one file:

```bash
npx tsx --tsconfig ./tsconfig.test.json --test test/commerce/order-totals.test.ts
```

Run the whole suite (`npm test`, which includes `test/commerce/*.test.ts`, `test/core/*.test.ts`, `test/cms/*.test.ts(x)`, …).

| File | Covers |
|---|---|
| `test/commerce/logic.test.ts` | Catalogue projection, `resolvePrice`, coupons, shipping `computeShipping`, misc pure helpers (47 cases) |
| `test/commerce/order-totals.test.ts` | `computeOrderTotals` (tenders, fractions refused) |
| `test/commerce/order-admin.test.ts` | `refundableAmount`, `orderStatusAfterRefund`, `giftCardAmountsUsed` |
| `test/commerce/order-edit-lines.test.ts`, `test/cms/order-editor-lines.test.ts` | `planOrderLines`, editor payload |
| `test/commerce/stock.test.ts` | `availableStock`, `applyStockDelta` |
| `test/commerce/stale-orders.test.ts` | `planStaleOrderCancellations`, TTL parsing |
| `test/commerce/refund-webhook-wiring.test.ts` | Webhook and admin refund both use `orderStatusAfterRefund` and `unlessAlready`, with no double restock |
| `test/commerce/quantity.test.ts` | `quantityRules`, `clampQuantity` |
| `test/commerce/shipping-methods.test.ts`, `shipping-admin.test.ts` | `quoteMethods`, `checkShippingMethod`, `normalizeCountry`, tracking URLs, admin wiring |
| `test/commerce/giftcards.test.ts`, `giftcard-purchase.test.ts` | Codes, hashing, `applyGiftCards`, config parsing, purchase validation |
| `test/commerce/abandoned.test.ts` | Capture sanitising, reminder budget, HTML, recovery URL |
| `test/commerce/wishlist.test.ts` | Cookie codec, merge, config |
| `test/commerce/reviews.test.ts`, `verified-badge.test.ts` | Aggregate, `orderQualifiesForBadge` |
| `test/commerce/facet-counts.test.ts`, `price-bounds.test.ts` | Facets, price ranges |
| `test/commerce/feeds.test.ts` | XML builders |
| `test/commerce/sizechart.test.ts`, `showcase-data.test.ts`, `unpublish-redirect.test.ts`, `field-help.test.ts` | Presets and projections |
| `test/core/payments.test.ts` | Registry, subject encoding, Stripe and PayPal event reduction |
| `test/core/refunds.test.ts` | Claim arithmetic, `reconcileProviderRefund` |
| `test/core/viva.test.ts` | Order-code extraction, `amountMatches`, event kinds |
| `test/cms/checkout-account.test.ts`, `customer-policy.test.ts`, `customer-session.test.ts`, `customer-tokens.test.ts` | Customers module |
| `test/cms/order-fulfilment.test.tsx`, `orders-editor-readonly.test.tsx`, `commerce-settings-ui.test.tsx`, `commerce-info-tips.test.tsx` | Admin components |
| `test/components/gift-card-buy-box.test.tsx`, `shop-filter-controls.test.tsx` | Storefront components |
| `test/booking/payment-*.test.ts` | Booking's use of the shared payment seam |

Never point tests or local runs at live gateway or courier credentials. Stripe test keys, PayPal `sandbox`, Viva `demo` and the BoxNow stage URL are the defaults for a reason.

---

## 10. Gotchas and invariants

**Money**

- All persisted money is integer minor units. Product JSON, coupon values, the shipping config, pickup charges and the gift-wrap fee are major units, and are converted with `Math.round(x * 100)` at the boundary. Gift card config amounts (`presets`, `minAmount`, `maxAmount`) are **already minor**. Do not mix these up.
- `computeOrderTotals` refuses fractional inputs. Treat a `RangeError` as a missing conversion, not as something to round away.
- Prices are VAT-inclusive. There is no tax line, per-product tax class or VAT breakdown on orders or in emails.
- `orders.total` is what was sold. Gift cards reduce only the amount charged to the gateway. Refund rows in `payments` are negative, so `Σ payments.amount` is what the shop holds.
- `sendOrderEmails` prints subtotal, discount, shipping, surcharge, gift wrap and total through `orderSummaryLines` (`totals.ts`), so the lines add up to the total. Add any new cost component there too.
- Viva reports amounts in major or minor units depending on the endpoint. `amountMatches` accepts either, and a partial reversal is refused as a mismatch.

**Idempotency and concurrency**

- `UNIQUE(payments.provider, provider_ref)` plus `capturePaymentByRef`'s locked "same status means no-op" is what makes replayed webhooks safe. Do not write payment rows from webhooks any other way.
- Refund safety depends on `metadata.refundedAmount` being written under lock **before** the gateway call. Never refund by checking `status === 'captured'` alone, because the capture row stays `captured` after an admin refund.
- `updateOrderStatus(..., {unlessAlready: true})` is what stops the admin refund and the refund webhook from both emailing or reversing. Use `onlyFrom` for automated callers that decided on a snapshot.
- Stock moves are idempotent through `metadata.stockTaken`. Anything that rewrites `orders.metadata` wholesale must preserve it. `saveOrder` spreads `prevMeta`, and `flagOrderRefundRequired` merges into the current metadata under the order lock.
- Gift card mints are idempotent through `UNIQUE(order_item_id)`. Balance changes use a compare-and-set `UPDATE … WHERE balance = ?`.
- The admin order editor needs `expectedVersion`. Without it the save returns 400, and with a stale value it returns 409.

**Stock**

- Stock is checked at checkout under `FOR UPDATE`, but taken only on payment (or immediately for `manual`). Between checkout and capture, two gateway orders can both pass `ensureStock` for the last unit. The second capture then takes the stock-short path: the order is cancelled with `metadata.stockFailure` and flagged `refundRequired`. The customer has been charged; the admin panel says so until the payment is refunded under Payments (there is no automatic refund).
- Stock is shared across locale rows, and every locale row is written.
- An admin edit that changes quantities does not adjust stock, so a later cancel restocks the **edited** quantities.
- `ensureStock` / `moveOrderStock` treat a missing `stock` number as unlimited.

**Behaviour that surprises**

- `createOrder` only sells a published row (`orderableRow`) and refuses external products, unknown or disabled variations, and `availability: 'out-of-stock'` on an untracked product (`lineUnavailableReason`). With tracked stock, `availability` is not consulted at checkout; the quantity check is. A product with enabled variations can still be ordered with no `variationId` at the base price.
- Viva refunds target the transaction id (`refundTargetRef`), not the order code the row is keyed by. A Viva payment captured before the webhook stored `transactionId` cannot be refunded from the admin (409); refund it in the Viva portal. Not yet verified end to end against the Viva demo environment.
- If a shop has shipping methods but the request omits `shippingMethodId`, checkout silently falls back to the legacy `computeShipping`.
- Cash on delivery is inferred from the provider: with `manual` configured, every shipped order is treated as COD (methods with `cod_allowed` off are hidden, `codAmount` is written). A shop that uses `manual` for bank transfer only should leave `cod_allowed` on; the voucher still books `prepaid` once the order is marked `paid`. There is no per-order payment-method choice.
- The stale-order job never cancels an order that was partly paid by gift card (the `giftcard` payment is `captured`, which counts as "money attached"). The card balance stays tied up until an admin cancels the order.
- A capture that arrives after the order was cancelled or refunded (e.g. by the stale job) does not revive it: no stock, no status change, and the order is flagged `refundRequired` for the admin to refund. Any gift card balance returned at cancellation stays returned.
- Order confirmation emails go out at checkout even when the payment later fails or is abandoned.
- The Stripe return URL built in `CheckoutClient` is `/order?ref=…` without a locale prefix. `createOrder`'s `returnUrl` (used by PayPal) is locale-prefixed.

**Security**

- Guest order lookup authorises on reference plus email. References are random (about 50 bits) precisely because of this. Do not return to sequential references. `publicOrder` allow-lists payment fields.
- The CSV export neutralises formula injection (`csvCell`). Keep that if you add columns.
- Gift card codes are bearer credentials: HMAC-SHA256 plus a pepper, never logged. The public check endpoint is rate-limited and captcha-protected, and gives the same answer for every failure.
- The Viva webhook trusts nothing in the POST body. Keep the `confirmTransaction` re-read.
- `COMMERCE_CRON_SECRET` goes through `authorizeCronRequest`, like `CMS_CRON_SECRET` and `BOOKING_CRON_SECRET`: unset or shorter than 32 characters, it authorises nothing (the route then needs an `ordersWrite` session).
- `customerId` on an order comes only from the session. A customer cookie cannot authenticate on the admin side (a different HKDF key and a different audience).
