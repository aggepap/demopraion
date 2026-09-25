# 10 · Settings, scheduled jobs, updates & operations

This manual covers the parts of the CMS that are about running a site rather than editing
content. It describes the `site_settings` key/value store and its admin screen, the
scheduled-job ("cron") endpoint and every job it can run, the CMS update package format with
its release and install CLIs, and the edit-lock WebSocket relay. It also has a full
environment-variable reference, deployment and backup notes, how to add a language, how the
end-user PDF guides are rebuilt, and a troubleshooting section. Everything here comes from the
code on the `CMS` branch. Where an older document under `docs/` disagrees with the code, the
difference is called out.

Related guides: [01-architecture.md](01-architecture.md) · [02-database.md](02-database.md) ·
[03-content-model.md](03-content-model.md) · [04-admin-ui.md](04-admin-ui.md) ·
[05-auth-users-security.md](05-auth-users-security.md) ·
[06-media-seo-structured-data.md](06-media-seo-structured-data.md) ·
[07-forms-email-marketing.md](07-forms-email-marketing.md) · [08-commerce.md](08-commerce.md) ·
[09-booking.md](09-booking.md)

---

## 1. File map

| Path | What it is |
|---|---|
| `src/cms/core/settings/index.ts` | KV store: `getSetting`, `getSettings`, `setSetting`, `SETTINGS_TAG`, `settingTag`. Re-exports the schema. |
| `src/cms/core/settings/schema.ts` | Client-safe setting registry: `MANAGED_SETTINGS`, `EXTRA_MANAGED_KEYS`, key constants, `MODULE_LABELS`, `moduleSettingKey`, `parseMultiValue` / `formatMultiValue`, `readBooleanSetting`, `resolveLocaleSet`. |
| `src/cms/core/settings/validate.ts` | `validateSettingValue(key, def, value)`, the write-boundary check for each type. |
| `src/cms/core/settings/structured.ts` | `checkStructuredSetting(key, value)`: zod schemas and sanitisers for the JSON-valued keys. |
| `src/cms/core/settings/modules.ts` | `resolveModuleFlags(config)`, `isModuleEnabled(config, name)`. |
| `src/cms/core/settings/locales.ts` | `resolveLocaleSettings(config)`, which applies `i18n.locales` at runtime. |
| `src/cms/core/settings/analytics.ts` | `ANALYTICS_GA_ID_KEY`, `resolveGaId` (setting first, then `NEXT_PUBLIC_GA_MEASUREMENT_ID`). |
| `src/cms/core/cache.ts` | `CMS_CACHE_REVALIDATE = false`. The rationale is in its comment and is also covered in section 10. |
| `src/cms/core/routes/settings.ts` | `settingsGetRoute`, `settingsUpdateRoute` (route factories). |
| `src/app/api/cms/settings/route.ts` | Glue: binds the factories to `@/site.config`. |
| `src/app/admin/(shell)/settings/page.tsx` | Server page. Loads the settings and builds the module, Fields and extra tabs. |
| `src/cms/admin/SettingsForm.tsx` | Client form: the generic tabs, Modules, Languages, and one PATCH on save. |
| `src/cms/admin/{BrandSettings,GiftCardSettings,ShippingSettings,StructuredDataSettings,WishlistSettings}.tsx` | Bespoke editors for structured keys. Each has its own save. |
| `src/cms/core/cron/policy.ts` | Pure logic: `authorizeCronRequest`, `resolveCronJob`, `isValidCronJobName`, `CRON_SECRET_MIN_LENGTH`. |
| `src/cms/core/cron/service.ts` | `runCronJob` (MySQL `GET_LOCK`) and the `cronRoute` factory. |
| `src/app/api/cms/cron/[job]/route.ts` | The job map. This is the one list of scheduled jobs. |
| `src/app/api/cms/reservations/expire/route.ts`, `src/app/api/cms/abandoned-carts/remind/route.ts` | Older per-job endpoints with their own secrets. |
| `src/cms/update/{cli,install,manifest,plan,version,zip}.mjs` | CMS updater. Dependency-free Node ESM. |
| `src/cms/version.json` | `{ "version": "x.y.z" }`: the CMS version this checkout runs. |
| `scripts/cms-release.mjs` | Builds `releases/cms-update-<version>.zip`. Only in the base; never shipped to sites. |
| `.claude/skills/new-site/scripts/core-sync.mjs` (+ `core-sync-plan.mjs`) | Checkout-to-checkout core sync, the older alternative to the zip. |
| `src/cms/realtime/lock-server.mjs` | Edit-lock WebSocket relay (a separate process). |
| `src/cms/core/locks/*`, `src/app/api/cms/locks/**` | App-side lock endpoints that the relay calls. |
| `src/cms/db/migrate.ts` | `npm run db:migrate`. |
| `src/cms/db/adapters/mysql/load-env.ts` | `.env.local` / `.env` loader for the tsx CLIs. |
| `.env.example` | Environment template. The updater treats it as glue. |
| `docs/user-guides/src/*.md`, `docs/user-guides/_build/build.mjs` | Greek end-user guides and their PDF builder. |
| `docs/CMS-FEATURES-FOR-PROPOSALS.md` | Sales-facing feature list, updated on every CMS change. |

---

## 2. Data model

### `site_settings`

Defined in `src/cms/db/adapters/mysql/schema/settings.ts`:

| Column | Type | Notes |
|---|---|---|
| `key` | `varchar(128)` PK | Dotted name, for example `booking.mode` or `module.commerce`. |
| `value` | `json` | Plain strings for form fields, booleans for module flags, objects/arrays for structured keys. |
| `updated_by` | `int` FK → `admin_users.id` (`ON DELETE SET NULL`) | `null` for seeds and CLI writes. |
| `updated_at` | `timestamp` | `defaultNow().onUpdateNow()`. |

Nothing else about settings is stored separately. There is no history table. Each save via the
API writes one `settings.update` audit row, and `after.changed` lists the keys written (see
[05-auth-users-security.md](05-auth-users-security.md) for the audit log).

Scheduled jobs have no tables of their own. Concurrency is controlled by the MySQL named lock
`cms-cron:<job>`, and a run that did work writes an audit row (`action: 'cron.run'`,
`actorLabel: 'cron'`, `subjectType: 'cron'`, `subjectId: <job>`).

### Setting keys

Types: `text`, `email`, `textarea`, `select`, `multiselect` (comma-separated string), `money`
(major units, normalised to `.`), `gaId`, and `boolean` (`on`/`off`). "Module" means the field's
tab is hidden while that module is off. The value is still kept and still sent on save.

**Form-managed keys (`MANAGED_SETTINGS`, rendered by `SettingsForm`)**

