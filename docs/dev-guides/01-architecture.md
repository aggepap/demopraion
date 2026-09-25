# 01 · Architecture, setup & conventions

Scope: how the repository is laid out, which code is the reusable CMS "core" and which is site code, how an API request travels through the route factory, how modules are declared and switched on, how the CMS is versioned and shipped to client sites, how to run it locally, and how tests are organised. Area-specific behaviour (content model, admin screens, auth, media/SEO, forms, commerce, booking, settings/cron) is only sketched here and belongs to the sibling guides.

Related guides: [02-database.md](02-database.md) · [03-content-model.md](03-content-model.md) · [04-admin-ui.md](04-admin-ui.md) · [05-auth-users-security.md](05-auth-users-security.md) · [06-media-seo-structured-data.md](06-media-seo-structured-data.md) · [07-forms-email-marketing.md](07-forms-email-marketing.md) · [08-commerce.md](08-commerce.md) · [09-booking.md](09-booking.md) · [10-settings-cron-operations.md](10-settings-cron-operations.md)

---

## 1. The big picture

One Next.js 16 App Router application (React 19, `next-intl`, Drizzle ORM over MariaDB/MySQL via `mysql2`) contains both a public website and its CMS. There is no separate backend process, apart from the optional WebSocket relay for edit locks.

```
                         ┌──────────────────────────── src/proxy.ts ───────────────────────────┐
 browser ── request ──▶  │ /admin/**  → stamp x-admin-path header, pass through                 │
                         │ /api/**    → not matched (goes straight to route handlers)           │
                         │ other      → DB redirect lookup (seo_redirects) → next-intl routing  │
                         └──────────────────────────────────────────────────────────────────────┘
        │                         │                                     │
        ▼                         ▼                                     ▼
 src/app/[locale]/**      src/app/admin/**                      src/app/api/cms/**
 public site (SITE)       admin screens (CORE)                  JSON API (CORE)
        │                         │                                     │
        │  src/lib/** (site read  │  @/cms/admin (client components)    │  thin route files:
        │  layer, presenters)     │  @/cms/modules/auth (page guards)   │  factory(config) → GET/POST…
        ▼                         ▼                                     ▼
                     src/cms/**  (CORE: config DSL, core services, modules, db)
                                          │
                                          ▼
                          Drizzle → MariaDB (src/cms/db/adapters/mysql)
```

The dividing line that governs everything else: **`src/cms/**`, `src/app/api/cms/**` and `src/app/admin/**` are the core**. They are identical in every site built from this base and are replaced wholesale when a site's CMS is updated (`src/cms/update/plan.mjs`, `CORE`). Everything else is site code, owned by the site.

This repository is the **CMS base**: the core plus a deliberately plain placeholder front end (brand "Site", `el` + `en`, pages only, commerce/booking/newsletter present but off). See `START_HERE.md`.

---

## 2. File map

### Top level

| Path | Responsibility |
|---|---|
| `src/site.config.ts` | The site's CMS configuration (`defineConfig`): locales, module default flags, collections, field resolvers. Site-owned "glue". |
| `src/site.brand.ts` | Brand code defaults (name, URL, contacts). Only a fallback; the live brand is in `site_settings` (Admin → Settings → Branding). |
| `src/proxy.ts` | Next 16 "proxy" (formerly middleware): admin path stamping, admin-managed redirects, next-intl routing. |
| `next.config.ts` | Security headers/CSP (separate admin CSP for reCAPTCHA), `ADMIN_PATH` header scoping, `distDir` override, MDX, `/home` redirect. |
| `drizzle.config.ts` | drizzle-kit config: schema `src/cms/db/adapters/mysql/schema/index.ts`, output `src/cms/db/adapters/mysql/migrations`. |
| `eslint.config.mjs` | Includes the core/site boundary rule (`no-restricted-imports` on `src/cms/**`). |
| `tsconfig.json`, `tsconfig.test.json`, `tsconfig.seed.json` | App, test runner (maps `server-only` to a stub), seed CLIs. |
| `START_HERE.md` | Orientation for this base repo (base-only, stripped from sites). |
| `.claude/skills/new-site/`, `.claude/skills/site-add-module/` | Site scaffolder and "add a module to a generated site" skill. |
| `scripts/` | `dev-all.mjs` (app + lock relay), `dev-qa.mjs` (QA instance), `cms-release.mjs` (build update zip), `generate-templates.ts`, `check-admin.ts`. |
| `messages/{el,en}.json` | next-intl messages for the public site. |
| `qa/`, `seo-audit-tool/` | Base-only tooling (Playwright QA studio, SEO audit engine). Not shipped to sites. |

### `src/cms` (core)

| Path | Responsibility |
|---|---|
| `src/cms/index.ts` | Declared public surface of the core (config API, route factory, errors, rate limit, email, audit, db). |
| `src/cms/version.json` | The core's version (`{"version": "1.0.0"}` at the time of writing). Travels with the core. |
| `src/cms/config/` | Config DSL: `defineConfig` (`config.ts`), `defineCollection`/`resolveCollection` (`collection.ts`), field builders `f.*` (`fields.ts`), `taxonomyCollection` (`taxonomy.ts`), `buildDataSchema` zod generator (`zod.ts`), PM page types (`pm-types.ts`). |
| `src/cms/core/api/` | Route factory `createRoute` (`handler.ts`), response helpers `ok/created/noContent/paginated` (`respond.ts`), `idParam`/`uuidParam` (`params.ts`), `isSameOrigin` (`same-origin.ts`). |
| `src/cms/core/errors.ts` | `ApiError`, error codes → HTTP status, `isDuplicateKeyError`, `isForeignKeyError`. |
| `src/cms/core/rate-limit.ts` | In-memory per-scope/per-IP limiter, `getClientIp`, `clientIpLabel`. |
| `src/cms/core/audit.ts` | `logAudit`, `extractRequestMeta`, audit listing, per-account auth-failure counting. |
| `src/cms/core/routes/` | Ready-made route factories for core features (collections, auth, MFA, settings, users, roles, SEO, media, cookies, scripts, api-tokens, audit, import, forms). Barrel: `routes/index.ts`. |
| `src/cms/core/{documents,read,content,fields,media,seo,structured-data,settings,brand,cookies,email,forms,locks,payments,cron,roles,users,tokens,secrets,security,scripts,shortcodes,stats,import,db}/` | Core services, one folder per concern. `read/` is the cached public read API; `settings/` the KV settings + module flags. |
| `src/cms/core/paths.ts` | `siteOrigin`, `getAdminPath`, `localePrefix`, `isProductionHost`. |
| `src/cms/core/cache.ts` | `CMS_CACHE_REVALIDATE = false` (tag-invalidated caches only). |
| `src/cms/modules/<name>/` | Optional feature modules: `auth`, `booking`, `commerce`, `customers`, `newsletter`, `pm`, `popups`, `reviews-external`. Each has an `index.ts` barrel. |
| `src/cms/admin/` | Admin React components (client + server-safe helpers); barrel `index.ts`. |
| `src/cms/db/` | `getDb`, `adapter`, `schema` (`index.ts`), MySQL adapter/client/schema/migrations (`adapters/mysql/`), `migrate.ts`, seed CLIs (`seeds/cli/`). |
| `src/cms/realtime/lock-server.mjs` | Standalone WebSocket relay for edit locks. |
| `src/cms/update/*.mjs` | Update package format and installer (`cli`, `install`, `manifest`, `plan`, `version`, `zip`). |

