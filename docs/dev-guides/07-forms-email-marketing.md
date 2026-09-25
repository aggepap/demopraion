# 07 · Forms, email, newsletter, popups, cookies & scripts

This guide covers the visitor-facing "marketing and communication" part of the CMS: public form capture and the Submissions inbox (`form_submissions`), outbound email through Microsoft Graph (branding, suppression, signed unsubscribe links), the newsletter module (`newsletter_subscribers`), the popups module, the cookie-consent catalogue and banner (`cookie_categories`, `cookie_services`, `cookie_consents`) with the storage scanner, consent-gated GA4 and script snippets (`script_snippets`), the Google reviews integration (`reviews-external`, `review_locations`, `reviews_external`, OAuth under `/api/cms/integrations`), and the anonymous counters in `core/stats` that popups write to. Order/booking/customer emails are only covered as callers of the mail layer. Their content belongs to the commerce and booking guides.

Related guides: [01-architecture.md](01-architecture.md) · [02-database.md](02-database.md) · [03-content-model.md](03-content-model.md) · [04-admin-ui.md](04-admin-ui.md) · [05-auth-users-security.md](05-auth-users-security.md) · [06-media-seo-structured-data.md](06-media-seo-structured-data.md) · [08-commerce.md](08-commerce.md) · [09-booking.md](09-booking.md) · [10-settings-cron-operations.md](10-settings-cron-operations.md)

---

## 1. File map

### Forms

| Path | Role |
|---|---|
| `src/cms/core/forms/service.ts` | `listSubmissions`, `createSubmission`, `getSubmission`, `updateSubmission`, `markSubmissionDelivered`, `markSubmissionUndelivered`, `claimSubmissionNotification`, `appendSubmissionPayload` |
| `src/cms/core/routes/forms.ts` | Admin route factories `submissionsListRoute`, `submissionGetRoute`, `submissionUpdateRoute` |
| `src/app/api/cms/forms/route.ts`, `src/app/api/cms/forms/[id]/route.ts` | Mount the admin factories |
| `src/app/api/contact/route.ts` | **Public** contact endpoint: validate, store, email |
| `src/lib/contact-submission.ts` | `contactSubmissionRecord`, `pageSlugFromReferer`, `ContactFormKind` (testable half of the route) |
| `src/lib/email/rows.ts` | `rowsToHtml` / `rowsToText`: the label/value table used for form notifications |
| `src/components/site/ContactForm.tsx` | Client form posting to `/api/contact` |
| `src/app/[locale]/contact/page.tsx` | `/contact` page (renders `<ContactForm />`) |
| `src/cms/admin/SubmissionsTable.tsx` | Admin inbox UI (list, filters, drawer, `PayloadView`) |
| `src/app/admin/(shell)/submissions/page.tsx` | Admin page, `formsRead` |
| `src/cms/db/adapters/mysql/schema/forms.ts` | `form_submissions` + `newsletter_subscribers` tables |

### Email

| Path | Role |
|---|---|
| `src/cms/core/email/graph.ts` | `sendGraphMail`, `graphMailConfigured`, `GraphMail` (core mailer, branded) |
| `src/cms/core/email/brand.ts` | `emailColor(token)` placeholders, `applyEmailBrand` |
| `src/cms/core/email/format.ts` | `escapeHtml`, `formatMoney`, `formatDate` (pure) |
| `src/cms/core/email/suppression.ts` | `suppressEmail`, `isSuppressed`, `suppressedAmong` |
| `src/cms/core/email/unsubscribe.ts` | `normalizeEmail`, `unsubscribeSignature`, `unsubscribeSignatureMatches`, `unsubscribeUrl` |
| `src/cms/core/email/index.ts` | Barrel |
| `src/cms/core/brand/index.ts` | `getEmailBrand`, `brandEmailHtml` (called by `sendGraphMail`) |
| `src/cms/db/adapters/mysql/schema/email.ts` | `email_suppressions` |

### Newsletter

| Path | Role |
|---|---|
| `src/cms/modules/newsletter/logic.ts` | Pure: `newsletterSubscribeBody` (zod), `consentTextFor`, `subscribeOutcome`, `isSubscribeSuccess`, `subscriberView`, `subscriberPage` |
| `src/cms/modules/newsletter/subscribers.ts` | DB: `subscribe`, `listSubscribers`, `setSubscribed`, `getSubscriber`, `deleteSubscriber` |
| `src/cms/modules/newsletter/routes.ts` | `newsletterSubscribeRoute`, `subscribersListRoute`, `subscriberUpdateRoute`, `subscriberDeleteRoute` |
| `src/app/api/newsletter/route.ts` | Public signup, module-gated |
| `src/app/api/cms/newsletter/route.ts`, `[id]/route.ts` | Admin list / update / delete, module-gated |
| `src/lib/newsletter.ts` | Browser client `subscribeToNewsletter(email, source, locale)` |
| `src/components/layout/NewsletterBand.tsx`, `NewsletterProvider.tsx` | Footer band + module flag context |
| `src/lib/site/newsletter-placement.ts` | `showFooterNewsletter(pathname)` |
| `src/cms/admin/SubscribersTable.tsx`, `src/app/admin/(shell)/newsletter/page.tsx` | Admin UI |
| `src/cms/modules/commerce/orders.ts` (`subscribeNewsletter`) | Checkout marketing opt-in writer |

### Popups

| Path | Role |
|---|---|
| `src/cms/modules/popups/collection.ts` | `popupCollection()` document collection (`key: 'popup'`) |
| `src/cms/modules/popups/policy.ts` | Pure targeting/frequency: `isPopupActive`, `matchesTarget`, `shouldShowAgain`, `choosePopup`, `toPopupRecord` |
| `src/cms/modules/popups/presets.ts` | `POPUP_PRESETS`, `popupPreset`, `safeColor`, `resolvePopupDesign` |
| `src/cms/modules/popups/read.ts` | `listPopups`, `toPopupPayload`, `popupTrackRoute`, `POPUP_STAT_SCOPE` |
| `src/app/api/cms/popups/track/route.ts` | Public impression/click/close counter |
| `src/components/popups/PopupHost.tsx` | Server: loads popups, renders bodies |
| `src/components/popups/PopupRuntime.tsx` | Client: consent wait, choice, triggers, seen-store, tracking |
| `src/components/popups/PopupDialog.tsx` | Accessible dialog rendering per preset layout |

### Cookies / consent / analytics