| Group | Key | Type | Default / fallback | Main reader |
|---|---|---|---|---|
| General | `site.supportEmail` | email | none | email reply-to, public contact |
| Analytics | `analytics.gaMeasurementId` | gaId (`^G-[A-Z0-9]{4,20}$`) | falls back to `NEXT_PUBLIC_GA_MEASUREMENT_ID` | `resolveGaId`, `AnalyticsLoader`, cookie declaration |
| Notifications | `notifications.inquiryEmails` | textarea | none | forms/quote notifications, `commerce/orders.ts` |
| SEO | `seo.robotsExtraDisallow` | textarea (one path per line) | none | `src/app/robots.ts` via `core/seo/setting-lines.ts` |
| SEO | `seo.sitemapExtraUrls` | textarea (one URL per line) | none | sitemap |
| Ecommerce (commerce) | `ecommerce.currency` | select `EUR`/`USD`/`GBP` | `EUR` (`DEFAULT_CURRENCY`) | `commerce/read.ts` |
| Ecommerce (commerce) | `ecommerce.paymentProvider` | select `manual`/`stripe`/`paypal`/`viva` | `manual` | `commerce/payments.ts` |
| Ecommerce (commerce) | `ecommerce.giftWrapFee` | money | 0 / free | `commerce/orders.ts` |
| Ecommerce (commerce) | `ecommerce.filters.priceControl` | select `slider`/`fields` | `slider` | `commerce/filters.ts` |
| Ecommerce (commerce) | `ecommerce.pendingOrderTtlHours` | text (whole hours) | 48. `0` turns it off | `commerce/stale-orders.ts` (cron job) |
| Booking (booking) | `booking.kinds` | multiselect `transport,stay` | both | `booking/settings-read.ts`, structured data |
| Booking (booking) | `booking.mode` | select `request`/`instant` | `request` | `booking/settings-read.ts` |
| Booking (booking) | `booking.currency` | select | then `ecommerce.currency`, then EUR | `booking/read.ts` |
| Booking (booking) | `booking.timezone` | text (IANA) | `Europe/Athens` | `booking/settings-read.ts` |
| Booking (booking) | `booking.notificationEmails` | textarea | none | booking notifications |
| Booking (booking) | `booking.requestExpiryHours` | text | 72 (placeholder) | expiry sweep |
| Booking (booking) | `booking.paymentHoldMinutes` | text | 20 (placeholder) | expiry sweep |
| Booking (booking) | `booking.paymentLinkExpiryDays` | text | 7 (placeholder) | payment links |
| Booking (booking) | `booking.depositPercent` | text | 0 = full amount | payments |
| Booking (booking) | `booking.defaultCapacity` | text | 1 | allocation |
| Booking (booking) | `booking.paymentProvider` | select (same four as commerce) | `manual` | `booking/settings-read.ts` |
| Booking (booking) | `booking.paymentInstructions` | textarea | none | approval / confirmation email |
| Booking (booking) | `booking.surchargePercent.stripe` / `.paypal` / `.viva` | text | 0 | `booking/payments.ts` |
| Booking (booking) | `booking.leadTimeHours` | text | 24 (placeholder) | availability |
| Security | `security.require2fa` | select `off`/`on` | `off`. Read strictly as `=== 'on'` | `core/routes/auth-mfa.ts` |

The booking "defaults" marked *(placeholder)* appear only as form placeholders. The value
actually used when a key is unset comes from the reader in `booking/settings-read.ts`. See
[09-booking.md](09-booking.md).

**Structured keys (`EXTRA_MANAGED_KEYS`, edited by bespoke screens, validated in `structured.ts`)**

| Key | Area | Editor | Validation |
|---|---|---|---|
| `brand.identity` | Branding | `BrandSettings` | `brandIdentitySchema` |
| `brand.palette` | Branding | `BrandSettings` | `brandPaletteSchema` |
| `seo.schema` | Structured data | `StructuredDataSettings` | `schemaPolicySchema` |
| `integrations.googleReviews` | Google reviews | reviews settings | zod in `structured.ts` |
| `ecommerce.shipping` | Commerce | `ShippingSettings` | zod |
| `ecommerce.coupons` | Commerce | `CouponsManager` | zod (≤500, unique codes, percent ≤100) |
| `ecommerce.wishlist` | Commerce | `WishlistSettings` | zod |
| `ecommerce.giftCards` | Commerce | `GiftCardSettings` | zod |
| `cms.customFields` | Fields | `CustomFieldsManager` | `sanitizeCustomFieldsConfig`. Merged per collection, and **requires** `cms.customFields.baseline` |
| `cms.seoFields` | Fields | `SeoFieldsManager` | `sanitizeSeoFieldOverrides`, and **requires** `cms.seoFields.baseline` |

**Other keys**

| Key | Written by | Notes |
|---|---|---|
| `module.<name>` | Modules tab | One per key of `config.modules`: `commerce`, `booking`, `forms`, `seo`, `newsletter`, `customers`, `googleReviews`, `popups`, `media`, `pm` (`DEFAULT_MODULES` in `src/cms/config/config.ts`). The value **must be a JSON boolean**. A missing or non-boolean value falls back to the compile-time flag in `site.config.ts`. |
| `i18n.locales` | Languages tab | `{ editing: string[], public: string[] }`, normalised by `normalizeLocaleSettings`. |
| `integrations.googleReviews.oauthState` | `reviews-external/routes.ts` | One-time OAuth `state`. Written directly with `setSetting`, not through the API allowlist. |
| `cms.customFields.baseline`, `cms.seoFields.baseline` | PATCH body only | Not stored. They tell the route which copy the client edited, for conflict detection. |

---

## 3. How it works

### 3.1 Reads and caching

`getSetting(key)` wraps a single-row select in `unstable_cache` with key parts
`['cms-setting', key]`, tags `cms:settings` and `cms:setting:<key>`, and
`revalidate: CMS_CACHE_REVALIDATE` (`false`, so never on a timer). If the database is
unreachable, for example during a static build with no DB, the function logs
`[cms/settings] getSetting failed` and returns `null` **without caching** the result. Pages
degrade instead of failing the prerender.

`getSettings(keys)` runs `getSetting` for each key in parallel. Callers should not add a cache of
their own.

`setSetting(key, value, updatedBy)` upserts with `onDuplicateKeyUpdate`. This is MariaDB/MySQL
specific; a comment notes it would move behind the adapter if a Postgres adapter is added. It then
purges that key's cache (`invalidateSetting(key)`, tag `cms:setting:<key>`), so every writer —
the settings route, the Google OAuth flow, anything else — leaves readers current. Outside a
request context (seed CLIs) the purge is a no-op. The API route additionally purges
`cms:settings` after a save.

`getSettingUncached(key)` reads the row straight from the database and **throws** on a DB failure
instead of returning `null`. Use it for decisions about a value somebody just wrote: the one-use
OAuth `state`, and the baselines the settings route's conflict checks compare against.

### 3.2 Runtime overlays on compile-time config

- **Module flags.** `resolveModuleFlags(config)` reads `module.<name>` for every configured
  module. It uses the stored value only if it is a boolean, and otherwise the config default.
  Every module-gated route (`isModuleEnabled`), the admin sidebar and the cron route go through
  this function.
- **Languages.** `resolveLocaleSettings` and `resolveLocaleSet(selected, pool, must)`: an
  unset list means "all of pool". `main` (`config.defaultLocale`) is always included, and
  `public ⊆ editing ⊆ installed`.

### 3.3 The write path (`PATCH /api/cms/settings`)

`settingsUpdateRoute`:

1. Guard `requireApiPerm(PERMISSIONS.settingsWrite)` (`cms.settings.write`). Same-origin is
   enforced (the `createRoute` default).
2. Body: `z.record(string, unknown)`. The allowlist is `managedKeys(config)`, which is
   `MANAGED_SETTING_KEYS + EXTRA_MANAGED_KEYS + module.<name>… + i18n.locales`.
   **Keys outside the allowlist are silently ignored.**