### App routes

| Path | Owner | Responsibility |
|---|---|---|
| `src/app/admin/layout.tsx`, `src/app/admin/(shell)/**` | core | Authenticated admin shell and screens (`[collection]`, `orders`, `settings`, `users`, …). |
| `src/app/admin/login`, `src/app/admin/403`, `src/app/admin/actions/mdx-preview.ts` | core | Login, forbidden page, MDX preview server action. |
| `src/app/api/cms/**` | core | ~130 `route.ts` files; each is a thin binding of a factory to `site.config`. |
| `src/app/api/{contact,newsletter,cookies/consent}` | site | Public, non-`/cms` endpoints. `contact` and `cookies/consent` call the core limiter (`checkRateLimit` + `getClientIp` from `src/cms/core/rate-limit.ts`) directly. |
| `src/app/[locale]/**` | site | Public pages (home, `[slug]`, `shop`, `booking`, `cart`, `checkout`, `account`, `wishlist`, `legal`, `[...rest]`). Some are "scaffold" (see §8.7). |
| `src/app/{sitemap.ts,robots.ts,feeds/}` | site | Sitemap, robots, product feeds. |

### `src/lib` (site read layer and helpers)

| Path | Responsibility |
|---|---|
| `src/lib/cms/resolve-doc.ts` | `resolveRenderDoc(type, slug, locale)`: published doc, or latest draft under Draft Mode. |
| `src/lib/cms/collection-route.ts`, `mdx-preview*.ts(x)` | Glue the core admin imports (see §8.7). |
| `src/lib/site/{content,content-query,authors,newsletter-placement}.ts` | Presenters mapping content documents to render shapes. |
| `src/lib/i18n/{config,routing,request,locale-settings,page-not-found}.ts` | Locales (must match `site.config.ts`), next-intl routing (`localePrefix: 'as-needed'`, `localeDetection: false`). |
| `src/lib/seo/`, `src/lib/brand.ts`, `src/lib/nav.ts`, `src/lib/storage-keys.ts` | Metadata/JSON-LD helpers, brand read, nav items, browser storage prefix. |
| `src/lib/admin-bar.ts`, `src/components/admin-bar/` | Front-end admin bar (work in progress at time of writing: untracked in git). |

---

## 3. Data model (architecture-relevant tables)

The full schema is in [02-database.md](02-database.md). Two tables are part of the cross-cutting machinery described here.

`audit_logs` (`src/cms/db/adapters/mysql/schema/audit.ts`), written by `logAudit`:

| Column | Type | Notes |
|---|---|---|
| `id` | int PK autoincrement | |
| `user_id` | int, FK `admin_users.id` ON DELETE SET NULL | null for non-person actors |
| `actor_label` | varchar(191) | e.g. `api-token:Product Manager` |
| `action` | varchar(64) not null | dotted verb, e.g. `role.create`, `auth.login.fail` |
| `subject_type`, `subject_id` | varchar(64) | `subjectId` is stringified |
| `before`, `after` | json | |
| `ip` | varchar(64) | from `clientIpLabel` via `extractRequestMeta` |
| `ua` | varchar(255) | truncated to 255 |
| `created_at` | timestamp default now | |

Indexes: `idx_audit_subject (subject_type, subject_id)`, `idx_audit_user (user_id)`, `idx_audit_created (created_at)`. `recentAuthFailures()` relies on the subject index (`subject_type='email'`).

`site_settings` (`schema/settings.ts`): `key varchar(128) PK`, `value json`, `updated_by` FK `admin_users`, `updated_at`. Module overrides are stored here under `module.<name>` (`moduleSettingKey`, `MODULE_PREFIX` in `src/cms/core/settings/schema.ts`).

The schema barrel is `src/cms/db/adapters/mysql/schema/index.ts`; `src/cms/db/index.ts` is the single dialect branch point (currently MySQL unconditionally). Migrations are SQL files `0000_init.sql` … `0024_*.sql` in `src/cms/db/adapters/mysql/migrations/`.

---

## 4. How it works

### 4.1 Core vs site: dependency direction

- Site code depends on the core; **the core never imports site code**. `eslint.config.mjs` enforces this for `src/cms/**/*.{ts,tsx}`: imports of `@/components`, `@/content`, `@/app`, `@/lib`, `@/types`, `@/admin` (and sub-paths) are errors.
- The core receives site data as arguments instead. Example: `collectionListRoute(config)` in `src/cms/core/routes/collections.ts`; the route file `src/app/api/cms/[collection]/route.ts` imports `@/site.config` and passes it in.
- The rule does not cover `src/app/admin/**` or `src/app/api/cms/**` (they are core by ownership but live under `src/app`). They import a small, named set of site files, which is exactly the "glue" contract in `src/cms/update/plan.mjs`:
  `@/site.config`, `@/lib/cms/collection-route`, `@/lib/cms/mdx-preview`, `@/lib/i18n/locale-settings`, `@/components/shop/showcase-data`.

### 4.2 Import paths from site code

`src/cms/index.ts` states that site code should import only from `@/cms`, `@/cms/config` and `@/cms/core`. In practice, site and glue code also imports deep paths, and nothing enforces the restriction:

| Import path | Used for | Example |
|---|---|---|
| `@/cms` | `DocumentRow` type, `createRoute`, errors, `getDb`, `schema` | `src/lib/cms/resolve-doc.ts` |
| `@/cms/config` | `defineConfig`, `defineCollection`, `f`, `taxonomyCollection` | `src/site.config.ts` |
| `@/cms/core` | Read API (`getPublishedDocument`, …), `isModuleEnabled`, `resolveModuleFlags`, paths, payments seam | `src/app/api/cms/orders/route.ts` |
| `@/cms/core/<area>` | Specific services not in the barrel: `seo/document`, `structured-data`, `paths`, `locks`, `brand` | `src/app/[locale]/[slug]/page.tsx` |
| `@/cms/core/routes` | Core route factories | `src/app/api/cms/roles/route.ts` |
| `@/cms/modules/<name>` | Module collections, route factories, reads | `src/site.config.ts`, `src/app/api/cms/newsletter/route.ts` |
| `@/cms/admin` | Admin components | `src/app/admin/(shell)/layout.tsx` |

