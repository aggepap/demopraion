# 03 · Content model: collections, fields, documents & the read layer

This guide covers how content is declared and stored, and how it is read. It starts with the collection and field DSL (`src/cms/config/*`) and the zod validator built from it. It then covers the generic `documents` store and its write path (`src/cms/core/documents`), and admin-defined custom fields (`src/cms/core/fields`). After that come the public cached read layer (`src/cms/core/read`) and how site routes use it. The remaining sections cover rich text and MDX bodies, shortcodes, markdown import, draft preview, edit locks, and the generic `/api/cms/[collection]` routes. It does not cover the SEO block, structured data or media storage (see 06), permissions and sessions (see 05), or commerce and booking collections beyond the fact that they use the same machinery (see 08 and 09).

Related guides: [01-architecture.md](01-architecture.md) · [02-database.md](02-database.md) · [04-admin-ui.md](04-admin-ui.md) · [05-auth-users-security.md](05-auth-users-security.md) · [06-media-seo-structured-data.md](06-media-seo-structured-data.md) · [07-forms-email-marketing.md](07-forms-email-marketing.md) · [08-commerce.md](08-commerce.md) · [09-booking.md](09-booking.md) · [10-settings-cron-operations.md](10-settings-cron-operations.md)

---

## 1. File map

| Path | Role |
|---|---|
| `src/site.config.ts` | **The site's collection declarations** (`defineConfig({...})`). It is site code: it imports the core, and the core never imports it. |
| `src/cms/config/index.ts` | Public barrel for the config API (`f`, `defineCollection`, `defineConfig`, `taxonomyCollection`, `buildDataSchema`, types). |
| `src/cms/config/collection.ts` | `CollectionDefinition`, `ResolvedCollection`, `defineCollection`, `resolveCollection` (defaults), `isReservedSlug`, `listingPathOf`. |
| `src/cms/config/fields.ts` | The `Field` discriminated union, the `f.*` builders, `walkFields`, `fieldAt`, `groupPartOrder`, `isFieldVisible` / `visibleFields` (`showIf`). |
| `src/cms/config/zod.ts` | `buildDataSchema(fields, locales, { enforceRequired })`, the single validator for `documents.data`. |
| `src/cms/config/taxonomy.ts` | `taxonomyCollection()`, a preset for category collections. |
| `src/cms/config/config.ts` | `defineConfig` (validates the whole config at module load), `ModuleFlags`, `FieldResolver`, collection URL aliases. |
| `src/cms/core/content/` | Reusable collection presets: `brand.ts` (`brandCollection`), `testimonial.ts` (`testimonialCollection`), plus `localized.ts` (`localizedText`, `localizedValue` for reading `localized` values). |
| `src/cms/core/fields/definitions.ts` | Admin-defined custom fields: sanitising, `visibleCustomFields`, compiling them into a `custom` group. |
| `src/cms/core/fields/resolve.ts` | `resolveCollectionWithCustomFields` / `mergeCustomFields`. This is the one path that turns config plus runtime (field resolver, SEO group, custom fields) into the field set used by the form **and** the validator. |
| `src/cms/core/fields/mdx-guard.ts`, `mdx-validate.ts` | The MDX "data, not code" guard (pure tree check) and its write-path enforcement (`assertMdxSafe`). |
| `src/cms/core/fields/month-day.ts` | `MM-DD` helpers (`monthDayToInt`, overlap checks for `noOverlap`). |
| `src/cms/core/documents/service.ts` | CRUD, versioning, listing, title derivation and path resolution (`createDocument`, `updateDocument`, `deleteDocument`, `restoreVersion`, `listDocuments`, `listDocumentGroups`, `resolvePath`, `deriveDocumentTitle`). |
| `src/cms/core/documents/relations.ts` | `syncDocumentRelations`, which mirrors top-level relation fields into `document_relations`. |
| `src/cms/core/documents/publish-rights.ts`, `live-status.ts` | Rules for when a write needs `cms.content.publish`. |
| `src/cms/core/documents/publish-scheduled.ts` | `scheduled` → `published` promotion (cron plus admin screens). |
| `src/cms/core/documents/preview-target.ts` | `previewTargetFor`, which picks the variant "Preview draft" opens. |
| `src/cms/core/read/` | Public cached reads (`documents.ts`), cache tags (`tags.ts`), purge helpers (`revalidate.ts`), and the visibility rule (`visibility.ts`). |
| `src/cms/core/cache.ts` | `CMS_CACHE_REVALIDATE = false`: tag invalidation only, no time-based expiry. |
| `src/cms/core/routes/collections.ts` | Route factories for the generic collection API. |
| `src/cms/core/routes/import.ts` | Route factories for the markdown template and import parser. |
| `src/cms/core/import/` | `.md` import: `frontmatter.ts` (YAML split), `coerce.ts` (frontmatter → field values), `parse.ts` (`parseDocumentMarkdown`), `template.ts` (`buildImportTemplate`). |
| `src/cms/core/shortcodes/` | Grammar (`parse.ts`), registry and validation (`registry.ts`), the list of shipped shortcodes (`all.ts`). |
| `src/cms/core/locks/` | Edit locks: pure policy, keys, wire protocol, DB service, route factories. |
| `src/cms/realtime/lock-server.mjs` | The WebSocket relay sidecar (`npm run locks`). |
| `src/cms/core/slug.ts` | `slugify` (Greek-aware transliteration), used by import. |
| `src/app/api/cms/[collection]/**` | Thin route files that bind `site.config` to the core factories. |
| `src/app/api/cms/preview/**` | Draft Mode on/off. |
| `src/app/api/cms/locks/**` | Lock gateway, heartbeat, relay release. |
| `src/app/admin/(shell)/[collection]/{page,new/page,[id]/page}.tsx` | Admin list, create and edit screens. |
| `src/cms/admin/DocumentForm.tsx`, `DocumentList.tsx`, `VersionHistory.tsx`, `ImportMarkdownDialog.tsx` | Admin form, list, history and import UI. |
| `src/cms/admin/fields/` | Field editors (`FieldInput.tsx` dispatch, `RichTextEditor`, `MdxBodyEditor`, `RelationPicker`, `TermPicker`, `MediaPicker`, `VariationsEditor`, `InsertShortcodeDialog`), plus `mdx/` (toolbar actions, snippet builder, preview state machine). |
| `src/cms/admin/locks/` | Client side of edit locks (`EditLockProvider`, `useEditLock`, `EditLockBanner`). |
| `src/lib/cms/resolve-doc.ts` | `resolveRenderDoc(type, slug, locale)` returns the published doc, or the draft when Draft Mode is on. |
| `src/lib/cms/collection-route.ts` | `resolveAdminCollection`, which maps admin URL segments (including aliases like `pages`) to a collection. |
| `src/lib/cms/mdx-allowlist.ts`, `src/mdx-components.tsx`, `src/components/cms/MdxRuntime.tsx`, `src/lib/cms/mdx-preview.tsx`, `src/app/admin/actions/mdx-preview.ts` | Site-side MDX rendering and admin preview. |
| `src/components/cms/RichText.tsx`, `Shortcode.tsx`, `src/shortcodes/index.tsx` | Public TipTap renderer, the shortcode renderer, and the site's shortcode → component map. |
| `src/lib/site/content.ts`, `content-query.ts`, `authors.ts` | Presenters for content collections (article, answer, scenario, categories, authors) and listing search and paging. |

---

## 2. Data model

### 2.1 Tables

Every document of every collection is one row in `documents`. Collection-specific fields live in the `data` JSON column. Adding a collection or a field needs **no migration**. Schema: `src/cms/db/adapters/mysql/schema/documents.ts`. For migrations and adapters, see 02.

**`documents`**

