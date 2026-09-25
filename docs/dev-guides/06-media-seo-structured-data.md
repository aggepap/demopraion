# 06 · Media, SEO, structured data & brand

This guide covers the parts of the CMS that decide how content looks to a browser, a crawler and a share preview. That is the media library (the upload pipeline, storage, AVIF/WebP serving and alt text), per-document and per-path SEO (fields, meta overrides, redirects, the 404 monitor, sitemap, robots, hreflang), JSON-LD structured data (the category policy and the node builder), the Product Manager ("PM", Praion.ai) bridge that pushes SEO/AEO enrichment in from an external system, and the brand (identity plus palette) that the site, the JSON-LD and emails read. It also covers the small anonymous stats counter module. Everything here is taken from the code on branch `CMS`. Where the code and older docs disagree, the code wins.

Related guides: [01-architecture.md](01-architecture.md) · [02-database.md](02-database.md) · [03-content-model.md](03-content-model.md) · [04-admin-ui.md](04-admin-ui.md) · [05-auth-users-security.md](05-auth-users-security.md) · [07-forms-email-marketing.md](07-forms-email-marketing.md) · [08-commerce.md](08-commerce.md) · [09-booking.md](09-booking.md) · [10-settings-cron-operations.md](10-settings-cron-operations.md)

---

## 2. File map

### Media

| Path | Role |
|---|---|
| `src/cms/core/media/mime.ts` | Upload allow-list (`ALLOWED_UPLOAD_MIME`) and magic-byte sniffing (`sniffMime`). SVG is always refused. |
| `src/cms/core/media/normalize.ts` | `prepareUpload()`: decode, rotate, fit to 1600x1200, re-encode to WebP, plus an AVIF companion. Holds the constants and `MediaProcessingError`. |
| `src/cms/core/media/service.ts` | `uploadMedia`, `listMedia`, `countMedia`, `getMedia`, `findMediaByHash`, `setMediaAltText`, `deleteMedia`, `mediaUrl`. |
| `src/cms/core/media/storage.ts` | `StorageAdapter` interface and `LocalDiskStorage` (`CMS_UPLOAD_DIR`, default `.data/uploads`), with a path-containment check. |
| `src/cms/core/media/variants.ts` | `avifKey`, `acceptsAvif`, `readForAccept`: content negotiation for the one public URL. |
| `src/cms/core/media/image.ts`, `remote-url.ts` | `toWebp` and `fetchRemoteImage` / `checkRemoteImageUrl`, for images the CMS fetches itself (used by `modules/reviews-external/sync.ts`). They do not go through the media library. |
| `src/cms/core/routes/media.ts` | Route factories `mediaListRoute`, `mediaUpdateRoute` (alt text), `mediaDeleteRoute`. |
| `src/app/api/cms/media/route.ts` | `GET` list. |
| `src/app/api/cms/media/upload/route.ts` | `POST` multipart upload. Hand-written, not `createRoute()`. |
| `src/app/api/cms/media/[uuid]/route.ts` | `PATCH` alt text, `DELETE`. |
| `src/app/api/cms/media/file/[uuid]/route.ts` | Public `GET` for the bytes. |
| `src/cms/admin/MediaLibrary.tsx`, `MediaAltText.tsx`, `media-upload-notice.ts`, `fields/MediaPicker.tsx` | Admin UI. |
| `src/app/admin/(shell)/media/page.tsx` | The Media screen. |
| `src/cms/db/adapters/mysql/schema/media.ts` | `media_files`, `media_folders`, `media_variants`, `media_usages`. |

### SEO

| Path | Role |
|---|---|
| `src/cms/core/seo/fields.ts` | The 15 built-in SEO/AEO field definitions (`SEO_FIELD_DEFS`), the robots codec, `SEO_FIELDS_DATA_KEY = 'seo'`. |
| `src/cms/core/seo/field-overrides.ts` | Admin deltas on top of the built-ins (`cms.seoFields`), `resolveSeoFields`, `compileSeoGroup`, and the per-collection `schemaType` field. |
| `src/cms/core/seo/document.ts` | `documentSeo(row)` normalises a document's SEO values for the public site. |
| `src/cms/core/seo/service.ts` | CRUD for redirects, the 404 log and per-path meta (`upsertMeta`, `patchMeta`). |
| `src/cms/core/seo/resolve.ts` | Request-time, cached, fail-open reads: `resolveRedirect`, `getMetaOverride`, `getHeadPayload`, `log404`, plus the revalidate helpers. |
| `src/cms/core/seo/match.ts` | `redirectMatches`, `redirectWouldLoop`. Pure. |
| `src/cms/core/seo/unpublish-redirect.ts` | Auto-redirects written when a post stops being live. |
| `src/cms/core/seo/slug-change-redirect.ts` | Auto-redirects written when a live document's address changes. |
| `src/cms/core/seo/setting-lines.ts` | `settingLines(key)` reads a textarea setting as lines (robots/sitemap extras). |
| `src/cms/core/routes/seo.ts` | Route factories for redirects, the 404 monitor and meta. Validates URLs and checks regexes for ReDoS. |
| `src/app/api/cms/seo/**` | Thin route files. |
| `src/proxy.ts` | Runs redirects before next-intl routing. |
| `src/app/sitemap.ts`, `src/app/robots.ts` | Generated `sitemap.xml` and `robots.txt`. |
| `src/lib/seo/metadata.ts` | `siteMetadata(brand)` for the layout and `localizedMetadata({...})` for pages: canonical, hreflang, OG, Twitter, robots. |
| `src/cms/admin/SeoPanel.tsx`, `SeoManager.tsx`, `SeoFieldsManager.tsx` | Admin UI. |
| `src/app/admin/(shell)/seo/page.tsx` | The SEO screen. |
| `src/cms/db/adapters/mysql/schema/seo.ts` | `seo_meta`, `seo_redirects`, `seo_404_log`. |

### Structured data, PM, brand, stats