Guidance: prefer the barrels (`@/cms`, `@/cms/config`, `@/cms/core`, `@/cms/modules/<name>`); reach into a deeper path only when the symbol is not re-exported, and never import a file inside `src/cms` from another core file via `@/lib`.

### 4.3 Configuration: `defineConfig`

`src/site.config.ts` calls `defineConfig` (`src/cms/config/config.ts`) at module load. It validates and normalises:

- `locales` non-empty and containing `defaultLocale`;
- at least one collection; collection keys match `/^[a-z][a-z0-9_]*$/` and are unique;
- field keys (`/^[a-z][a-zA-Z0-9_]*$/`), relation targets, PM field maps, etc.;
- defaults: `modules` merged over `DEFAULT_MODULES` (`forms`, `seo`, `media` on; `commerce`, `booking`, `newsletter`, `customers`, `googleReviews`, `popups`, `pm` off), `storagePrefix` default `site`, `productionOrigin` normalised or null, `brand.name` defaulted from `name`.

The result (`CmsConfig`) adds `collectionByKey` and `collectionKeyByAlias` maps (so `/admin/pages` can redirect to `/admin/page`). A misconfiguration throws `ConfigError` ("cms.config: …") on import, failing the build/dev server immediately.

Collections are built with `defineCollection` (identity function, typed) or helpers: `taxonomyCollection` (`src/cms/config/taxonomy.ts`), `brandCollection()` / `testimonialCollection()` (`src/cms/core/content/`), and module helpers (`productCollection()`, `bookingCollection()`, `popupCollection()`, …). A collection's `data` JSON is validated by the zod schema built from its fields by `buildDataSchema` (`src/cms/config/zod.ts`). Details: [03-content-model.md](03-content-model.md).

### 4.4 Module flags: compile-time default + runtime override

```
site.config.ts  modules: { commerce: false, … }   ← code default (DEFAULT_MODULES fills gaps)
site_settings   key 'module.commerce' = true       ← Admin → Settings → Modules
                     │
resolveModuleFlags(config)  (src/cms/core/settings/modules.ts)
  = stored boolean if present, else config default     (cached + tag-revalidated like all settings)
isModuleEnabled(config, name) → boolean
```

Where the flag is enforced:

| Surface | Mechanism |
|---|---|
| Admin sidebar collections | `visibleAdminCollections()` (`src/cms/admin/shared.ts`) hides collections whose `module` flag is not `true`. Collections declare `module: 'commerce' | 'booking' | 'popups' | 'googleReviews'`. |
| Admin sidebar tools | Hand-written conditions in `src/app/admin/(shell)/layout.tsx` (`moduleFlags.commerce && can(PERMISSIONS.ordersRead)`, …). |
| Admin pages | Page calls `isModuleEnabled(config, '<m>')` then `notFound()`, e.g. `src/app/admin/(shell)/orders/page.tsx`. |
| Module API routes | Route file wraps the factory: `if (!(await isModuleEnabled(config, 'commerce'))) return 404` (`src/app/api/cms/orders/route.ts`, `newsletter/route.ts`, webhooks, …). |
| Cron jobs | `cronRoute({ jobs: { 'x': { module: 'commerce', run } }, moduleFlags })` answers 404 for a disabled module's job (`src/app/api/cms/cron/[job]/route.ts`). |
| Rich-text "+ Block" | `ModuleFlagsProvider` / `useModuleFlags()` (`src/cms/admin/module-flags.tsx`). |
| Public pages | Site code checks the flag (e.g. `src/app/[locale]/layout.tsx`, `checkout/page.tsx`, `sitemap.ts`). |

Module labels, descriptions and "Off:" notes for the Modules settings tab live in `MODULE_LABELS` (`src/cms/core/settings/schema.ts`).

### 4.5 A module, concretely

There is no plugin registry. A "module" is a folder under `src/cms/modules/<name>/` whose `index.ts` exports some of:

- collection factories (`productCollection`, `bookingCollection`, `popupCollection`) that set `module: '<name>'`, which the site lists in `site.config.ts`;
- route factories built with `createRoute` (`newsletterSubscribeRoute`, `subscribersListRoute`, `ordersListRoute`, …);
- services/read helpers used by site pages and admin screens;
- field resolvers (`bookingFieldResolver`, passed as `fieldResolvers: { booking: … }`).

Registration is by wiring, done in three places that are all core except the config:

1. `src/site.config.ts` lists the module's collections and the default flag (site glue).
2. `src/app/api/cms/<area>/**/route.ts` mounts the route factories behind `isModuleEnabled` (core).
3. `src/app/admin/(shell)/<screen>/page.tsx` plus a sidebar entry in `(shell)/layout.tsx` (core).

`src/cms/modules/auth` is not optional: it provides `PERMISSIONS`, `requireApiPerm`, `requirePerm`, sessions and MFA used by everything ([05-auth-users-security.md](05-auth-users-security.md)).

### 4.6 The route factory: `createRoute`

Every CMS endpoint is a `createRoute(config)` call (`src/cms/core/api/handler.ts`). The returned function is a Next route handler `(req, { params })`.

Pipeline, in order:

```
1. same-origin     writes (non GET/HEAD) with an Origin header must match NEXT_PUBLIC_SITE_URL
                   (config.sameOrigin, default true)                       → 403 forbidden
2. captcha         optional: own rate limit bucket, then verify x-captcha-token → 429 / 400 captcha_failed
3. rateLimit       optional { scope, max, windowMs }, keyed by x-real-ip    → 429 + Retry-After
4. guard           returns auth context or a Response (401/403) that short-circuits
5. params          awaited from ctx.params (NOT validated: use idParam/uuidParam)
6. query           optional zod over URLSearchParams                        → 422 invalid_input
7. input           optional zod over req.json()                             → 400 invalid_json / 422
8. handler         Response → passed through; anything else → NextResponse.json(result ?? {ok:true})
9. errors          ApiError → {ok:false,error,message,issues?}; FK error → 422; dup key → 409;
                   anything else → 500 server_error (logged)
```

Minimal example (from `src/cms/core/routes/roles.ts`):

```ts
export function roleCreateRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.rolesManage),
    input: createBody,                      // zod schema
    handler: async ({ input, auth }) => {
      assertCanGrant(auth.permissions, input.permissions);
      if (await roleNameTaken(input.name)) throw new ApiError('conflict', `A role named "${input.name}" already exists.`);
      const id = await createRole(input);
      await logAudit({ userId: auth.userId, action: 'role.create', subjectType: 'admin_role', subjectId: id,
                       after: { name: input.name, permissions: input.permissions } });
      return created({ id });
    },
  });
}
```