| Column | Notes |
|---|---|
| `id` | int PK. |
| `type` | Collection key (`varchar(64)`). |
| `slug` | `varchar(191)`. Unique per `(type, slug, locale)` (`uniq_documents_type_slug_locale`). |
| `locale` | `varchar(8)`. Must be in `config.locales` (`assertLocale`). |
| `status` | enum `draft` \| `published` \| `scheduled` \| `archived` (`documentStatusValues`). Default `draft`. |
| `published_at`, `scheduled_for`, `modified_at` | `modified_at` is the hand-authored editorial revision date (JSON-LD `dateModified`, sitemap lastmod). It falls back to `published_at`. |
| `translation_group_id` | uuid shared by the locale variants of one logical document. `createDocument` always assigns one (`crypto.randomUUID()`) unless given one. |
| `meta_title`, `meta_description`, `canonical_path`, `noindex`, `nofollow`, `include_in_sitemap`, `og_image_uuid` | SEO block (see 06). `canonical_path` is **globally unique** (`uniq_documents_canonical_path`). |
| `data` | JSON, validated by `buildDataSchema` on every write. |
| `created_by`, `updated_by`, `created_at`, `updated_at` | `updated_at` is `ON UPDATE NOW()`. |

**`document_versions`**: `(document_id, version)` unique, `snapshot` JSON (all editable columns plus `data`, see `editableSnapshot`), optional `label`, `created_by`. Deleted with the document by FK cascade.

**`document_relations`**: `from_id`, `to_id` (both FK cascade), `field_key`, `position`. Unique on `(from_id, to_id, field_key)`. This is a **reverse index** derived from `data`. The source of truth is the id(s) stored in `data[fieldKey]`.

**`editing_locks`** (migration `0015_groovy_taskmaster.sql`): `resource_type`, `resource_key` (unique pair), `user_id`, `user_name`, `session_id`, `connection_id`, `acquired_at`, `heartbeat_at`, `expires_at`.

Custom field definitions and SEO field overrides are not tables. They are JSON settings rows: `cms.customFields` and `cms.seoFields` (`src/cms/core/settings/schema.ts`).

### 2.2 Collection definition (`CollectionDefinition`)

| Option | Default | Meaning |
|---|---|---|
| `key` | required | Becomes `documents.type`. Must match `/^[a-z][a-z0-9_]*$/` and be unique (`defineConfig`). |
| `label`, `labelPlural` | `key` | String or per-locale map. |
| `icon` | none | Sidebar icon, typed `IconName` (one of `ICON_NAMES` in `src/cms/admin/ui/icon-names.ts`). |
| `fields` | required | `Field[]`. |
| `titlePath` | guess | Dot path to the display title. It may point at a group, whose parts are joined in declared order. Without it: `title`, `name`, `question`, `label`. |
| `routing.pathTemplate` | none | Public path, e.g. `/blog/{slug}`. Omit it for collections with no own page. Only `{slug}` is interpolated by `resolvePath`, even though the type comment mentions other placeholders. |
| `routing.reservedSlugs` | `[]` | Slugs refused on write because a static route owns them (e.g. `categories`). |
| `unpublishRedirect` | none | `{ taxonomyField, fallbackPath, termPathTemplate? }`. Needs `pathTemplate` and a top-level relation field. Behaviour is covered in 06. |
| `seo` | `true` | Emit the SEO columns and append the shipped SEO/AEO field group (`data.seo`, see `withSeoGroup`). |
| `drafts` | `true` | Declared, but no code reads it. Every collection is versioned and has statuses. |
| `singleton` | `false` | Declared and passed to the sidebar summary, but no singleton editing mode is implemented in the admin screens. |
| `hidden` | `false` | Hidden from the admin sidebar and dashboard. The collection can still be reached through the API. |
| `module` | none | Module flag gating the collection in the admin (e.g. `commerce`). The generic `/api/cms/[collection]` routes do **not** check it. |
| `advisories` | none | Key into `src/cms/admin/advisories.ts` for client-side, non-blocking cross-field checks. |
| `sections` | none | `SectionDefinition[]` (`title`, `collapsed`, `description`) for form cards. It also lets a sectioned repeater join its section's card. |
| `pmPageType`, `pmFieldMap`, `pmGroup`, `pmDescription` | none | Product Manager bridge exposure (see 10). `pmFieldMap` paths are checked against the field tree at load. |

`resolveCollection` applies the defaults and yields a `ResolvedCollection`. This is plain, serialisable data, so it is passed to client components as a prop (`src/cms/admin/shared.ts`). Do not pass the whole `CmsConfig` to the client: it contains `Map`s.

### 2.3 Field reference

All fields share `BaseField`:

| Option | Meaning |
|---|---|
| `key` | Object key in `data`. `/^[a-z][a-zA-Z0-9_]*$/`, unique per level. |
| `label` | String or per-locale map. |
| `required` | Enforced **only when the document goes live** (`published`/`scheduled`). See §4.2. |
| `localized` | Stores `{ [locale]: value }`. Under zod v4 the map must contain **every** configured locale (see §10). |
| `shared` | Top-level only. The form copies the value to every locale row of the translation group on save. |
| `description` | Help text shown behind the "i" next to the label. `test/cms/field-help-content.test.ts` requires one on owner-facing fields. |
| `section` | Form card name. A UI hint only. |
| `hidden` | Not rendered, but still stored and validated (e.g. auto ids). |
| `showIf` | `{ field, equals }` or an array of them (AND). Compares against a **sibling** at the same level only. Hidden values are kept, and hidden fields are never required. `isFieldVisible` is the one implementation used by the zod builder, the form and the renderer. |

Field kinds (`FieldKind`), their builders, options, stored value and validator (`scalarSchema` in `zod.ts`):

| Kind | Builder | Extra options | Stored value | Validation |
|---|---|---|---|---|
| `text` | `f.text(key, opts)` | `minLength`, `maxLength`, `pattern` (regex source string), `default` | string | `z.string()` + bounds + regex. A required field is non-empty when live. |
| `textarea` | `f.textarea` | `minLength`, `maxLength`, `rows`, `default` | string | as `text`, no pattern |
| `richText` | `f.richText` | none | TipTap JSON `{type:'doc', content:[…]}` | top-level shape only, `content` ≤ 10,000 nodes. An empty doc passes `required`. |
| `code` | `f.code` | `language`, `rows`, `default`, `allowedComponents`, `componentPalette` | string | `z.string()`, plus `assertMdxSafe` when `language: 'mdx'` |
| `code` (MDX) | `f.mdx(key, opts)` | same, with `language: 'mdx'` preset | MDX source | parsed with `@mdx-js/mdx` and checked by the guard on every write |
| `number` | `f.number` | `min`, `max`, `integer`, `default`, `countWordsFrom`, `boundsFrom: {min?, max?}` | number | `z.number()` (`.int()`), static bounds only. `boundsFrom` is an admin input aid, not enforced. |
| `boolean` | `f.boolean` | `default` | boolean | `z.boolean()` |
| `select` | `f.select(key, { options })` | `options: {value, label?}[]`, `multiple`, `default` | string or string[] | `z.enum(values)`. Multi has at most `options.length` entries. |
| `date` | `f.date` | `withTime`, `default` | ISO date/datetime string | `Date.parse` refine. `required` is **not** checked for non-empty (ZodEffects). |
| `monthDay` | `f.monthDay` | `default` | `MM-DD` or `''` | regex `^$|MONTH_DAY_PATTERN`. `required` enforced when live. |
| `color` | `f.color` | `default` | `#rrggbb` | regex |
| `image` | `f.image` | none | `media_files` uuid | `z.string().uuid()`. `''` is accepted and dropped unless required and live. |
| `relation` | `f.relation(key, { to })` | `to` (collection key, checked at load), `many`, `picker: 'default' \| 'categoryTree' \| 'termList'`, `pickerNoun` | document id or ordered id[] | positive int(s), at most 500 |
| `repeater` | `f.repeater(key, fields, opts)` | `min`, `max`, `itemLabel`, `autoId`, `noOverlap: {from, to}`, `summaryTemplate`, `inlineFields` | object[] | strict object per row. `min`/`max` enforced, default ceiling 500. |
| `group` | `f.group(key, fields, opts)` | `strict` (default `true`; `false` strips unknown keys) | object | strict object unless `strict: false` |
| `variations` | `f.variations(key, { attributesKey })` | `attributesKey` (default `attributes`) | `{id, options, sku?, price?, stock?, image?, enabled?, weight?}[]` | fixed strict schema (see 08) |