| Path | Role |
|---|---|
| `src/cms/core/cookies/service.ts` | Catalogue CRUD, `getCookieCatalogPublic` (cached), `getPublicCookieDeclaration`, `getConsentOptions`, `recordConsent`, `getCookieScan`, `revalidateCookies` |
| `src/cms/core/cookies/declaration.ts` | Pure: `withAnalyticsDeclaration`, `cookiePolicyVersion`, `toConsentOptions` |
| `src/cms/core/cookies/defaults.ts` | `DEFAULT_COOKIE_CATEGORIES`, `ANALYTICS_CATEGORY_KEY`, `GOOGLE_ANALYTICS_SERVICE` (client-safe) |
| `src/cms/core/cookies/registry.ts` | Hand-written list of what the code stores (`alwaysPresent`, `GOOGLE_ANALYTICS_REGISTRY`, `gaContainerId`) |
| `src/cms/core/cookies/scan.ts` | `detectServices`, `compareToDeclaration` |
| `src/cms/core/cookies/storage-keys.ts` | `storageKeys(prefix)` |
| `src/cms/core/routes/cookies.ts` | Admin route factories |
| `src/app/api/cms/cookies/**` | Admin catalogue + scan routes |
| `src/app/api/cookies/consent/route.ts` | **Public** GET options / POST decision |
| `src/components/layout/CookieBanner.tsx` | Banner, `useConsent`, `useCategoryConsent` |
| `src/components/layout/AnalyticsLoader.tsx` | Consent-gated GA4 loader with URL scrubbing |
| `src/cms/core/settings/analytics.ts` | `ANALYTICS_GA_ID_KEY`, `resolveGaId` |
| `src/lib/analytics/gtag.ts` | `trackEvent` |
| `src/lib/storage-keys.ts` | `STORAGE_PREFIX = 'site'`, `STORAGE_KEYS` |
| `src/cms/db/seeds/cookies.ts`, `src/cms/db/seeds/cli/seed-cookies.ts` | `seedCookieCatalog` (non-destructive) |
| `src/cms/admin/CookiesManager.tsx`, `CookieScanner.tsx`, `src/app/admin/(shell)/cookies/page.tsx` | Admin UI |
| `src/app/[locale]/legal/cookies/page.tsx` | Public declaration page |

### Scripts

| Path | Role |
|---|---|
| `src/cms/core/scripts/schema.ts` | Client-safe zod `snippetInputSchema`, `SNIPPET_SLUG`, `publicSnippet`, `externalHost`, `scriptShortcode` |
| `src/cms/core/scripts/service.ts` | `listSnippets`, `getEnabledSnippetBySlug` (cached), `createSnippet`, `updateSnippet`, `deleteSnippet`, `revalidateScripts` |
| `src/cms/core/routes/scripts.ts` | Admin route factories |
| `src/app/api/cms/scripts/route.ts`, `[id]/route.ts` | Admin routes |
| `src/cms/core/shortcodes/all.ts` | `script` shortcode declaration |
| `src/shortcodes/index.tsx` | Site map `SHORTCODE_COMPONENTS` (`script: Script`) |
| `src/components/shortcodes/Script.tsx`, `ScriptSnippetView.tsx`, `SnippetRunner.tsx`, `snippet-consent.ts` | Render path |
| `src/cms/admin/ScriptsManager.tsx`, `src/app/admin/(shell)/scripts/page.tsx` | Admin UI |
| `next.config.ts` (`PRODUCTION_CSP`, `ADMIN_CSP`) | CSP that constrains external snippets |

### External reviews / integrations / stats

| Path | Role |
|---|---|
| `src/cms/modules/reviews-external/google.ts` | Places API + Business Profile API + OAuth helpers, `GOOGLE_SECRET_KEYS` |
| `src/cms/modules/reviews-external/mapping.ts` | Pure payload mapping, `filterExternalReviews`, `parseGoogleReviewsConfig`, `GOOGLE_REVIEWS_KEY` |
| `src/cms/modules/reviews-external/sync.ts` | `syncReviewLocation`, `syncAllReviewLocations`, photo re-hosting |
| `src/cms/modules/reviews-external/read.ts` | `listExternalReviews`, `listReviewLocations`, `setReviewHidden` |
| `src/cms/modules/reviews-external/routes.ts` | Admin routes + `publicReviews` |
| `src/app/api/cms/reviews-external/**` | List, locations, sync, hide |
| `src/app/api/cms/integrations/google/oauth/{start,callback}/route.ts` | Google Business Profile OAuth |
| `src/components/shortcodes/GoogleReviews.tsx` | `[google-reviews]` renderer |
| `src/app/api/cms/cron/[job]/route.ts` | `google-reviews-sync` job |
| `src/cms/db/adapters/mysql/schema/reviews-external.ts`, `integrations.ts` | `review_locations`, `reviews_external`, `integration_secrets` |
| `src/cms/core/stats/counters.ts`, `policy.ts` | `incrementCounter`, `readCounters`, `counterDay`, `isValidCounterPart`, `sumCounters` |
| `src/cms/db/adapters/mysql/schema/stats.ts` | `stat_counters` |

---

## 2. Data model

All tables are MySQL via Drizzle. Schema files live in `src/cms/db/adapters/mysql/schema/`.

### `form_submissions` (`forms.ts`)

| Column | Type | Notes |
|---|---|---|
| `id` | int PK AI | |
| `form_type` | varchar(64) | Free string chosen by the site (`contact`, ...). Not an enum. |
| `email` | varchar(255) | Submitter address |
| `payload` | json `Record<string, unknown>` | The label/value pairs, e.g. `{ Name, Email, Message, Locale }` |
| `source_page_slug` | varchar(191) | Locale-stripped path from `Referer` (`pageSlugFromReferer`) |
| `source_locale` | varchar(8) | |
| `referrer_url` | varchar(512) | Truncated in `createSubmission` |
| `ip_hash` | varchar(64) | **Never written** by any current code path |
| `ua` | varchar(255) | Truncated in `createSubmission` |
| `email_status` | enum `pending/sent/failed/skipped` | Notification outcome |
| `email_error` | text | `markSubmissionUndelivered` writes `name: message` (≤1000 chars) |
| `status` | enum `new/handled/archived/spam` | Triage state, admin-only |
| `notes` | text | Triager's notes |
| `created_at` / `updated_at` | timestamp | |

Indexes: `(form_type, created_at)`, `status`, `email`.

### `newsletter_subscribers` (`forms.ts`)

| Column | Notes |
|---|---|
| `email` | varchar(255) **UNIQUE**, stored lowercase (normalised by the zod schema) |
| `locale` | default `'el'` |
| `consent_text` | e.g. `Newsletter signup (footer)`, or `Marketing opt-in at checkout` |
| `consent_given_at` | Refreshed only on first signup or resubscribe |
| `double_opt_in_at` | **Never written.** There is no double opt-in flow |
| `unsubscribed_at` | null = active |
| `source_page_slug` | The `source` string (`footer`, `sidebar`, `article:<slug>`, `/checkout`) |
| `mailchimp_id`, `mailchimp_status`, `last_synced_at` | **Unused.** Reserved for a server-side provider sync that does not exist yet |
| `ip_hash` | Never written |
| `ua` | Written by the public route |

### `email_suppressions` (`email.ts`)

`email` varchar(255) UNIQUE (lowercase), `reason` enum `unsubscribe | bounce | complaint | manual` (only `unsubscribe` is ever written), `created_at`.

### Cookie tables (`cookies.ts`)

| Table | Columns |
|---|---|
| `cookie_categories` | `key` UNIQUE varchar(64), `name` json locale map, `description` json, `required` bool, `sort_order`, `created_at` |
| `cookie_services` | `category_id` FK → categories (cascade delete), `name`, `provider`, `purpose` json locale map, `enabled` |
| `cookie_consents` | Append-only. `visitor_ref` (random browser id), `decision` (`accepted/rejected/custom`), `categories` json `Record<key, boolean>`, `policy_version`, `locale`, `ua`, `created_at`. No IP, no email |

### `script_snippets` (`scripts.ts`)

`slug` UNIQUE varchar(64) (the shortcode key), `name`, `kind` (`inline`/`external`), `code` mediumtext, `src` varchar(2048), `lazy`, `consent_category` (a cookie category key or null), `enabled`, `notes`, timestamps.