And the route file that mounts it (`src/app/api/cms/roles/route.ts`):

```ts
import { roleCreateRoute, rolesListRoute } from '@/cms/core/routes';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = rolesListRoute();
export const POST = roleCreateRoute();
```

### 4.7 Response and error envelopes

`src/cms/core/api/respond.ts`:

| Helper | Status | Body |
|---|---|---|
| `ok(data, status=200)` | 200 | `{ ok: true, data }` |
| `created(data)` | 201 | `{ ok: true, data }` |
| `noContent()` | 204 | empty |
| `paginated(items, { page, pageSize, total })` | 200 | `{ ok: true, items, page, pageSize, total, pageCount }` (`pageCount >= 1`) |
| plain object returned from handler | 200 | the object as-is (no envelope added) |

Note: returning a plain object does **not** wrap it in `{ok:true,data}`; only `undefined`/`null` becomes `{ ok: true }`. Several handlers return `ok({ ok: true })`, which yields `{ ok: true, data: { ok: true } }`.

Errors (`src/cms/core/errors.ts`), always `{ ok: false, error: <code>, message, issues? }`:

| Code | Status | Helper |
|---|---|---|
| `bad_request` | 400 | `badRequest(msg)` |
| `invalid_json` | 400 | thrown by factory |
| `invalid_input` | 422 | `invalidInput(issues, msg)` (zod `flatten()` output in `issues`) |
| `unauthorized` | 401 | `unauthorized()` |
| `forbidden` | 403 | `forbidden()` |
| `not_found` | 404 | `notFound()` |
| `conflict` | 409 | `conflict()` (default message "Already exists.") |
| `rate_limited` | 429 | factory, with `Retry-After` |
| `captcha_failed` | 400 | factory |
| `mfa_invalid` | 401 | MFA routes |
| `server_error` | 500 | unhandled |

`isDuplicateKeyError` / `isForeignKeyError` walk the `cause` chain up to 5 levels because Drizzle wraps the mysql2 error.

Pagination convention: list queries accept `page` (positive int) and `pageSize` (positive int with a per-route `max`: 100 for collections and forms, 200 for audit), coerced from strings by zod, and respond via `paginated()`. There is no shared pagination schema; each route declares its own `query` object.

### 4.8 Rate limiting

`checkRateLimit(scope, ip, { max, windowMs })` in `src/cms/core/rate-limit.ts` is a fixed-window counter in a per-process `Map<scope, Map<ip, {count, resetAt}>>` with a 60 s cleanup timer.

- Bucket key is `x-real-ip` only (`getClientIp`). `x-forwarded-for` and `cf-connecting-ip` are ignored for bucketing because they are spoofable. Nginx must set `proxy_set_header X-Real-IP $remote_addr;`.
- No `x-real-ip`: in production the request is **refused** (limited); in development all such requests share an `unknown` bucket and a one-time warning is logged.
- `clientIpLabel` is the logging variant: falls back to the first `x-forwarded-for` hop in development only, else `unknown`.
- Per-process: under PM2 cluster mode each worker has its own counters.

### 4.9 Audit logging

`logAudit(entry)` inserts into `audit_logs` and **swallows errors** (logs them) so an audit failure never breaks the user action. Call it after the mutation succeeds, with `userId: auth.userId` (or `actorLabel` for tokens), a dotted `action`, `subjectType`/`subjectId`, and `before`/`after` snapshots where meaningful. `extractRequestMeta(req)` provides `ip`/`ua`. Grouping and labels for the audit screen: `src/cms/core/audit-groups.ts`, `audit-labels.ts`.

### 4.10 Public read path

```
src/app/[locale]/[slug]/page.tsx  (dynamic = 'force-dynamic')
   └─ resolveRenderDoc('page', slug, locale)            src/lib/cms/resolve-doc.ts
        ├─ draftMode on  → getDocumentPreview(...)       src/cms/core/read/documents.ts
        └─ otherwise     → getPublishedDocument(...)     (unstable_cache, tags cms:doc:/cms:type:)
   └─ documentSeo / documentStructuredData / RichText / AdminEditTarget
```

Cache tags (`src/cms/core/read/tags.ts`): `cms:type:<type>`, `cms:doc:<type>:<locale>:<slug>`, `cms:path:<path>`. Write paths call `revalidateDocument` / `revalidateType` (`read/revalidate.ts`). `CMS_CACHE_REVALIDATE = false`: caches never expire on a timer, only by tag (see the comment in `src/cms/core/cache.ts` for the outage that motivated this).

### 4.11 `src/proxy.ts`

- Matcher excludes `api`, `_next`, `_vercel`, anything with a dot, and `admin` from the main pattern (segment-anchored), then re-adds `/admin` and `/admin/:path*` separately.
- `/<ADMIN_PATH>/**` (default `/admin/**`, classified by `resolveAdminRequest` in `src/cms/admin/admin-path.ts` against `getAdminPath()` at request time): copies the requested public path into the `ADMIN_PATH_HEADER` request header (overwriting any client value); the shell layout reads it to build `?next=` for post-login redirect. With the default segment it returns `NextResponse.next`; with a custom one it rewrites onto the `/admin/**` route tree. No redirects, no i18n. A custom segment reaches the proxy through the site matcher; the literal `/admin` entries stay so that, once the admin has moved, `/admin/**` still reaches the proxy and gets a plain 404 there (`kind: 'hidden'`) — never the pages, and never the redirect resolver or i18n.
- Everything else: `resolveRedirect(pathname)` against admin-managed redirects (fail-open), `bumpRedirectHit` fire-and-forget, else `next-intl` middleware.

### 4.12 Realtime edit locks (brief)

`src/cms/realtime/lock-server.mjs` is a separate Node process (`npm run locks`, or started by `npm run dev:all`) because a Next route handler cannot upgrade to WebSocket. It holds rooms and heartbeats only; every frame is forwarded to the app (`/api/cms/locks`, `/locks/release`, `/locks/heartbeat`) with the socket's cookie and the `x-cms-lock-secret` header, and the app decides. It refuses to start without `CMS_LOCK_INTERNAL_SECRET` (>= 32 chars) and an allowed origin. Locks are optional: `locksEnabled()` (`src/cms/core/locks/config.ts`) is false without the secret and the admin still saves (server-side `assertNotLockedByOther` still runs in collection updates). Details in [03-content-model.md](03-content-model.md).

---

## 5. HTTP API (overview)

All CMS endpoints live under `/api/cms`. Every route file sets `runtime = 'nodejs'` and `dynamic = 'force-dynamic'`. Static segments (e.g. `/api/cms/orders`) take precedence over the `[collection]` catch-all, so a new static folder must not collide with a collection key. The table lists groups and the guide that details them.