Unknown keys at any strict level are rejected. That includes top-level `data` keys the config does not declare.

`f.relation` with `picker: 'categoryTree'` creates new terms with `data.parent`. Only use it against collections that have a `parent` field (e.g. `taxonomyCollection({ hierarchical: true })`). Otherwise use `termList`.

### 2.4 Where the site's collections are declared

`src/site.config.ts` in this repository (the CMS base) registers:

| Collection | Source | Routing |
|---|---|---|
| `page` | inline `defineCollection` (title, `richText` body, hero image) | `/{slug}` → `src/app/[locale]/[slug]/page.tsx` |
| `brand` | `brandCollection()` (`seo: false`) | none (used by `[brands]`) |
| `testimonial` | `testimonialCollection()` | none (used by `[testimonials]`) |
| `popup` | `popupCollection()` (module `popups`) | none |
| `category`, `size_chart`, `tag`, `product` | `src/cms/modules/commerce` (module `commerce`) | see 08 |
| `booking_category`, `vessel_type`, `departure_location`, `booking` | `src/cms/modules/booking` (module `booking`) | see 09 |

`fieldResolvers: { booking: bookingFieldResolver }` is a per-request field adjustment (see §4.3).

The editorial collections (`article`, `answer`, `scenario`, their `<type>_category` taxonomies, and `author`) are **not** in this repo's `site.config.ts`. The new-site skill generates them into a client site's config (`.claude/skills/new-site/scripts/generate.mjs`, `ARTICLE_DEF`/`ANSWER_DEF`/`SCENARIO_DEF`/`AUTHOR_DEF`), together with their routes (`templates/content/*.tpl`). All of them use `richText` bodies, not MDX. Base code that consumes them (`src/lib/site/content.ts`, `authors.ts`, `content-query.ts`) is shipped to every site.

---

## 3. How it works

### 3.1 Config load

`defineConfig(input)` in `config.ts` runs when `site.config.ts` is imported and throws `ConfigError` for:

- empty or invalid `locales` or `defaultLocale`;
- a bad or duplicate collection key, a bad field key, or duplicate sibling keys;
- a relation `to` pointing at an unknown collection;
- an invalid `unpublishRedirect`, `pmPageType`, `pmFieldMap` or `pm.archives`;
- an invalid `storagePrefix` or `productionOrigin`.

It returns `CmsConfig` with `collectionByKey` (a Map), `collectionKeyByAlias` (plural and label spellings → key, used by `resolveAdminCollection` to redirect `/admin/pages` → `/admin/page`), merged `modules` (defaults in `DEFAULT_MODULES`), and `fieldResolvers`.

### 3.2 The effective field set

Never validate or render a document against `config.collectionByKey.get(key).fields` alone. The effective set comes from `mergeCustomFields` (`src/cms/core/fields/resolve.ts`), which runs these steps in order:

1. **Field resolver.** Applies `config.fieldResolvers[key](fields, { data })` if one exists. It can hide or adjust fields based on settings and the document being written.
2. **SEO group.** `withSeoGroup` appends the `seo` group built from the shipped SEO/AEO fields plus the `cms.seoFields` overrides. This only runs when `collection.seo` is true and no code field is keyed `seo`.
3. **Custom fields.** Appends the admin-defined ones (`cms.customFields[key]`), compiled as `f.group('custom', …, { shared: true, strict: false })`. Only definitions visible for the document's `categories` ids keep `required`. On a version restore, `relaxRequired: true` drops `required` from all of them.

The admin screens (`new/page.tsx`, `[id]/page.tsx`) and the write routes (`writeCollection` in `routes/collections.ts`) both go through this function. That is why the form and the validator agree. The seed CLIs call `createDocument` without `opts.collection` and so validate against the static config only.

### 3.3 Write path (`createDocument` / `updateDocument`)

```
route (createRoute: same-origin, guard, zod body)
  → requirePublishRights(input, before)            // cms.content.publish when going live OR going dark
  → assertNotLockedByOther('document', key, user)  // update/delete/restore, and create-into-existing-group
  → writeCollection(config, key, data)             // mergeCustomFields
  → createDocument/updateDocument(config, …, { collection })
        assertLocale, assertSlugAvailable (reservedSlugs)
        [update] expectedVersion check → 409 conflict
        validateData(buildDataSchema(fields, locales, { enforceRequired: goesLive(status) }))
        assertMdxSafe(fields, data)                // only when data is in the payload
        transaction {
          insert/update documents row
          syncDocumentRelations                    // delete + reinsert top-level relation links
          writeVersion                             // version = max+1, snapshot
          applyUnpublishRedirect (update only)     // see 06
          applySlugChangeRedirect                  // see 06
        }
        revalidateRedirects() if a redirect changed
  → revalidateDocument(row) (+ old row if canonicalPath changed)
  → logAudit('document.create' | 'document.update' | …)
```

Key rules in `service.ts`:

- **Required only when live.** `goesLive(status)` is `status === 'published' || 'scheduled'`. A bare status change from draft to live, with no `data` in the patch, re-validates the stored `data` with `enforceRequired: true`.
- **Validation errors** throw `invalidInput({ ...flatten(), pathErrors })`. `pathErrors` is keyed by full dot path (`header.eyebrow`, `toc.0.label`), and messages use the field label (`humanizeIssue`). The form places each message under the matching control.
- **`canonicalPath`** is computed on create only, from `resolvePath(collection, slug, locale, defaultLocale)`. Non-default locales are prefixed `/{locale}`. On update it changes only if the patch sends `canonicalPath` (see §10).
- **`publishedAt`** is set to now when the status first becomes `published` and none is set. It is never cleared.
- **Optimistic concurrency.** The version number (`documentVersionNumber`) is the token. The form sends `expectedVersion`, and a mismatch is `409 conflict`. Seed CLIs omit it.
- **Delete** removes the row. Versions and relations cascade.

### 3.4 Statuses

| Status | Public? | Notes |
|---|---|---|
| `draft` | no | Required fields not enforced. |
| `published` | yes | |
| `scheduled` | yes once `scheduledFor <= now` (`isDocumentVisible`) | The API refuses `scheduled` without `scheduledFor` (`SCHEDULE_WITHOUT_DATE`, checked against the effective row on PATCH). |
| `archived` | no | Triggers a 301 unpublish redirect when configured. |

