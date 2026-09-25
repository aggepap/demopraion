# 02 · Database, migrations & seeds

This guide covers the persistence layer of the CMS: the dialect boundary in `src/cms/db`, the MariaDB/MySQL adapter (connection pool, URL composition, `.env` loading), the Drizzle schema and its 51 tables, the migration chain and the runner that applies it, the seed and maintenance CLIs, the generic `documents` store with its versions and relations, and how the test suite relates to (and avoids) the database. It does not cover what individual modules do with their tables beyond a one-line purpose; see the module guides for that.

Related guides: [01-architecture.md](01-architecture.md) · [03-content-model.md](03-content-model.md) · [04-admin-ui.md](04-admin-ui.md) · [05-auth-users-security.md](05-auth-users-security.md) · [06-media-seo-structured-data.md](06-media-seo-structured-data.md) · [07-forms-email-marketing.md](07-forms-email-marketing.md) · [08-commerce.md](08-commerce.md) · [09-booking.md](09-booking.md) · [10-settings-cron-operations.md](10-settings-cron-operations.md)

---

## 1. File map

| Path | Responsibility |
|---|---|
| `src/cms/db/adapter.ts` | `DialectKind` (`'mysql' \| 'pg'`) and the `DbAdapter` interface: `insertId`, `affectedRows`, `jsonScalar`. The only place dialect differences are meant to be expressed. |
| `src/cms/db/index.ts` | The single binding point: `getDb()`, `adapter`, `schema`, and re-exported types (`Db`, `DocumentRow`, `NewDocumentRow`, `DocumentStatus`, `DbAdapter`, `DialectKind`). Everything in `core/` and `modules/` imports from here. |
| `src/cms/db/migrate.ts` | `npm run db:migrate` entry point. Runs Drizzle's `migrate()` over the app's own pooled connection. |
| `src/cms/db/adapters/mysql/adapter.ts` | `mysqlAdapter` — MariaDB implementation of `DbAdapter`. |
| `src/cms/db/adapters/mysql/client.ts` | `getMysqlDb()` — lazy `mysql2/promise` pool + Drizzle instance, cached on `globalThis`. Re-exports `schema`. |
| `src/cms/db/adapters/mysql/url.ts` | `composeDbUrl(env)` — builds the connection URL from `DATABASE_URL` or `DB_*`. |
| `src/cms/db/adapters/mysql/load-env.ts` | Side-effect `.env.local` / `.env` loader for standalone CLIs (not needed inside Next). |
| `src/cms/db/adapters/mysql/schema/*.ts` | Drizzle table definitions, one file per area; `schema/index.ts` is the barrel. |
| `src/cms/db/adapters/mysql/migrations/*.sql` | Generated (and occasionally hand-extended) SQL migrations `0000`…`0024`. |
| `src/cms/db/adapters/mysql/migrations/meta/` | Drizzle-kit snapshots (`NNNN_snapshot.json`) and `_journal.json` (ordered tag list + timestamps). |
| `src/cms/core/db/like.ts` | `likeTerm(search)` — escapes `%`, `_`, `\` and wraps in `%…%` for `LIKE` searches. |
| `src/cms/db/seeds/seed-mode.ts` | `SeedMode` (`create-only` \| `force`), `seedAction`, `parseSeedMode`, `tally`, `formatSeedSummary`. |
| `src/cms/db/seeds/documents.ts` | `resolveTranslationGroupId`, `applySeedDocument` — helpers for site content seeders. |
| `src/cms/db/seeds/roles.ts` | `DEFAULT_ROLES`, `seedRoles()` (upsert by name). |
| `src/cms/db/seeds/cookies.ts` | `pendingCategories`, `seedCookieCatalog()` (create-only). |
| `src/cms/db/seeds/brand.ts` | `importBrand()` — copies brand identity/palette into `site_settings` when absent. |
| `src/cms/db/seeds/admin-args.ts` | `parseAdminArgs` for `db:seed-admin`. |
| `src/cms/db/seeds/cli/*.ts` | Runnable CLIs (see §4.6). |
| `src/cms/db/seeds/stubs/server-only.ts` | Empty module that `tsconfig.seed.json` maps `server-only` / `client-only` to. |
| `src/site-seed/cli.ts`, `src/site-seed/data.ts` | Site-level seeder (`db:seed-site`): settings + placeholder documents. Site-owned, not core. |
| `drizzle.config.ts` | drizzle-kit config: schema barrel, output folder, `casing: 'snake_case'`, `strict`, discrete TCP credentials. |
| `tsconfig.seed.json` | tsconfig for CLIs that import `server-only` modules. |
| `.env.example` | Connection variable template. |

---

## 2. The dialect boundary

### 2.1 `DbAdapter`

`src/cms/db/adapter.ts`:

```ts
export type DialectKind = 'mysql' | 'pg';

export interface DbAdapter {
  readonly kind: DialectKind;
  insertId(result: unknown): number;          // auto-increment id from an insert result
  affectedRows(result: unknown): number;      // rows MATCHED by an UPDATE/DELETE
  jsonScalar(column: AnyColumn, path: string): SQL<string | null>; // unquoted JSON scalar
}
```

Core code uses Drizzle's query builder directly (it is the same API across dialects) and routes only these three operations through the adapter. `mysqlAdapter` (`adapters/mysql/adapter.ts`):

- `insertId` accepts both result shapes Drizzle/mysql2 produce (`[ResultSetHeader, FieldPacket[]]` or a bare header) and **throws** if no numeric `insertId` is present.
- `affectedRows` reads `affectedRows` (rows matched), not `changedRows`, so an update that sets a value to itself still counts as "the row existed". Returns `0` when absent. Used to answer 404 on update/delete (e.g. `src/cms/core/scripts/service.ts`, `src/cms/core/documents/publish-scheduled.ts`).
- `jsonScalar(col, 'a.b')` emits `json_unquote(json_extract(col, '$.a.b'))`.

Only `pg` exists as a name; there is **no Postgres adapter**. `src/cms/db/index.ts` binds `mysqlAdapter` unconditionally. Several MariaDB-specific calls still live outside the adapter — notably `.onDuplicateKeyUpdate(...)` in `core/settings/index.ts`, `core/seo/service.ts`, `core/seo/resolve.ts`, `core/secrets/service.ts`, `core/email/suppression.ts`, and `.for('update')` row locks in `modules/booking/allocation.ts`, `modules/commerce/payments.ts`, `modules/commerce/coupons.ts`. A Postgres port would have to touch those.

### 2.2 `getDb()` and `schema`

```ts
// src/cms/db/index.ts
export function getDb() { return getMysqlDb(); }
export const adapter: DbAdapter = mysqlAdapter;
export { schema };
export type Db = ReturnType<typeof getDb>;
```

Usage pattern everywhere in `core/` and `modules/`:

```ts
import { adapter, getDb, schema } from '../../db';

const [row] = await getDb().select().from(schema.documents).where(eq(schema.documents.id, id)).limit(1);
```

A few files import enum value arrays straight from the schema files (e.g. `documentStatusValues` in `core/routes/collections.ts`, `orderStatusValues` in `modules/commerce/orders.ts`, `formStatusValues` in `core/routes/forms.ts`); many more do `import type` from `adapters/mysql/schema/*`. That is tolerated but does couple those files to the MySQL adapter path.

### 2.3 Connection pool (`client.ts`)

```ts
mysql.createPool({
  uri: ensureUrl(),
  connectionLimit: 10,
  waitForConnections: true,
  namedPlaceholders: false,
  dateStrings: false,      // DATE/TIMESTAMP come back as JS Date
  multipleStatements: false,
});
drizzle(pool, { schema, mode: 'default' });
```

- Pool and Drizzle instance are cached on `globalThis.__cmsMysqlPool` / `globalThis.__cmsMysqlDb`, so Next dev HMR does not leak pools. Under PM2 cluster mode each worker has its own pool of 10.
- Creation is lazy: nothing connects until the first `getDb()` call. `ensureUrl()` throws `Database connection is not configured…` when neither variable set is present.
- `client.ts` deliberately does **not** `import 'server-only'` so the `tsx` CLIs can use it. A client component importing it still fails the build because of `mysql2`.

### 2.4 URL composition (`url.ts`)

`composeDbUrl(env = process.env)` returns `{ url, source }`:

1. `DATABASE_URL` (trimmed) is used verbatim → `source: 'DATABASE_URL'`.
2. Otherwise `DB_HOST`, `DB_USER`, `DB_NAME` are required; `DB_PASSWORD` defaults to empty, `DB_PORT` to `3306`. User and password are `encodeURIComponent`-ed (Plesk passwords with special characters). → `mysql://user:pass@host:port/name`, `source: 'DB_*'`.
3. Otherwise `{ url: null, source: 'missing' }`.

### 2.5 `.env` loading for CLIs (`load-env.ts`)

Next loads `.env.local` itself; `tsx` processes and drizzle-kit do not. `load-env.ts` is imported for its side effect at the top of every CLI and of `drizzle.config.ts`. Precedence: already-set `process.env` > `.env.local` > `.env`. It supports `KEY=value`, `#` comments and single/double-quoted values; there is no variable expansion and no multi-line values.

---

## 3. Data model

All tables use `int` auto-increment ids unless noted, `timestamp` for dates (`created_at` default `now()`, `updated_at` with `ON UPDATE CURRENT_TIMESTAMP`), and JSON columns typed via `.$type<>()`. Money is stored as integer minor units (cents). Column names are explicit snake_case in every definition. The expected server charset is `utf8mb4` / `utf8mb4_unicode_ci` (set at database creation, see `docs/LOCAL_SETUP.md` §3) — migrations do not set it.

The schema barrel `schema/index.ts` exports every file; there is **one** migration chain, so every table exists on every site regardless of which modules its `cms.config` enables.

### 3.1 The generic content store (`schema/documents.ts`)

Every piece of content — page, post, product, booking item, author, term — is a row in `documents`. Filtered/sorted columns are real columns; collection-specific fields live in `data` JSON, validated at write time by the zod schema generated from the collection's fields (`src/cms/config/zod.ts`). New content types therefore need no migration.

**`documents`**

| Column | Type | Notes |
|---|---|---|
| `id` | int PK AI | |
| `type` | varchar(64) NOT NULL | Collection key from site config (`post`, `page`, `product`, …). |
| `slug` | varchar(191) NOT NULL | |
| `locale` | varchar(8) NOT NULL | One row per locale. |
| `status` | enum `draft`,`published`,`scheduled`,`archived` default `draft` | `documentStatusValues`. |
| `published_at` | timestamp NULL | Set to now on first publish if not supplied. |
| `scheduled_for` | timestamp NULL | Promoted by `core/documents/publish-scheduled.ts`. |
| `modified_at` | timestamp NULL | Editorial "last meaningful change" (JSON-LD `dateModified`, sitemap lastmod); falls back to `published_at`. Distinct from `updated_at`. |
| `translation_group_id` | varchar(36) NULL | UUID shared by all locale variants of one logical document. `createDocument` always assigns one. |
| `meta_title`, `meta_description` | varchar(255) / varchar(320) | SEO block for `seo: true` collections. |
| `canonical_path` | varchar(512) NULL, **unique** | Resolved public path; enables O(1) path→document lookup. |
| `noindex`, `nofollow`, `include_in_sitemap` | boolean | Defaults false/false/true. |
| `og_image_uuid` | varchar(36) NULL | `media_files.uuid`, intentionally **no FK** (media may be disabled). |
| `data` | json NOT NULL | All config-defined fields. |
| `created_by`, `updated_by` | int → `admin_users.id` ON DELETE SET NULL | |
| `created_at`, `updated_at` | timestamp | `updated_at` changes on every save. |

Indexes: `uniq_documents_type_slug_locale (type, slug, locale)`, `uniq_documents_canonical_path (canonical_path)`, `idx_documents_type_status_locale`, `idx_documents_status_published (status, published_at)`, `idx_documents_translation_group`, `idx_documents_updated_at` (PM bridge incremental sync).

**`document_versions`** — immutable snapshot per save: `document_id` (FK cascade), `version` (monotonic per document), `snapshot` JSON (the editable payload: slug, locale, status, data, SEO block, dates, translation group — see `editableSnapshot()` in `core/documents/service.ts`), optional `label`, `created_by`. Unique `(document_id, version)`.

**`document_relations`** — materialised links from `relation` fields: `from_id`, `to_id` (both FK cascade to `documents`), `field_key` (dotted key path of the relation field), `position` (order for `many`). Unique `(from_id, to_id, field_key)`; indexes on `(from_id, field_key)` and `to_id`. Replaces per-pair join tables.

Exported types: `DocumentRow`, `NewDocumentRow`, `DocumentVersionRow`, `NewDocumentVersionRow`, `DocumentRelationRow`, `NewDocumentRelationRow`, `DocumentStatus`.

### 3.2 Table inventory by area

51 tables in 25 schema files. Each is created by exactly one migration (verified: every `mysqlTable` name has a matching `CREATE TABLE`).

**Admin identity & security**

| Table | File | Purpose / key columns |
|---|---|---|
| `admin_users` | `auth.ts` | Admin accounts: `email` unique, `password_hash`, `locale` (default `el`), `disabled_at`, MFA columns `mfa_method`, `totp_secret_encrypted` (varbinary, AES-GCM), `mfa_enrolled_at`, `totp_last_step` (replay guard). |
| `admin_roles` | `auth.ts` | `name` unique, `permissions` JSON string array (`*` = superadmin). |
| `admin_user_roles` | `auth.ts` | Join table, composite PK `(user_id, role_id)`, both cascade. Drizzle `relations()` defined here. |
| `admin_mfa_codes` | `mfa.ts` | Emailed one-time codes (bcrypt `code_hash`), `purpose` `login`/`enroll`, `attempts`, `expires_at`, `consumed_at`. |
| `admin_recovery_codes` | `mfa.ts` | bcrypt recovery codes; `used_at` marks, rows are never deleted on use. |
| `audit_logs` | `audit.ts` | Change trail: `user_id` (nullable), `actor_label` (non-human actors), `action`, `subject_type`/`subject_id`, `before`/`after` JSON, `ip`, `ua`. |
| `cms_api_tokens` | `api-tokens.ts` | PM bridge credentials imported from Product Manager: `key_id` unique, `secret_encrypted` (AES-GCM under `CMS_TOKEN_ENCRYPTION_KEY`), `scopes`, `expires_at`, `revoked_at`. |
| `integration_secrets` | `integrations.ts` | PK `key`; encrypted `ciphertext` + `hint` (last 4) for OAuth tokens, API keys, courier credentials. |
| `editing_locks` | `locks.ts` | Collaborative edit locks: unique `(resource_type, resource_key)`, `session_id` (tab), `connection_id` (socket), `heartbeat_at`, `expires_at`. |

**Content, settings, media, SEO**

| Table | File | Purpose |
|---|---|---|
| `documents`, `document_versions`, `document_relations` | `documents.ts` | See §3.1. |
| `site_settings` | `settings.ts` | KV store: PK `key` varchar(128), `value` JSON. Upserted with `onDuplicateKeyUpdate`. |
| `media_folders` | `media.ts` | Folder tree, self-FK `parent_id` ON DELETE SET NULL. |
| `media_files` | `media.ts` | PK `uuid`; `original_name`, `mime`, `size`, `width`/`height`, `hash` (indexed, dedupe), `alt_text`, `folder_id`. |
| `media_variants` | `media.ts` | Generated renditions: `variant_key` (`original`,`thumb`,`medium`,`large`,`og`) × `format` (`jpg`,`webp`,`png`,`avif`,`svg`), unique per media. |
| `media_usages` | `media.ts` | Where a media file is used (`subject_type`, `subject_id`, `context`). |
| `seo_meta` | `seo.ts` | Human per-path overrides, unique `(path, locale)`. |
| `seo_redirects` | `seo.ts` | Redirect rules: `source`, `target`, `status_code`, `kind` (`literal`/`wildcard`/`regex`), `hits`; `document_id` (FK cascade) + `reason` (`unpublish`/`slug_change`) mark CMS-written rules. Unique `(source, kind)`. |
| `seo_404_log` | `seo.ts` | Aggregated 404s, unique `(path, locale)`, `hits`, `ignored`. |
| `pm_head_payloads` | `pm.ts` | Compiled `<head>` payloads pushed by Product Manager, unique `(path, locale)`, `document_id` FK cascade. |
| `script_snippets` | `scripts.ts` | Admin-managed JS snippets placed with `[script name="…"]`. `slug`, `kind`, `code` (mediumtext), `consent_category`. |
| `cookie_categories`, `cookie_services` | `cookies.ts` | Consent catalogue; per-locale JSON `name`/`description`/`purpose`. `cookie_categories.key` unique. |
| `cookie_consents` | `cookies.ts` | Consent records by anonymous `visitor_ref`, `decision`, `categories`, `policy_version`. |
| `stat_counters` | `stats.ts` | Anonymous daily counters; composite PK `(scope, subject_id, metric, day)` for `INSERT … ON DUPLICATE KEY UPDATE` increments. |

**Forms, email, marketing**

| Table | File | Purpose |
|---|---|---|
| `form_submissions` | `forms.ts` | All form posts: site-defined `form_type`, `email`, `payload` JSON, `email_status`, `status` (`new`,`handled`,`archived`,`spam`). |
| `newsletter_subscribers` | `forms.ts` | `email` unique, consent text/time, double opt-in, unsubscribe, Mailchimp sync fields. |
| `email_suppressions` | `email.ts` | Addresses that must not get marketing mail; `email` unique, `reason`. |
| `abandoned_carts` | `abandoned.ts` | Checkout-abandon captures: `token` unique, `items` JSON, `subtotal`, `status` (`pending`,`reminded`,`converted`). |

**Commerce & customers** (products themselves are `documents` with `type = 'product'`)

| Table | File | Purpose |
|---|---|---|
| `orders` | `commerce.ts` | `reference` unique, `status` (`pending`,`paid`,`fulfilled`,`cancelled`,`refunded`), `email`, `customer_id` (FK SET NULL), `shipping_method_id`, `currency`, `subtotal`, `total`, `metadata`, `version` (optimistic lock, default 1). |
| `order_items` | `commerce.ts` | Lines: `product_id` (FK to `documents`), `sku`, `variation_id`, `unit_price`, `quantity`, `line_total`, `snapshot` JSON (immutable purchase data). |
| `payments` | `commerce.ts` | Provider payments; unique `(provider, provider_ref)`. |
| `product_reviews` | `reviews.ts` | Keyed by `product_group_id` (translation group), `product_id` best-effort; `status` `pending`/`approved`/`rejected`. |
| `customers` | `customers.ts` | Shop accounts (separate from admins): `email` unique, `password_hash`, `token_version` (JWT revocation), `status`, `deleted_at` (anonymised, not deleted). |
| `customer_addresses` | `customers.ts` | Address book with default shipping/billing flags. |
| `customer_tokens` | `customers.ts` | One-time links; only `token_hash` (sha256) stored, unique. |
| `wishlist_items` | `wishlist.ts` | Unique `(customer_id, product_id, variation_id)`; `variation_id` NOT NULL default `''` so the unique key works. |
| `shipping_zones`, `shipping_methods`, `shipments` | `shipping.ts` | Zones (countries), methods (courier, kind, cost, weight tiers, COD), parcels with courier voucher (unique `(courier, voucher)`). |
| `gift_cards`, `gift_card_transactions` | `giftcards.ts` | Card with HMAC `code_hash` (unique), encrypted copy, `balance`; ledger with `balance_after`. |
| `review_locations`, `reviews_external` | `reviews-external.ts` | Google review sources and synced reviews; unique `(location_id, external_id)`, admin `hidden` flag. |

**Booking** (bookable items/resources are `documents`)

| Table | File | Purpose |
|---|---|---|
| `reservations` | `booking.ts` | `reference` unique, `status` (`pending`,`awaiting_payment`,`confirmed`,`paid`,`cancelled`,`expired`), `mode` (`request`/`instant`), `allocation_mode`, `booking_id` + `booking_group_id`, `resource_id` + `resource_group_id`, `slot_date`, `end_date`, `nights`, party size, money columns, `pricing_snapshot`, payment-link token hash, `expires_at`, `version`. |
| `reservation_items` | `booking.ts` | Priced breakdown lines. |
| `booking_slots` | `booking.ts` | One row per `(slot_key, slot_date)` (unique): capacity override, blackout `closed`, and the row locked `FOR UPDATE` during allocation. |
| `reservation_holds` | `booking.ts` | Seat ledger, one row per (slot, date); capacity is aggregated from these under the slot lock, never stored as a counter. |
| `reservation_payments` | `booking.ts` | Unique `(provider, provider_ref)`, `is_deposit`. |
| `reservation_events` | `booking.ts` | Timeline of status changes and emails with delivery outcome. |

Note: the header comment of `schema/commerce.ts` still says the order tables are "DORMANT (Phase 4)"; the commerce module writes to them now, so treat that comment as stale.

---

## 4. How it works

### 4.1 Document writes, versions and optimistic concurrency

All document writers — admin form, collection CRUD routes, version restore, the PM bridge and the seed helpers — go through `src/cms/core/documents/service.ts`:

- `createDocument(config, type, input, actorId)` validates `data` (required fields enforced only if the status goes live), runs `assertMdxSafe`, computes `canonical_path` for SEO collections, then in **one transaction**: inserts the row, syncs `document_relations` (`syncDocumentRelations`), writes version 1 (`writeVersion`), and reconciles slug-change redirects.
- `updateDocument(config, id, patch, actorId)` does the same inside a transaction, plus the unpublish-redirect reconciler.
- `writeVersion` computes `coalesce(max(version), 0) + 1` and inserts a snapshot. The highest version number is the document's concurrency token (`documentVersionNumber(id)`).
- If `patch.expectedVersion` is supplied and differs from the current version, the update throws `ApiError('conflict', …)`. The check runs inside the transaction after a `.for('update')` lock on the document row. Seeders and other single-writer callers omit it.
- `deleteDocument(id)` deletes the row; versions, relations, `seo_redirects` rows tied to it and `pm_head_payloads` cascade via FK.
- `listVersions`, `versionRestoreState`, `restoreVersion` read `document_versions`; restore re-applies a snapshot through `updateDocument`.

The `scheduled` → `published` promotion (`core/documents/publish-scheduled.ts`) uses one conditional UPDATE per document and `adapter.affectedRows()` to know whether it won, batch limit 200.

### 4.2 Transactions and locking

`db.transaction(async (tx) => …)` is used in ~26 places. Inside a transaction, code passes `tx` cast as `ReturnType<typeof getDb>` to helpers that accept a db handle. Row locks use Drizzle's `.for('update')` (booking allocation, commerce payments, coupons). `orders.version`, `reservations.version` and `booking_slots.version` are optimistic-lock counters maintained by the modules.

### 4.3 Search

Always build `LIKE` patterns with `likeTerm()`:

```ts
import { likeTerm } from '@/cms/core/db/like';
where(like(schema.formSubmissions.email, likeTerm(q)))
```

It escapes `\` first, then `%` and `_`, relying on backslash being the default MySQL `LIKE` escape (no `ESCAPE` clause needed).

### 4.4 Migrations: generation

`drizzle.config.ts`:

```ts
defineConfig({
  dialect: 'mysql',
  schema: './src/cms/db/adapters/mysql/schema/index.ts',
  out: './src/cms/db/adapters/mysql/migrations',
  casing: 'snake_case',
  strict: true,
  verbose: true,
  dbCredentials: dbCredentials(), // discrete host/port/user/password/database
});
```

`npm run db:generate` (`drizzle-kit generate`) diffs the schema against the latest `meta/NNNN_snapshot.json` and writes `NNNN_<random_name>.sql`, a new snapshot, and a `_journal.json` entry (`idx`, `when` = ms timestamp, `tag`, `breakpoints: true`). It needs no database connection. Statements are separated by `--> statement-breakpoint`.

Naming: `NNNN_` sequence prefix plus drizzle-kit's random two-word tag. Only `0000_init` and `0001_add_document_modified_at` have descriptive names. Current chain:

| # | Content |
|---|---|
| 0000 | Initial: auth, audit, settings, documents/versions/relations, media, seo, forms/newsletter |
| 0001 | `documents.modified_at` |
| 0002 | `orders`, `order_items`, `payments` |
| 0003 | `cookie_categories`, `cookie_services` |
| 0004 | `product_reviews` |
| 0005 | `abandoned_carts` |
| 0006 | `cookie_consents` |
| 0007 | `orders.version` |
| 0008 | Booking tables (6) |
| 0009 | Payment provider-ref indexes → unique; `order_items.variation_id` |
| 0010 | `reservations.end_date`, `nights`, `adults`, `children` |
| 0011 | `cms_api_tokens`, `pm_head_payloads`, `audit_logs.actor_label`, `idx_documents_updated_at` |
| 0012 | `email_suppressions` |
| 0013 | `reservations.payment_started_at` |
| 0014 | MFA: `admin_mfa_codes`, `admin_recovery_codes`, `admin_users` MFA columns |
| 0015 | `editing_locks` |
| 0016 | `seo_redirects.document_id` |
| 0017 | `integration_secrets`, `stat_counters` |
| 0018 | Customers (3 tables), `orders.customer_id` |
| 0019 | `wishlist_items` |
| 0020 | `review_locations`, `reviews_external` |
| 0021 | Shipping (3 tables), `orders.shipping_method_id` |
| 0022 | Gift cards (2 tables) |
| 0023 | `script_snippets` |
| 0024 | `seo_redirects.reason` + hand-added data backfill `UPDATE … SET reason = 'unpublish' WHERE document_id IS NOT NULL` |

### 4.5 Migrations: applying

`npm run db:migrate` runs `tsx src/cms/db/migrate.ts`:

```ts
import './adapters/mysql/load-env';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { getMysqlDb } from './adapters/mysql/client';

await migrate(getMysqlDb(), { migrationsFolder: './src/cms/db/adapters/mysql/migrations' });
```

It deliberately does not use `drizzle-kit migrate`: drizzle-kit's URL handling resolved `127.0.0.1` to a socket `localhost` connection, which MariaDB authenticates as `user@localhost` rather than the app's `user@'%'` TCP grant. `drizzle.config.ts` works around the same issue for `push`/`studio` by passing discrete credentials with an explicit host.

What Drizzle's MySQL migrator does (from `node_modules/drizzle-orm/mysql-core/dialect.js`):

1. `CREATE TABLE IF NOT EXISTS __drizzle_migrations (id serial, hash text, created_at bigint)`.
2. Reads the single row with the highest `created_at`.
3. Applies every journal entry whose `when` is **greater** than that value, statement by statement, then inserts `(hash, when)`.

Consequences:

- Applied-ness is decided by the journal timestamp only; the hash is recorded but never compared. Editing an already-applied `.sql` file has no effect on databases that ran it.
- An entry whose `when` is lower than the newest applied one is **silently skipped**. The current journal is strictly increasing (25 entries, checked); keep it that way when merging branches that both generated migrations — regenerate rather than hand-merge.
- The loop runs inside `session.transaction`, but MariaDB DDL causes implicit commits, so a failure halfway through a multi-statement migration leaves the earlier statements applied and the migration unrecorded. Re-running will then fail on the first already-applied statement (e.g. duplicate column). Generated SQL has no `IF NOT EXISTS` guards; recovery is manual.
- `npm run cms:update` (`src/cms/update/install.mjs`) runs `npm run db:migrate` after copying a new core into a site unless `--skip-migrate`. Migrations are classified as core files by the sync plan (`test/tools/core-sync-plan.test.ts`), so every migration you add ships to every client site.

### 4.6 Seeds and maintenance CLIs

All CLIs import `load-env` first, call `process.exit(0)` on success (the pool would otherwise keep the process alive) and `process.exit(1)` with the error on failure.

| npm script | File | What it does | Idempotency |
|---|---|---|---|
| `db:seed-roles` | `seeds/cli/seed-roles.ts` → `seeds/roles.ts` | Upserts `DEFAULT_ROLES`: `superadmin` (`['*']`) and `editor` (content, media, SEO, forms read, newsletter read, orders, reviews, reservations, schedule). | Upsert by `name`; **overwrites** the permission list of an existing role of the same name every run (roles are treated as code-owned). |
| `db:seed-admin -- <email> <password> [name] [--locale <code>]` | `seeds/cli/create-admin.ts` | Validates password with `passwordMessage` (same policy as the admin), runs `seedRoles`, creates or updates the user (lower-cased email, bcrypt hash, clears `disabled_at`), grants `superadmin` if the user has no role row. | Safe to re-run; resets the password of an existing account. |
| `db:seed-cookies` | `seeds/cli/seed-cookies.ts` → `seeds/cookies.ts` | Inserts `DEFAULT_COOKIE_CATEGORIES` (from `core/cookies/defaults.ts`) whose `key` is missing, plus their services. | Create-only; never edits or re-adds services to an existing category. |
| `db:brand-import` | `seeds/cli/brand-import.ts` → `seeds/brand.ts` | Copies `config.brand` and the `@theme` colours of `src/app/globals.css` into `brand.identity` / `brand.palette` settings, validated by `checkStructuredSetting`. | Writes only absent keys. Uses `tsconfig.seed.json`. |
| `db:seed-site [-- --force] [-- --publish-samples]` | `src/site-seed/cli.ts` | Site seeder: upserts settings from `src/site-seed/data.ts`, imports brand, creates placeholder documents per locale in one translation group via `applySeedDocument`. | Settings always upserted; documents create-only unless `--force`. Uses `tsconfig.seed.json`. |
| `db:snapshot-content` | `seeds/cli/snapshot-content.ts` | Dumps all `documents` (without editor ids / technical timestamps) and `document_relations` to `src/cms/db/seeds/data/content.json`, preserving ids. | Read-only on the DB; overwrites the file. |
| `db:seed-content` | `seeds/cli/seed-content.ts` | Replays `content.json` into a clean database: inserts documents **with their original ids**, `created_by`/`updated_by` null, then relations whose endpoints exist. Raw inserts — no validation, no `document_versions` rows. | Skips a document when `(type, slug, locale)` exists and a relation when `(from, to, field)` exists. The `data/` directory is not present in this repo (see `docs/LOCAL_SETUP.md`). |
| `db:backfill-translation-groups` | `seeds/cli/backfill-translation-groups.ts` | Gives every `(type, slug)` bucket a single `translation_group_id`, reusing an existing one if any. | Writes only rows whose id differs. |
| `db:migrate-booking-options [-- --apply [--purge]]` | `seeds/cli/migrate-booking-options.ts` | One-off data migration: folds `resource` / `booking_type` / `departure` documents into `options[]` on `booking` documents, keeping the resource's translation group id as the option id (the availability key). | Dry run by default; skips experiences whose `options` are already set. |
| `db:migrate-booking-facets [-- --apply] [--locale=xx]` | `seeds/cli/migrate-booking-facets.ts` | One-off: turns `types` / `departures` rows into `vessel_type` / `departure_location` documents, preserving slugs; stamps `optionsEnabled`. Must run in the same window as the deploy that introduced it. | Dry run by default; resumable. |
| `db:reset-mfa -- <email>` | `seeds/cli/reset-mfa.ts` | Clears MFA columns on `admin_users` and deletes the user's `admin_mfa_codes` / `admin_recovery_codes`. Break-glass for a locked-out sole superadmin. | No-op if no MFA method is set. |

**Seed mode contract** (`seeds/seed-mode.ts`): `parseSeedMode(argv)` returns `force` only for the exact token `--force`. `seedAction(exists, mode)` → `create` when absent, `update` when present and forced, else `skip`. `formatSeedSummary` prints counts and, when anything was skipped, tells the operator which flag would overwrite. `applySeedDocument` implements that decision against `documents` and delegates to `createDocument` / `updateDocument` (so validation, relations, versions and redirects all apply).

**`server-only` stubbing.** Core services start with `import 'server-only'`, which only Next's bundler can resolve. CLIs that import them (`brand-import`, `db:seed-site`) run with `tsx --tsconfig ./tsconfig.seed.json`, which maps `server-only` and `client-only` to `src/cms/db/seeds/stubs/server-only.ts`. The CLIs that only touch `client.ts` and the schema run with plain `tsx`.

---

## 5. HTTP API

None. The database layer exposes no routes. Deployment-time migration and seeding are driven by env switches described in `docs/STAGING-SETUP.md` (`DEPLOY_DB_MIGRATE`, `DEPLOY_DB_SEED`), consumed by a `deploy.php` that is **not** in this repository.

---

## 6. Admin UI

No database-administration screen exists. `npm run db:studio` (`drizzle-kit studio`) is the local inspection tool; it uses `drizzle.config.ts` credentials.

---

## 7. Configuration

### 7.1 Environment variables

| Variable | Used by | Notes |
|---|---|---|
| `DATABASE_URL` | `url.ts`, `drizzle.config.ts` | `mysql://user:pass@host:port/db`. Takes precedence over `DB_*`. |
| `DB_HOST` | same | Required if no `DATABASE_URL`. Use `127.0.0.1`, not `localhost`, to force TCP (see `docs/STAGING-SETUP.md`, `drizzle.config.ts`). |
| `DB_PORT` | same | Default `3306`. |
| `DB_USER` | same | Required; URL-encoded. |
| `DB_PASSWORD` | same | Optional; URL-encoded. |
| `DB_NAME` | same | Required. |
| `CMS_TOKEN_ENCRYPTION_KEY` | `core/tokens`, `core/secrets` | Not a connection setting, but required to read `cms_api_tokens.secret_encrypted`, `integration_secrets.ciphertext`, `admin_users.totp_secret_encrypted`. A DB restored without the same key cannot decrypt those columns. |

`drizzle.config.ts` falls back to `127.0.0.1` / `placeholder` credentials when nothing is set, so `db:generate` works without a database.

### 7.2 npm scripts

| Script | Command |
|---|---|
| `db:generate` | `drizzle-kit generate` |
| `db:migrate` | `tsx src/cms/db/migrate.ts` |
| `db:push` | `drizzle-kit push` — bypasses the migration journal; do not use against shared databases. |
| `db:studio` | `drizzle-kit studio` |
| `db:seed-roles`, `db:seed-admin`, `db:seed-cookies`, `db:reset-mfa`, `db:snapshot-content`, `db:seed-content`, `db:backfill-translation-groups`, `db:migrate-booking-options`, `db:migrate-booking-facets` | `tsx src/cms/db/seeds/cli/<name>.ts` |
| `db:brand-import` | `tsx --tsconfig ./tsconfig.seed.json src/cms/db/seeds/cli/brand-import.ts` |
| `db:seed-site` | `tsx --tsconfig ./tsconfig.seed.json src/site-seed/cli.ts` |

### 7.3 Database creation

Migrations create tables, not the database. From `docs/LOCAL_SETUP.md`:

```sql
CREATE DATABASE site_cms CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'site'@'%' IDENTIFIED BY '…';
GRANT ALL PRIVILEGES ON site_cms.* TO 'site'@'%';
```

Fresh setup order: create DB → `npm run db:migrate` → `npm run db:seed-admin -- …` (seeds roles too) → `npm run db:seed-cookies` → `npm run db:seed-site` (or `db:seed-content` if a snapshot exists).

### 7.4 Backup and restore

There is no backup code in the CMS; `docs/CMS-FEATURES-FOR-PROPOSALS.md` states backups are provided at server level. What the code does offer:

- `db:snapshot-content` / `db:seed-content` move **documents and relations only** between environments (no media files, settings, users, orders, reservations). It is a content-carry mechanism for a clean target, not a backup.
- For a real backup use a server-level `mysqldump` (or Plesk backups) of the whole database plus the media directory, and keep `CMS_TOKEN_ENCRYPTION_KEY` alongside it (see §7.1).
- Include `__drizzle_migrations` in any dump; restoring without it makes `db:migrate` try to re-run `0000_init` against existing tables.

---

## 8. Extending

### 8.1 Add a table for a new module

1. Create `src/cms/db/adapters/mysql/schema/<area>.ts` following the existing style:

   ```ts
   import { index, int, json, mysqlEnum, mysqlTable, timestamp, unique, varchar } from 'drizzle-orm/mysql-core';
   import { adminUsers } from './auth';
   import { documents } from './documents';

   export const widgetStatusValues = ['active', 'retired'] as const;
   export type WidgetStatus = (typeof widgetStatusValues)[number];

   export const widgets = mysqlTable(
     'widgets',
     {
       id: int('id').autoincrement().primaryKey(),
       documentId: int('document_id').references(() => documents.id, { onDelete: 'cascade' }),
       key: varchar('key', { length: 64 }).notNull(),
       status: mysqlEnum('status', widgetStatusValues).notNull().default('active'),
       config: json('config').$type<Record<string, unknown>>().notNull(),
       createdBy: int('created_by').references(() => adminUsers.id, { onDelete: 'set null' }),
       createdAt: timestamp('created_at').notNull().defaultNow(),
       updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
     },
     (t) => ({
       keyUniq: unique('uniq_widgets_key').on(t.key),
       statusIdx: index('idx_widgets_status_created').on(t.status, t.createdAt),
     }),
   );

   export type Widget = typeof widgets.$inferSelect;
   export type NewWidget = typeof widgets.$inferInsert;
   ```

   Conventions: explicit snake_case column names; name indexes `idx_<table>_<cols>` and uniques `uniq_<table>_<cols>`; money as `int` minor units; `varchar(191)` for indexed strings that may be long (utf8mb4 index length); a file-level comment explaining *why* the table exists and any non-obvious column.
2. Export it from `schema/index.ts` (`export * from './<area>';`). It is then available as `schema.widgets` via `@/cms/db`.
3. `npm run db:generate`. Review the new `NNNN_*.sql`: check FK `ON DELETE` actions, index names, defaults. Commit the SQL, the new `meta/NNNN_snapshot.json` and `meta/_journal.json` together.
4. `npm run db:migrate` against your local database.
5. Access the table only through `getDb()` / `schema` from `src/cms/db`; use `adapter.insertId(res)` rather than reading `insertId` directly, and `adapter.affectedRows(res)` for 404 detection.
6. Remember the table is created on every site that updates its core, whether or not the module is enabled. Code must not assume rows exist.

### 8.2 Add a column safely

- Add it to the schema file as **nullable** or **with a default** (`.notNull().default(...)`), as `0007` (`orders.version DEFAULT 1 NOT NULL`) and `0010` did. A `NOT NULL` column without a default on a populated table is either rejected or silently filled with a type zero-value depending on SQL mode.
- `npm run db:generate`, then inspect the `ALTER TABLE`.
- If existing rows need a computed value, append the backfill to the generated SQL file **before it is applied anywhere**, separated by a breakpoint, as `0024_slow_dormammu.sql` does:

  ```sql
  ALTER TABLE `seo_redirects` ADD `reason` varchar(32);--> statement-breakpoint
  UPDATE `seo_redirects` SET `reason` = 'unpublish' WHERE `document_id` IS NOT NULL;
  ```

  Never edit a migration that has already been applied on any environment — it will not re-run (§4.5). Add a new migration instead (`drizzle-kit generate --custom` produces an empty one; not used in this repo so far).
- Renames: drizzle-kit prompts interactively whether a change is a rename or drop+add. Choose rename; drop+add loses data.
- Do not write migrations that touch `site_settings` rows — `test/core/cms-update.test.ts` fails any `.sql` containing `UPDATE`/`DELETE FROM`/`TRUNCATE`/`DROP TABLE` on `site_settings`, because owners' saved settings must survive core updates.
- Removing a column: ship code that stops reading it first, then the drop in a later release, since sites run `cms:update` (code + migrate) as one step and a rollback of code would otherwise hit a missing column.
- For document fields, you usually need **no** column: add a field to the collection in the site config; it lives in `documents.data`. Promote to a real column only when the core must filter/sort/index on it.

### 8.3 Write a seed

1. Put the decision logic in a pure, exported function (see `pendingCategories` in `seeds/cookies.ts`, `seedAction` in `seeds/seed-mode.ts`) so it can be unit-tested without a database.
2. Put the DB work in `src/cms/db/seeds/<name>.ts`, accepting an optional db handle (`db = getMysqlDb()`), like `seedRoles` / `seedCookieCatalog`.
3. Choose the overwrite policy explicitly:
   - Content an admin can edit → create-only by default; overwrite only with `--force` via `parseSeedMode(process.argv)`, and report with `tally` + `formatSeedSummary`.
   - Code-owned data (roles) → upsert.
4. For documents, use `applySeedDocument(config, type, slug, locale, mode, input)` and `resolveTranslationGroupId(type, slug)` from `seeds/documents.ts` so validation, relations, versions and redirects happen. Do not raw-insert into `documents` unless you are replaying a snapshot.
5. Add a CLI in `src/cms/db/seeds/cli/<name>.ts`:

   ```ts
   /** One-line purpose. `npm run db:seed-widgets` */
   import '../../adapters/mysql/load-env';
   import { seedWidgets } from '../widgets';

   async function main(): Promise<void> {
     const r = await seedWidgets();
     console.log(`Widgets seeded (created ${r.created}, skipped ${r.skipped}).`);
     process.exit(0);
   }
   main().catch((err) => { console.error(err); process.exit(1); });
   ```

6. Add the npm script. If the seed imports anything that starts with `import 'server-only'` (core services, `@/site.config`), use `tsx --tsconfig ./tsconfig.seed.json …`.
7. For one-off data migrations (like `migrate-booking-*`), default to a dry run and require `--apply`; make re-runs resume rather than duplicate.

---

## 9. Testing

There is **no database in the test suite**: no in-memory adapter, no fake Drizzle, no test container, and no `mock.module` of `getDb`. Tests cover the database layer in two ways:

- **Pure decision functions** extracted from DB code and tested directly.
- **Source assertions**: tests `readFileSync` the schema, migration SQL or service source and assert on text (e.g. that a migration adds a column, that a function calls `affectedRows(`).

| Test file | Covers |
|---|---|
| `test/cms/seed-mode.test.ts` | `seedAction`, `parseSeedMode` (exact `--force` token), `formatSeedSummary`, `tally`. |
| `test/cms/admin-args.test.ts` | `parseAdminArgs` for `db:seed-admin`. |
| `test/cms/cookie-seed.test.ts` | `DEFAULT_COOKIE_CATEGORIES` and `pendingCategories`. |
| `test/cms/scripts-manager.test.tsx` | Uses `DEFAULT_ROLES` (permission expectations). |
| `test/core/slug-change-redirect.test.ts` | `planSlugChangeRedirect`; reads `_journal.json` and every listed `.sql` to assert `seo_redirects.reason` and its backfill exist. A handy template for "a migration adds X" tests. |
| `test/core/cms-update.test.ts` | "No migration touches `site_settings`" scan over all `.sql` files; update installer runs `db:migrate`. |
| `test/tools/core-sync-plan.test.ts` | Migrations are classified as core files for site sync. |
| `test/booking/accept-and-emails.test.ts` | Source assertion that the booking path checks `affectedRows(`. |

Not covered by any test: `composeDbUrl`, `load-env`, `mysqlAdapter`, `likeTerm`, `documentVersionNumber` / `expectedVersion` conflict handling, and the CLIs themselves.

Run a single file:

```bash
npx tsx --tsconfig ./tsconfig.test.json --test test/cms/seed-mode.test.ts
npx tsx --tsconfig ./tsconfig.test.json --test test/core/slug-change-redirect.test.ts test/core/cms-update.test.ts
```

`tsconfig.test.json` maps `server-only` to `test/setup/server-only.ts` (empty), so modules that import it can be loaded; importing anything that calls `getDb()` at module load would still need a database, which is why DB code keeps its logic in separate pure functions.

---

## 10. Gotchas and invariants

- **Always `127.0.0.1`, never `localhost`**, in `DB_HOST` on servers where the DB user is granted as `user@'%'`: `localhost` goes over the socket and authenticates as a different MariaDB account. This is the reason `migrate.ts` exists instead of `drizzle-kit migrate`.
- **Journal timestamps must increase.** The migrator applies only entries newer than the last applied `created_at`; an older-stamped migration from a merged branch is skipped with no error.
- **Applied migrations are immutable.** The hash is stored but never checked.
- **A failed migration is partially applied.** MariaDB DDL auto-commits; fix forward by hand, then let the runner record it (or insert the `__drizzle_migrations` row manually after completing the statements).
- **`db:push` bypasses the journal.** Using it on a database that is also migrated leaves `__drizzle_migrations` out of step with the schema.
- **`(type, slug, locale)` is unique** and `canonical_path` is globally unique across all types. Two collections that resolve to the same path cannot both store it.
- **`og_image_uuid` has no FK** to `media_files` by design; deleting media does not null it.
- **Versions are per save.** Every `updateDocument` call writes a `document_versions` row, including status-only changes and seeder runs under `--force`; the table grows without pruning.
- **Updates serialise on the document row.** `updateDocument` locks the row with `.for('update')` inside its transaction, then compares `expectedVersion` and writes the next version, so concurrent saves queue rather than race. A duplicate key on `uniq_document_versions_doc_version` (should be unreachable) is still mapped to the same `conflict` error as a stale `expectedVersion` (`isVersionConflictError`).
- **`seed-content` matches by `(type, slug, locale)`.** Present documents are skipped; a new one keeps its snapshot id when free and gets a fresh id when another row holds it, and relation links are remapped through the id map. Each inserted document gets version 1. It imports only server-only-free modules (`documents/snapshot.ts`), because it runs under plain tsx. With no `src/cms/db/seeds/data/content.json` it prints how to generate one and exits 1.
- **`seedRoles` overwrites** the `superadmin` and `editor` permission lists on every run (including via `db:seed-admin` and `DEPLOY_DB_SEED`). Custom permissions added to those two roles in the admin are reverted; custom roles with other names are untouched.
- **`db:seed-admin` on an existing user** resets the password and re-enables the account, but grants `superadmin` only if the user has no role at all — an existing `editor` is not promoted.
- **Every CLI must `process.exit()`**; the mysql2 pool keeps the event loop alive otherwise.
- **All tables exist on all sites.** Migrations are not module-conditional, and `cms:update` ships every new migration to every client site.
- **Stale docs.** `docs/LOCAL_SETUP.md` says there are fourteen migrations (there are 25, `0000`…`0024`); `docs/STAGING-SETUP.md` refers to `db:seed-articles`, `db:seed-answers`, `db:seed-scenarios`, which are not npm scripts in this repo; the `schema/commerce.ts` header still calls the order tables dormant.