| Path prefix | Methods | Auth | Purpose | Guide |
|---|---|---|---|---|
| `/api/cms/[collection]`, `/[id]`, `/[id]/versions`, `/[id]/versions/[versionId]/restore`, `/import` | GET, POST, PATCH, DELETE | `cms.content.read` / `write` / `publish` | Generic document CRUD, versions, markdown import | 03 |
| `/api/cms/auth/{login,logout,me}`, `/auth/2fa/**` | GET, POST | public (login, captcha + rate limit) / session | Admin sessions and MFA | 05 |
| `/api/cms/users`, `/roles`, `/api-tokens`, `/audit` | GET, POST, PATCH, DELETE | `usersManage`, `rolesManage`, `tokensManage`, `auditRead` | Users, roles, tokens, audit log | 05 |
| `/api/cms/settings` | GET, PATCH | `settingsRead` / `settingsWrite` | Managed settings incl. module toggles | 10 |
| `/api/cms/cron/[job]` | POST | `x-cron-secret` = `CMS_CRON_SECRET` | Scheduled jobs | 10 |
| `/api/cms/locks`, `/locks/release`, `/locks/heartbeat` | POST | session / relay secret | Edit locks | 03 |
| `/api/cms/preview`, `/preview/disable` | GET | session | Draft Mode on/off | 03 |
| `/api/cms/media/**` | GET, POST, PATCH, DELETE | `mediaRead` / `mediaWrite`; `file/[uuid]` public | Media library and file serving | 06 |
| `/api/cms/seo/{redirects,notfound,meta}/**`, `/cookies/**`, `/scripts/**` | GET, POST, PATCH, DELETE | `seoRead`/`seoWrite`, `settings*`, `scriptsManage` | SEO tools, cookie catalogue, scripts | 06 / 07 |
| `/api/cms/forms/**`, `/newsletter/**`, `/popups/track` | GET, PATCH, DELETE, POST | `formsRead`/`formsWrite`, `newsletterRead` | Submissions, subscribers, popup stats | 07 |
| `/api/cms/commerce/**`, `/orders/**`, `/customers/**`, `/customer/**`, `/gift-cards/**`, `/reviews/**`, `/abandoned-carts/**`, `/shipping/**`, `/wishlist/**`, `/payments/webhooks/*` | mixed | public (rate limited) / customer session / commerce perms; module-gated | Shop | 08 |
| `/api/cms/booking/**`, `/bookings/validate-pricing`, `/reservations/**` | mixed | public / booking perms; module-gated | Booking | 09 |
| `/api/cms/reviews-external/**`, `/integrations/google/oauth/*` | mixed | settings perms; `googleReviews`-gated | Google reviews | 06 / 10 |
| `/api/cms/pm/v1/**` | GET, PATCH | API token; `pm`-gated | Product Manager bridge | 10 |
| `/api/contact`, `/api/newsletter`, `/api/cookies/consent` | POST (GET for consent) | public | Site endpoints outside `/cms` | 07 |

Health check used in `docs/LOCAL_SETUP.md`: `GET /api/cms/auth/me` answers 401 when the app and auth stack are up.

---

## 6. Admin UI (structure only)

| Path | Role |
|---|---|
| `src/app/admin/layout.tsx` | Outer admin layout. |
| `src/app/admin/(shell)/layout.tsx` | Requires `PERMISSIONS.access`; resolves module flags and brand; builds sidebar collections (`visibleAdminCollections`) and tools (permission + module gated); provides `ModuleFlagsProvider`, `EditLockProvider`, `IdleLogout`. |
| `src/app/admin/(shell)/[collection]/{page,new/page,[id]/page}.tsx` | Generic list/create/edit for any collection (uses `src/lib/cms/collection-route.ts` for alias redirects). |
| `src/app/admin/(shell)/<tool>/page.tsx` | One folder per tool (orders, reservations, settings, users, roles, seo, media, audit, …). Pattern: `isModuleEnabled` → `requirePerm` → load data → render a component from `@/cms/admin`. |
| `src/cms/admin/*.tsx` | The components (`DocumentForm`, `DocumentList`, `SettingsForm`, `OrdersTable`, `Sidebar`, `TopBar`, …), `ui/`, `fields/`, `locks/`, `api-client.ts`. |

Screens and components are covered in [04-admin-ui.md](04-admin-ui.md).

---

## 7. Configuration

### 7.1 Environment (`.env.example`)