`publishDueScheduled` (`publish-scheduled.ts`) rewrites due `scheduled` rows to `published`, with `publishedAt = publishedAt ?? scheduledFor`. It uses one conditional UPDATE, deliberately **without** writing a version (so an open editor's `expectedVersion` stays valid), and writes an audit row per document (`actorLabel: 'scheduler'`) before purging the caches. It runs from:

- the cron job `content-publish-scheduled` (`src/app/api/cms/cron/[job]/route.ts`, see 10);
- `promoteDueScheduled(key)` at the top of the admin list and edit pages.

### 3.5 Translations

One logical document is a set of rows sharing `translation_group_id`, one per locale. The admin edit screen loads the whole group (`getDocumentGroup`) and shows one tab per locale: the editable locales plus any locale that already has a row. When you save a tab:

- An existing row gets a PATCH. A new locale gets a POST with the group's `translationGroupId`, which attaches the row to the group.
- If the slug changed or the collection has `shared` fields, the form then PATCHes each sibling row. The body carries the new `slug`, the sibling's full `data` merged with the shared keys, and the sibling's own `expectedVersion`. A 409 there is shown as a warning, not as a failed save (`DocumentForm.tsx`, `submit`).
- The slug is conventionally identical across a group, but only the form keeps it that way. The unique key is per locale.

Taxonomy terms (`taxonomyCollection`) are the exception. There is **one row in the default locale** with `localized` title and description, so posts in every language point at the same term id.

### 3.6 Relations

A relation value is stored in `data` as an id or id[]. `syncDocumentRelations` rebuilds `document_relations` for the row on every create and update, inside the write transaction. **Only top-level relation fields are indexed.** Relations inside groups and repeaters are validated and stored but have no reverse index (`relations.ts`, "Phase 1"). Relations point at a specific row id, i.e. a specific locale variant. A term is one default-locale row, so this matters for authors, which exist per locale. `articlesByAuthor` handles that by matching against the author's ids in every locale.

### 3.7 Public read layer

`src/cms/core/read/documents.ts`, exported from `@/cms/core` and `@/cms/core/read`:

| Function | Cached | Tags | Behaviour |
|---|---|---|---|
| `getPublishedDocument(type, slug, locale)` | `unstable_cache` key `['cms-doc', type, slug, locale]` | `cms:type:{type}`, `cms:doc:{type}:{locale}:{slug}` | Visible row or null. Returns null (uncached) if the DB throws. |
| `getPublishedByPath(canonicalPath)` | `['cms-path', path]` | `cms:path:{path}` | By `canonical_path`. |
| `listPublishedDocuments(type, locale, { limit })` | `['cms-list', type, locale, limit]` | `cms:type:{type}` | Newest `publishedAt` first. `limit` defaults to 200 (max 1000) and is applied **before** the visibility filter. Returns `[]` on error. |
| `listPublishedByRelation(type, fieldKey, targetId, locale, { limit })` | `['cms-list-by-relation', …]` | `cms:type:{type}` | Joins `document_relations` and filters status in SQL. |
| `loadRelatedDocuments(fromId, fieldKey)` | **no** | none | Rows linked from `fromId` in `position` order, any status and any locale. Filter by status yourself. |
| `getDocumentPreview(type, slug, locale)` | **no** | none | Any status. Only for Draft Mode. |

Visibility (`isDocumentVisible`): `published`, or `scheduled` with `scheduledFor <= now`. `scheduledFor` is coerced with `new Date()` because an `unstable_cache` hit returns strings.

Invalidation: `revalidateDocument(row)` purges the type tag, the doc tag and the path tag (`revalidateTag(tag, { expire: 0 })`). It is a no-op outside a request context (seed CLIs). The collection routes call it after create, update (for both the new row and, if the path changed, the old one), restore and delete. The scheduler calls it after promotion. `CMS_CACHE_REVALIDATE` is `false`, which means **no time-based refresh**. `src/cms/core/cache.ts` explains why: a 300-second timer caused ISR regeneration outages.

### 3.8 Site consumption

- **Detail pages** call `resolveRenderDoc(type, slug, locale)` (`src/lib/cms/resolve-doc.ts`). It returns `getDocumentPreview` when `draftMode().isEnabled`, and `getPublishedDocument` otherwise. `src/app/[locale]/[slug]/page.tsx` is the reference implementation:
  - `export const dynamic = 'force-dynamic'`;
  - `generateMetadata` uses `documentSeo(doc)` and `localizedMetadata`;
  - a missing doc runs `log404` and then `redirect(pageNotFoundPath(locale))` (no `notFound()`, see the comment in `[...rest]/page.tsx`);
  - it renders `<AdminEditTarget doc={doc} />` for the admin bar and `documentStructuredData` for JSON-LD;
  - the body goes through `<RichText value={data.body} />`.
- **Listings** (generated `templates/content/index-page.tsx.tpl`) read `listPublishedDocuments(type, locale, { limit: 1000 })`, or `listPublishedByRelation(type, 'categories', termId, locale, …)` when `?category=` names a live term. Each row goes through `presentEntry(type, doc)` (`src/lib/site/content.ts`), which maps each collection's field names to one `ContentEntry` shape. Then `applyContentQuery(entries, parseContentParams(searchParams))` does search and paging in memory: accent- and case-folded match on title, summary and eyebrow, `CONTENT_PAGE_SIZE = 12`, and `?page` clamped to the last page. `parseContentParams` validates `q` (≤100 chars), `category` (slug pattern) and `page`.
- **Categories**: `presentTerm(doc, locale)` resolves localized title and description and `parentId`. `buildTermTree` nests terms, promoting orphans and cycle members to roots.
- **Authors** (`src/lib/site/authors.ts`): `presentAuthorDoc(doc)` returns an `AuthorView` and keeps only absolute http(s) URLs. `authorPersonSchema` and `authorProfileNodes` build the `Person` and `ProfilePage` JSON-LD. `authorProfilePath(slug)` is `/authors/{slug}`, and `articlesByAuthor(articles, authorIds)` filters articles by author. The profile route itself is generated (`templates/content/author-page.tsx.tpl`).
- **Home blocks** (`src/components/site/HomeSections.tsx`) use `listPublishedDocuments(type, locale, { limit: 3 })`.
- **Module read layers** (`src/cms/modules/commerce/read.ts`, `booking/read.ts`, `popups/read.ts`) and shortcode components (`Brands`, `Testimonials`) are built on the same functions.
- **Reading localized values**: use `localizedText(value, locale, defaultLocale)` / `localizedValue` from `src/cms/core/content/localized.ts`. Never pass the value to `String(value)`, which prints `[object Object]`.

### 3.9 Rich text, MDX and shortcodes

**Rich text (`richText`)** is edited by `RichTextEditor` (TipTap StarterKit) and stored as JSON. `src/components/cms/RichText.tsx` renders it server-side by walking the node tree:

- supported nodes: paragraph, heading (clamped to h2–h4), lists, blockquote, codeBlock, hr, hardBreak;
- supported marks: bold, italic, strike, code, and link (the href goes through `safeHref`);
- unknown nodes render their children.

A paragraph whose plain, unmarked text is **exactly one shortcode** renders `<Shortcode>`, and `[[name]]` renders as the literal `[name]`. The editor's "+ Block" button (`InsertShortcodeDialog`) inserts the shortcode as its own paragraph of text. `RichText` also handles a structured `shortcode` node type, but nothing in the editor currently produces one.

**MDX (`f.mdx`)** fields hold source that `MdxRuntime` (`src/components/cms/MdxRuntime.tsx`) **compiles and executes** with `@mdx-js/mdx` `evaluate()`. The guard (`src/cms/core/fields/mdx-guard.ts`) allows:

- elements whose name is in the field's `allowedComponents` (no raw HTML elements at all);
- expressions that are pure data (literals, arrays, objects, untagged templates without interpolation, JSX fragments of allowed components), plus comment-only expressions.

It refuses identifiers, member access, calls, and `import`/`export`. The guard runs in two places:

1. On write: `assertMdxSafe` in `createDocument`/`updateDocument` returns a 422 with `pathErrors`. A field with `language: 'mdx'` and no `allowedComponents` allows **no** components.
2. On render: `mdxGuardPlugin` is a remark plugin inside `evaluate()`. A refused body renders `null` and logs `[cms/mdx] body refused`.

The site's allow-list is `MDX_ALLOWED_COMPONENTS` in `src/lib/cms/mdx-allowlist.ts` (currently `['Callout']`). It must equal the keys in `src/mdx-components.tsx` (`test/components/mdx-allowlist.test.tsx`). In the admin, `MdxBodyEditor` is used only when `isMdxPreviewField` holds (`language: 'mdx'` **and** `allowedComponents` set). It provides:

- a markdown toolbar (`mdx/markdown-actions.ts`, with no H1 on purpose);
- the "Insert component" palette (`componentPalette`, intersected with `allowedComponents`; snippets built by `mdx/snippet.ts`);
- a live preview through the site-supplied server action `previewMdxAction` (`src/app/admin/actions/mdx-preview.ts` → `src/lib/cms/mdx-preview.tsx` → `MdxRuntime`). The preview needs `contentRead`, is rate limited, and caps source at 512 KB. Stale replies are dropped by `mdx/preview-state.ts`.

No collection in the base config currently uses MDX.

**Shortcodes** use the grammar `[name attr="value" …]`. `parseShortcode` (`src/cms/core/shortcodes/parse.ts`):

- names are kebab-case, at most 40 chars; values at most 500 chars; input at most 2000 chars;
- the first occurrence of a duplicate attribute wins;
- `\"` escapes a quote;
- it returns `null` for anything that is not exactly one shortcode.

`SHORTCODES` (`all.ts`) is the single registry. Each entry comes from `defineShortcode({ name, label, description, module?, attrs })`. `AttrSpec` kinds are `text` (`maxLength`, `pattern`), `select` (`options`), `int` (`min`, `max`, coerced), and `boolean` (accepts `true/false/yes/no/1/0`). `resolveShortcode(registry, parsed, moduleFlags)` returns one of:

- `ok` with attrs validated by a **strict** zod object with defaults;
- `unknown`;
- `disabled` (module off);
- `invalid`.

The public `<Shortcode>` renders only `ok` results that also have an entry in the site map `SHORTCODE_COMPONENTS` (`src/shortcodes/index.tsx`), each inside its own `<Suspense>`. Everything else renders nothing.

Shipped shortcodes:

| Name | Module | Attributes | Component |
|---|---|---|---|
| `google-reviews` | `googleReviews` | layout, location, limit, min | `GoogleReviews` |
| `testimonials` | `googleReviews` | layout, limit | `Testimonials` |
| `form` | none | id, title | none (renders nothing) |
| `popup` | `popups` | id | none (renders nothing) |
| `brands` | none | layout, limit | `Brands` |
| `countdown` | none | to (ISO pattern), label, expired | `Countdown` |
| `script` | none | name (`SNIPPET_SLUG`) | `Script` |

### 3.10 Markdown import

This only applies to collections with **exactly one top-level `f.mdx` field** (`mdxBodyField`). Every other collection gets 400 from the route, and the list screen hides the "Import .md" button.

- `GET /api/cms/{collection}/import` returns `buildImportTemplate(collection, …)`: a commented `.md` template with YAML frontmatter for every field, built against the effective collection including custom fields.
- `POST /api/cms/{collection}/import` with `{ filename?, source }` (≤ 512 KB) calls `parseDocumentMarkdown` and **writes nothing**. It returns `{ collection, document: ImportedDocument, errors, warnings }`.
  - `splitFrontmatter` normalises CRLF and BOM. YAML is parsed with the `yaml` package.
  - Keys in `RESERVED_KEYS` (`collection, slug, locale, status, metaTitle, metaDescription, noindex, nofollow, includeInSitemap, publishedAt, modifiedAt, scheduledFor`) map to document columns. `REFUSED_KEYS` (`canonicalPath`, `ogImageUuid`, `translationGroup(Id)`, `id`, `type`) are errors with an explanation.
  - All other keys go through `coerceFields` (strict). The body goes into the MDX field, with a leading `# H1` stripped and a warning.
  - A `{id,label}` repeater (a "toc") is filled from `##` headings with `github-slugger` if it was not given.
  - Slug precedence: the frontmatter `slug`, then the filename (`slugFromFilename`, which also detects a locale suffix), then the slugified title. Status defaults to `draft`.
  - The schema runs twice. Without `enforceRequired`, failures are errors. The extra failures with it are warnings (what must be filled before publishing). The MDX guard also runs.
  - A `collection:` line naming a different collection is prepended as an error by the route.
- `ImportMarkdownDialog` (inside `DocumentForm`, opened automatically by `?import=1`) posts the file text and calls `applyImported`. That replaces the active tab's fields and takes the slug only if the form's slug is empty. The user then saves normally through `POST`/`PATCH`, which applies permissions, audit and validation.

### 3.11 Draft preview

`GET /api/cms/preview?redirect=/path` requires `cms.content.read`, enables Next Draft Mode, and redirects to `safeRedirectPath(redirect)`. Routes that use `resolveRenderDoc` then show the latest row regardless of status, uncached. `GET /api/cms/preview/disable` is open and turns Draft Mode off. The admin edit page builds the link with `previewTargetFor(group, ?locale, openedRow)`. It uses the `canonicalPath` of the **variant on screen** and hides the button when that locale has no row or no public path. `[locale]/layout.tsx` reads `draftMode()` to show a "leave preview" link in the admin bar (`src/lib/admin-bar.ts`). Only routes that call `resolveRenderDoc` honour preview. Listings and module read layers always show published content.

### 3.12 Edit locks

Edit locks are advisory at the UI level and **enforced on save**. The feature is entirely off unless `CMS_LOCK_INTERNAL_SECRET` is at least 32 chars (`locksEnabled()`). In that case no locks are written and `assertNotLockedByOther` never refuses.

```
browser (EditLockProvider, one WS for the admin shell)
  ⇄ wss://<site>/_ws/locks  (Nginx → lock-server.mjs, 127.0.0.1:8081)
      relay forwards each frame + the socket's Cookie → POST /api/cms/locks (gateway)
      relay heartbeats every TTL/3 → POST /api/cms/locks/heartbeat (x-cms-lock-secret)
      relay on socket close → POST /api/cms/locks/release (x-cms-lock-secret)
  app broadcasts the returned LockState to every socket in the room
```

- **Resource key.** For a document it is the translation group id, or `row:<id>` when the group id is null (`documentLockKey`, `documentLockKeyFor`). All locale tabs of a document therefore share one lock. Orders and reservations use their numeric id.
- **Policy** (`policy.ts`, pure):
  - `decideAcquire`: granted if the lock is free or expired; `renewed` if the same **user** holds it (any tab); otherwise `held-by-other`.
  - `takeover` forces the acquire and writes a `lock.takeover` audit row.
  - `decideRelease` releases only when the connection id matches (this handles the refresh race).
  - `decideWrite` is keyed on the **user id** from the session cookie, never on the broadcast `sessionId`.
- **TTL**: `CMS_LOCK_TTL_SECONDS`, default 60 and capped at 3600. `resolveTtlSeconds` treats blank, 0 or NaN as the default.
- **Server enforcement**: PATCH, DELETE, restore, and POST into an existing `translationGroupId` call `assertNotLockedByOther`. A 409 names the holder.
- **Client** (`src/cms/admin/locks/`): `useEditLock({ type, key, enabled })` and `EditLockBanner`. The state starts editable and only turns read-only on an explicit frame naming someone else. If the relay is down, editing still works. `DocumentForm` enables the lock only when editing an existing document and the user has `contentWrite`.
- The relay (`lock-server.mjs`) exits at start without the secret or `CMS_LOCK_ALLOWED_ORIGIN`/`NEXT_PUBLIC_SITE_URL`. It limits a socket to 16 rooms and 4 KB frames, and rate-limits frames with a token bucket.

---

## 4. HTTP API

All routes are built with `createRoute` (`src/cms/core/api/handler.ts`), which provides:

- a same-origin check on writes;
- the permission guard;
- a zod body/query check (`422 invalid_input` with `issues`);
- a uniform error shape `{ ok:false, error, message, issues? }`;
- duplicate-key mapping to `409 conflict` and foreign-key mapping to `422`.

Success is `{ ok:true, data }`. Lists are `{ ok:true, items, page, pageSize, total, pageCount }`.

| Method | Path | Auth / permission | Purpose |
|---|---|---|---|
| GET | `/api/cms/{collection}` | `cms.content.read` | Paginated list. Query: `page`, `pageSize` (≤100, default 25), `status`, `locale`, `search` (≤200), `grouped`. Non-grouped: rows ordered by `updatedAt` desc, search on slug and meta title (`listDocuments`). Grouped: one item per translation group with `variants[]`, and search also covers `json_extract(data, '$.<titlePath>')` (`listDocumentGroups`). |
| POST | `/api/cms/{collection}` | `cms.content.write`, plus `cms.content.publish` if `status` is live or `publishedAt`/`scheduledFor` is set | Create. Body: `slug` (trimmed, 1–191), `locale`, `status?`, `data`, SEO fields, `translationGroupId?`, `publishedAt?`, `modifiedAt?`, `scheduledFor?` (coerced dates). Returns 201 with the row. |
| GET | `/api/cms/{collection}/{id}` | `cms.content.read` | One row (404 if the type does not match). |
| PATCH | `/api/cms/{collection}/{id}` | `cms.content.write`, plus publish rights when going live **or** going from live to non-live; lock check | Partial update. `data` omitted means it is kept. `expectedVersion` (optional) gives 409 on mismatch. |
| DELETE | `/api/cms/{collection}/{id}` | `cms.content.write`, plus `cms.content.publish` if the doc is live; lock check | 204. |
| GET | `/api/cms/{collection}/{id}/versions` | `cms.content.read` | `DocumentVersionSummary[]`, newest first. |
| POST | `/api/cms/{collection}/{id}/versions/{versionId}/restore` | `cms.content.write`, plus publish rights judged from the snapshot's status and dates; lock check | Re-applies the snapshot through `updateDocument` (writes a new version). Custom fields are validated with `relaxRequired`. |
| GET | `/api/cms/{collection}/import` | `cms.content.write` | Downloads `{key}-template.md`. 400 if the collection has no single MDX body. |
| POST | `/api/cms/{collection}/import` | `cms.content.write`; rate limit 30/min/IP (`cms-content-import`) | Parses `{ filename?, source }`. No write, no audit. |
| GET | `/api/cms/preview?redirect=` | `cms.content.read` | Enables Draft Mode and redirects. |
| GET | `/api/cms/preview/disable?redirect=` | none | Disables Draft Mode and redirects. |
| POST | `/api/cms/locks` | `cms.access`, plus the per-type perm (`document` → `cms.content.write`, `order` → `ordersWrite`, `reservation` → `reservationsWrite`); 120/min/user | Lock gateway, called by the relay with the user's cookie. Body: `action` (`acquire`/`release`/`takeover`/`observe`), `resourceType`, `resourceKey`, `sessionId`, `connectionId`. |
| POST | `/api/cms/locks/heartbeat` | `x-cms-lock-secret` header | `{ connectionIds[] }` extends `expiresAt`. |
| POST | `/api/cms/locks/release` | `x-cms-lock-secret` header | Releases one resource or all locks of a connection. |
| Server Action | `previewMdxAction` | `cms.content.read`; rate-limited | MDX live preview for the admin. |

Status codes to expect:

| Code | Cause |
|---|---|
| 401 | Not signed in. |
| 403 | Missing permission or cross-origin. A refused publish returns `{ error:'forbidden', missing:'cms.content.publish', message }`. |
| 404 | Unknown collection, id, or type mismatch. |
| 409 | Stale version, lock held by someone else, or duplicate `(type,slug,locale)` / `canonical_path`. |
| 422 | Validation. `issues.pathErrors` is keyed by dot path. |

---

## 5. Admin UI

| Screen | File | Notes |
|---|---|---|
| List `/admin/{collection}` | `src/app/admin/(shell)/[collection]/page.tsx`, `DocumentList.tsx` | Runs `promoteDueScheduled` first. The server renders page 1 from `listDocumentGroups` (25 per page). Search, status filter and paging then re-fetch `GET /api/cms/{key}?grouped=1`, with the search debounced by 300 ms. Rows show `deriveDocumentTitle` and one status badge per locale. "Import .md" appears only for MDX-body collections. |
| New `/admin/{collection}/new` | `new/page.tsx` | Needs `contentWrite`. Uses the effective collection (`mergeCustomFields`). `?import=1` opens the import dialog. |
| Edit `/admin/{collection}/{id}` | `[id]/page.tsx`, `DocumentForm.tsx` | Loads the translation group, each row's version number, the custom and SEO field configs, and the preview target. The form holds per-locale state and a shared slug. `canPublish` controls which statuses are offered. Without it, updates omit the go-live fields and send only a non-live status. |
| History | `VersionHistory.tsx` | Lists versions and restores one through the restore route. |
| Custom fields | `CustomFieldsManager.tsx` (Settings) | Edits `cms.customFields`. Kinds are listed in `CUSTOM_FIELD_KINDS` (text, textarea, richText, number, select, multiselect, boolean, date, color, image, relation, repeater). Options: per-language, per-category visibility (`categoryIds`), `showOnPdp`, groups rendered as `specs`/`tab`/`hidden`. |

The form is generated from fields by `buildBlocks` (`src/cms/admin/shared.ts`) and `FieldInput` (`src/cms/admin/fields/FieldInput.tsx`):

- groups and repeaters get their own section card;
- `localized` leaves get per-locale tabs (`LocalizedField`);
- leaves dispatch on `field.kind` in `LeafControl`: `RelationPicker` (typeahead) or `TermPicker` (`categoryTree`/`termList`), `MediaPicker`, `MdxBodyEditor` or a plain monospace textarea for `code`, `VariationsEditor`, and so on.

An unknown kind renders `null` in `LeafControl`, so the field silently disappears from the form. Admin URL segments are resolved by `resolveAdminCollection`: unknown segments that match an alias redirect, everything else is a 404.

---

## 6. Configuration

| Item | Where | Effect |
|---|---|---|
| Collections, fields, locales, modules, field resolvers | `src/site.config.ts` | See §2. |
| Enabled/public locales at runtime | Admin → Settings (`getLocaleSettings`) | Decides which tabs the editor shows (`editing`) and which locales the site serves (`public`). See 10. |
| Module flags at runtime | Admin → Settings → Modules (`resolveModuleFlags`) | Overrides `modules` defaults. Affects admin visibility and shortcode `disabled` state. |
| Custom fields | `site_settings` `cms.customFields` | §3.2. |
| SEO field overrides | `site_settings` `cms.seoFields` | See 06. |
| MDX allow-list | `src/lib/cms/mdx-allowlist.ts` + `src/mdx-components.tsx` | Must match. |
| Shortcode components | `src/shortcodes/index.tsx` | Name → component. A missing entry renders nothing. |
| `CMS_LOCK_INTERNAL_SECRET` | env (≥32 chars) | Enables locks. The same value is needed by the app and the relay. |
| `CMS_LOCK_TTL_SECONDS` | env (default 60, max 3600) | Lock expiry without heartbeat. |
| `CMS_LOCK_WS_PORT`, `CMS_LOCK_WS_HOST` | env (8081, 127.0.0.1) | Relay bind. |
| `CMS_APP_ORIGIN` | env (default `http://127.0.0.1:3000`) | Where the relay forwards frames. Use 3002 in dev (`npm run dev` uses port 3002). |
| `CMS_LOCK_ALLOWED_ORIGIN` | env (falls back to `NEXT_PUBLIC_SITE_URL`) | WS `Origin` check. |
| `NEXT_PUBLIC_CMS_LOCK_WS_URL` | env (dev only) | Browser WS override. Blank means same origin plus `/_ws/locks` (`resolveWsUrl`). |
| Relay process | `npm run locks` (`node --env-file-if-exists=.env --env-file-if-exists=.env.local src/cms/realtime/lock-server.mjs`) | Run under PM2 in production, behind an Nginx `location /_ws/locks` that forwards the Upgrade. |
| Cron `content-publish-scheduled` | `src/app/api/cms/cron/[job]/route.ts` | See 10. |

---

## 7. Extending: recipes

### 7.1 Add a new collection

1. Declare it in `src/site.config.ts` and add it to `collections`:

   ```ts
   const event = defineCollection({
     key: 'event',
     label: 'Event',
     labelPlural: 'Events',
     icon: 'calendar',
     titlePath: 'title',
     routing: { pathTemplate: '/events/{slug}', reservedSlugs: ['categories'] },
     fields: [
       f.text('title', { required: true, maxLength: 255, label: 'Title', description: 'Shown as the page heading.' }),
       f.date('startsAt', { withTime: true, required: true, label: 'Starts', description: 'Local date and time.' }),
       f.image('cover', { label: 'Cover image', description: 'Optional.' }),
       f.richText('body', { label: 'Body', description: 'The event description.' }),
       f.relation('categories', {
         to: 'event_category', many: true, picker: 'categoryTree', shared: true,
         label: 'Categories', description: 'Used for filtering.',
       }),
     ],
   });
   const eventCategory = taxonomyCollection({
     key: 'event_category', label: 'Event category', labelPlural: 'Event categories',
     pathTemplate: '/events/categories/{slug}', hierarchical: true,
   });
   ```

   For taxonomies, use `taxonomyCollection`. Its terms are one row in the default locale with localized titles.
2. No migration is needed. Restart dev, because `defineConfig` validates at import time. The collection appears in the admin sidebar, and the generic API serves it immediately.
3. Give every owner-facing field a `description`, or `test/cms/field-help-content.test.ts` fails if you add the collection to its list.
4. Optionally:
   - add `unpublishRedirect` (see 06);
   - add the type to the sitemap list in `src/app/sitemap.ts` (see 06);
   - add a structured-data category (see 06);
   - add `pmPageType` for the PM bridge.
5. Render it on the public site (§7.3).
6. If this is a generated site, also mirror it in the new-site skill (`.claude/skills/new-site/scripts/generate.mjs`) when it should ship to future sites. Update `docs/CMS-FEATURES-FOR-PROPOSALS.md` per the project rule.

### 7.2 Add a new field type

Every consumer switches on `kind`, and most switches have a `default` that silently ignores unknown kinds. Touch each of these:

1. `src/cms/config/fields.ts`:
   - add the literal to `FieldKind`;
   - add an interface extending `BaseField`;
   - add it to the `Field` union;
   - add a builder to `f`.

   Export the type from `src/cms/config/index.ts`.
2. `src/cms/config/zod.ts`: add a `case` in `scalarSchema`. Return a `ZodString` if `required` should mean non-empty (only `ZodString` gets `.min(1)` in `applyModifiers`). If it stores arrays, bound them.
3. `src/cms/admin/fields/FieldInput.tsx`:
   - add a `case` in `LeafControl`;
   - if the control renders its own composite UI and label, add it to `isComposite`.
4. `src/cms/core/import/coerce.ts` (`coerceField`) and `template.ts` (`emitField`): add cases so markdown import coerces the value and documents it. Otherwise values pass through untouched and the template omits the field.
5. If it holds document references, extend `extractRelationLinks` (`src/cms/core/documents/relations.ts`) and `isRelationKind`.
6. If editors should be able to create it as a custom field: add it to `CUSTOM_FIELD_KINDS` and `compileOne` in `src/cms/core/fields/definitions.ts`, and to the `CustomFieldsManager` UI.
7. Public rendering: add a presenter or component in site code (`src/lib/site/*`, `src/components/*`). The core never renders public HTML.
8. Tests: extend `test/cms/zod-schema.test.ts` (valid, invalid, required-when-live, localized), plus coerce and template cases in `test/cms/import-parse.test.ts`.

### 7.3 Render a collection on the public site

1. **Detail route**: add `src/app/[locale]/events/[slug]/page.tsx`, using `src/app/[locale]/[slug]/page.tsx` or `.claude/skills/new-site/templates/content/detail-page.tsx.tpl` as the model:

   ```tsx
   export const dynamic = 'force-dynamic';

   export default async function EventPage({ params }: { params: Promise<{ locale: Locale; slug: string }> }) {
     const { locale, slug } = await params;
     setRequestLocale(locale);
     const doc = await resolveRenderDoc('event', slug, locale);      // honours Draft Mode
     if (!doc) {
       await log404(`/events/${slug}`, locale);
       redirect(pageNotFoundPath(locale));
     }
     const d = doc.data as Record<string, unknown>;
     const categories = (await loadRelatedDocuments(doc.id, 'categories'))
       .filter((c) => c.status === 'published');                     // not cached, not filtered
     return (
       <>
         <AdminEditTarget doc={doc} />
         <h1>{typeof d.title === 'string' ? d.title : ''}</h1>
         <RichText value={d.body} />
       </>
     );
   }
   ```

   Add `generateMetadata` with `documentSeo(doc)` and `localizedMetadata`, and JSON-LD with `documentStructuredData` (see 06).
2. **Listing**: call `listPublishedDocuments('event', locale, { limit: 1000 })`, or `listPublishedByRelation('event', 'categories', termId, locale, …)` for a category filter. Map rows through a presenter (extend `presentEntry`/`ContentType` in `src/lib/site/content.ts` if it is content-shaped), then page with `parseContentParams` and `applyContentQuery`.
3. The static path must match `routing.pathTemplate`. `canonical_path`, preview links, slug-change redirects and the sitemap are all derived from the template. A route whose URL differs from the template breaks all four.
4. Localized fields go through `localizedText` / `localizedValue`. Media UUIDs become `/api/cms/media/file/{uuid}` (`mediaUrl`).
5. For a new top-level segment, make sure it does not collide with the `page` collection's `/{slug}` route. Static segments win over `[slug]`, so a `page` doc slugged `events` becomes unreachable.

### 7.4 Add a shortcode

1. Declare it in `SHORTCODES` (`src/cms/core/shortcodes/all.ts`):

   ```ts
   map: defineShortcode({
     name: 'map',                      // kebab-case; typed by hand into a body
     label: 'Map',
     description: 'An embedded map of one location.',
     module: undefined,                // or a ModuleFlags key to gate it
     attrs: {
       lat: { kind: 'text', maxLength: 20, pattern: /^-?\d+(\.\d+)?$/, default: '' },
       lng: { kind: 'text', maxLength: 20, pattern: /^-?\d+(\.\d+)?$/, default: '' },
       zoom: { kind: 'int', min: 1, max: 18, default: 12 },
     },
   }),
   ```

   The admin `InsertShortcodeDialog` builds its form from `attrs` automatically. Help text for attributes comes from `shortcodeAttrHelp` (checked by `test/cms/field-help-content.test.ts`).
2. Create the component in `src/components/shortcodes/Map.tsx`. It receives the **validated** attrs as props (`Record<string, unknown>`), so narrow them. It may be an async server component. It is wrapped in `<Suspense fallback={null}>`.
3. Map it in `src/shortcodes/index.tsx`: `map: Map as ShortcodeComponent`. Without this entry the shortcode renders nothing on the public site, even though the editor offers it.
4. If shortcodes should also work in MDX bodies, the component name (`componentNameFor('map')` → `Map`) must be in `MDX_ALLOWED_COMPONENTS` and `src/mdx-components.tsx`. `shortcodeComponentNames()` exists for that, but nothing currently wires it in.
5. Tests: add parse and resolve cases to `test/cms/shortcode-registry.test.ts`, and a render case to `test/components/richtext-shortcode.test.tsx` if relevant.

---

## 8. Testing

Run one file:

```bash
npx tsx --tsconfig ./tsconfig.test.json --test test/cms/zod-schema.test.ts
```

Run everything with `npm test` (the file globs are in `package.json`). The tests use `node:test` and need no database for the files below.

| Area | Test files |
|---|---|
| Config and collections | `test/cms/config.test.ts`, `test/cms/taxonomy-collection.test.ts`, `test/site/config.test.ts`, `test/cms/admin-content-collections.test.ts`, `test/cms/form-sections.test.ts`, `test/cms/labels.test.ts` |
| Field validation | `test/cms/zod-schema.test.ts`, `test/cms/show-if.test.ts`, `test/cms/month-day.test.ts`, `test/cms/localized-values.test.ts`, `test/cms/custom-fields.test.ts` |
| Field help | `test/cms/field-help-content.test.ts`, `test/tools/generated-field-help.test.ts` (helper `test/setup/field-help.ts`) |
| Documents | `test/cms/document-title.test.ts`, `test/core/relations.test.ts`, `test/cms/publish-rights.test.ts`, `test/core/publish-scheduled.test.ts`, `test/cms/preview-locale.test.ts`, `test/core/slug-change-redirect.test.ts`, `test/core/unpublish-redirect.test.ts` |
| MDX | `test/core/mdx-guard.test.ts`, `test/components/mdx-allowlist.test.tsx`, `test/cms/mdx-markdown-actions.test.ts`, `test/cms/mdx-preview-state.test.ts` |
| Rich text and shortcodes | `test/components/richtext.test.tsx`, `test/components/richtext-shortcode.test.tsx`, `test/cms/shortcode-parse.test.ts`, `test/cms/shortcode-registry.test.ts`, `test/cms/insert-shortcode-dialog.test.tsx`, `test/cms/script-shortcode-registry.test.ts`, `test/components/script-shortcode.test.tsx` |
| Import | `test/cms/import-frontmatter.test.ts`, `test/cms/import-parse.test.ts` |
| Locks | `test/core/locks.test.ts`, `test/cms/edit-lock.test.ts` |
| Site read and presenters | `test/site/content-presenter.test.ts`, `test/site/content-query.test.ts`, `test/site/content-toolbar.test.tsx`, `test/site/categories.test.ts`, `test/site/authors.test.ts`, `test/site/admin-edit-wiring.test.ts` |

`src/cms/core/fields/mdx-guard.ts` and `src/cms/admin/fields/mdx/snippet.ts` mention `test/cms/mdx-snippet.test.ts` and `test/components/mdx-palette.test.tsx`, and `fields.ts` mentions `src/lib/cms/mdx-palette.ts`. None of these exist in this repo. They are praion.gr-era references.

---

## 9. Gotchas and invariants

- **One validation authority.** Every write goes through `createDocument`/`updateDocument`, which run `buildDataSchema` and `assertMdxSafe`. Do not write to `documents` directly. The one sanctioned exception is the scheduler's conditional UPDATE, which does not version on purpose.
- **Validate against the effective collection.** Server code that validates or renders fields must use `mergeCustomFields` / `resolveCollectionWithCustomFields`. Otherwise custom fields and the `seo` group are missing and strict validation rejects `data.custom` / `data.seo`.
- **`required` means "required to go live".** Drafts may be incomplete. `richText` required accepts an empty doc. `date` required does not reject `''` (it fails `Date.parse` anyway). A required localized field going live must carry the **default locale**, non-empty (`buildDataSchema(..., { defaultLocale })`; falls back to `locales[0]`); other locales may be missing or `''`.
- **Localized maps are partial** (`z.partialRecord(z.enum(locales), …)`). Zod v4's `z.record(z.enum(…))` is exhaustive, which made adding a locale to `config.locales` break the next save of every existing document; that is fixed. Present locales are still validated and unknown locale keys are still rejected (`test/cms/zod-schema.test.ts`).
- **Unknown `data` keys are rejected** at strict levels. Removing a field from config makes every later save of an old document that still holds the key fail with 422. Use `strict: false` groups for runtime-shaped data.
- **`canonical_path` follows the slug.** `updateDocument` re-derives it (`nextCanonicalPath` → `resolvePath`, same `collection.seo` rule as create) when the slug or locale changes and the patch carries no `canonicalPath`. An explicit `canonicalPath` in the patch still wins (version restore and the PM bridge send one). The slug-change 301 redirect is unchanged.
- **`listPublishedDocuments` is a page.** Visibility is filtered in SQL (`visibleWhere`) before the limit, so `limit: 3` returns three live rows when there are three. The default limit is 200 and the cap is 1000 (`offset` is supported); when you need every document — the sitemap does — use `listAllPublishedDocuments`, which pages through.
- **No time-based cache expiry.** A `scheduled` document becomes visible in cached reads only when something purges its tags: the cron job, an admin list or edit screen visit (`promoteDueScheduled`), or any write to the type (`CMS_CACHE_REVALIDATE = false`).
- **`loadRelatedDocuments` is uncached and unfiltered.** It issues one query per linked id and returns drafts too. Filter by status (and prefer `isDocumentVisible` over `status === 'published'`, which drops due scheduled rows).
- **Only top-level relations are indexed** in `document_relations`. `listPublishedByRelation` and the unpublish redirect cannot see relations nested in groups or repeaters. A `many` relation with the same id twice violates `uniq_document_relations_link` (→ 409).
- **Slugs are normalised on write by the collection routes** (`normalizeDocumentSlug` → the shared `core/slug.ts` `slugify`: lowercase, hyphens, Greek transliterated, max 96). Only a *new* slug is normalised: a PATCH re-sending the stored slug, or a new locale joining a group with the group's stored slug, keeps it verbatim, so legacy un-normalised slugs are never rewritten. A slug with nothing sluggable is a 422 on `slug`. The service itself (seeds, PM bridge) does not normalise, and the admin slug input still shows what was typed until reload.
- **List-query booleans use `z.stringbool()`**, not `z.coerce.boolean()` (which reads `"false"` as true). `?grouped=false`/`0` is false; an unrecognised value is a 400.
- **Non-grouped list search** matches only slug and meta title. Grouped search also covers `titlePath`.
- **The generic API honours the module flag.** Every `/api/cms/{key}` route (and `/api/cms/{key}/import`) answers 404 while the collection's `module` is off (`assertCollection` → `resolveModuleFlags`).
- **Shortcodes `form` and `popup`** are registered and offered in the editor but have no entry in `SHORTCODE_COMPONENTS`, so they render nothing on the public site of the base.
- **MDX fields execute code on render.** Never render stored MDX without `MdxRuntime` (which carries `mdxGuardPlugin`). Keep `MDX_ALLOWED_COMPONENTS` free of raw HTML element names. A `code` field with `language: 'mdx'` and no `allowedComponents` allows no components and gets the plain textarea editor, not `MdxBodyEditor`.
- **Import requires exactly one top-level `f.mdx` field.** In the base config no collection qualifies, so the import feature is dormant until a site adds an MDX-bodied collection.
- **Grouped titles and MySQL JSON key order.** MySQL reorders JSON object keys. Always pass `titleOrder: groupPartOrder(fields, titlePath)` to `deriveDocumentTitle` / `listDocumentGroups`, or accent headlines print backwards.
- **Edit locks fail open.** With no secret, or with the relay down, nobody is blocked. `expectedVersion` is the real backstop. Lock keys must be produced by `documentLockKey` on both the client and the server.
- **Documented but not implemented:** `CollectionDefinition.drafts` and `singleton` have no effect today, and `pathTemplate` only interpolates `{slug}`.
- **`src/cms/**` may not import site code** (`@/components`, `@/lib`, `@/app`, …; enforced by ESLint in `eslint.config.mjs`). The site injects site behaviour into the core as props or config: `renderMdxPreview`, `allowedComponents`, `fieldResolvers`, the shortcode component map.