| Path | Role |
|---|---|
| `src/cms/core/structured-data/policy.ts` | Types, categories, parts (incl. `speakable`), business types, `parseSchemaPolicy`, `resolveSchemaChoice`. Pure and client-safe. |
| `src/cms/core/structured-data/nodes.ts` | `buildDocumentNodes`, `businessNode`, `structuredDataJson`. Pure. |
| `src/cms/core/structured-data/index.ts` | `getSchemaPolicy(config)` (React-`cache`d settings read) and `schemaPolicyHints`. |
| `src/lib/seo/schemas.ts` | Site-side helpers: `SITE_URL`, `ORG_ID`, `organizationSchema`, `globalGraph`, `breadcrumbSchema`, `faqSchema`, `jsonLd`, `documentGraph`, `documentStructuredData`. |
| `src/lib/seo/commerce-schema.ts` | `productSchema`, `itemListSchema` and the availability/condition mappers (see 08). |
| `src/cms/admin/StructuredDataSettings.tsx` | Settings → Structured data. |
| `src/cms/modules/pm/*` | The PM bridge: `routes.ts`, `catalogue.ts`, `dto.ts`, `mapping.ts`, `write.ts`, `alts.ts`, `payload.ts`, `jsonld.ts`, `PmStructuredData.tsx`, `gate.ts`, `identity.ts`. |
| `src/cms/config/pm-types.ts` | PM page-type vocabulary and the editable keys per type. |
| `src/app/api/cms/pm/v1/**` | Bridge route files. |
| `src/cms/db/adapters/mysql/schema/pm.ts` | `pm_head_payloads`. |
| `src/cms/core/brand/policy.ts` | Brand identity and palette schemas, `PALETTE_TOKENS`, `resolveBrand`, `paletteCss`, `contrastRatio`. |
| `src/cms/core/brand/index.ts` | `getBrand`, `getPaletteCss`, `getEmailBrand`, `brandEmailHtml`. |
| `src/cms/core/brand/BrandStyle.tsx`, `BrandProvider.tsx` | `<style id="brand-palette">` and the client context `useBrand()`. |
| `src/cms/core/brand/import.ts`, `src/cms/db/seeds/brand.ts` | A one-time import from `site.brand.ts` / `globals.css` (`npm run db:brand-import`). |
| `src/lib/brand.ts` | `siteBrand()`, which is `getBrand(config.brand)`. |
| `src/cms/admin/BrandSettings.tsx` | Settings → Branding. |
| `src/cms/core/stats/policy.ts`, `counters.ts` | `stat_counters`: anonymous per-day counters. |

---

## 3. Data model

### `media_files` (primary key `uuid`)

| Column | Notes |
|---|---|
| `uuid` varchar(36) PK | Also the storage key. |
| `original_name` varchar(255) | For images this is rewritten to `<stem>.webp` (`webpName`), truncated by code point. |
| `mime` varchar(128) | `image/webp` for every image uploaded since normalisation. `application/pdf` is stored as-is. Older rows may hold other allowed types. |
| `size`, `width`, `height` | Describe the **stored WebP**, not the upload. Width and height are null for PDFs. For animations, `height` is one frame's height. |
| `hash` varchar(64), index `idx_media_files_hash` | sha256 of the stored bytes. Used for duplicate detection. **No unique constraint.** |
| `alt_text` varchar(512) | The default alt text. Written by `PATCH /api/cms/media/:uuid` and by the PM bridge. |
| `folder_id` | FK to `media_folders`. **Unused by any code.** |
| `uploaded_by` | FK to `admin_users`, set null on delete. |

`media_folders`, `media_variants` (`original/thumb/medium/large/og` x `jpg/webp/png/avif/svg`) and `media_usages` exist in the schema and nothing reads or writes them. The only "variant" that exists is the AVIF companion file, which has no row (see §4.1).

### `seo_meta`: per-path overrides, unique `(path, locale)`

`title`, `description`, `robots`, `canonical`, `og_title`, `og_description`, `og_image`, `updated_by`. `path` is the **locale-less** path (`/pricing`, not `/en/pricing`). `localizedMetadata` looks it up with the main-locale path plus the page locale.

### `seo_redirects`, unique `(source, kind)`

`source`, `target`, `status_code` (default 301), `kind` enum `literal|wildcard|regex`, `active`, `hits`, `last_hit_at`, `notes`, `document_id` (FK cascade, set only on CMS-written rules), `reason` (`unpublish` | `slug_change` | null for admin rules), `created_by`.

### `seo_404_log`, unique `(path, locale)`

`hits`, `first_seen`, `last_seen`, `user_agent_sample`, `referrer_sample`, `ignored`.

### SEO on `documents` (see 02/03)

Columns: `meta_title` (255), `meta_description` (320), `canonical_path` (512, **unique**, the routing index), `noindex`, `nofollow`, `include_in_sitemap` (default true), `og_image_uuid`. The JSON-backed SEO values live in `documents.data.seo.*` and are per locale, because a row is per locale.

### `pm_head_payloads`, unique `(path, locale)`

`remote_type`, `document_id` (FK cascade, null for archives), `head_meta` JSON, `jsonld` JSON, `alternates` JSON (stored, **not rendered**), `seo_override` bool, `source`, `payload_hash` (sha256 of the canonical JSON), `compiled_at`.

### `site_settings` keys owned by this area

| Key | Shape | Writer |
|---|---|---|
| `cms.seoFields` (`SEO_FIELDS_KEY`) | `SeoFieldOverrides` deltas | SeoFieldsManager |
| `seo.schema` (`SCHEMA_POLICY_KEY`) | `SchemaPolicy` (validated by `schemaPolicySchema`) | StructuredDataSettings |
| `seo.robotsExtraDisallow` | textarea, one path per line | Settings → SEO |
| `seo.sitemapExtraUrls` | textarea, one absolute URL per line | Settings → SEO |
| `brand.identity` (`BRAND_IDENTITY_KEY`) | `BrandIdentity` | BrandSettings |
| `brand.palette` (`BRAND_PALETTE_KEY`) | `{token: '#rrggbb'}` | BrandSettings |

These keys are validated in `src/cms/core/settings/structured.ts`. See 10 for the settings pipeline.

### `stat_counters`

One row per `(scope, subject_id, metric, day)` holding `count`. No visitor data. Written by `incrementCounter` (the wishlist and popups modules) and read by `readCounters`. This is not SEO or analytics tracking. GA4 lives in `src/lib/analytics/gtag.ts` and `AnalyticsLoader` (see 10).

---

## 4. How it works

### 4.1 Media upload pipeline

```
POST /api/cms/media/upload (multipart, field "file")
  isSameOrigin → 403
  checkRateLimit('cms-media-upload', ip, 60/min) → 429
  requireApiPerm(cms.media.write)
  content-length > 10 MB + 64 KB → 413       (before formData() buffers it)
  file.size > 10 MB → 413
  sniffMime(bytes) → null → 415              (client File.type is ignored)
  uploadMedia({buffer, originalName, mime}, userId)
    prepareUpload()
      PDF → pass-through, name truncated
      image → sharp(failOn:'error', limitInputPixels: 40M)
              probe pages → animated?
              rotate() (stills only) → resize inside 1600x1200, withoutEnlargement
              WebP q82   ┐ in parallel from the same pipeline
              AVIF q55 e2 ┘ (stills only; kept only if smaller than the WebP)
              sharp failure → MediaProcessingError → 415
    findMediaByHash(sha256(webp)) → hit → return existing row, duplicate:true
    storage.save(uuid, webp); storage.save(`${uuid}.avif`, avif?)
    INSERT media_files
  logAudit('media.upload') unless duplicate
  201 {ok, data: row+url+duplicate}   | 200 when duplicate
```

Key properties:

- **Every image becomes WebP.** No screen can opt out. The media library, `f.image()` pickers, brand logo/favicon/OG image, galleries and the SEO social image all upload through this one route. The stored bytes are always something sharp produced, so EXIF (including GPS) is dropped.
- **Animated GIF/WebP** keep all their frames (`animated: true`). They skip `rotate()` and get no AVIF.
- **Duplicates.** The hash is taken after normalisation, so the same original uploaded twice under different names gives the same digest. The existing row is returned untouched: its name and alt text are kept. Both upload UIs show `duplicateNotice()` (from `media-upload-notice.ts`). Two identical uploads racing each other can both be stored. That is a known trade-off, because the column has no unique constraint.
- **Storage.** `LocalDiskStorage` writes to `CMS_UPLOAD_DIR` or `<cwd>/.data/uploads`. `path()` resolves the key and throws if it leaves the root. The `StorageAdapter` interface (`save/read/delete`) is the seam for S3-style storage. Only the local adapter exists, and `getStorage()` always returns it.

### 4.2 Serving media

`GET /api/cms/media/file/:uuid` is public. It looks up the row (404 if none) and then calls `readForAccept(storage, uuid, mime, Accept)`:

- If `mime !== 'image/webp'`, it serves the stored file and does not negotiate.
- If the WebP row's `Accept` contains an explicit `image/avif` with q>0, it serves `<uuid>.avif`, falling back to the WebP when that file is missing. Wildcards such as `image/*` do **not** count, because crawlers and feed fetchers send them.
- Negotiated responses send `Vary: Accept`.