| Variable | Required | Used by |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | yes | `isSameOrigin`, `siteOrigin()`, lock relay allowed origin. Must match the served origin/port. Unset in production → all cross-origin-checked writes refused. |
| `DATABASE_URL` or `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/`DB_NAME` | yes | `src/cms/db/adapters/mysql/{client,url,load-env}.ts`, `drizzle.config.ts` |
| `ADMIN_SESSION_SECRET` (>= 32 chars), `ADMIN_SESSION_TTL_HOURS`, `ADMIN_SESSION_IDLE_MINUTES` | secret yes | auth module |
| `CMS_TOKEN_ENCRYPTION_KEY` | yes | encrypted tokens/integration secrets |
| `ADMIN_PATH` | no (default `admin`) | Public admin segment: `getAdminPath()`, the proxy rewrite onto `src/app/admin`, every admin link (`adminHref`), `next.config.ts` admin header scoping. Plain slug only. See gotcha §10. |
| `RECAPTCHA_SITE_KEY`, `RECAPTCHA_SECRET_KEY` | no | login captcha (no-op unless both set; example ships Google test keys) |
| `ADMIN_MFA_BYPASS_CODE` | dev only | MFA bypass |
| `AZURE_*`, `GRAPH_SENDER_ADDRESS`, `CONTACT_RECIPIENT_EMAIL` | no | Microsoft Graph email |
| `STRIPE_*`, `PAYPAL_*`, `VIVA_*` | no | payments |
| `GOOGLE_OAUTH_CLIENT_ID/SECRET` | no | Google reviews |
| `CMS_GIFTCARD_PEPPER`, `BOXNOW_API_URL` | commerce | gift cards, couriers |
| `CMS_CRON_SECRET`, `BOOKING_CRON_SECRET`, `COMMERCE_CRON_SECRET`, `COMMERCE_ABANDONED_*` | no | cron endpoints |
| `CMS_UPLOAD_DIR` | no (default `.data/uploads`) | media storage |
| `CMS_LOCK_*`, `CMS_APP_ORIGIN`, `NEXT_PUBLIC_CMS_LOCK_WS_URL` | no | lock relay |
| `NEXT_DIST_DIR` | no | `next.config.ts` build dir (QA instance uses `.next-qa`) |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | no | analytics (also settable in admin) |

### 7.2 Config options (`CmsConfigInput`)

`name`, `locales`, `defaultLocale`, `modules`, `collections`, `fieldResolvers`, `pm`, `storagePrefix`, `productionOrigin`, `brand`. See §4.3. `src/lib/i18n/config.ts` must list the same locales (checked by `test/site/config.test.ts`).

### 7.3 Module flags

`ModuleFlags` keys: `commerce`, `booking`, `forms`, `seo`, `newsletter`, `customers`, `googleReviews`, `popups`, `media`, `pm`. Runtime override key: `module.<name>` in `site_settings`.

### 7.4 npm scripts (`package.json`)

| Script | Does |
|---|---|
| `dev` | `next dev -p 3002` |
| `dev:all` | `scripts/dev-all.mjs`: Next dev + lock relay as direct children; relay only if `CMS_LOCK_INTERNAL_SECRET` >= 32 chars; relay death does not stop the app, app death stops everything |
| `dev:qa` | `scripts/dev-qa.mjs`: second instance on :3003 from `qa/.env.qa`, own `.next-qa`, refuses DB names without `qa` (base-only) |
| `build`, `start`, `lint`, `type-check`, `format`, `format:check` | as named |
| `test` | `tsx --tsconfig ./tsconfig.test.json --test` over the test globs (§9) |
| `db:migrate` | `tsx src/cms/db/migrate.ts` (use this, not `drizzle-kit migrate`) |
| `db:generate`, `db:push`, `db:studio` | drizzle-kit |
| `db:seed-roles`, `db:seed-admin`, `db:seed-cookies`, `db:reset-mfa`, `db:brand-import`, `db:snapshot-content`, `db:seed-content`, `db:backfill-translation-groups`, `db:migrate-booking-*` | CLIs in `src/cms/db/seeds/cli/` |
| `db:seed-site` | `src/site-seed/cli.ts` (site-owned seed data in `src/site-seed/data.ts`) |
| `locks` | run `lock-server.mjs` with `--env-file-if-exists` |
| `cms:update` | `node src/cms/update/cli.mjs <zip> [--apply]` |
| `cms:release` | `scripts/cms-release.mjs` (base-only) |
| `docs:templates` | `scripts/generate-templates.ts` |

### 7.5 Local setup (summary; full text `docs/LOCAL_SETUP.md`)

```bash
nvm use                       # .nvmrc = 20.18.0; engines: node >=20.9 <25, npm >=10 <12
npm ci
# CREATE DATABASE site_cms CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
cp .env.example .env.local    # fill DB_*, ADMIN_SESSION_SECRET, CMS_TOKEN_ENCRYPTION_KEY, NEXT_PUBLIC_SITE_URL
npm run db:migrate
npm run db:seed-admin -- you@example.com 'Str0ng-Passw0rd!' 'Your Name'   # seeds roles too
npm run db:seed-site          # settings + placeholder pages as drafts (--publish-samples to publish)
npm run dev                   # http://localhost:3002, admin at /admin
```

`docs/LOCAL_SETUP.md` is partly stale: it says `.env.example` ships port 3000 (it now ships `http://localhost:3002`) and says fourteen migrations (there are 25, `0000`–`0024`).

---

## 8. Extending

### 8.1 Where do I put new code?

| You are adding… | Put it in | Notes |
|---|---|---|
| Reusable business logic used by any site | `src/cms/core/<area>/` | No `@/lib`/`@/components` imports. Keep pure logic separate from I/O so it is unit-testable without a DB. |
| Logic for an optional feature | `src/cms/modules/<name>/` | Export from the module `index.ts`. |
| A CMS API endpoint | Factory in `src/cms/core/routes/<x>.ts` or `src/cms/modules/<m>/routes.ts`; mount in `src/app/api/cms/<path>/route.ts` | §8.2 |
| A DB table/column | `src/cms/db/adapters/mysql/schema/<area>.ts` + `npm run db:generate` | [02-database.md](02-database.md). Migrations must not touch `site_settings` (pinned by a test). |
| An admin screen | `src/app/admin/(shell)/<tool>/page.tsx` + component in `src/cms/admin/` + sidebar entry in `(shell)/layout.tsx` | [04-admin-ui.md](04-admin-ui.md) |
| A setting | `MANAGED_SETTINGS` in `src/cms/core/settings/schema.ts` | [10-settings-cron-operations.md](10-settings-cron-operations.md) |
| A cron job | `jobs` map in `src/app/api/cms/cron/[job]/route.ts` | Set `module:` if module-owned. |
| A collection used by every site | Factory in `src/cms/core/content/` or the module; site adds it to `site.config.ts` | |
| A collection for one site | `src/site.config.ts` in that site | |
| A public page or component | `src/app/[locale]/**`, `src/components/**` | Site code. |
| A site read helper/presenter | `src/lib/site/`, `src/lib/cms/` | Note `src/lib/cms/**` is glue: never auto-synced. |
| A change needed by the core but in a site file | Change the base's glue file and document it; sites port it by hand | `core-sync.mjs` reports glue diffs |
| A fix discovered in a generated site's `src/cms/**` | Fix on the base, release, update the site | Never patch the site's core. |

### 8.2 How to add a core API endpoint

1. Write the factory next to its siblings, e.g. `src/cms/core/routes/widgets.ts`:

   ```ts
   import 'server-only';
   import { z } from 'zod';
   import { PERMISSIONS, requireApiPerm } from '../../modules/auth';
   import { logAudit } from '../audit';
   import { createRoute } from '../api/handler';
   import { idParam } from '../api/params';
   import { ok } from '../api/respond';

   const body = z.object({ name: z.string().trim().min(1).max(64) });

   /** PATCH /api/cms/widgets/:id */
   export function widgetUpdateRoute() {
     return createRoute({
       guard: () => requireApiPerm(PERMISSIONS.settingsWrite),
       input: body,
       handler: async ({ params, input, auth }) => {
         const id = idParam(params.id);           // params are not validated by the factory
         await updateWidget(id, input);
         await logAudit({ userId: auth.userId, action: 'widget.update', subjectType: 'widget', subjectId: id, after: input });
         return ok({ id });
       },
     });
   }
   ```