3. Every allowed key is validated first (`applySettingsUpdate`); nothing is written until all of
   them pass:
   - `cms.customFields` goes through `mergeCustomFields`. Without a baseline the response is
     422. It returns 409 `conflict` if any collection in the patch differs from its baseline.
     Otherwise it does a shallow per-collection merge onto the stored value, then validates.
   - `cms.seoFields` goes through `assertSeoFieldsBaseline` (compared after sanitising), then
     validation.
   - `i18n.locales` goes through `normalizeLocaleSettings`. An invalid shape is **skipped**,
     not rejected.
   - Every other key goes through `validateSettingValue`, which dispatches by key/type: structured
     check, `module.*` must be a boolean, text ≤ 20 000 chars, email, money (`^\d+([.,]\d{1,2})?$`
     with the comma normalised), gaId, boolean, select option, multiselect options (re-encoded).
     A failure throws a 422 with `fieldErrors[key]`.
4. `revalidateTag('cms:settings')`, audit `settings.update`, then return the fresh values for all
   managed keys.

Only then are the keys written, one `setSetting` each (each purging its own cache). There is
still no transaction, so a DB error midway can leave a partial save, but a validation error
(422/409) writes nothing.

### 3.4 Scheduled jobs

The CMS has no scheduler of its own. An external scheduler calls
`POST /api/cms/cron/<job>` with header `x-cron-secret: $CMS_CRON_SECRET`. `cronRoute`
(`src/cms/core/cron/service.ts`) does the following:

1. `sameOrigin: false`, because the secret is the whole authorisation.
2. Rate limit scope `cms-cron`, 30 requests/min per client IP (in-memory, per process). A request
   with no `X-Real-IP` that carries the correct secret is counted in one shared bucket instead of
   being refused (`trustedWithoutIp`); one without the right secret is refused as before.
3. `authorizeCronRequest(header, process.env.CMS_CRON_SECRET)`. If the secret is unset or
   shorter than 32 characters, every request is refused. The comparison is
   `timingSafeEquals`. Failure returns 401.
4. `resolveCronJob(jobs, name, moduleFlags)`: the name must match `^[a-z0-9]+(-[a-z0-9]+)*$`
   (≤64 characters) and be an own key of the map. If the job's `module` is off, the response is
   404, the same as for an unknown job.
5. `runCronJob` opens a transaction only to pin one pooled connection, then runs
   `SELECT GET_LOCK('cms-cron:<job>', 0)`. If the lock is held it returns
   `{ status: 'skipped', reason: 'already_running' }`. Otherwise it runs the job, calls
   `RELEASE_LOCK` in `finally`, and returns `{ status: 'ran', result }`. If the process crashes,
   the lock is released when the connection drops.
6. A job that ran is audited as `cron.run`. The response is `{ ok: true, data: <outcome> }`.

**Registered jobs** (`src/app/api/cms/cron/[job]/route.ts`):

| Job | Module gate | Function | What it does | Suggested schedule |
|---|---|---|---|---|
| `content-publish-scheduled` | none | `publishDueScheduled(scheduledPublisher())` (`core/documents/publish-scheduled.ts`) | Rewrites `scheduled` documents whose time has passed to `published` (≤200 per run), audits them as `scheduler`, and revalidates. The public read already treats them as live, and the admin lists run the same function when opened, so this job keeps the stored status correct. | every 5–15 min |
| `commerce-stale-orders` | `commerce` | `cancelStaleOrders` (`commerce/stale-orders.ts`) | Cancels unpaid **online-gateway** orders older than `ecommerce.pendingOrderTtlHours` (default 48, 0 = off) through `updateOrderStatus`. Manual orders and orders with money attached are never touched. | hourly (per `.env.example`) |
| `giftcard-deliver` | `commerce` | `deliverDueGiftCards(sendGiftCardEmail)` | Sends gift-card emails whose chosen delivery date has arrived, in `config.defaultLocale`. | hourly or daily |
| `giftcard-expire` | `commerce` | `expireGiftCards` | Marks expired gift cards. | daily |
| `commerce-abandoned-reminders` | `commerce` | `processReminders({ defaultLocale })` (`commerce/abandoned.ts`) | Sends abandoned-cart reminders once carts are older than `COMMERCE_ABANDONED_DELAY_MINUTES` (default 60), capped at `COMMERCE_ABANDONED_DAILY_MAX` per rolling 24 h (default 200). | every 15 min (per `.env.example`) |
| `booking-expire` | `booking` | `expireStaleReservations` (`booking/allocation.ts`) | Lapses stale enquiries and releases abandoned payment holds. Same sweep as the legacy endpoint. | every 5 min (20-minute default hold) |
| `google-reviews-sync` | `googleReviews` | `syncAllReviewLocations` (`reviews-external/sync.ts`) | Syncs every enabled Google location one after another. Returns `{results: []}` if the integration is disabled. | nightly |

The schedules above are suggestions. Only the two taken from `.env.example` are stated anywhere
in the repo.

**Legacy per-job endpoints**, still live. They accept their own secret **or** an admin session:

| Endpoint | Secret env | Session fallback | Rate limit | Notes |
|---|---|---|---|---|
| `POST /api/cms/reservations/expire` | `BOOKING_CRON_SECRET` | `reservationsWrite` | 5/min | `expireStaleReservations`: lapses stale enquiries and releases abandoned payment holds. Also in the unified map as `booking-expire`; schedule one or the other, not both. |
| `POST /api/cms/abandoned-carts/remind` | `COMMERCE_CRON_SECRET` | `ordersWrite` | 5/min | Same work as `commerce-abandoned-reminders`. Also used by the admin "Send reminders" button. |

Neither legacy guard enforces a minimum secret length. Both are module-gated with a 404.

### 3.5 Updater

A site is its own front end plus a copy of the CMS core. The updater replaces the core and
nothing else. All the safety comes from `classifyPath` in `src/cms/update/plan.mjs`:

| Class | Globs (abridged) | Install behaviour |
|---|---|---|
| `base-only` | `START_HERE.md`, `.claude/**`, `qa/**`, `test/studio/**`, `test/tools/**`, `seo-audit-tool/**`, `scripts/dev-qa.mjs`, `scripts/cms-release.mjs`, `docs/**`, `releases/**`, `.cms-origin.json` | never packed |
| `glue` (checked before core) | `src/site.config.ts`, `src/lib/cms/**`, `src/lib/i18n/locale-settings.ts`, `src/lib/storage-keys.ts`, `src/components/shop/showcase-data.ts`, `src/app/[locale]/layout.tsx`, `src/components/layout/Header.tsx`, `src/mdx-components.tsx`, `.env.example`, `package.json` | **never written**. Packed under `glue/` only so the report can say "differs" |
| `core` | `src/cms/**`, `src/app/api/cms/**`, `src/app/admin/**` | written wholesale. Core files missing from the update are **deleted** (then empty dirs pruned) |
| `core-tests` | `test/cms/**`, `test/core/**`, `test/commerce/**`, `test/booking/**` | added/updated, never deleted |
| `scaffold` | `src/components/{account,popups,checkout,shortcodes,shop/wishlist,shop/filters}/**`, `src/components/cms/Shortcode.tsx`, `src/shortcodes/**`, `src/app/[locale]/{account,wishlist}/**` | copied **only when missing**. An existing copy is reported as "yours-already" |
| `site` | everything else | untouched (default for unknown paths) |

Unchanged files (same SHA-256) are skipped, so the resulting git diff shows only the update.

**Package** (`manifest.mjs`): a zip containing `manifest.json` (`format: 1`, `version`,
`commit`, `branch`, `builtAt`, `files[] {path, kind, sha256}`, `glue[] {path, sha256}`,
`package {dependencies, devDependencies, scripts}`, `env[]`, `modules[]`), `files/<path>` and
`glue/<path>`. `readUpdate` does not trust the manifest:

- every path is re-classified by the installer's own rules;
- every checksum is verified;
- a duplicate, missing or unlisted archive entry rejects the whole package;
- scripts must be `^[a-z][a-z0-9:-]*$`, may not be npm lifecycle names (`pre*`, `post*`,
  `install`, `prepare`, …), and their command must contain `src/cms/`.

The zip reader and writer (`zip.mjs`) is hand-written, supports only deflate or store, UTF-8 names,
no ZIP64 and no encryption, and rejects `../` or absolute entry names (zip slip) before
anything is written.

**Install** (`install.mjs` → `runInstall`):

1. Reads `package.json`. The site version comes from `src/cms/version.json`, else
   `.cms-origin.json.cmsVersion`, else "unversioned".
2. `planInstall`: an older version is `refused` (unless `--allow-downgrade`), the same version is
   `up-to-date` (unless `--reinstall`). Then it builds the file plan, the package plan
   (**additions only**: missing deps, devDeps and core scripts are added, different ranges are
   only reported), and follow-ups (env keys missing from the site's `.env.example`, module names
   not mentioned in `site.config.ts`, and `brandNotWired` if the locale layout lacks `BrandStyle`).
3. Prints the report. Without `--apply` it stops there (dry run).
4. With `--apply` it requires `git status --porcelain` to be empty (unless `--force`), writes and
   deletes files, rewrites `package.json` if needed, and updates `.cms-origin.json`
   (`cmsVersion`, `baseCommit`, `syncedAt`).
5. Runs `npm install` only if dependencies were added (`--skip-install` turns this off), then
   `npm run db:migrate` (`--skip-migrate` turns this off).

`cli.mjs` checks the archive with the **site's current** reader. If the zip carries
`src/cms/update/install.mjs`, the CLI extracts the flat `src/cms/update/*.mjs` to a temp dir
and runs **the update's own installer**. Each site therefore installs with the rules of the
version it is moving to.

### 3.6 Edit-lock relay

A Next route handler cannot upgrade to WebSocket, so `src/cms/realtime/lock-server.mjs` runs as
a separate process (`ws` package). It has no database and no auth logic of its own:

- It listens on `CMS_LOCK_WS_HOST:CMS_LOCK_WS_PORT` (default `127.0.0.1:8081`), path
  `/_ws/locks` (this must equal `LOCK_WS_PATH` in `src/cms/admin/locks/ws-url.ts`).
- `verifyClient` requires `Origin === CMS_LOCK_ALLOWED_ORIGIN` (or `NEXT_PUBLIC_SITE_URL`) and a
  `Cookie` header. This origin check is the only CSRF protection on the path.
- Each frame (`acquire` | `release` | `takeover` | `observe`, on `document` | `order` |
  `reservation`) is re-built and POSTed to `CMS_APP_ORIGIN/api/cms/locks` with the socket's
  cookie and `x-real-ip`. The app's answer names the room, and the relay broadcasts it.
- On close it POSTs `/api/cms/locks/release` with `x-cms-lock-secret`. Every TTL/3 (at least 5 s)
  it sends one batched `/api/cms/locks/heartbeat` and pings sockets.
- Limits: 4 KB frames, a 10-token bucket per socket (refills at 1/s), at most 16 rooms per socket.
- It refuses to start if `CMS_LOCK_INTERNAL_SECRET` is shorter than 32 characters or no allowed
  origin is set.

App side: with `CMS_LOCK_INTERNAL_SECRET` unset (or shorter than 32 characters), `locksEnabled()`
is false and locking is dark. Saves are never refused. If the socket cannot connect, the editor
shows "live status unavailable" and stays editable. Details are in
[04-admin-ui.md](04-admin-ui.md).

---

## 4. HTTP API

| Method | Path | Auth / permission | Purpose |
|---|---|---|---|
| GET | `/api/cms/settings` | session + `cms.settings.read` | Current values of all managed keys (`getSettings(managedKeys)`). |
| PATCH | `/api/cms/settings` | session + `cms.settings.write`, same-origin | Upsert allowed keys. Unknown keys are ignored. 422 on invalid values, 409 on a custom/SEO field conflict. |
| POST | `/api/cms/cron/{job}` | `x-cron-secret` = `CMS_CRON_SECRET` (≥32 chars) | Run one registered job. 401 bad secret, 404 unknown or module off, 429 rate limit. |
| POST | `/api/cms/reservations/expire` | `x-cron-secret` = `BOOKING_CRON_SECRET`, or `reservationsWrite` | Booking expiry sweep (module `booking`). |
| POST | `/api/cms/abandoned-carts/remind` | `x-cron-secret` = `COMMERCE_CRON_SECRET`, or `ordersWrite` | Abandoned-cart reminders (module `commerce`). |
| POST | `/api/cms/reviews-external/sync` | session + `cms.settings.write`, 5/min | "Sync now" (optional `locationId`). The scheduled version is `google-reviews-sync`. |
| POST | `/api/cms/locks` | session cookie (forwarded by the relay) | Lock gateway (`lockGatewayRoute`). |
| POST | `/api/cms/locks/release` | `x-cms-lock-secret` | Release all locks of a closed connection. |
| POST | `/api/cms/locks/heartbeat` | `x-cms-lock-secret` | Batched heartbeat. |

Responses use the standard envelope `{ ok: true, data }` / `{ ok: false, error, ... }` (see
[01-architecture.md](01-architecture.md)).

---

## 5. Admin UI

`/admin/settings` (`src/app/admin/(shell)/settings/page.tsx`) requires `settingsRead`.
`SettingsForm` builds its top-level tabs in this order:

1. One tab per `group` in `MANAGED_SETTINGS` with at least one visible field (General, Analytics,
   Notifications, SEO, Ecommerce, Booking, Security). Fields whose `module` is off are hidden.
2. Module tabs with bespoke sub-tabs (`moduleTabs`). Currently only **Ecommerce** has them:
   Shipping (plus shipping methods and courier credentials), Coupons, Wishlist, Gift cards. The
   group's plain fields sit in a "General" sub-tab.
3. **Fields**: "SEO & AEO" (`SeoFieldsManager`), then one `CustomFieldsManager` per eligible
   collection (visible, routable, not `topic`/`author`/`category`, module on).
4. Extra tabs: **Branding**, **Structured data**, and the **Praion.ai** tab (`PRAION_TAB`), which
   needs both the `pm` module and `cms.tokens.manage`.
5. **Modules**: one checkbox per `config.modules` key, labelled from `MODULE_LABELS`, with its
   `offNote` always visible.
6. **Languages**: an Editing/Public checkbox per installed locale. The main locale is fixed.

Behaviour worth knowing:

- The open tab is in the URL (`?tab=SEO`). An unknown value falls back to the first tab.
- The main **Save** sends **every** `MANAGED_SETTINGS` key, every module flag and `i18n.locales`
  in one PATCH. Initial form values are stored value, else `defaultValue`, else the first
  option for a select. The first save therefore persists those shown defaults.
- The bespoke sub-tabs and extra tabs have their own save buttons and state. The unsaved-changes
  guard (`useUnsavedChangesGuard`) covers only the main form.

---

## 6. Configuration

### 6.1 Environment variable reference

Next loads `.env.local` / `.env` itself. The tsx CLIs (`db:*`) use `load-env.ts`, where existing
env values take precedence, then `.env.local`, then `.env`. The lock relay needs
`node --env-file…` (`npm run locks` passes `.env` and `.env.local`). "Build-time" means the
value is inlined by `next build` and **must be present when building**.