Response headers: `Cache-Control: public, max-age=31536000, immutable`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox; frame-ancestors 'none'`, `X-Frame-Options: DENY`. A row whose `mime` is not on the allow-list is served as `application/octet-stream` with `Content-Disposition: attachment`.

The public URL shape `/api/cms/media/file/<uuid>` is built by `mediaUrl()` in `core/media/service.ts`. Several site files re-declare it inline (`src/lib/site/content.ts`, `src/app/[locale]/[slug]/page.tsx`, `src/components/shop/showcase-data.ts`, `src/cms/core/brand/policy.ts`, and others). Pages pass it to `next/image` as a relative URL, and absolute URLs (OG, JSON-LD) are built as `${SITE_URL}${mediaUrl(uuid)}`.

### 4.3 Alt text

There are two places alt text lives:

1. **Per usage.** An `alt` field beside an image inside a repeater (galleries in booking/commerce collections). This is what templates render, for example `showcase-data.ts` renders `g.alt || title` and `booking/[slug]/page.tsx` keeps each gallery item's `alt`.
2. **Per asset.** `media_files.alt_text`, edited in the Media screen (`MediaAltText`) and in the PM bridge's `library` scope. The admin copy says it "applies wherever this image appears without alt text of its own". **No public template currently reads `media_files.alt_text` as a fallback.** Only the admin picker and the PM DTO use it. Treat it as a stored default that templates still need to adopt.

### 4.4 SEO field set

Every collection with `seo: true` (the default in `CollectionDefinition`) gets the SEO block. `mergeCustomFields()` in `core/fields/resolve.ts` calls `withSeoGroup()`. That function appends `compileSeoGroup(resolveSeoFields(overrides, collectionKey))` as an `f.group('seo', …, {strict:false})`. The group is **not** `shared`, so it is per locale.

The 15 built-ins (`SEO_FIELD_DEFS`) use two storage backings:

| Key | Tab | Storage | Target |
|---|---|---|---|
| `seoTitle` | general | column | `metaTitle` (counter 10–60) |
| `metaDescription` | general | column | `metaDescription` (counter 50–160) |
| `focusKeywords` | general | data | `data.seo.focusKeywords[].keyword` (not published) |
| `ogTitle`, `ogDescription` | social | data | `data.seo.ogTitle/ogDescription` |
| `ogImage` | social | column | `ogImageUuid` |
| `twitterCard` | social | data | `summary` \| `summary_large_image` |
| `faqs` | aeo | data | `[{question, answer}]`, emitted as FAQPage |
| `keyFacts`, `prosCons` | aeo | data | Stored only ("not yet shown on the page") |
| `answerSummary` | aeo | data | Stored. Not rendered by the generic templates. |
| `canonicalUrl` | advanced | data | `data.seo.canonicalUrl`. **Not** the `canonical_path` column (that one is unique). |
| `robots` | advanced | column | Select over `noindex` + `nofollow` (`robotsValue`/`robotsColumns`) |
| `includeInSitemap` | advanced | column | `includeInSitemap` |
| `schemaOverride` | advanced | data | Raw JSON-LD that replaces the generated graph |

`resolveSeoFields` also adds a 16th field, `schemaType` (a select, `data.seo.schemaType`, order 145, advanced tab), for any collection that has a structured-data category. Its options are `inherit` plus the category's types. For `booking`, both kinds' types are merged, and `resolveSchemaChoice` ignores a type that does not fit the document's kind.

`field-overrides.ts` stores **deltas only**: `disabled`, `labels`, `descriptions`, `order`, `tab`, `required` (only for `data` fields), `extra` (admin-added fields, always under `data.seo.<key>`) and `perCollection[key].disabled`. The key, kind and storage of a built-in cannot be changed. A disabled field keeps its stored value, and `strict:false` stops old values from failing validation.

On the public side, `documentSeo(row)` in `core/seo/document.ts` turns a row into a `DocumentSeo`. It trims strings and turns empty values into null. It drops half-filled FAQ pairs. It parses `schemaOverride` and keeps it only if the result is an object or an array. It treats `schemaType: 'inherit'` as null, and a missing `includeInSitemap` reads as true. It never throws.

### 4.5 Page metadata (`src/lib/seo/metadata.ts`)

The locale layout calls `siteMetadata(brand)`. That sets `metadataBase = SITE_URL`, a title template `%s | {brand.name}`, the default OG/Twitter values (brand OG image), a default hreflang map, and the favicon from `brand.faviconUrl`, falling back to `/favicon.svg`.

Pages call `localizedMetadata({title, description, path, locale, ogImage?, seo?})`:

1. It strips any trailing slash. It computes `mainPath` (the locale-less path), the page's `canonical`, and `languages` for every **public** locale (from `getLocaleSettings()`), plus `x-default`, which is `en` when public and otherwise the main locale.
2. It loads `getMetaOverride(mainPath, locale)`, `getHeadPayload(mainPath, locale)` and `siteBrand()` in parallel.
3. Precedence, highest first:
   - `seo_meta` override
   - PM payload with `seo_override = true` ("pmStrong")
   - the page's args / document SEO
   - PM payload without the override flag ("pmWeak"), which only fills gaps
   - brand default (OG image only)

   The canonical order is override → pmStrong → `seo.canonicalUrl` → computed. Robots are emitted only when something restricts them.
4. `twitter.card` comes from `seo.twitterCard`, defaulting to `summary_large_image`. `openGraph` is restated in full, because a page-level `openGraph` replaces the layout's.

Note that `localizedMetadata` does not read `seo.metaTitle` or `seo.metaDescription` itself. Each page passes `title: seo.metaTitle || title` and so on (see `src/app/[locale]/[slug]/page.tsx`).

**Hreflang** comes only from `<link>` tags (via `alternates.languages`) and from the sitemap's `alternates.languages`. next-intl's `Link` header is disabled (`alternateLinks: false` in `src/lib/i18n/routing.ts`, per the comment in `proxy.ts`). The sitemap comment says its x-default rule "must agree with `localizedMetadata()`". Keep the two in step.

### 4.6 Redirects and the 404 monitor

`src/proxy.ts` (the Node runtime) runs on every non-API, non-admin, extension-less path:

```ts
const match = await resolveRedirect(pathname);           // cached, fail-open
if (match) { void bumpRedirectHit(match.id); return NextResponse.redirect(target, match.statusCode); }
return intl(request);
```

- `loadActiveRedirects` is `unstable_cache`d under tag `cms:seo-redirects` and ordered by `id ASC`. **The oldest matching rule wins**, and the admin table shows rules in the same order.
- `redirectMatches(source, kind, path)` compares decoded, trailing-slash-stripped paths:
  - `literal`: equality.
  - `wildcard`: `/x/*` matches `/x` and `/x/...`. A legacy wildcard without `/*` acts as a prefix.
  - `regex`: `new RegExp(source).test(path)`, but only for paths of 256 characters or fewer.
- The redirect runs on the **full pathname including the locale prefix** (`/en/old`), before next-intl.
- On write (`core/routes/seo.ts`):
  - The target must be `/path` (not `//`) or an absolute http(s) URL (`publishableUrl`).
  - Status must be one of 301/302/307/308.
  - The source is stored with trailing slashes stripped.
  - Wildcards must end in `/*`.
  - Regexes are refused for nested quantifiers (`nestedQuantifier`) or if a probe run exceeds 25 ms.
  - Self-loops and multi-rule cycles across all active rules are refused (`redirectWouldLoop`, max 20 hops).
  - Every write calls `revalidateRedirects()` and `logAudit`.

The CMS also writes redirects itself, inside `updateDocument`/`createDocument` in `core/documents/service.ts`:

- **`applyUnpublishRedirect`**: runs for collections that declare `unpublishRedirect: {taxonomyField, fallbackPath, termPathTemplate?}`. A once-published document that is no longer live gets a rule to its first live category (302 while a draft, 301 once archived), or to `fallbackPath`. The rule is removed when the document is live again. An admin rule for the same source wins. Rows carry `document_id` and `reason='unpublish'`.
- **`applySlugChangeRedirect`**: when a public document's path changes, it writes a 301 from the old path to the new one (`reason='slug_change'`). It moves earlier slug rules forward so there is only one hop, and it removes slug rules whose source is now a live page's own path.

Both use a pure `plan*` function (tested) and an `apply*` function that performs the plan.

**404 log.** `log404(path, locale, meta)` upserts into `seo_404_log`. It is called from `src/app/[locale]/[slug]/page.tsx` and `src/app/[locale]/shop/[slug]/page.tsx` when no document resolves, and from the `[...rest]` catch-all (with the unprefixed path, `/${rest.join('/')}`) before it redirects to `/page-not-found`.

### 4.7 Sitemap and robots

`src/app/sitemap.ts` (`force-dynamic`):

- Includes `STATIC_ROUTES` (`/`, `/contact`, `/legal/cookies`), family indexes, and published documents from `SITEMAP_FAMILIES`. A family is only listed if its collection is registered and its module is on.
- Skips documents with `noindex` or `includeInSitemap === false`, and skips `page` slugs `home` and `contact`.
- Emits one entry per public locale, with `alternates.languages` and an x-default.
- Sets `lastModified` only for document routes (`modifiedAt ?? publishedAt ?? createdAt`, as UTC noon).
- Appends `seo.sitemapExtraUrls` lines that start with http(s) and are not already listed.

`src/app/robots.ts`:

- If `isProductionHost(SITE_URL, config.productionOrigin)` is false, it returns `Disallow: /` for everyone. `SITE_URL` is inlined at build time.
- Otherwise it returns `robotsRules(extra)`. That always disallows `/api/` and `/admin/`, plus the `seo.robotsExtraDisallow` lines, and applies them both to `*` and to each explicitly allowed AI crawler (`GPTBot`, `ChatGPT-User`, `OAI-SearchBot`, `ClaudeBot`, `anthropic-ai`, `PerplexityBot`, `Google-Extended`).

### 4.8 Structured data

**Site-wide.** `src/app/[locale]/layout.tsx` emits `globalGraph(locale, brand, schemaPolicy.business)` on every page. That is an Organization (`@id ${SITE_URL}/#organization`) plus a WebSite (`#website`). `organizationSchema` builds the Organization from the brand: name, legalName, logo (absolute), slogan, address, contactPoint, and `sameAs` from the socials. `businessNode()` then retypes it to the chosen business type. A local-business type without an address stays `Organization`, because Google requires the address. `priceRange` and `telephone` are added for local businesses.

**Per document.** The policy lives in `seo.schema` and is read by `getSchemaPolicy(config)`:

- Categories (`SCHEMA_CATEGORIES`): `pages`, `articles`, `answers`, `caseStudies`, `products` (commerce), `bookingTransport`, `bookingStay` (booking). Each maps to a collection and has an allowed type list (the first is the default) and toggleable parts.
- Each category policy is `{type, breadcrumbs, appendFaq, parts}`. Values default to on. `parseSchemaPolicy` is tolerant field by field.
- The business type defaults from modules: commerce gives `OnlineStore`; booking gives `LodgingBusiness` if every booking kind is `stay`, otherwise `TravelAgency`; anything else gives `Organization`.
- `resolveSchemaChoice(policy, category, docOverride)` gives the effective type, `family`, and a parts map. A part is on only if the family can carry it (`PARTS_FOR_FAMILY`) **and**, when the category offers it as a toggle, the toggle is not off.

Families and what `buildDocumentNodes` emits:

| Family | Types | Main node |
|---|---|---|
| `webpage` | WebPage, AboutPage, ContactPage, CollectionPage | `#webpage`, isPartOf website, publisher org |
| `article` | BlogPosting, Article, NewsArticle, TechArticle, CreativeWork | `#article`, headline ≤110, optional image/dates/author (author node emitted beside it when it has `@id`) |
| `faq` | FAQPage | `#faq` from `facts.faq` + (if `appendFaq`) SEO FAQs. Nothing if there are no pairs. |
| `product` | Product | `facts.productNode` (from `productSchema`) with the parts stripped per toggles |
| `trip` | TouristTrip, Trip | `#trip` with provider org, image, offers |
| `accommodation` | Accommodation, HotelRoom, Apartment, House, VacationRental | `#accommodation`, image only (never `offers`) |
| `none` | None | Nothing. The layout graph still stands. |

After the main node come the breadcrumb (if enabled and given) and the SEO-panel FAQs as a separate FAQPage (not for the `faq` family). `structuredDataJson()` returns the escaped `{"@context","@graph"}` string, or `null` when there are no nodes. **A non-empty `schemaOverride` replaces everything**, even when the type is None.

The site wrapper `documentStructuredData({category, seo, policy, url, locale, facts, crumbs})` in `src/lib/seo/schemas.ts` joins these together and returns a string or null.

**`speakable`.** It is in `SCHEMA_PARTS` and offered for `articles`, `answers` and `caseStudies`, and the `article` family can carry it. When it is on, `buildDocumentNodes` gives an `article`-family node `speakable: { '@type': 'SpeakableSpecification', cssSelector: SPEAKABLE_SELECTORS }`, which points at `[data-speakable="headline"]` and `[data-speakable="summary"]`. A template has to mark those elements (the new-site `detail-page.tsx.tpl` does); one that marks neither gets a spec that matches nothing, which search engines ignore. The `answers` category lists `speakable` as a part, but its default FAQPage type carries no parts. The toggle is only live if the category's type is switched to `Article`.

**How pages emit it.** Pages that support PM overlays wrap their graph in `<PmStructuredData path locale fallbackJson={structuredData}>` (currently only `[slug]/page.tsx` and `shop/[slug]/page.tsx`. The new-site templates `content/detail-page.tsx.tpl` and `author-page.tsx.tpl` use `documentStructuredData`/`documentGraph` without the PM wrapper). Others render `<script type="application/ld+json" dangerouslySetInnerHTML={{__html: structuredData}}>` directly (`booking/[slug]/page.tsx`, listing pages via `jsonLd(...)`). Always serialise with `jsonLd()` / `structuredDataJson()` (which escape `<`) or with `safeJsonLd()` (which escapes `< > &` and U+2028/9).

### 4.9 The PM (Product Manager / Praion.ai) bridge

"PM" is an external SaaS (Laravel, originally built against WooCommerce/WordPress) that reads a site's content, scores it, and pushes back SEO/AEO enrichment. In the admin the settings tab is labelled "Connect to Praion.ai" (`PRAION_TAB`). `src/cms/modules/pm/index.ts` refers to `docs/PM_BRIDGE_SPEC.md` and `docs/PM_CONTENT_TYPES.md`. **Neither file exists in `docs/`.**

- **Gate.** `modules.pm` is off by default (`site.config.ts` has `pm: false`). Every route checks `pmEnabled(config)` (the resolved runtime module flags) and answers `404 {ok:false,error:'no_route'}` when it is off. The Modules toggle is the kill switch.
- **Auth.** `requireSignatureOrSession({scope, perm})` from `core/tokens/guard.ts` (details in 05) accepts either an HMAC-signed request with an API token holding the scope (`pm:read`, `pm:write`, `pm:payload`, `pm:media`) or an admin session with the permission. `sameOrigin: false` is deliberate, because the guard owns CSRF.
- **Exposure.** A collection is exposed by declaring `pmPageType` (`wp_page | wp_post | product | product_category | product_tag`), optionally with `pmFieldMap`, `pmGroup` and `pmDescription`. Archives (virtual pages) are declared in `config.pm.archives` as `{archive_home|archive_blog|archive_shop|archive_search|archive_404: {path, label?}}`. `defineConfig` validates all of this (`src/cms/config/config.ts`).
- **Identity.** `remote_id` is `doc:<id>` or the archive type (`identity.ts`). There is no locale in the id on purpose. `decodeRef` accepts `doc:42`, `42` and `archive_*`. `resolveDocument` asserts that the document's collection declares the requested type.
- **Catalogue** (`catalogue.ts`). Archives come first (with negative synthetic ids), then documents ordered by `updated_at`, in PM's envelope `{data, meta:{current_page, per_page, total, last_page}}`. `per_page` is at most 100. `modified_after` accepts ISO or `Y-m-d H:i:s` and omits archives. Items are built by `dto.ts/buildItem` and include images (with `media_files.alt_text`) and SEO.
- **Writes** (`write.ts`). `applyPageValues` translates PM keys (`name`, `slug`, `description`, `short_description`, `seo_title`, `meta_description`, `robots`, `canonical_url`, `og_*`, `twitter_card`, `focus_keywords`, `faqs`, `key_facts`, `answer_summary`, `pros_cons`, `schema_raw_override`) into a **single** `updateDocument` call, so that exactly one version row is written.
  - Values are capped and rejected, never truncated.
  - `robots` must be one of the four combinations.
  - `canonical_url` and `og_image` must be same-origin (`toSameOriginPath`, `mediaUuidFromUrl`).
  - The response is always 200 with `{written, errors, skipped}` per field.
  - A version conflict is retried once.
  - A slug change recomputes `canonical_path` (checked for collisions first). The 301 is written by `updateDocument` (`applySlugChangeRedirect`), as for every other writer; the bridge writes none of its own.
  - `applyArchiveValues` writes `seo_meta` through `patchMeta` (a partial upsert, unlike `upsertMeta`).
- **Image alts** (`alts.ts`). `PATCH …/image-alts` with `values: [{media_id|src|index, alt}]` (at most 200) and `scope: document|library|both`. `document` writes the `alt` beside the image in gallery repeaters, and `library` writes `media_files.alt_text` via `setMediaAltText`.
- **Head payloads** (`payload.ts`). `PATCH /payload` stores `{head_meta, jsonld, alternates, seo_override}` in `pm_head_payloads`.
  - `remote_id` beats `path`, and the stored path is the document's `canonical_path`.
  - Limits: 256 KB body, 100 JSON-LD nodes, 5 000-character strings, 40 head-meta keys, depth 20. `__proto__`/`constructor`/`prototype` are refused and `</script` is refused.
  - An identical `payload_hash` is a no-op that neither writes nor revalidates.
  - `deletePayload` is the revocation.
- **Rendering.** `localizedMetadata` folds in `head_meta` (strong or weak, see 4.5). `PmStructuredData` renders the site graph and/or PM's graph: `seo_override` replaces the site graph, otherwise PM's graph is emitted as a second `<script>`. PM output is serialised with `safeJsonLd`. `ping` advertises `compiled_payloads: true` and `alternates: false`. If you remove the render wiring, flip `compiled_payloads` in `routes.ts` in the same change.

### 4.10 Brand

`getBrand(defaults)` (React `cache`) reads `brand.identity` and `brand.palette` through `getSetting`, so it is invalidated by the `cms:settings` tag. It returns a `SiteBrand`:

- the identity fields
- `phoneHref`
- `logoUrl`, `logoDarkUrl`, `faviconUrl`, `ogImageUrl` (all relative media URLs, or null)
- `palette`

If the stored identity fails `brandIdentitySchema`, it falls back entirely to `config.brand` from `src/site.brand.ts` (and then to `'Site'`).

How the brand is consumed:

- **CSS.** `<BrandStyle/>` (in the `[locale]` layout `<head>` and in `src/app/admin/layout.tsx`) emits `:root{--color-<token>:#hex;…}` for **stored tokens only**. The rule is unlayered, so it beats Tailwind's `@layer theme` values without a rebuild. There are 11 tokens (`PALETTE_TOKENS`). The token names are fixed because Tailwind utilities are generated from them.
- **Server components** call `siteBrand()` (`src/lib/brand.ts`). **Client components** call `useBrand()` under `<BrandProvider value={brand}>` (in the locale layout).
- **Metadata / JSON-LD.** `siteMetadata`, `localizedMetadata` (OG fallback) and `organizationSchema`.
- **Email.** `getEmailBrand()` / `brandEmailHtml()` use an absolute logo URL built from `siteOrigin()` (see 07).
- **Migration.** `npm run db:brand-import` runs `planBrandImport`, which writes a key only when it is absent, from `site.brand.ts` and the `@theme` colours in `globals.css`.

---

## 5. HTTP API

All CMS routes answer `{ok, data}` / `{ok:false, error, message}` unless noted. `createRoute` routes get the same-origin check and rate limiting by default (see 01/05).

| Method | Path | Auth / permission | Purpose |
|---|---|---|---|
| GET | `/api/cms/media?limit&offset&search` | `cms.media.read` | Paginated list (`paginated()` envelope), newest first. `limit` ≤ 500. `search` is a LIKE on `original_name`. |
| POST | `/api/cms/media/upload` | `cms.media.write`, same-origin, 60/min/IP | Multipart upload, max 10 MB. 201 new / 200 duplicate / 413 / 415. |
| PATCH | `/api/cms/media/:uuid` | `cms.media.write` | `{altText: string ≤512 \| null}`. Audited `media.update`. |
| DELETE | `/api/cms/media/:uuid` | `cms.media.write` | Deletes the WebP, the AVIF and the row. 204 / 404. Audited `media.delete`. |
| GET | `/api/cms/media/file/:uuid` | public | Bytes. AVIF/WebP negotiated. Immutable cache. |
| GET | `/api/cms/seo/redirects` | `cms.seo.read` | All redirects, `id ASC`. |
| POST | `/api/cms/seo/redirects` | `cms.seo.write` | Create. `{source, target, statusCode?, kind?, active?, notes?}`. |
| PATCH | `/api/cms/seo/redirects/:id` | `cms.seo.write` | Partial update, re-checked for kind shape and loops. |
| DELETE | `/api/cms/seo/redirects/:id` | `cms.seo.write` | Delete. |
| GET | `/api/cms/seo/notfound` | `cms.seo.read` | Latest 100 404 entries by `last_seen`. |
| PATCH | `/api/cms/seo/notfound/:id` | `cms.seo.write` | `{ignored}`. |
| DELETE | `/api/cms/seo/notfound/:id` | `cms.seo.write` | Delete an entry. |
| GET | `/api/cms/seo/meta` | `cms.seo.read` | All per-path overrides. |
| POST | `/api/cms/seo/meta` | `cms.seo.write` | Whole-row upsert on `(path, locale)`. |
| DELETE | `/api/cms/seo/meta/:id` | `cms.seo.write` | Delete an override. |
| GET | `/api/cms/pm/v1/ping` | `pm:read` token or `cms.content.read` session; 30/min | Capabilities and content-type manifest. |
| GET | `/api/cms/pm/v1/pages?page&per_page&locale&modified_after` | `pm:read` / `cms.content.read`; 120/min | Archives + documents, PM envelope. |
| GET | `/api/cms/pm/v1/pages/:type/:ref` | same | One page or archive. |
| PATCH | `/api/cms/pm/v1/pages/:type/:ref` | `pm:write` / `cms.content.write`; 60/min | `{values, expected_version?}` → `{written, errors, skipped}`. |
| PATCH | `/api/cms/pm/v1/pages/:type/:ref/image-alts` | `pm:media` / `cms.media.write`; 60/min | Alt text, document and/or library scope. |
| GET | `/api/cms/pm/v1/products` | `pm:read` / `cms.content.read` | Products only. |
| GET, PATCH | `/api/cms/pm/v1/products/:id` | read / `pm:write` | The PATCH also accepts unwrapped values. |
| PATCH | `/api/cms/pm/v1/payload?locale` | `pm:payload` / `cms.seo.write`; 120/min | Store a compiled head payload. |

The brand, structured-data policy, SEO field overrides and robots/sitemap extras are written through the generic settings endpoint (`cmsApi.updateSiteSettings`, see 10) with `cms.settings.write`.

---

## 6. Admin UI

| Screen | Component | Notes |
|---|---|---|
| Media (`/admin/media`) | `MediaLibrary` | `cms.media.read` to view. `canWrite` (`cms.media.write`) shows upload, delete and the alt-text editor. Features: search, "Load more" (rebuilds pages rather than fetching only the tail), copy uuid, duplicate notice. |
| Media alt text | `MediaAltText` | Inline textarea (max 512) with Save and a status line (`altTextStatus`: Saving / Not saved / Unsaved / Saved). Read-only text without write permission. |
| Image fields | `fields/MediaPicker` | Used by every `f.image()`, including the SEO social image and the brand images. It has a modal grid and upload, and shows each tile's alt text. It stores the uuid string. |
| Document editor, SEO & AEO | `SeoPanel` | Full-width tabs (General / Social / AEO / Advanced) with per-tab filled counts. `column` fields bind to document state (`SeoColumns`), and `data` fields go through `FieldInput`. `CharCounter` shows the soft length targets. |
| SEO (`/admin/seo`) | `SeoManager` | Three tables with search and "show more": **Redirects** (numbered in match order, with toggle-active, edit-target, delete and `STATUS_CODE_HELP` for 301/302/307/308), the **404 monitor** (redirect to `/` + ignore, toggle ignore, delete) and **Per-path meta overrides** (form: path, locale, title, description, robots, canonical, ogImage). |
| Settings → Fields → SEO & AEO | `SeoFieldsManager` | Relabel (per locale), redescribe, reorder, move tab, disable, require (`data` fields only), per-collection disable, and add extras (kinds exclude `relation`). Saves `cms.seoFields`. |
| Settings → Branding | `BrandSettings` | Identity, socials, logo, dark logo, favicon and OG image pickers, and the palette with WCAG contrast warnings (`contrastRatio`) and a live mock. Saves `brand.identity` + `brand.palette`. |
| Settings → Structured data | `StructuredDataSettings` | Business type + price range. One card per available category (`availableSchemaCategories`) with type, breadcrumbs, append FAQ, and the parts from `partsFor(category, type)`. Saves the **whole** policy, hidden categories included. |
| Settings → Connect to Praion.ai | `ApiTokensManager` | Only shown with `modules.pm` on and `cms.tokens.manage` (see 05). |

---

## 7. Configuration

| Setting | Where | Effect |
|---|---|---|
| `CMS_UPLOAD_DIR` | env | Upload directory. Default `<cwd>/.data/uploads`. Must be persistent and shared across instances. |
| `NEXT_PUBLIC_SITE_URL` | env, **build time** | `SITE_URL`: canonical origin, `metadataBase`, JSON-LD ids, sitemap URLs. Falls back to `brand.url` in `site.brand.ts`. |
| `config.productionOrigin` | `site.config.ts` (`brand.url`) | `robots.ts` production gate, and the PM `production_host` flag. |
| `config.brand` | `site.config.ts` ← `site.brand.ts` | Brand defaults when the database has none. |
| `modules.pm` | `site.config.ts` + runtime Modules toggle | Enables the bridge. |
| `config.pm.archives` | `site.config.ts` | Archive types → paths exposed to PM. |
| collection `seo` (default true) | collection definition | Adds the SEO group, the SeoPanel and the SEO columns. |
| collection `unpublishRedirect` | collection definition | Auto-redirect on unpublish. |
| collection `pmPageType`, `pmFieldMap`, `pmGroup`, `pmDescription` | collection definition | PM exposure. |
| `UPLOAD_MAX_WIDTH/HEIGHT`, `UPLOAD_WEBP_QUALITY`, `UPLOAD_AVIF_QUALITY`, `UPLOAD_AVIF_EFFORT`, `UPLOAD_MAX_PIXELS` | `core/media/normalize.ts` | Code constants, not settings. |
| `MAX_BYTES` (10 MB) | `app/api/cms/media/upload/route.ts` | Upload cap. |
| `CMS_CACHE_REVALIDATE` | `core/cache.ts` | TTL for cached redirects, meta and PM payloads (on top of tag revalidation). |

Cache tags: `cms:seo-redirects`, `cms:seo-meta`, `cms:pm-payload` (plus `cms:pm-payload:<path>`), and `cms:settings` (brand, schema policy, SEO field overrides, robots/sitemap extras).

---

## 8. Extending

### Recipe: emit JSON-LD for a new page type

1. **If it belongs to an existing category** (such as a new page-like collection), call `documentStructuredData` with that category key. Otherwise add a category to `SCHEMA_CATEGORIES` in `core/structured-data/policy.ts`: add the key to `SCHEMA_CATEGORY_KEYS`, and give it `collection`, `module?`, `types` (the first is the default) and `parts`. `schemaPolicySchema`, `parseSchemaPolicy`, the admin cards and the per-document `schemaType` select all derive from this list.
2. **If you need a new schema.org type**, add it to `SCHEMA_TYPES`, `TYPE_FAMILY` and `TYPE_HINTS`. A new *family* also needs an entry in `PARTS_FOR_FAMILY` and a `case` in `mainNodes()` in `nodes.ts`. Keep `nodes.ts` pure: the core must not import `@/lib/*`.
3. **In the page**:

   ```tsx
   const seo = documentSeo(doc);
   const structuredData = documentStructuredData({
     category: 'articles',
     seo,
     policy: await getSchemaPolicy(config),
     url: `${SITE_URL}${localePath(locale, `/blog/${slug}`)}`,
     locale,
     facts: { name, description, images, datePublished, dateModified, author },
     crumbs: [{ name: 'Blog', path: '/blog' }, { name, path: `/blog/${slug}` }],
   });
   return (<>
     <PmStructuredData path={`/blog/${slug}`} locale={locale} fallbackJson={structuredData} />
     …
   </>);
   ```

   Use `PmStructuredData` if the collection is PM-exposed. Otherwise render the `<script>` yourself when `structuredData` is non-null. Never `JSON.stringify` into `dangerouslySetInnerHTML`: use `jsonLd()`.
4. Add tests next to `test/cms/structured-data-nodes.test.ts` / `test/site/structured-data.test.ts`.

### Recipe: add an SEO field

- **Per site, no code.** Use Settings → Fields → SEO & AEO → add an extra. It is stored under `data.seo.<key>` and appears in the SeoPanel. You still need to read it in the page (`(doc.data as any).seo?.<key>`), because `documentSeo` only knows the built-ins.
- **As a built-in for every site:**
  1. Add a `data(...)` or `column(...)` entry to `SEO_FIELD_DEFS` in `core/seo/fields.ts`, with its tab, order (spaced by 10) and optional `counter`. Prefer `data` storage. A `column` field needs a real `documents` column (a migration, see 02), a `SeoColumn` member, the write-route zod body in `core/routes/collections.ts`, and a bespoke control in `SeoPanel`.
  2. Expose it on `DocumentSeo` in `core/seo/document.ts` with defensive parsing.
  3. Consume it in `localizedMetadata` or in `buildDocumentNodes`.
  4. If PM should write it, add a key to `PM_EDITABLE_FIELD_KEYS` (`config/pm-types.ts`), to `SEO_DATA_PATHS` / `coerceSeoValue` in `pm/write.ts`, and a `TEXT_LIMITS` entry.
  5. Update `test/cms/seo-fields.test.ts`. That test pins the built-in count.

### Recipe: add an image variant

There is no resize-variant system. One WebP (at most 1600x1200) plus an optional AVIF is stored per upload, and `media_variants` is unused. To add, for example, a thumbnail:

1. In `normalize.ts`, branch another `fitted.clone()` or a new `sharp` pipeline in `toUploadWebp`, and return it on `PreparedUpload`.
2. Give it a storage key helper next to `avifKey` in `variants.ts` (keep it `<uuid>.<suffix>` so the containment check still passes). Save it in `uploadMedia` and delete it in `deleteMedia`.
3. Decide how it is addressed: either a query or path on the file route (`/api/cms/media/file/:uuid?v=thumb`, keeping `Vary` correct), or rows in `media_variants`. Remember that `hash`, `size`, `width` and `height` on the row describe the main WebP only.
4. Existing uploads have no variant. Serve the main file as the fallback, as `readForAccept` does for AVIF.
5. Extend `test/core/media-normalize.test.ts` and `test/core/media-variants.test.ts`.

### Recipe: add a redirect

- **Editor or admin.** Use SEO → Redirects, or `POST /api/cms/seo/redirects` with `{source:'/old', target:'/new', statusCode:301, kind:'literal'}`. Remember that the source includes any locale prefix (`/en/old`).
- **From code (a seed or migration script).** Use `createRedirect(input, actorId)` from `core/seo/service.ts`. It does **not** validate. Run the same checks the route does (`redirectWouldLoop` against the active rules, internal-path target), then call `revalidateRedirects()`.
- **Automatically for a collection.** Declare `unpublishRedirect` on the collection. Slug-change redirects need no configuration.

### Other extension points

- **New storage backend.** Implement `StorageAdapter` and return it from `getStorage()`. `avifKey` keys must be supported.
- **New palette token.** Add it to `PALETTE_TOKENS` and `BASE_PALETTE`, and add the matching `--color-*` to `globals.css` `@theme`.
- **Robots/sitemap families.** Add them to `SITEMAP_FAMILIES` in `src/app/sitemap.ts`.

---

## 9. Testing

Run a single file:

```bash
npx tsx --tsconfig ./tsconfig.test.json --test test/core/media-normalize.test.ts
```

`npm test` runs every suite (see `package.json`).

| Area | Files |
|---|---|
| Media | `test/core/media-normalize.test.ts`, `test/core/media-variants.test.ts`, `test/core/media-upload-wiring.test.ts`, `test/cms/media-alt-text.test.tsx`, `test/cms/media-upload-notice.test.ts` |
| SEO fields / redirects | `test/cms/seo-fields.test.ts`, `test/cms/seo-match.test.ts`, `test/core/slug-change-redirect.test.ts`, `test/core/unpublish-redirect.test.ts`, `test/commerce/unpublish-redirect.test.ts` |
| Sitemap / robots / metadata | `test/lib/sitemap-lastmod.test.ts`, `test/cms/robots-extras.test.ts`, `test/site/brand-seo.test.ts` |
| Structured data | `test/cms/structured-data-policy.test.ts`, `test/cms/structured-data-nodes.test.ts`, `test/cms/structured-data-seo-field.test.ts`, `test/cms/structured-data-settings.test.tsx`, `test/site/structured-data.test.ts`, `test/lib/jsonld-page-guards.test.ts`, `test/lib/commerce-schema.test.ts` |
| PM | `test/cms/pm-mapping.test.ts`, `test/cms/pm-payload.test.ts`, `test/core/pm-signature.test.ts`, `test/core/pm-tokens.test.ts` |
| Brand | `test/cms/brand.test.ts`, `test/cms/brand-settings.test.tsx`, `test/cms/email-brand-colours.test.ts`, `test/site/brand-leak.test.ts` |
| Settings shapes | `test/cms/structured-settings.test.ts`, `test/cms/settings-schema.test.ts` |
| Stats | `test/core/stat-counters.test.ts` |

Most of the logic under test is in pure modules (`normalize`, `variants`, `match`, `fields`, `field-overrides`, `document`, `policy`, `nodes`, `mapping`, `jsonld`, `brand/policy`, `plan*Redirect`). `mediaUpdateRoute` takes injectable deps (`MediaUpdateDeps`) so it can be tested without a database. There is no dedicated test for `routes/seo.ts` (the ReDoS and URL checks) or for `pm/write.ts`/`alts.ts` beyond `__testables`.

---

## 10. Gotchas and invariants

- **Never trust `File.type`.** Types come from `sniffMime`. SVG is refused by design. Do not add it without a sanitiser.
- **Every stored image went through sharp.** Do not add an upload path that bypasses `uploadMedia`, or EXIF and oversized files return.
- **`media_files` describes the WebP.** The AVIF has no row. `hash` is taken after normalisation, so changing the encoder settings changes every future hash, and a re-upload of an old file will no longer be detected as a duplicate of a pre-change row.
- **Deleting media does not check usage.** `media_usages` is unused, so deleting a file referenced by documents, the brand or `og_image_uuid` leaves broken images and no warning.
- **Media list page size.** `mediaPageLimit(limit)` decides the page size (default 200, max 500). `listMedia` and the `pageSize` that `mediaListRoute` reports both use it; do not compute either on its own.
- **The first matching redirect by `id` wins**, and redirects run before i18n on the prefixed path. A rule whose source is a live page's path hides that page. The auto-redirect modules remove their own such rules, but admin rules are never removed automatically.
- **Regex redirects run synchronously on every request.** Keep the write-time checks, and the 256-character subject cap in `redirectMatches`.
- **`upsertMeta` is whole-row.** Any partial writer must use `patchMeta`. The admin save (`POST /api/cms/seo/meta`) uses `patchMeta`: fields the form sends (an explicit `null` included) are written, and fields it omits — `ogTitle`/`ogDescription`, which PM writes — are left alone.
- **`canonical_path` is not the canonical override.** It is the unique routing index. The editor's canonical is `data.seo.canonicalUrl`.
- **`SITE_URL` and the robots production gate are build-time.** A staging build pointed at the production URL will be indexable.
- **The 404 monitor.** `[slug]`, `shop/[slug]` and the `[...rest]` catch-all call `log404` with the unprefixed path plus the locale. A new public route that redirects to the not-found page must call it too.
- **Per-path SEO rows are keyed unprefixed + locale.** `seo_meta` and `pm_head_payloads` are read with the path as the main language spells it (`/foo` + `en`), never the public URL (`/en/foo`). Writers that start from a `canonicalPath` must pass it through `localeKeyedPath` (`core/seo/locale-path.ts`); the PM payload route and `pm/write.ts` do. Lookups also accept the prefixed form (`localeKeyedPathCandidates`) so rows written before this was fixed still resolve; the unprefixed row wins when both exist.
- **PM slug changes rely on `updateDocument`.** It recomputes `canonical_path` and writes the 301 (`applySlugChangeRedirect`). Do not add a second redirect writer in the bridge. Legacy `literal` rules with `notes: 'PM bridge: slug change'` may still exist from before.
- **`speakable` needs marked elements.** See 4.8. It targets `data-speakable="headline"` / `"summary"`; a site template without them gets no effect. The `answers` category offers the toggle, but its default FAQPage type ignores it.
- **`media_files.alt_text` is not a render-time fallback yet.** See 4.3.
- **`pm_head_payloads.alternates` is stored and never rendered.** `ping` reports `alternates: false`. Keep the capability flags honest when you change rendering.
- **JSON-LD escaping.** Site graphs use `jsonLd`/`structuredDataJson` (which escape `<`). Operator or PM JSON uses `safeJsonLd` (which escapes `< > &` and U+2028/9). A pasted `schemaOverride` goes through `jsonLd`. Keep `<` escaping on every path.
- **Brand fallback is all-or-nothing.** If the stored `brand.identity` fails validation (for example after a schema change), the whole identity falls back to `site.brand.ts`. The palette is per token.
- **Docs referenced in code are missing.** `docs/PM_BRIDGE_SPEC.md` and `docs/PM_CONTENT_TYPES.md` are cited in `modules/pm/index.ts` and `routes/seo.ts` but are not in the repo.