2. Re-export it from `src/cms/core/routes/index.ts`.
3. Mount it: `src/app/api/cms/widgets/[id]/route.ts` with `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `export const PATCH = widgetUpdateRoute();`. If it needs site data, take it as a factory argument (`widgetRoute(config)`), never import `@/site.config` inside `src/cms`.
4. Choose the path so it cannot shadow a collection key (static segments beat `[collection]`).
5. Public endpoint? Add `rateLimit: { scope: 'widget-x', max, windowMs }`; consider `captcha`. Leave `sameOrigin` at its default unless it is a server-to-server webhook.
6. Add a permission if none fits ([05-auth-users-security.md](05-auth-users-security.md)).
7. Test pure parts under `test/core/` or `test/cms/`.

### 8.3 How to add a module-owned endpoint

Same as 8.2, but the factory lives in `src/cms/modules/<m>/routes.ts`, is exported from the module's `index.ts`, and the route file gates it:

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { isModuleEnabled } from '@/cms/core';
import { subscribersListRoute } from '@/cms/modules/newsletter';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const list = subscribersListRoute();

export async function GET(req: NextRequest) {
  if (!(await isModuleEnabled(config, 'newsletter')))
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  return list(req);
}
```

### 8.4 How to add a new module flag

1. `src/cms/config/config.ts`: add the key to `ModuleFlags` and to `DEFAULT_MODULES` (default `false` for anything with external side effects). `scripts/cms-release.mjs` parses `DEFAULT_MODULES` with a regex to report new flags to sites, so keep the `key: value,` one-per-line shape.
2. `src/cms/core/settings/schema.ts`: add a `MODULE_LABELS` entry (label, description, `offNote`).
3. Create `src/cms/modules/<name>/index.ts`; set `module: '<name>'` on its collections.
4. Gate every surface listed in §4.4 (route files, admin pages, sidebar tools, cron jobs, public pages).
5. In the base `src/site.config.ts`, add the flag explicitly under `modules` (sites get it via the core-sync/update report, since `site.config.ts` is glue).
6. If `new-site` should offer it, update `.claude/skills/new-site/` (interview, `generate.mjs`, fixtures) and `site-add-module`, then run `check-base.mjs`.

### 8.5 How to add a collection

See [03-content-model.md](03-content-model.md). In short: `defineCollection({ key, label, fields: [f.text(...), ...], routing: { pathTemplate } })` and add it to `collections` in `site.config.ts`; the admin, API validation and reads follow automatically. A public route under `src/app/[locale]/` is still needed to render it.

### 8.6 How to ship a core change to sites

```bash
# base (branch CMS, clean tree)
npm run lint && npm run type-check && npm test
node .claude/skills/new-site/scripts/check-base.mjs
.claude/skills/new-site/scripts/verify-scaffold.sh          # if templates/skill/templated base files changed
npm run cms:release -- --bump patch|minor|major            # → releases/cms-update-<v>.zip, tag cms-v<v>

# site (clean tree)
npm run cms:update -- ../cms-update-<v>.zip                # dry run
npm run cms:update -- ../cms-update-<v>.zip --apply        # writes core, npm install if needed, db:migrate
npm run lint && npm run type-check && npm test && npm run build
```

Alternative from a base checkout: `node .claude/skills/new-site/scripts/core-sync.mjs --target ../site [--apply]`. Both use the same classifier.

### 8.7 The update classifier (`src/cms/update/plan.mjs`)

| Class | Globs | What an update does |
|---|---|---|
| `base-only` | `START_HERE.md`, `.claude/**`, `qa/**`, `test/studio/**`, `test/tools/**`, `seo-audit-tool/**`, `scripts/dev-qa.mjs`, `scripts/cms-release.mjs`, `docs/**`, `releases/**`, `.cms-origin.json` | never shipped |
| `glue` | `src/site.config.ts`, `src/lib/cms/**`, `src/lib/i18n/locale-settings.ts`, `src/lib/storage-keys.ts`, `src/components/shop/showcase-data.ts`, `src/app/[locale]/layout.tsx`, `src/components/layout/Header.tsx`, `src/mdx-components.tsx`, `.env.example`, `package.json` | never written; differences reported (`package.json`: missing deps and core scripts added only) |
| `core` | `src/cms/**`, `src/app/api/cms/**`, `src/app/admin/**` | replaced; files dropped upstream are deleted |
| `core-tests` | `test/cms/**`, `test/core/**`, `test/commerce/**`, `test/booking/**` | added/updated, never deleted |
| `scaffold` | `src/components/{account,popups,checkout,shortcodes}/**`, `shop/{wishlist,filters}/**`, `src/components/cms/Shortcode.tsx`, `src/shortcodes/**`, `src/app/[locale]/{account,wishlist}/**` | copied only if absent |
| `site` | everything else | untouched |

Rules are checked in the order base-only, glue, core, core-tests, scaffold; unknown paths default to `site`. The installer (`install.mjs`) refuses a dirty git tree (unless `--force`), downgrades (unless `--allow-downgrade`), and same-version reinstalls (unless `--reinstall`). The zip (`manifest.mjs`) lists every file with SHA-256; paths are re-classified by the installer and zip-slip names refused (`zip.mjs`). The zip carries its own installer, which `cli.mjs` extracts and runs, so installation follows the target version's rules.

### 8.8 The new-site / site-add-module skills

- `new-site` (`.claude/skills/new-site/SKILL.md`): interview → answers JSON → `scripts/scaffold.mjs` copies the base **working tree** into a new directory, strips base-only files (`scripts/manifest.mjs`, `references/strip-manifest.md`), renders templates (`templates/`) and generates answer-specific files (`scripts/generate.mjs`), then runs `check-imports.mjs` and `leak-check.mjs` (no "Praion" references). Then the build gate (lint, type-check, test, build) in the new site.
- `site-add-module`: run inside a generated site (has `.cms-origin.json`) to switch on commerce/booking/newsletter (config + seed settings) or add article/answer/scenario collections from the base templates. Never edits `src/cms/**`.
- **Parity gate** `node .claude/skills/new-site/scripts/check-base.mjs`: the base's front end must equal what the skill generates from `scripts/fixtures/base.json`; also fails on Praion references, unresolved imports, and dead STRIP entries. If you edit a templated/generated base file, edit its template/generator in the same change.
- **Drift check** `.claude/skills/new-site/scripts/verify-scaffold.sh [base|ecommerce|booking|simple]`: runs `check-base`, scaffolds each fixture into a temp dir (hard-linking `node_modules`), and runs lint/type-check/test/build on each. `KEEP=1` keeps output.

---

## 9. Testing

Runner: Node's built-in `node:test` + `node:assert/strict`, executed through `tsx` with `tsconfig.test.json` (adds `@/*` path mapping and maps `server-only` to `test/setup/server-only.ts`, an empty module). No database is needed; tests target pure logic.

```bash
npm test                                                           # everything in the globs below
npx tsx --tsconfig ./tsconfig.test.json --test test/core/api.test.ts   # one file
```