### Reviews (`reviews-external.ts`)

- `review_locations`: `slug` UNIQUE, `label`, `source` enum `gbp | places`, `place_id` (Places), `resource_name` (`accounts/x/locations/y` for GBP), `enabled`, `last_synced_at`, `last_error` (varchar 500).
- `reviews_external`: `location_id` FK (cascade), `source`, `external_id`, `author_name`, `photo_media_id` (a local media UUID, never Google's URL), `rating` tinyint, `text`, `published_at`, `owner_reply`, `owner_reply_at`, `hidden`, `synced_at`. UNIQUE `(location_id, external_id)`.

### `integration_secrets` (`integrations.ts`)

`key` PK (e.g. `google.gbp.refreshToken`), `ciphertext` varbinary (AES-256-GCM under `CMS_TOKEN_ENCRYPTION_KEY`), `hint` (last 4 chars), `updated_by`, `updated_at`. See 05-auth-users-security.md for the crypto.

### `stat_counters` (`stats.ts`)

Composite PK `(scope, subject_id, metric, day)`, `count` int. Scopes in use: `popup` (metrics `impression`, `click`, `close`) and the wishlist scope in `commerce/wishlist.ts`.

### Popups

Popups are **documents** in the generic documents store (collection key `popup`), not a dedicated table. Fields are listed under §6.

### Settings keys used here

| Key | Shape | Validated by |
|---|---|---|
| `analytics.gaMeasurementId` | string | settings validate (must be a `G-` id on write) |
| `integrations.googleReviews` | `{ enabled, minRating, sort, locations[] }` | `googleReviewsSchema` in `core/settings/structured.ts` |
| `integrations.googleReviews.oauthState` | `{ state, at }`, transient | written/cleared by the OAuth routes |
| Module flags `newsletter`, `popups`, `googleReviews` | boolean | Settings → Modules (`core/settings/schema.ts`) |

---

## 3. How it works

### 3.1 Contact form → submission → notification

```
ContactForm (client)
  └─ POST /api/contact  { kind:'contact', locale, name, email, phone, message, _hp }
       1. content-length > 16 KB            → 413
       2. isAllowedPublicOrigin (prod only)  → 403
       3. content-type must be JSON          → 400
       4. checkRateLimit('contact', ip, 5/min) → 429 + Retry-After
       5. zod discriminatedUnion('kind', [contactSchema]) → 400 invalid_payload
       6. _hp non-empty                      → 200 {ok:true}, nothing stored
       7. build rows → createSubmission(contactSubmissionRecord(...))   (errors logged, not fatal)
       8. sendGraphMail (@/cms/core/email) → markSubmissionDelivered
          on throw → markSubmissionUndelivered + 502 send_failed
```

Key points:

- **Store first.** The row is written with `email_status = 'pending'` before any mail is attempted, so a Graph outage never loses an enquiry. A storage failure is logged and the email still goes out.
- **Spam protection** is layered: body cap, same-origin check (`src/lib/public-origin.ts`, production only, a missing `Origin` passes), per-IP in-memory rate limit (`src/lib/rate-limit.ts`), strict zod lengths, and the `_hp` honeypot (hidden `<input name="_hp">` in `ContactForm`). There is **no captcha** on public forms (`createRoute`'s `captcha` option exists but `/api/contact` is a hand-written handler).
- `payload` is `Object.fromEntries(rows)` with empty values dropped, so the admin `PayloadView` shows the same labels as the email.
- `source_page_slug` comes from the `Referer` header via `pageSlugFromReferer`: it strips the first segment only if it is a configured locale (whole segment match, so `/energy` is not mistaken for `/en`), and truncates to 191 chars.
- The notification goes to `CONTACT_RECIPIENT_EMAIL`. Reply-To is set to the submitter with display name `"<name> (via <brand> contact form)"` as an anti-spoofing hint.

`claimSubmissionNotification` (conditional `pending → sent` update, exactly-once claim) and `appendSubmissionPayload` (read-merge-write into `payload`) are exported from `@/cms/core` for a two-pass "kiosk questionnaire" flow. **No caller exists in this repo.** They are there for sites that need them.

### 3.2 Email layer

`sendGraphMail(mail: GraphMail)` in `src/cms/core/email/graph.ts`:

1. `readEnv()` requires all five env vars (`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `GRAPH_SENDER_ADDRESS`, `CONTACT_RECIPIENT_EMAIL`) and throws `Missing email env vars: ...` otherwise.
2. A module-level `ClientSecretCredential` (from `@azure/identity`) gets a token for `https://graph.microsoft.com/.default`. `@azure/identity` caches the token.
3. The HTML goes through `brandEmailHtml` → `applyEmailBrand`: every `{{brand:<token>}}` placeholder (written by `emailColor('midnight-navy')` etc.) is replaced from the saved palette, falling back to `BASE_PALETTE`. If a logo is configured and `siteOrigin()` resolves, a logo header is inserted after `<body>` (or prepended). Branding failure never blocks a send.
4. `POST https://graph.microsoft.com/v1.0/users/{sender}/sendMail` with `saveToSentItems: true`. The recipient is `mail.to ?? CONTACT_RECIPIENT_EMAIL`. Reply-To comes from `replyTo` / `replyToName` / `replyToSuffix`.
5. Non-2xx → throws `Graph sendMail failed (<status>): <detail>`.

`GraphMail` fields: `subject`, `html`, `text?`, `to?`, `replyTo?`, `replyToName?`, `replyToSuffix?`. There is one recipient per call (no cc/bcc/attachments). `text` is accepted but **not sent**: only the HTML body goes to Graph.

`graphMailConfigured()` returns whether `readEnv()` would succeed. The MFA code uses it (`core/routes/auth-mfa.ts`, `/admin/login`, `/admin/account`) to refuse email-2FA enrolment on a deploy with no mail.

**Callers of the core mailer** (each owns its templates as plain string builders):

| Module | File | Error policy |
|---|---|---|
| Commerce orders | `modules/commerce/orders.ts` (`safeSend`) | Swallow + log; never fails an order |
| Abandoned-cart reminders | `modules/commerce/abandoned.ts` | Consults `isSuppressed` / `suppressedAmong`, includes `unsubscribeUrl` |
| Gift cards | `modules/commerce/giftcards/emails.ts` | |
| Booking | `modules/booking/emails.ts` (`sendAndRecord`) | Never throws; writes `reservation_events` + mirrors `email_status` |
| Customer accounts | `modules/customers/emails.ts` | Best-effort at call site |
| Admin MFA codes | `modules/auth/mfa-email.ts` | `send` is injectable for tests |

**Unsubscribe and suppression.** `unsubscribeUrl(origin, email, locale?)` builds `${origin}/api/cms/commerce/unsubscribe?e=<email>&s=<sig>[&locale=]`. The signature is `HMAC-SHA256(ADMIN_SESSION_SECRET, "unsubscribe:v1:<lowercased email>")`, base64url, truncated to 32 chars. It needs no storage and never expires. `unsubscribeSignature` throws if the secret is missing or shorter than 32 chars, so a mail that cannot carry a working link fails instead of going out without one. `unsubscribeSignatureMatches` is constant-time and returns false on any error. The unsubscribe endpoint itself lives in commerce (see 08-commerce.md) and calls `suppressEmail`, which is idempotent (`ON DUPLICATE KEY`).

### 3.3 Newsletter

```
NewsletterBand / checkout tick
  └─ subscribeToNewsletter(email, source, locale)   (src/lib/newsletter.ts, browser)
       └─ POST /api/newsletter  { email, source, locale, _hp? }
            isModuleEnabled('newsletter') else 404
            createRoute: same-origin check on writes, rateLimit newsletter-subscribe 5/min,
                         zod newsletterSubscribeBody (trims + lowercases email)
            _hp filled → 200 {status:'subscribed'}, nothing written
            subscribe() → 'subscribed' | 'already-subscribed' | 'resubscribed'
```

`subscribe()` reads the existing row first, because the caller needs to know which of the three outcomes applies:

- no row → insert, outcome `subscribed`;
- row with `unsubscribed_at` → upsert that clears `unsubscribed_at` and refreshes `consent_text` / `consent_given_at` / `locale` / `source`, outcome `resubscribed`;
- active row → **no write** (the original consent date is kept), outcome `already-subscribed`.

The insert still uses `onDuplicateKeyUpdate`, so two concurrent signups cannot collide on the UNIQUE key.

The route deliberately returns `already-subscribed`, which confirms membership for any address. That is a documented trade-off in `routes.ts`, bounded by the 5/min per-IP limit.

`subscribeToNewsletter` validates the returned `data.status` against its own copy of the three literals. The copy exists because the module is `server-only`. An unreadable 200 is treated as `subscribed`.

Checkout writes via the private `subscribeNewsletter` in `orders.ts` (`consentText: 'Marketing opt-in at checkout'`, `sourcePageSlug: '/checkout'`). Its duplicate-key update only touches `updatedAt`, so it does **not** resubscribe someone who unsubscribed.

**No double opt-in, no confirmation email, no provider sync.** Nothing emails subscribers. There is also no public newsletter unsubscribe link: unsubscribing is admin-only (`PATCH /api/cms/newsletter/:id`). The `mailchimp_*` columns and the "Brevo" comments in `src/lib/newsletter.ts` describe future server-side work.

`NewsletterProvider` carries the module flag to client controls so they hide when it is off. That is presentation only: enforcement is the 404 on the route.

### 3.4 Popups

Server (`PopupHost`, rendered in `src/app/[locale]/layout.tsx` only when `isModuleEnabled(config,'popups')`):

1. `listPopups(locale, defaultLocale)` → `listPublishedDocuments('popup', locale, { limit: 50 })`.
2. `toPopupPayload` maps each document. Localized fields go through `localizedText` / `localizedValue`. `targetMode/targetPaths/targetExclude` become `record.target`. `frequencyMode/frequencyDays` become `record.frequency`. Colours go through `resolvePopupDesign` → `safeColor` (hex allow-list, else the preset default). `backgroundImage` becomes `/api/cms/media/file/<encoded uuid>`.
3. Bodies are rendered server-side with `<RichText>` (so shortcodes work) and passed to the client as React nodes.

Client (`PopupRuntime`):

1. Waits while `useConsent()` is `loading` or `undecided`. **A popup never opens over the cookie banner.**
2. Reads the seen-map from localStorage key `<prefix>-popup-seen` (`{ [id]: epochMs }`).
3. `choosePopup`, given the path with its locale segment stripped (`popupPagePath`), filters by `isPopupActive` (start/end dates, end date inclusive), `matchesTarget` (exclude wins, then `all` or glob paths), and `shouldShowAgain`. It sorts by `priority` desc, then `id` desc, and returns **one** popup.
4. Arms the trigger: `load` (next tick), `delay` (`triggerValue` seconds, default 5), `scroll` (`triggerValue` %, default 50, clamped 1–100), `exit` (desktop `mouseout` with `clientY <= 0`).
5. On show: `markSeen`, then `POST /api/cms/popups/track {popupId, metric:'impression'}`. Close and button click send `close` and `click`.

Path matching (`pathMatches`) is glob-only. `/shop/*` matches `/shop` and anything below it. A trailing `*` otherwise is a prefix match. Anything else is an exact match. Query and hash are stripped. No regex is ever built from admin input.

Frequency: `always`, `once` (never again once seen), or `days` (default 7, minimum 1). A `lastSeen` in the future counts as never seen.

`PopupDialog` is a real modal: `aria-modal`, focus moved in and restored, Escape closes, Tab is trapped. Positions are all `fixed` (`center`, `bottom-bar`, `top-bar`, `bottom-right`) so opening one does not shift layout. Preset layouts (`card`, `split`, `bar`, `corner`, `takeover`, `plain`) come from `POPUP_PRESETS`.

### 3.5 Cookie consent

**Declaration** (server): `getPublicCookieDeclaration()` combines two cached reads:

- `getCookieCatalogPublic()`: `unstable_cache` tag `cms:cookies`, `revalidate: CMS_CACHE_REVALIDATE`, returns `[]` on any error;
- `getSetting('analytics.gaMeasurementId')` resolved by `resolveGaId` (setting, else `NEXT_PUBLIC_GA_MEASUREMENT_ID`).

`withAnalyticsDeclaration` then guarantees the policy never says less than the loader does:

- if a GA id resolves and no `analytics` category exists, a synthetic category is added (id `-1`, using the seed definition) with a synthetic GA4 service (id `-2`);
- if the category exists but does not name GA (matched by name: `google analytics`, `gtag`, `ga4`; disabled rows count), the GA service is appended.

`cookiePolicyVersion(catalog)` is a 32-bit string hash over `key:required:serviceIds` of every category, rendered as `v<base36>`. It is derived rather than stored, so it changes whenever categories or services change.

**Public endpoint** `/api/cookies/consent`:

- `GET` → `{ policyVersion, categories[{key,name,description,required,services[enabled only]}] }`. On any error it returns an empty list so the banner falls back to accept-all / reject-all.
- `POST {visitorRef(≥8 chars), decision, categories, policyVersion?, locale?}`: body cap 8 KB, 20/min per IP. Only **known** category keys are stored, only as booleans, and required categories are forced to `true`. `recordConsent` appends a row and never updates. A DB failure answers `202 {ok:false,error:'not_recorded'}`, since the choice already applies client-side.

**Banner** (`CookieBanner.tsx`), all keys prefixed by `STORAGE_PREFIX` (`'site'`):

| localStorage key | Content |
|---|---|
| `site-cookie-consent` | `accepted` / `rejected` / `custom` (blanket flag, kept for backward compatibility) |
| `site-cookie-categories` | JSON `{ [categoryKey]: boolean }` |
| `site-visitor-ref` | `crypto.randomUUID()` |

On a decision, `writeConsent` does four things in order:

1. keeps the answer in memory, so it holds even when storage throws (Safari private mode, blocked site data);
2. writes localStorage;
3. dispatches the window event `site-consent-changed`;
4. POSTs `/api/cookies/consent` with `keepalive`.

The banner fetches the options only when the visitor is undecided. With no optional categories, "Preferences" links to `/legal/cookies`. Otherwise it expands per-category checkboxes. `saveChoices` names the decision `accepted` / `rejected` / `custom` from what was actually ticked.

**Gating API for consumers:**

```ts
import { useConsent, useCategoryConsent } from '@/components/layout/CookieBanner';

const snapshot = useConsent();                   // 'loading' | 'undecided' | 'accepted' | 'rejected' | 'custom'
const allowed  = useCategoryConsent('marketing'); // boolean
```

`useCategoryConsent(key)` returns `false` while loading or undecided. It returns the stored per-category value if that key exists in the decision, and otherwise **falls back to the blanket flag** (`snapshot === 'accepted'`). Both hooks are `useSyncExternalStore`-based: SSR snapshot is `loading`, and they react to the consent event and to cross-tab `storage` events without a reload. The parsed categories object is cached by raw string to keep snapshot identity stable.

**GA4** (`AnalyticsLoader`, mounted in the locale layout) injects gtag only when a GA id resolves **and** `NODE_ENV === 'production'` **and** `useCategoryConsent('analytics')` is true. The id is emitted as `JSON.stringify(id).replace(/</g,'\\u003c')`. `page_location` is scrubbed of `t` / `token` query params (`scrubUrl` / `scrubQuery`) both in the initial `config` call and in the SPA `page_view` events from `GaPageviews`. `trackEvent(name, params)` in `src/lib/analytics/gtag.ts` no-ops until gtag exists.

**Scanner** (`GET /api/cms/cookies/scan`): `detectServices({ gaId, storagePrefix })` returns the hand-written registry (`alwaysPresent` plus GA4 with `_ga` and `_ga_<container>` when the id parses). `compareToDeclaration` then splits it into `matched` (with `declaredBy: 'stored' | 'automatic'`), `undeclared`, and `unknownToScanner`. Matching is by normalised service name. The scanner cannot discover anything it was not told about.

### 3.6 Script snippets

1. The admin saves a snippet (`scriptsManage`). `snippetInputSchema` is a discriminated union on `kind`:
   - `inline`: code must be non-empty and ≤ 64 KB, must not start with `<script`, and must not contain `</script` (case-insensitive). It is refused, not escaped.
   - `external`: `src` must be `https:`, have no userinfo, and be ≤ 2048 chars.
   - Shared fields: `slug` matches `^[a-z0-9]+(?:-[a-z0-9]+)*$`. `consentCategory` is `''`/null → null, or a category key. `lazy` and `enabled` are booleans. `notes` ≤ 2000 chars.
   - The service's `assertCategoryExists` rejects a consent category that is not in `cookie_categories` (422 with a `consentCategory` field error).
2. Every write calls `revalidateScripts()` (tag `cms:scripts`) and `logAudit` with the full snippet as `after`.
3. An editor places `[script name="<slug>"]` in rich text. `Shortcode.tsx` validates attributes against the declaration in `core/shortcodes/all.ts` and looks up `SHORTCODE_COMPONENTS.script` → `Script` (server component).
4. `Script` calls `getEnabledSnippetBySlug(slug)` (cached per slug, null when disabled or missing, null on DB error) and passes `publicSnippet(row)` (slug, kind, code, src, lazy, consentCategory; never the name or notes) to `ScriptSnippetView`.
5. `ScriptSnippetView` renders an anchor `<div data-script-snippet="<slug>">` plus `<SnippetRunner>`.
6. `SnippetRunner` calls `useCategoryConsent(consentCategory ?? '')`. `snippetMayRun(category, granted)` is `category === null || granted`. It renders `next/script` with `id="snippet-<slug>"` (dedupes across placements and client navigations) and `strategy = lazy ? 'lazyOnload' : 'afterInteractive'`.

**Injection point:** there is exactly one, wherever the shortcode is placed in content. There are no head/body-global injection slots, and GA4 is the only globally injected third-party script (hard-wired in the layout).

**CSP:** `PRODUCTION_CSP` in `next.config.ts` has `script-src 'self' 'unsafe-inline' https://www.googletagmanager.com`. Inline snippets run. **External snippets from any other host are blocked** until that origin is added to `script-src` (and `connect-src`/`img-src`/`frame-src` as the vendor needs) in `next.config.ts` and in the reverse-proxy config. `ScriptsManager`'s `CspNotice` shows the origin from `externalHost(src)` for this reason.

### 3.7 Google reviews (reviews-external)

Two sources, stored in one table:

| Source | Credential | Returns |
|---|---|---|
| `places` (Places API New) | API key from `integration_secrets['google.places.apiKey']` | At most 5 reviews, no owner replies. Field mask `reviews,rating,userRatingCount` |
| `gbp` (Business Profile v4) | OAuth refresh token `integration_secrets['google.gbp.refreshToken']` + env `GOOGLE_OAUTH_CLIENT_ID/SECRET` | All reviews, paged 50 × max 20 pages, with owner replies |

**OAuth:**

1. `POST /api/cms/integrations/google/oauth/start` (`settingsWrite`) stores `{state: randomUUID, at}` in setting `integrations.googleReviews.oauthState` and returns `{url}` (scope `business.manage`, `access_type=offline`, `prompt=consent`).
2. Google redirects to `GET /api/cms/integrations/google/oauth/callback` (`settingsWrite`, so the admin session must be present). The callback reads the state uncached (`getSettingUncached`), always clears it first, then requires matching `state` within 10 minutes.
3. It exchanges the code, stores the refresh token encrypted via `setSecret`, audits `secret.set`, and redirects to `<adminPath>/settings?tab=Integrations&connected=google`.
4. `redirectUri` is `${siteOrigin()}/api/cms/integrations/google/oauth/callback` and must be registered in the Google Cloud OAuth client.

**Sync:** `syncAllReviewLocations` returns nothing unless setting `integrations.googleReviews.enabled === true`. Otherwise it syncs each `review_locations` row with `enabled = true`, one after another.

- Per location: fetch, then map (`mapGbpReview` / `mapPlacesReview` drop payloads without an id or a 1–5 rating), then `upsertReview` keyed on `(location_id, external_id)`.
- `hidden` is never overwritten by a sync.
- Reviewer photos are downloaded **once** from `*.googleusercontent.com` / `*.ggpht.com` (≤ 2 MB, 8 s timeout). They are converted to 96 px WebP and stored via `uploadMedia`, so visitors never contact Google before consent.
- Success sets `last_synced_at` and clears `last_error`. Failure records `last_error` (≤ 500 chars) and returns it. `syncReviewLocation` never throws.

The sync runs through cron (`POST /api/cms/cron/google-reviews-sync` with `x-cron-secret: $CMS_CRON_SECRET`, module `googleReviews`) or the admin's `POST /api/cms/reviews-external/sync` (optional `{locationId}`).

**Display:** `[google-reviews layout="carousel|grid|badge" location="all|<slug>" limit="6" min="1"]` → `GoogleReviews` → `publicReviews(query)`. That returns `[]` unless the setting is enabled. `listExternalReviews` loads up to 500 rows, resolves the location slug (an unknown slug returns `[]`), and `filterExternalReviews` drops hidden rows, applies `min` and the location, sorts, then applies `limit` last. Structured data (`Review` / `AggregateRating`) is **deliberately not emitted** because of Google's self-serving review policy. A "Google" attribution is rendered.

### 3.8 Stats counters

`incrementCounter({scope, subjectId, metric, by?, at?})` validates identifiers (`^[a-z][a-z0-9_]{0,31}$`, positive safe integers) and **throws** on invalid input. It then does `INSERT ... ON DUPLICATE KEY UPDATE count = count + by` into the UTC day bucket. DB errors are logged and swallowed. `readCounters({scope, subjectIds?, since?})` returns `Map<subjectId, Record<metric, total>>`. No visitor identifiers are stored, which is why the popup counter runs without consent.

---

## 4. HTTP API

All `/api/cms/*` handlers built with `createRoute` get a same-origin check on writes (`core/api/same-origin.ts`) and zod validation. Permissions come from `PERMISSIONS` in `src/cms/modules/auth/permissions.ts`.

### Public

| Method | Path | Auth / gate | Purpose |
|---|---|---|---|
| POST | `/api/contact` | none; origin (prod), 5/min/IP, honeypot | Contact form: store + email |
| POST | `/api/newsletter` | module `newsletter`; 5/min/IP; honeypot | Subscribe |
| GET | `/api/cookies/consent` | none | Banner options + policy version |
| POST | `/api/cookies/consent` | none; 20/min/IP; 8 KB | Record a consent decision |
| POST | `/api/cms/popups/track` | module `popups`; 120/min/IP | `{popupId, metric: impression/click/close}` counter |
| GET | `/api/cms/commerce/unsubscribe?e=&s=&locale=` | signed link | Suppress an address (commerce; see 08) |

### Admin

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/api/cms/forms?page&pageSize&formType&status&search` | `cms.forms.read` | Paginated submissions + distinct `types` |
| GET | `/api/cms/forms/:id` | `cms.forms.read` | One submission with payload |
| PATCH | `/api/cms/forms/:id` `{status?, notes?}` | `cms.forms.write` | Triage; audited `submission.update` |
| GET | `/api/cms/newsletter?status=all\|active\|unsubscribed&search&page&pageSize` | `cms.newsletter.read` + module | List + `counts` |
| PATCH | `/api/cms/newsletter/:id` `{subscribed}` | `cms.newsletter.write` + module | Unsubscribe / resubscribe (not audited) |
| DELETE | `/api/cms/newsletter/:id` | `cms.newsletter.write` + module | Erase (not audited) |
| GET | `/api/cms/cookies/categories` | `cms.settings.read` | Full catalogue with services |
| POST | `/api/cms/cookies/categories` | `cms.settings.write` | Create category |
| PATCH / DELETE | `/api/cms/cookies/categories/:id` | `cms.settings.write` | Update / delete (cascades services) |
| POST | `/api/cms/cookies/services` | `cms.settings.write` | Create service |
| PATCH / DELETE | `/api/cms/cookies/services/:id` | `cms.settings.write` | Update / delete |
| GET | `/api/cms/cookies/scan` | `cms.settings.read` | Scanner report |
| GET / POST | `/api/cms/scripts` | `cms.scripts.manage` | List / create snippet |
| PATCH / DELETE | `/api/cms/scripts/:id` | `cms.scripts.manage` | Replace (full body) / delete |
| GET | `/api/cms/reviews-external` | `cms.commerce.reviews.read` + module `googleReviews` | All synced reviews incl. hidden |
| PATCH | `/api/cms/reviews-external/:id/hide` `{hidden}` | `cms.commerce.reviews.write` + module | Hide/show |
| GET / POST | `/api/cms/reviews-external/locations` | read: `settings.read`; write: `settings.write`; + module | List / upsert a location by slug |
| POST | `/api/cms/reviews-external/sync` `{locationId?}` | `cms.settings.write` + module; 5/min | Sync now |
| POST | `/api/cms/integrations/google/oauth/start` | `cms.settings.write` + module | Returns Google consent URL |
| GET | `/api/cms/integrations/google/oauth/callback?code&state` | `cms.settings.write` + module | Stores refresh token, redirects to admin |
| POST | `/api/cms/cron/google-reviews-sync` | `x-cron-secret` | Nightly sync |

Popups have no dedicated admin API. They are ordinary documents under `/api/cms/[collection]` (collection `popup`, see 03-content-model.md).

---

## 5. Admin UI

| Screen | Path | Component | Permission | Notes |
|---|---|---|---|---|
| Submissions | `/admin/submissions` | `SubmissionsTable` | `formsRead` (write for status/notes) | Filters `type`, `status`, `search`, `page` mirrored in the URL. The drawer shows `PayloadView` (read-only payload), email delivery state (`sent` / `failed` with `email_error` tooltip / `skipped`), status select and a notes textarea. No CSV export, no delete. |
| Newsletter | `/admin/newsletter` | `SubscribersTable` | `newsletterRead`; buttons need `newsletterWrite` | 404 when the module is off. Tabs Subscribed / Unsubscribed / All with counts. Unsubscribe keeps the row; Delete (with confirm) erases it. `ip_hash`/`ua` are never sent to the client (`subscriberView`). |
| Cookies | `/admin/cookies` | `CookiesManager` + `CookieScanner` | `settingsRead` / `settingsWrite` | Category key is fixed after creation. Required categories are shown as always on. The scanner's "Declare" posts through the normal service-create route. |
| Scripts | `/admin/scripts` | `ScriptsManager` | `scriptsManage` | Consent dropdown lists only **non-required** categories. Shows the shortcode to copy and a CSP notice for external hosts. Enable/disable toggle re-sends the full snippet. |
| Popups | Content → Popups (generic `[collection]` admin route) | `DocumentForm` | content permissions | Sections: Content, Where, When, Design (collapsed). Listed only while the module is on. |
| Google reviews | none | none | none | No admin screen exists (see Gotchas). |

Popup fields (`collection.ts`): `title`\*, `body`, `image` (unused by every design), `buttonLabel`, `buttonUrl`, `targetMode` (`all`/`paths`), `targetPaths`, `targetExclude` (one per line), `position`, `size` (`s/m/l`), `trigger` (`delay/load/scroll/exit`), `triggerValue`, `frequencyMode` (`days/once/always`), `frequencyDays`, `startAt`, `endAt` (text `YYYY-MM-DD`), `priority` (text, parsed as a number), `preset`, `backgroundImage`, `backgroundColor`, `textColor`, `buttonColor`, `buttonTextColor`, `textSize`. `title`, `body` and `buttonLabel` are localized.

---

## 6. Configuration

### Environment variables

| Var | Used by | Notes |
|---|---|---|
| `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` | both Graph senders | Entra app with `Mail.Send` **application** permission, admin-consented |
| `GRAPH_SENDER_ADDRESS` | both Graph senders | UPN of the sending mailbox |
| `CONTACT_RECIPIENT_EMAIL` | both Graph senders | Default recipient. **Required even for modules that always pass `to`**, because `readEnv` checks all five |
| `ADMIN_SESSION_SECRET` (≥ 32 chars) | `unsubscribe.ts` | Also the unsubscribe HMAC key (domain-separated). Rotating it invalidates every unsubscribe link already sent |
| `NEXT_PUBLIC_SITE_URL` | `/api/contact` origin check, `createRoute` same-origin, `siteOrigin()` for OAuth redirect and email logo | Missing in production → public writes via `createRoute` fail closed |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | `resolveGaId` | Build-time fallback when the `analytics.gaMeasurementId` setting is empty |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | `reviews-external/google.ts` | Business Profile only |
| `CMS_TOKEN_ENCRYPTION_KEY` | `integration_secrets` | Decrypts Places key / refresh token |
| `CMS_CRON_SECRET` | cron route | `google-reviews-sync` |

### Module flags

`newsletter`, `popups` and `googleReviews` all default to `false` in `src/site.config.ts` and are toggled in Settings → Modules. Descriptions and off-notes live in `core/settings/schema.ts`. Forms, email, cookies and scripts are core and always on.

### Other knobs

- `STORAGE_PREFIX` in `src/lib/storage-keys.ts` (passed as `storagePrefix` to `defineConfig`). Every consent/popup/cart localStorage key derives from it. Changing it on a live site re-asks consent and forgets popup history.
- Default cookie catalogue: `npm run db:seed-cookies` (`seedCookieCatalog`). It is non-destructive: an existing key is left untouched. Seeds `necessary` (required, one service), `analytics`, `marketing`.
- CSP: `PRODUCTION_CSP` / `ADMIN_CSP` in `next.config.ts` (production only; dev sends no CSP).
- Rate limits are constants in each route (`RATE_LIMIT` in `/api/contact` and `/api/cookies/consent`, `SUBSCRIBE_RATE_LIMIT` in `newsletter/routes.ts`, `popup-track` 120/min, `reviews-sync` 5/min).

---

## 7. Extending

### Recipe: add a new form

The contact endpoint is designed to grow by `kind`. For a "quote request" form:

1. **Schema.** In `src/app/api/contact/route.ts`, add a zod object with `kind: z.literal('quote')`, the same `locale` and `_hp` fields, and strict length caps. Add it to the union:
   ```ts
   const quoteSchema = z.object({
     kind: z.literal('quote'),
     locale: z.enum(['el', 'en']).optional(),
     _hp: z.string().optional(),
     name: z.string().trim().min(1).max(120),
     email: z.string().trim().email().max(254),
     company: z.string().trim().max(160).optional().or(z.literal('')),
     budget: z.string().trim().max(40).optional().or(z.literal('')),
     message: z.string().trim().min(1).max(4000),
   });
   const payloadSchema = z.discriminatedUnion('kind', [contactSchema, quoteSchema]);
   ```
2. **Kind type.** Extend `ContactFormKind` in `src/lib/contact-submission.ts` to `'contact' | 'quote'`. `form_type` is a free varchar(64), so no migration is needed.
3. **Rows.** Add a `case 'quote':` to the switch that sets `subject` and `rows`. Rows become both the email table (`rowsToHtml`) and the stored `payload`, so label them for humans.
4. **Client.** Write the component (copy `ContactForm.tsx`). Keep the hidden `_hp` input, send `content-type: application/json` and `kind: 'quote'`, and show a generic error on any non-2xx.
5. **Messages.** Add strings to `messages/{el,en}.json`. `test/lib/messages-parity.test.ts` enforces parity.
6. **Tests.** Extend `test/lib/contact-submission.test.ts` / `test/lib/email-rows.test.ts` for any new pure logic.
7. **Docs.** Update `docs/CMS-FEATURES-FOR-PROPOSALS.md` (project rule for CMS changes).

The submission then appears in Admin → Submissions with type `quote` automatically (the type filter comes from `SELECT DISTINCT form_type`).

For an entirely separate endpoint (for example one that must notify a different inbox), reuse the building blocks in the same order: `createSubmission` → send → `markSubmissionDelivered` / `markSubmissionUndelivered`. Use `claimSubmissionNotification` if a double submit could send twice. Prefer the core `sendGraphMail` (`@/cms/core/email`) with `to:` and `replyToSuffix`.

The `[form id="..."]` shortcode is declared in `core/shortcodes/all.ts` but has **no component** in `src/shortcodes/index.tsx`, so it renders nothing. Wiring a form into rich text means adding a component to `SHORTCODE_COMPONENTS`.

### Recipe: send a new transactional email

1. Put the builder in the owning module (e.g. `src/cms/modules/<module>/emails.ts`), marked `import 'server-only'`.
2. Build HTML as a string. Escape **every** interpolated value with `escapeHtml`. Use `emailColor('<palette-token>')` instead of hex so the saved brand applies, and use `formatMoney(minor, currency, locale)` / `formatDate(ymd, locale)` for amounts and dates. Provide el/en labels, following `modules/customers/emails.ts`.
3. Send with an explicit recipient:
   ```ts
   import { emailColor, escapeHtml, sendGraphMail } from '../../core/email';

   export async function sendThingReady(opts: { to: string; name: string; locale: string }) {
     const html =
       `<div style="font-family:system-ui,sans-serif;color:${emailColor('midnight-navy')};">` +
       `<p>${escapeHtml(opts.name)}, ...</p></div>`;
     await sendGraphMail({ to: opts.to, subject: '...', html });
   }
   ```
4. Decide the failure policy at the call site. The house pattern is **never let mail failure undo a committed business action**: wrap it like `safeSend` in `orders.ts`, or record the outcome like `sendAndRecord` in `booking/emails.ts` or `markSubmissionUndelivered`.
5. If the mail is **not strictly transactional** (reminders, promotions): check `isSuppressed(email)` (or `suppressedAmong` for batches) before sending, and include `unsubscribeUrl(siteOrigin, email, locale)` in the body. Today that URL points at the commerce unsubscribe route.
6. If an action must be refused up front when mail is impossible, check `graphMailConfigured()`.
7. Test pure builders by injecting the sender, as `modules/auth/mfa-email.ts` does (`send = sendGraphMail` default parameter). See `test/cms/mfa-email.test.ts`.

### Recipe: add a third-party script that respects consent

**No-code path (preferred, admin only):**

1. Admin → Cookies: make sure a suitable category exists (e.g. `marketing`) and add a **service** row naming the vendor (name, provider, purpose per locale). The banner lists it and `/legal/cookies` declares it.
2. Admin → Scripts: create a snippet. Use kind `external` for a vendor URL or `inline` for a loader, and set **Consent category** to that category key. Leave it empty only for functional widgets that set nothing tracking-related.
3. If external, add the vendor origin to `script-src` (and whatever `connect-src` / `img-src` / `frame-src` it needs) in `PRODUCTION_CSP` in `next.config.ts` **and** in the Nginx/Plesk header config. Then deploy.
4. Place `[script name="<slug>"]` in the page(s) that need it. There is no site-wide slot. For every page, put it in a globally rendered content area, or use the code path below.

**Code path (site-wide scripts):** follow `AnalyticsLoader`:

```tsx
'use client';
import Script from 'next/script';
import { useCategoryConsent } from '@/components/layout/CookieBanner';

export function PixelLoader({ pixelId }: { pixelId: string }) {
  const allowed = useCategoryConsent('marketing');
  if (!pixelId || process.env.NODE_ENV !== 'production' || !allowed) return null;
  const idLiteral = JSON.stringify(pixelId).replace(/</g, '\\u003c'); // script-sink safe
  return <Script id="pixel-init" strategy="afterInteractive">{`/* ... ${idLiteral} ... */`}</Script>;
}
```

Mount it next to `<AnalyticsLoader>` in `src/app/[locale]/layout.tsx`. Also:

- add the service to `alwaysPresent` or as a conditional entry in `core/cookies/registry.ts` / `detectServices`, so the scanner reports it (update `test/cms/cookie-scan.test.ts`);
- declare it in the catalogue (seed defaults in `core/cookies/defaults.ts` if every site should have it);
- update the CSP.

Unmounting a `next/script` on revoked consent does **not** remove code that already ran or cookies it set. A full reload is needed for a clean state.

### Adding a new cookie category in code

Add it to `DEFAULT_COOKIE_CATEGORIES` in `core/cookies/defaults.ts` and run `db:seed-cookies` on each site. Existing keys are never overwritten, so admin wording survives.

---

## 8. Testing

Run one file with:

```bash
npx tsx --tsconfig ./tsconfig.test.json --test test/cms/newsletter.test.ts
```

Run everything with `npm test`, which expands the globs in `package.json`.

| Area | Test files |
|---|---|
| Contact / forms | `test/lib/contact-submission.test.ts`, `test/lib/email-rows.test.ts`, `test/lib/public-origin.test.ts`, `test/cms/payload-fields.test.ts`, `test/cms/admin-table-markup.test.tsx` |
| Email | `test/cms/email-brand-colours.test.ts`, `test/cms/brand.test.ts`, `test/core/unsubscribe.test.ts`, `test/cms/mfa-email.test.ts`, `test/commerce/abandoned.test.ts` (suppression use) |
| Newsletter | `test/cms/newsletter.test.ts`, `test/cms/newsletter-outcome.test.ts`, `test/lib/newsletter-client.test.ts`, `test/site/newsletter.test.tsx`, `test/site/module-gate.test.ts` |
| Popups | `test/cms/popups.test.ts`, `test/cms/popup-presets.test.ts` |
| Cookies / consent / analytics | `test/cms/cookie-declaration.test.ts`, `test/cms/cookie-scan.test.ts`, `test/cms/cookie-seed.test.ts`, `test/cms/storage-keys.test.ts`, `test/components/analytics-scrub.test.tsx` |
| Scripts | `test/cms/script-snippet-schema.test.ts`, `test/cms/script-shortcode-registry.test.ts`, `test/cms/scripts-manager.test.tsx`, `test/components/script-shortcode.test.tsx` |
| Reviews | `test/cms/google-reviews.test.ts`, `test/core/remote-image.test.ts`, `test/core/secrets.test.ts` |
| Stats | `test/core/stat-counters.test.ts` |
| Cron wiring | `test/core/cron-route.test.ts`, `test/core/cron.test.ts` |

Coverage gaps: nothing tests `/api/contact` or `/api/cookies/consent` as handlers (only their extracted helpers), and there is no test for `CookieBanner` / `useCategoryConsent` or `PopupRuntime`.

---

## 9. Gotchas and invariants

- **One Graph sender.** Everything, `/api/contact` included, sends through `sendGraphMail` from `@/cms/core/email`, which applies the email branding. `/api/contact` passes `replyToSuffix: '(via <brand> contact form)'` so the inbox shows the Reply-To came from a form. The old `src/lib/email/graph.ts` is gone; do not reintroduce a second sender.
- **One body per Graph message.** `graphMailBody` picks it: `html` when non-empty (branded), otherwise `text` as `contentType: 'Text'` (unbranded). A mail with neither throws before any network call. `text` is **not** sent alongside HTML — Graph takes one body.
- **Store before send** is the invariant for form submissions. `email_status` is the delivery record, `status` is triage. The two are independent. `ip_hash` is never populated on either table, despite the column.
- **Rate limits need `x-real-ip`.** `/api/contact` and `/api/cookies/consent` use the core limiter (`src/cms/core/rate-limit.ts`), like `createRoute`: in production a request without `x-real-ip` is refused. Nginx must set the header.
- **Newsletter is capture-only.** There is no double opt-in (`double_opt_in_at` unused), no confirmation or welcome mail, no public unsubscribe, and no Mailchimp/Brevo sync (`mailchimp_*` unused). `newsletter_subscribers.unsubscribed_at` and `email_suppressions` are **not linked**: unsubscribing from abandoned-cart mail does not unsubscribe the newsletter, and vice versa. Any future newsletter sender must check both.
- **Newsletter PATCH/DELETE are not audited**, unlike submissions, cookies and scripts.
- **Membership disclosure.** `POST /api/newsletter` returns `already-subscribed`, so it confirms whether an address is on the list. This is intentional and bounded only by the rate limit.
- **Popup targets are written without the locale.** `PopupRuntime` passes the path through `popupPagePath(pathname, locales)`, which strips a leading segment that names a configured locale, so `/shop` matches `/shop` and `/en/shop`. A target cannot aim at one language only; an old target such as `/en/shop/*` no longer matches anything.
- **Popup dates** are UTC. `startAt` `YYYY-MM-DD` starts at 00:00 UTC; a date-only `endAt` is inclusive, running to 23:59:59.999 UTC of that day. A value with a time is taken literally.
- **Popup seen-key** is `storageKeys(prefix).popupSeen` (`<prefix>-popup-seen`), shared by `PopupRuntime` and the cookie registry (`alwaysPresent`, "Popups", necessary), so a dashed prefix works and the scanner reports it.
- **Popup counters are write-only.** `popupTrackRoute` accepts any positive `popupId` without checking it exists (rate-limited, not consent-gated), and `readCounters` is not called anywhere, so impressions/clicks are never shown in the admin. `PopupPayload.bodyHtml` is always `null` (vestigial) and the `image` field is used by no design.
- **Popups wait for consent to be answered**, but not for any category: they are content, not tracking. The track call runs regardless of consent (it stores no personal data).
- **`useCategoryConsent` falls back to the blanket flag** when the stored decision lacks the key. Declaring a category can only tighten behaviour. A snippet gated on a category added *after* a visitor accepted everything will run for them (blanket `accepted`) until they decide again. The policy version changes, but the banner does not re-prompt on a version change: it only shows when undecided.
- **Consent POST stores only known categories.** A category key that the banner sent but that no longer exists is dropped. Required categories are always recorded as `true`.
- **Snippet consent category must exist** in `cookie_categories` at save time. Deleting a category later leaves snippets pointing at a key no banner offers. Those snippets then follow the blanket flag (see previous point), not "never run".
- **External snippets need a CSP change and a deploy**. The admin cannot make them work alone. Inline snippets run because `script-src` contains `'unsafe-inline'`.
- **`[form]` and `[popup]` shortcodes are declared but not implemented** in `src/shortcodes/index.tsx`, so they render nothing on the site even though the editor dialog offers them.
- **Google reviews have no admin UI.** There is no Integrations tab in Settings (the OAuth callback redirects to `?tab=Integrations`, which does not exist), and nothing in the codebase calls `setSecret('google.places.apiKey', ...)`, so the Places source cannot be configured without a manual DB/secret write. Locations exist in two places: the `locations[]` array in setting `integrations.googleReviews` (validated but unused by sync) and the `review_locations` table (what sync and shortcodes actually read). `publicReviews` ignores the setting's `minRating` / `sort`. The badge layout's average and count cover only the rows returned after `limit`, not all reviews. Treat this module as unfinished.
- **Reviews moderation uses commerce permissions** (`cms.commerce.reviews.*`) even though the module is `googleReviews`.
- **`REVIEWS_TAG` is exported but unused.** `listExternalReviews` is not cached and hits the DB on each render of a page containing the shortcode.
- **Unsubscribe HMAC key is `ADMIN_SESSION_SECRET`.** Rotating the session secret silently breaks every unsubscribe link in mail already sent.
- **Cookie catalogue cache.** Public reads are cached under `cms:cookies`. Every admin write calls `revalidateCookies()`. Direct DB edits wait up to `CMS_CACHE_REVALIDATE`. The GA id is read from a separate cached setting, so the two invalidate independently by design.
- **GA only loads in production** and only with `analytics` consent (or the blanket flag when no `analytics` category exists). Payment-link tokens (`t`, `token`) are scrubbed from every GA hit. Add any new sensitive query parameter to `SENSITIVE_QUERY_PARAMS` in `AnalyticsLoader.tsx`.