| Variable | Used in | Required? | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | `core/paths.ts`, `core/api/same-origin.ts`, `lib/seo/schemas.ts`, `cms/config/config.ts`, `lock-server.mjs`, `core/routes/api-tokens.ts` | **Yes** (build-time) | Public origin, no trailing slash. Used for canonicals, sitemap and JSON-LD, and for the same-origin check (fails closed in production if unset). Must equal `productionOrigin` for an indexable robots.txt. Must be `https://` in production for API tokens. |
| `DATABASE_URL` | `db/adapters/mysql/url.ts`, `drizzle.config.ts` | Yes, or the `DB_*` set | `mysql://user:pass@host:port/db`. Takes precedence over `DB_*`. |
| `DB_HOST`, `DB_PORT` (3306), `DB_USER`, `DB_PASSWORD`, `DB_NAME` | same | Yes, unless `DATABASE_URL` | Composed connection. Use `127.0.0.1` (TCP), not `localhost`. |
| `ADMIN_SESSION_SECRET` | `modules/auth/session.ts`, `mfa-challenge.ts`, `core/email/unsubscribe.ts`, `modules/customers/token.ts` | **Yes** (≥32) | Signs admin sessions, MFA challenges, unsubscribe and customer tokens. |
| `ADMIN_SESSION_TTL_HOURS` | `auth/session.ts`, `session-idle.ts` | No (8) | Absolute session lifetime. |
| `ADMIN_SESSION_IDLE_MINUTES` | `auth/session-idle.ts` | No (60) | Idle timeout. Non-positive values fall back to the default. |
| `ADMIN_PATH` | `core/paths.ts`, `next.config.ts`, `src/proxy.ts`, admin pages | No (`admin`) | Admin URL segment. An invalid value falls back to `admin` with a warning. |
| `ADMIN_MFA_BYPASS_CODE` | `core/security/mfa-bypass.ts` | No. **Leave blank in production** | Development second-factor bypass. |
| `RECAPTCHA_SITE_KEY`, `RECAPTCHA_SECRET_KEY` | `core/security/captcha.ts`, `next.config.ts` | No (both needed to enable) | reCAPTCHA v2 on admin login. `.env.example` ships Google's public **test** keys, which must be replaced in production. |
| `CMS_TOKEN_ENCRYPTION_KEY` | `core/tokens/crypto.ts`, `core/tokens/service.ts` | Yes for PM bridge / stored integration secrets (≥32) | AES key source for API tokens, Google refresh token, courier credentials. **Changing it invalidates everything already stored.** |
| `CMS_GIFTCARD_PEPPER` | `commerce/giftcards/service.ts` | Yes if gift cards are used (≥32) | Peppers gift-card code hashes. **Never change it on a live shop.** |
| `CMS_CRON_SECRET` | `core/cron/service.ts` | Yes if any job is scheduled (≥32) | `x-cron-secret` for `/api/cms/cron/*`. |
| `BOOKING_CRON_SECRET` | `booking/payments.ts` (`bookingExpireRoute`) | For booking sites | Secret for `/api/cms/reservations/expire`. |
| `COMMERCE_CRON_SECRET` | `commerce/abandoned.ts` | Optional (legacy endpoint) | Secret for `/api/cms/abandoned-carts/remind`. |
| `COMMERCE_ABANDONED_DELAY_MINUTES` | `commerce/abandoned.ts` | No (60) | Cart age before a reminder is sent. |
| `COMMERCE_ABANDONED_DAILY_MAX` | `commerce/abandoned.ts` | No (200) | Reminder ceiling per rolling 24 h. |
| `CMS_UPLOAD_DIR` | `core/media/storage.ts` | No (`<cwd>/.data/uploads`) | Media storage directory. **Set it to a path outside the release dir in production.** |
| `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `GRAPH_SENDER_ADDRESS` | `core/email/graph.ts` | For any email | Microsoft Graph sender. |
| `CONTACT_RECIPIENT_EMAIL` | same | For forms | Default recipient of form submissions. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | `core/payments/stripe.ts` | If Stripe is selected | Stripe API + webhook verification. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `stripe.ts`, `CheckoutClient.tsx`, booking pay page | If Stripe (build-time) | Client key. |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_ENV` (`sandbox`/`live`) | `core/payments/paypal.ts` | If PayPal | Anything but `live` is sandbox. |
| `VIVA_CLIENT_ID`, `VIVA_CLIENT_SECRET`, `VIVA_MERCHANT_ID`, `VIVA_API_KEY`, `VIVA_WEBHOOK_VERIFICATION_KEY`, `VIVA_ENV` (`demo`/`live`) | `core/payments/viva.ts` | If Viva | Anything but `live` is demo. |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | `reviews-external/google.ts` | For GBP OAuth | Business Profile connection. |
| `BOXNOW_API_URL` | `commerce/couriers/boxnow.ts` | No (sandbox) | BoxNow production URL. |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | `core/settings/analytics.ts` | No (build-time) | GA fallback when `analytics.gaMeasurementId` is unset. |
| `CMS_LOCK_INTERNAL_SECRET` | `core/locks/config.ts`, `lock-server.mjs` | For edit locks (≥32) | Unset turns locking off. Relay ↔ app shared secret. |
| `CMS_LOCK_WS_PORT` / `CMS_LOCK_WS_HOST` | `lock-server.mjs` | No (8081 / 127.0.0.1) | Relay bind address. Never `0.0.0.0`. |
| `CMS_APP_ORIGIN` | `lock-server.mjs` | Yes in production | Where the relay reaches Next. The code default is `http://127.0.0.1:3000`; `.env.example` has `:3002` (dev). |
| `CMS_LOCK_ALLOWED_ORIGIN` | `lock-server.mjs` | No (falls back to `NEXT_PUBLIC_SITE_URL`) | Required browser `Origin` for the socket. |
| `CMS_LOCK_TTL_SECONDS` | `core/locks/config.ts`, `lock-server.mjs` | No (60, max 3600) | Lock TTL. The heartbeat runs every TTL/3. |
| `NEXT_PUBLIC_CMS_LOCK_WS_URL` | `admin/locks/ws-url.ts`, admin layout | Dev only | Override socket URL. Leave blank in production (same-origin `/_ws/locks`). |
| `NODE_ENV` | many | set by Next | `production` enables secure cookies, the fail-closed origin check, HTTPS-only tokens, and strict `X-Real-IP` rate limiting. |
| `NEXT_DIST_DIR` | `next.config.ts` | No (`.next`) | Separate build dir (used by `dev:qa`, `.next-build`). |
| `QA_DATABASE_URL` (in `qa/.env.qa`) | `scripts/dev-qa.mjs` | QA only | Database of the second dev instance. |
| `CHROME` | `docs/user-guides/_build/build.mjs` | No | Chromium path for PDF rendering. |

`AUTH_SECRET` only appears in comments (`mdx-guard.ts`, `documents/service.ts`) as an example
of what MDX must not be able to render. It is not read anywhere. The deploy-time switches in
`docs/STAGING-SETUP.md` (`DEPLOY_DB_MIGRATE`, `DEPLOY_DB_SEED`, `DEPLOY_SKIP_ENGINE`,
`AUDIT_API_URL`) belong to `deploy.php`, which is **not** in this repository. Nothing under
`src/` or `scripts/` reads them.

### 6.2 Compile-time vs runtime