`npm test` globs: `test/lib/*.test.ts(x)`, `test/components/*.test.ts(x)`, `test/commerce/*.test.ts`, `test/booking/*.test.ts`, `test/cms/*.test.ts(x)`, `test/core/*.test.ts`, `test/studio/*.test.ts`, `test/tools/*.test.ts`, `test/site/*.test.ts(x)`. Only listed extensions run: a `.tsx` file in `test/core`, `test/commerce` or `test/booking` would be silently skipped. `generate.mjs` removes the `test/studio` and `test/tools` globs from a generated site's `package.json`.

| Folder | Class | Content |
|---|---|---|
| `test/core/` | core-tests | services and factory: `api.test.ts` (errors, respond, params, same-origin, paths, tags), `route-captcha.test.ts`, `route-2fa.test.ts`, `cms-update.test.ts`, `cron*.test.ts`, `locks.test.ts`, … |
| `test/cms/` | core-tests | config, admin helpers, auth, settings: `config.test.ts`, `zod-schema.test.ts`, `taxonomy-collection.test.ts`, `client-ip.test.ts`, `paths.test.ts`, `no-hardcoded-default-locale.test.ts`, `sidebar-groups.test.ts`, `settings-schema.test.ts`, … |
| `test/commerce/`, `test/booking/` | core-tests | module logic |
| `test/site/` | site | site config/locale parity (`config.test.ts`), brand leak, front-end wiring |
| `test/components/`, `test/lib/` | site | components and `src/lib` helpers |
| `test/tools/` | base-only | `core-sync-plan.test.ts` (classifier), `generated-field-help.test.ts` |
| `test/studio/` | base-only | QA studio |
| `test/setup/` | helpers | `server-only.ts`, `react-global.ts`, `field-help.ts` (imported by tests, not run) |

Architecture-relevant tests to run after touching this area:

```bash
npx tsx --tsconfig ./tsconfig.test.json --test test/core/api.test.ts test/core/route-captcha.test.ts \
  test/core/route-2fa.test.ts test/cms/client-ip.test.ts test/cms/config.test.ts test/cms/paths.test.ts \
  test/core/cms-update.test.ts test/tools/core-sync-plan.test.ts test/site/config.test.ts
```

Other gates: `npm run lint` (includes the core boundary rule), `npm run type-check`, `check-base.mjs`, `verify-scaffold.sh`. End-to-end QA lives in `qa/` (Playwright, base-only, against `npm run dev:qa`).

---

## 10. Gotchas / invariants

- **Never edit `src/cms/**`, `src/app/api/cms/**` or `src/app/admin/**` in a generated site.** They are replaced on the next update; fix on the base and release.
- **Copy, never `git merge`,** between base and sites (unrelated front ends).
- **`NEXT_PUBLIC_SITE_URL` must match the origin you serve on** (port included). Otherwise every browser write from the admin returns `403 Cross-origin request rejected`, while curl without an `Origin` header succeeds.
- **Production needs `X-Real-IP` from the proxy.** Without it every rate-limited route refuses all requests in production.
- **Rate limits are per process** and reset on restart.
- **`params` are not validated by `createRoute`.** Always use `idParam` / `uuidParam`; `uuidParam` is a security check for media paths.
- **Returning a plain object from a handler skips the `{ok, data}` envelope.** Use `ok()`/`created()`/`paginated()` for consistency.
- **Do not hand-roll error responses** in route handlers; throw `ApiError` (module-gate 404s in route files are the existing exception).
- **`logAudit` never throws.** A missing audit row does not surface as an error, so check tests or the audit screen when adding an action.
- **Module flags are resolved at request time** from `site_settings`; the code default in `site.config.ts` applies only when no `module.<name>` row exists. Changing the code default does not affect a site whose admin has saved the toggle.
- **The generic collection API does not check module flags.** `collectionListRoute` etc. validate the key against `config.collectionByKey`, and commerce/booking collections are always registered in `site.config.ts`, so `/api/cms/product` answers (to a user with content permissions) even when commerce is off. The comment in `src/site.config.ts` ("404s its routes") applies to module endpoints, not to document CRUD.
- **`forms`, `seo`, `media` flags exist but nothing reads them** (no `isModuleEnabled(config, 'forms'|'seo'|'media')` call was found); `START_HERE.md` describes them as always on.
- **`ADMIN_PATH` moves the admin by rewrite, not by folder.** The pages stay at `src/app/admin`; `src/proxy.ts` rewrites `/<ADMIN_PATH>/**` onto them and, when the segment is not `admin`, answers `/admin/**` with a plain 404 before redirects and i18n (so `/admin` is never localised into `/<locale>/admin`). Every admin link and redirect must be built from `getAdminPath()` (`adminHref()` in `src/cms/admin/admin-path.ts`; client components take an `adminPath` prop). `next.config.ts` duplicates the slug rule for the header `source` and reads the variable at startup, so a change needs a restart. `src/app/robots.ts` still disallows the literal `/admin/`.
- **Next 16 uses `src/proxy.ts`, not `middleware.ts`.** The proxy runs on the Node runtime (DB access allowed). Its main matcher pattern carries a segment-anchoring fix (F-050); add new exclusions as separate entries.
- **`CMS_CACHE_REVALIDATE` must stay `false`.** Time-based revalidation of layout-level reads caused a production outage; invalidation is by tag only.
- **Use `npm run db:migrate`, not `drizzle-kit migrate`** (socket vs TCP auth issue on MariaDB). `drizzle-kit generate` is fine.
- **`check-base.mjs` must stay green** on the base; a templated file changed in only one place makes "the base" and "a new site with base answers" diverge.
- **Do not edit the base while `verify-scaffold.sh` runs.** The scaffold copies the live working tree (including uncommitted changes), so edits mid-run leak into the scaffolds under test. Stale `.next` dev type files can also hide `tsc` errors; clear them if type-check results look inconsistent.
- **Branch naming is inconsistent.** The skill docs (`SKILL.md`, `core-sync.md`, `strip-manifest.md`) call the base branch `newsiteskill`; `scripts/cms-release.mjs` only releases from `CMS` (`RELEASE_BRANCH`). Both branches exist.
- **One rate limiter.** `src/lib/rate-limit.ts` is gone; `/api/contact` and `/api/cookies/consent` now call the core `checkRateLimit` / `getClientIp` (`src/cms/core/rate-limit.ts`) directly, so they share its handling of a missing `x-real-ip` (no shared sentinel bucket). Use `createRoute({ rateLimit })` for new CMS endpoints and `checkRateLimit` for plain route handlers.
- **`.gitignore` excludes `*.md`** except explicit re-includes (`docs/dev-guides/*.md`, `.claude/skills/**/*.md`, `docs/user-guides/src/*.md`, `seo-audit-tool/**/*.md`). Other docs, such as `docs/*.md`, must be force-added (`git add -f`).
- **`docs/CMS-FEATURES-FOR-PROPOSALS.md` must never reach a client site.** It is base-only; update it on every CMS feature change.