| Concern | Compile-time (`src/site.config.ts`) | Runtime (`site_settings`) |
|---|---|---|
| Modules | `modules: { commerce: true, ... }` (defaults) | `module.<name>` override |
| Languages | `locales`, `defaultLocale` (installed set) | `i18n.locales` (editing/public subsets) |
| Branding | `config.brand` / `src/site.brand.ts` fallback | `brand.identity`, `brand.palette` |
| Production host | `productionOrigin` | none |

---

## 7. Operations

### 7.1 Build, start and required services

| Service | Needed for | Notes |
|---|---|---|
| Node `>=20.9.0 <25`, npm `>=10 <12` | everything | `.nvmrc` pins `20.18.0`. |
| MariaDB/MySQL | everything | utf8mb4. The app and `db:migrate` connect over TCP, so grant on `'user'@'%'` (socket auth maps to a different account). |
| Reverse proxy (Nginx) | production | **Must** set `X-Real-IP $remote_addr` (overwrite, never pass through) and forward the WebSocket upgrade for `/_ws/locks`. |
| Lock relay process | optional (edit locks) | `npm run locks`. |
| External scheduler | optional (jobs) | cron, systemd timer, or hosting panel. |
| Microsoft Graph | email | see [07-forms-email-marketing.md](07-forms-email-marketing.md). |

A release, in order:

```bash
npm ci --include=dev          # tsx and drizzle-kit are devDependencies, needed by db:migrate
npm run db:migrate            # BEFORE the new build serves traffic
NEXT_PUBLIC_SITE_URL=https://example.com npm run build   # env must be present at build time
npm run start                 # next start, port 3000 unless -p / PORT is given
npm run locks                 # separate long-running process (optional)
```

`next start` has no port flag in `package.json`, so it uses 3000. `npm run dev` uses 3002.
First-time setup also needs `npm run db:seed-roles` and
`npm run db:seed-admin -- you@example.com '<password>' "Name"`. Run the admin seed by hand, and
keep it out of logged deploy scripts because the password is a CLI argument.

Example PM2 layout (the process names come from the Praion production box, per
`docs/STAGING-SETUP.md`):

```bash
pm2 start npm --name site-frontend -- run start
pm2 start node --name site-locks -- --env-file-if-exists=.env src/cms/realtime/lock-server.mjs
```

Example Nginx fragment. It is illustrative and not shipped in the repo:

```nginx
location /_ws/locks {
    proxy_pass http://127.0.0.1:8081;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 120s;
}
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

### 7.2 Wiring the scheduler

Calling the public URL through the proxy is preferred, but a scheduler on the same host may also
call `127.0.0.1:3000` directly: a request with the correct secret is not refused for lacking
`X-Real-IP`. Keep the secret out of the crontab itself:

```bash
# /usr/local/bin/cms-cron   (chmod 700)
#!/bin/sh
set -eu
. /home/site/private/cron.env          # CMS_CRON_SECRET=..., SITE=https://example.com
curl -fsS -m 300 -X POST -H "x-cron-secret: $CMS_CRON_SECRET" "$SITE/api/cms/cron/$1"
```

```cron
*/10 * * * *  /usr/local/bin/cms-cron content-publish-scheduled
7 * * * *     /usr/local/bin/cms-cron commerce-stale-orders
*/15 * * * *  /usr/local/bin/cms-cron commerce-abandoned-reminders
20 * * * *    /usr/local/bin/cms-cron giftcard-deliver
40 3 * * *    /usr/local/bin/cms-cron giftcard-expire
15 4 * * *    /usr/local/bin/cms-cron google-reviews-sync
*/5 * * * *   /usr/local/bin/cms-cron booking-expire   # booking sites
```

Jobs for disabled modules return 404, so `curl -f` exits non-zero. Remove those lines rather than
ignore the failures. `{"ok":true,"data":{"status":"skipped","reason":"already_running"}}` is
normal when a previous run overlaps.

### 7.3 Staging (`docs/STAGING-SETUP.md`, verified)

That document describes the Praion Plesk + PM2 setup. It is untracked (it is ignored by the
`*.md` rule in `.gitignore`). What still matches the code:

- Separate DB, and a `'%'` grant (see `src/cms/db/migrate.ts` for why it uses the app pool rather
  than the drizzle-kit CLI).
- Fresh ≥32-character `ADMIN_SESSION_SECRET` and `CMS_LOCK_INTERNAL_SECRET` per environment.
- `CMS_APP_ORIGIN=http://127.0.0.1:3000` and `CMS_LOCK_ALLOWED_ORIGIN=https://staging…`.
- robots.txt is `noindex` on any build whose `NEXT_PUBLIC_SITE_URL` differs from
  `config.productionOrigin`. `isProductionHost` in `core/paths.ts` is called from
  `src/app/robots.ts`. **Correction:** the doc says "not exactly `https://praion.gr`", but the
  comparison is against `productionOrigin` (`brand.url` in `site.config.ts`).

What does not match:

- `deploy.php`, `deploy-api.php` and the `.github/workflows` it mentions are not in this
  checkout.
- The seed scripts `db:seed-articles`, `db:seed-answers` and `db:seed-scenarios` no longer
  exist. Current seeders are `db:seed-roles`, `db:seed-site`, `db:seed-content`,
  `db:seed-cookies` and `db:brand-import`.
- `.env.example` now has 50 keys, not 46.
- `docs/LOCAL_SETUP.md` says `.env.example` ships `:3000`. It now ships
  `NEXT_PUBLIC_SITE_URL=http://localhost:3002`.

### 7.4 File storage and backups

The repo has no backup tooling. `backups/` is gitignored. Back up:

| What | Where | Why |
|---|---|---|
| Database | `mysqldump --single-transaction` of `DB_NAME` | content, settings, orders, audit |
| Uploads | `CMS_UPLOAD_DIR` (default `.data/uploads`, gitignored) | Media binaries are **not** in the DB. Only the rows are. |
| Secrets | the server `.env` | Without the same `CMS_TOKEN_ENCRYPTION_KEY` a restore cannot decrypt stored integration secrets. Without the same `CMS_GIFTCARD_PEPPER`, every gift card becomes unusable. |

The local storage adapter writes to `process.cwd()/.data/uploads` by default. A deploy that
replaces the release directory would lose the files, so set `CMS_UPLOAD_DIR` to a persistent
path. `StorageAdapter` (`core/media/storage.ts`) is the place where S3 would plug in. There is no
S3 implementation.

### 7.5 Logging and monitoring

- All logging is `console.*` to stdout/stderr (PM2 logs). Prefixes to grep for:
  `[cms/settings]`, `[cms]` (rate limiter / same-origin), `[cms/api]`, `[locks]`,
  `[commerce/abandoned]`.
- The audit log (Admin → Audit, `logAudit`) records `settings.update`, `cron.run` and scheduler
  publishes (`scheduler` actor), among others.
- There is no health endpoint. `GET /api/cms/auth/me` returning **401** shows the app and its
  auth stack are up (per `docs/LOCAL_SETUP.md`).
- For cron monitoring, alert on a non-2xx from `curl -f`, or on missing `cron.run` audit rows.

---

## 8. Extending

### Recipe: add a setting

1. **Plain field.** Add an entry to `MANAGED_SETTINGS` in `src/cms/core/settings/schema.ts`
   with `key`, `label`, `type`, `group`, and optionally `description`, `placeholder`, `options`,
   `defaultValue` and `module`. Export a key constant if code reads it. Keep this file
   client-safe: do not import server modules. Use a literal key, as the
   `ecommerce.pendingOrderTtlHours` entry does, if the owning constant lives in a server module.
2. Add a reader next to the feature: `await getSetting<string>(KEY)` plus a parser that turns
   any unreadable value into the default. Booleans use `readBooleanSetting`, multiselects use
   `parseMultiValue`. Default **off** for anything security-related (see `security.require2fa`).
3. If the type needs new validation, extend `validateSettingValue`. A new `SettingFieldType` also
   needs a renderer in `SettingField` (`SettingsForm.tsx`).
4. **Structured (JSON) key.** Export the key, add it to `EXTRA_MANAGED_KEYS`, add a branch in
   `checkStructuredSetting` (zod or the owning sanitiser), and build a bespoke editor that calls
   `cmsApi.updateSiteSettings({ [KEY]: value })`. Mount it in `settings/page.tsx` through
   `moduleTabs[<Group>]` or `extraTabs`. If several admins can edit the same blob, copy the
   baseline pattern (`cms.seoFields.baseline`).
5. Tests: extend `test/cms/settings-schema.test.ts` or `test/cms/structured-settings.test.ts`.
6. Update `docs/CMS-FEATURES-FOR-PROPOSALS.md` and, if it is user-visible, the user guide
   (`docs/user-guides/src/06-rythmiseis-xristes.md`), then rebuild the PDFs.

A key that is not in `managedKeys()` is silently dropped by PATCH. This is the most common reason
a new setting "doesn't save".

### Recipe: add a cron job

1. Write the job in the owning module as `async () => Record<string, unknown>`. Make it
   idempotent and bounded (batch limit), because it can be retried. It must not assume it is the
   only runner (`GET_LOCK` covers a single job name, not related jobs).
2. Register it in `src/app/api/cms/cron/[job]/route.ts`:
   `'my-job': { module: 'commerce', run: myJob }`. The name must be lowercase kebab-case and at
   most 64 characters. Omit `module` if the job is always available.
3. If the job needs config, read it from `site_settings` (add a setting as above) or from an env
   var. Add the env var to `.env.example` with a comment so the updater reports it to sites.
4. Tests: pure decision logic goes in `test/core/cron.test.ts`, route behaviour in
   `test/core/cron-route.test.ts`, and the job's own logic next to its module.
5. Document the job and its schedule in this manual and in `.env.example`. Update
   `docs/CMS-FEATURES-FOR-PROPOSALS.md`.

### Recipe: release a new CMS version to client sites

On the base (`CMS` branch, clean tree):

```bash
npm run lint && npm run type-check && npm test
npm run cms:release -- --bump minor    # bumps src/cms/version.json, commits
                                       # "chore(cms): release vX.Y.Z", tags cms-vX.Y.Z,
                                       # writes releases/cms-update-X.Y.Z.zip
git push && git push origin cms-vX.Y.Z
```

`cms:release` without `--bump` rebuilds the current version's zip. `--any-branch` overrides the
branch check and `--out <dir>` changes the output folder. The script prints the zip's SHA-256.
Record it when handing the zip over.

On each site (clean git tree):

```bash
npm run cms:update -- ../cms-update-X.Y.Z.zip           # dry run: read the report
npm run cms:update -- ../cms-update-X.Y.Z.zip --apply   # write, npm install if needed, db:migrate
```

Then act on the report:

- **Contract files that differ**: compare with
  `unzip -p <zip> glue/<path> | diff -u <path> -` and port by hand.
- **Scaffold "yours-already"**: the base's version moved on. Port anything wanted.
- **package.json differs**: raise the ranges by hand if the core needs them.
- **Missing env vars** (compared against the site's `.env.example`): add them to the server env
  and to `.env.example`.
- **Missing module flags**: add them to `src/site.config.ts` (the updater defaults them to off).
- **brandNotWired**: run `npm run db:brand-import` and wire `BrandStyle`/`BrandProvider`.

Finally run `npm run lint && npm run type-check && npm test`, build with the production
`NEXT_PUBLIC_SITE_URL`, and commit the update as one diff. To roll back before committing:
`git checkout . && git clean -fd`. Migrations that already ran are not reverted.

For a site that is too old to have `cms:update`, run the base's CLI against it:
`node src/cms/update/cli.mjs <zip> --target ../site`.

### Adding a language (`docs/ADDING_A_LANGUAGE.md`, verified)

Installing a language is a code change. Enabling it is a runtime setting. Steps, corrected
against the code:

1. `src/lib/i18n/config.ts`: add the code to **both** the `Locale` union type and `locales`
   (the doc only mentions `locales`).
2. `src/site.config.ts`: `locales: [...]`. It must match step 1, which
   `test/site/config.test.ts` checks.
3. `messages/<locale>.json`: copy and translate `messages/en.json` (UI chrome only).
4. `src/lib/seo/metadata.ts`: add to `OG_LOCALE`.
5. New script only: font subsets are now in **`src/lib/fonts.ts`**, not
   `src/app/[locale]/layout.tsx` as the doc says.
6. Rebuild and restart.

Corrections to the doc's "Turn it on" section:

- **Enablement.** The doc says a new language arrives "Editing-only". In the code
  (`resolveLocaleSet`), if `i18n.locales` has **never been saved**, every installed locale is
  both editing and public. If it **has** been saved, the new locale is in neither list until an
  admin ticks it. It is never Editing-only automatically.
- **Main language.** The doc names Greek as the main language. It is whatever
  `config.defaultLocale` is.
- **Other hardcoded locales.** Several core paths assume `el | en`: commerce email labels
  (`commerce/orders.ts` `EMAIL_LABELS`), abandoned-cart reminders (`commerce/abandoned.ts`), the
  product feed (`commerce/feeds.ts`), the contact API schema (`src/app/api/contact/route.ts`),
  and the admin bar (`src/lib/admin-bar.ts`). Check these before shipping a third language.

---

## 9. Testing

Run a single file:

```bash
npx tsx --tsconfig ./tsconfig.test.json --test test/core/cron.test.ts
```

or the whole suite with `npm test`.

| File | Covers |
|---|---|
| `test/cms/settings-schema.test.ts` | Registry shape, `validateSettingValue`, multiselect/money/gaId rules. |
| `test/core/settings-boolean.test.ts` | `boolean` type and `readBooleanSetting`. |
| `test/cms/structured-settings.test.ts` | `checkStructuredSetting` for shipping, coupons, custom fields, etc. |
| `test/cms/brand-settings.test.tsx`, `test/cms/commerce-settings-ui.test.tsx`, `test/cms/structured-data-settings.test.tsx` | Bespoke settings editors. |
| `test/booking/settings.test.ts`, `test/commerce/stale-orders.test.ts` | Module setting readers, TTL parsing. |
| `test/cms/cookie-declaration.test.ts` | `resolveGaId` agreement between loader and declaration. |
| `test/core/cron.test.ts` | `authorizeCronRequest`, `resolveCronJob`, name validation. |
| `test/core/cron-route.test.ts` | 401/404/module-off/cross-origin behaviour of `cronRoute`. |
| `test/core/publish-scheduled.test.ts` | `publishDueScheduled`. |
| `test/core/cms-update.test.ts` | `classifyPath`, `planInstall`, `packUpdate`/`readUpdate`, zip, `runInstall`. |
| `test/tools/core-sync-plan.test.ts` | Skill-side core-sync plan (base-only). |
| `test/core/locks.test.ts`, `test/cms/edit-lock.test.ts` | Lock policy and editor lock behaviour (incl. `resolveWsUrl`). |
| `test/site/config.test.ts` | Locale lists agree between i18n config and site config. |

There is no test that exercises `settingsUpdateRoute` end to end (the allowlist, partial-write
behaviour, or baseline conflicts). The relay (`lock-server.mjs`) has no direct test either.

---

## 10. Gotchas and invariants

- **Caches never expire on a timer.** `CMS_CACHE_REVALIDATE = false`. A 300 s timer used to make
  statically rendered pages fail after background regeneration (see `core/cache.ts`). Every
  write path must purge. For settings this is built in: `setSetting` purges the key it wrote, so
  do not write `site_settings` any other way. A read that decides something about a value just
  written (a one-use token, a conflict baseline) must use `getSettingUncached`.
- **PATCH validates everything before writing anything.** A 422/409 on any key writes nothing.
  It is still not a transaction: a DB failure between two writes leaves the earlier ones stored
  (each already purged from the cache).
- **Unknown keys are silently ignored** by PATCH. An invalid `i18n.locales` shape is also skipped
  silently.
- **Module flags must be JSON booleans.** `"false"` gets a 422 at write time (F-061). The reader
  ignores anything that is not a boolean.
- **"Unset" has meaning**, for example all locales enabled, both booking kinds, 2FA optional.
  The main Save sends only the keys whose value differs from what the screen opened with
  (`buildSettingsPatch` in `admin/settings-patch.ts`), so displayed defaults stay unset. A
  field the admin actually changes is stored explicitly; one changed and changed back is not
  sent. Keys stored by older versions, which sent everything,
  stay stored.
- **Security defaults live in readers.** `security.require2fa` is `=== 'on'`. Never default a
  restrictive toggle to on in the reader.
- **Cron without `X-Real-IP`.** The rate limiter still runs before the guard. In production a
  request with no `X-Real-IP` is refused (429) **unless** it carries the correct
  `CMS_CRON_SECRET` (`rateLimit.trustedWithoutIp` in `createRoute`); such requests share one
  bucket of 30/min. A wrong or missing secret gets no way round the limiter.
- **Rate limits are in-memory per process.** With several Next instances, each has its own
  buckets.
- **Cron secrets.** `CMS_CRON_SECRET` shorter than 32 characters refuses everything. The legacy
  `BOOKING_CRON_SECRET` / `COMMERCE_CRON_SECRET` go through the same `authorizeCronRequest` check
  (32-character minimum); if they are unset or too short the endpoints fall back to session auth. Prefer the unified map, which has every job.
- **Booking expiry is in the unified map** as `booking-expire` (module `booking`). The legacy
  `/api/cms/reservations/expire` still works; schedule one of them, not both.
- **`GET_LOCK` is per job name and per server.** It does not serialise different jobs that touch
  the same rows.
- **Updater invariants.** Glue is never written. Scaffolds are never overwritten. Core files
  absent from the update are deleted, so **never hand-edit `src/cms/**`, `src/app/api/cms/**` or
  `src/app/admin/**` in a site**. `package.json` changes are additive only. Unknown paths
  default to `site`. A downgrade is refused unless explicitly allowed.
- **The updater walks the whole site tree** except `.git`, `node_modules`, `.next`, `.turbo`,
  `dist`, `coverage` and `.history`. `.data/` (uploads) is not skipped, so on a large media folder the
  walk is slow. Those files classify as `site` and are never read or hashed.
- **Lock relay needs `--env-file`.** Without it every variable is undefined and it exits at
  once. `CMS_APP_ORIGIN` must point at the real `next start` port (3000 in production), not the
  `.env.example` dev value.
- **Secrets that must never change on a live site:** `CMS_GIFTCARD_PEPPER`, and
  `CMS_TOKEN_ENCRYPTION_KEY` (changing it invalidates stored tokens). Rotating
  `ADMIN_SESSION_SECRET` signs everyone out, and unsubscribe and customer tokens issued under the
  old secret stop working.
- **`NEXT_PUBLIC_*` values are build-time.** Changing them in the runtime env without
  rebuilding does nothing on the client and leaves canonical URLs unchanged.

### Documentation rules that are part of every CMS change

- **`docs/CMS-FEATURES-FOR-PROPOSALS.md`** must be updated on **every** CMS change (new, removed,
  or "not yet" → "exists"), including its "Τελευταία ενημέρωση" date. It is written in plain Greek
  for clients and never claims unbuilt features. It is **not** copied to new sites (the new-site
  skill strips it, per `.claude/skills/new-site/references/strip-manifest.md`), and the updater
  classifies `docs/**` as base-only.
- **User-guide PDFs** (`docs/user-guides/*.pdf`, Greek) ship to new sites and must be updated
  whenever the admin UI changes. Edit `docs/user-guides/src/NN-*.md` (frontmatter, `[[Label]]`
  for UI chips, and blockquotes starting with a bold word for callouts), then rebuild:

  ```bash
  cd docs/user-guides/_build && npm install && node build.mjs          # all guides
  node build.mjs 06-rythmiseis-xristes                                  # one guide
  ```

  It needs a Chromium. It uses `$CHROME` or Playwright's cached
  `~/.cache/ms-playwright/chromium-1243/...`. Commit both the `.md` source and the regenerated
  `.pdf`.
- `.gitignore` ignores `*.md` except for explicit exceptions (`docs/dev-guides/*.md`,
  `docs/user-guides/src/*.md`, `.claude/skills/**/*.md`, `START_HERE.md`, `seo-audit-tool`).
  Some `docs/*.md` files are tracked because they were added before the rule. Others, such as
  `STAGING-SETUP.md` and `AUDIT-ENGINE-SERVER-SETUP.md`, are local-only. A new top-level doc needs
  `git add -f` or a new exception.

### Troubleshooting

| Symptom | Likely cause |
|---|---|
| Every admin save returns 403 "Cross-origin request rejected" | `NEXT_PUBLIC_SITE_URL` does not match the origin/port being served. In production, it is unset. |
| Rate-limited routes (login, cron) return 429 on first call in production | Proxy is not setting `X-Real-IP`. The log shows `[cms] No X-Real-IP…`. |
| Cron returns 401 with the right secret | `CMS_CRON_SECRET` is shorter than 32 characters or not in the Next process env. |
| Cron returns 404 | Typo in the job name, or the job's module is off (`module.<name>` or config). |
| A setting "saves" but nothing changes | Key not in `managedKeys()`, a non-boolean module flag, or a reader parsing an unexpected format. |
| Setting changed directly in the DB but not visible | Cached forever. Save any setting in the admin (it purges `cms:settings`) or restart. |
| Settings page: "Could not load the shipping methods" / connected keys | Migrations not applied: `npm run db:migrate`. |
| Lock relay exits at start | Secret shorter than 32 characters or no allowed origin. Check that `--env-file` was used. |
| Editor shows "live status unavailable" | Relay not running, Nginx not forwarding `/_ws/locks` upgrade, or wrong `CMS_APP_ORIGIN`. Editing still works. |
| `cms:update` refuses: "not a clean git checkout" | Commit or stash, or pass `--force`. |
| `cms:update` manifest error "format ... update the installer first" | The site's installer is older than the package format. Run the base's `src/cms/update/cli.mjs` with `--target`. |
| `sh: tsx: not found` in migrate | Dev dependencies not installed (`npm ci --include=dev`), or `NODE_ENV=production` was set during install. |
| Migration "access denied" while the app connects fine | MariaDB socket vs TCP account. Grant on `'%'` and use `DB_HOST=127.0.0.1`. |
