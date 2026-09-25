# 04 · Admin UI

This guide covers the browser-facing admin: the route tree under `src/app/admin`, the shell (sidebar, top bar, idle sign-out, module flags, edit-lock provider), the config-driven document list and editor, the field-component registry, the shared UI kit, the browser API client, the per-feature management screens, and the front-end admin bar that links public pages back to their edit screens. It explains how these pieces fit together and how to extend them. It does not cover authentication internals, the permission model or sessions (see 05), the route handlers under `/api/cms` (see 01 and the feature guides), or what individual settings mean (see 10).

Related guides: [01-architecture.md](01-architecture.md) · [02-database.md](02-database.md) · [03-content-model.md](03-content-model.md) · [05-auth-users-security.md](05-auth-users-security.md) · [06-media-seo-structured-data.md](06-media-seo-structured-data.md) · [07-forms-email-marketing.md](07-forms-email-marketing.md) · [08-commerce.md](08-commerce.md) · [09-booking.md](09-booking.md) · [10-settings-cron-operations.md](10-settings-cron-operations.md)

---

## 1. File map

### Routes (`src/app/admin`)

| Path | Kind | Purpose |
|---|---|---|
| `src/app/admin/layout.tsx` | Server layout | Root layout of the admin tree. Owns `<html>`/`<body>` (the site root `src/app/layout.tsx` is a pass-through), loads Fraunces + Inter via `next/font`, injects `<BrandStyle />` so the admin uses the saved brand palette, sets `robots: noindex,nofollow`, `dynamic = 'force-dynamic'`. |
| `src/app/admin/login/page.tsx` | Server page | Renders `LoginForm` with `adminPath`, the reCAPTCHA site key and whether emailed 2FA codes are available (`graphMailConfigured()`), all resolved server-side. Outside the shell: no auth gate. |
| `src/app/admin/403/page.tsx` | Server page | Static "403 — Forbidden" page. `requirePerm` redirects here. Outside the shell. |
| `src/app/admin/actions/mdx-preview.ts` | Server Action | `previewMdxAction`, the MDX body editor's live preview. |
| `src/app/admin/(shell)/layout.tsx` | Server layout | The authenticated shell. See section 4.1. |
| `src/app/admin/(shell)/page.tsx` | Dashboard | Per-collection counts + draft counts, recent form submissions. |
| `src/app/admin/(shell)/[collection]/page.tsx` | Generic list | `DocumentList` for any collection. |
| `src/app/admin/(shell)/[collection]/new/page.tsx` | Generic create | `DocumentForm` without `initialGroup`. |
| `src/app/admin/(shell)/[collection]/[id]/page.tsx` | Generic edit | `DocumentForm` with the whole translation group. |
| `src/app/admin/(shell)/<tool>/page.tsx` | Tool screens | One per feature (orders, media, seo, ...). Table in section 6.3. |

### Shell and shared client code (`src/cms/admin`)

| File | Exports | Role |
|---|---|---|
| `index.ts` | barrel | Public surface imported as `@/cms/admin`. Everything here takes serialisable props; nothing imports `site.config`. |
| `Sidebar.tsx` | `Sidebar`, `SidebarTool` | Left nav: site name, "Back to site", Dashboard, Content, module sections, System. |
| `AdminNav.tsx` | `AdminNavProvider`, `useAdminNav`, `MobileNavToggle`, `MobileNavBackdrop` | Off-canvas drawer state below `md`. |
| `TopBar.tsx` | `TopBar`, `TopBarItem` | Breadcrumb-style title, user name, Sign out. |
| `IdleLogout.tsx` | `IdleLogout` | Client idle timer, warning dialog, keepalive ping. |
| `module-flags.tsx` | `ModuleFlagsProvider`, `useModuleFlags` | Context with the resolved module switches. |
| `shared.ts` | `groupSidebarItems`, `visibleAdminCollections`, `MODULE_GROUPS`, `labelText`, `buildBlocks`, `collectionSummary`, `PRAION_TAB` | Pure helpers shared by server pages and client components. |
| `DocumentList.tsx` | `DocumentList`, `DocumentListItem` | Grouped-by-translation list with search, status filter, paging, delete. |
| `DocumentForm.tsx` | `DocumentForm`, `DocumentInitial`, `DocumentGroupInitial` | Config-driven multi-locale editor. |
| `VersionHistory.tsx` | `VersionHistory` | Snapshot list + restore. |
| `SeoPanel.tsx` | `SeoPanel`, `SeoColumns` | Tabbed SEO & AEO panel inside the editor. |
| `ImportMarkdownDialog.tsx` | `ImportMarkdownDialog` | `.md` import into the active language tab. |
| `advisories.ts` | `ADVISORIES`, `Advisory`, `AdvisoryMap` | Non-blocking cross-field checks run in the editor. |
| `status-options.ts` | `statusOptionDisabled`, `statusHint`, `STATUS_HELP` | Which statuses a writer without publish rights may pick. |
| `local-datetime.ts` | `toWireDateTime`, `isoToLocalInput`, `localInputToIso`, `localTimeZoneName` | UTC <-> editor-local conversion for "Publish at". |
| `api-client.ts` | `cmsApi`, `CmsApiError`, `ListResponse`, `DataResponse` | Browser client for `/api/cms/*`. |
| `api-error-text.ts` | `apiErrorText` | Most-specific message from a `CmsApiError`. |
| `use-unsaved-changes.ts` | `useUnsavedChangesGuard` | `beforeunload` + in-app link guard. |
| `use-hydrated.ts` | `useHydrated` | False until React has hydrated. |
| `safe-next.ts` | `safeNextPath` | Validates post-login `?next=` (see 05). |
| `locks/*` | `EditLockProvider`, `useEditLock`, `EditLockBanner` | WebSocket edit locks. |
| `login-error.ts`, `mfa-bypass-hotkey.ts`, `recovery-codes-file.ts`, `LoginForm.tsx`, `MfaEnrollPanel.tsx`, `MfaBypassDialog.tsx`, `RecoveryCodesPanel.tsx`, `AccountSecurity.tsx` | | Sign-in and 2FA UI. Documented in 05. |
| `payload-fields.ts`, `media-upload-notice.ts`, `MediaAltText.tsx`, `CopyShortcodeButton.tsx` | | Small helpers used by the submissions, media and module-settings screens. |
| `*Manager.tsx`, `*Table.tsx`, `*Settings.tsx`, `AvailabilityCalendar.tsx`, `CookieScanner.tsx`, `OrderFulfilment.tsx`, `ReservationPayments.tsx`, `CourierCredentials.tsx` | | Per-feature screens (section 6.3). |

### Field components (`src/cms/admin/fields`)

| File | Role |
|---|---|
| `FieldInput.tsx` | The field-kind -> control registry (`FieldInput`, internal `LeafControl`, `LocalizedField`, `GroupControl`, `RepeaterControl`, `MultiSelect`, `MonthDayControl`, exported `ColorControl`). |
| `RichTextEditor.tsx` | TipTap editor for `richText`. |
| `InsertShortcodeDialog.tsx` | "+ Block" dialog for the rich-text editor; greys out shortcodes whose module is off (reads `useModuleFlags`). |
| `MdxBodyEditor.tsx` + `mdx/*` | MDX body editor for `code` fields with `language: 'mdx'`: toolbar (`markdown-actions.ts`, `apply-edit.ts`), component palette (`InsertComponentDialog.tsx`, `snippet.ts`), preview state machine (`preview-state.ts`). |
| `MediaPicker.tsx` | `image` fields; lists and uploads media. |
| `RelationPicker.tsx` | `relation` fields (search via `cmsApi.list(field.to)`). |
| `TermPicker.tsx` | `relation` fields with `picker: 'categoryTree' | 'termList'`; can create/rename/delete terms inline. |
| `VariationsEditor.tsx` | `variations` fields (product matrix). |
| `DefinitionEditors.tsx` | Sub-editors shared by `CustomFieldsManager` and `SeoFieldsManager` (labels, options, repeater columns). |

### UI kit (`src/cms/admin/ui`)

| File | Exports |
|---|---|
| `index.tsx` | `Button` + `buttonVariants` (`primary`/`secondary`/`ghost`/`danger`, `sm`/`md`), `IconButton`, `TextInput`, `Textarea`, `Select`, `Badge` (`neutral`/`gold`/`green`/`blue`/`amber`/`red`), `Table`, `Thead`, `Tbody`, `Th` (with `info`), `Td`; re-exports the rest. |
| `Field.tsx` | `Field` — label/control/help wiring with `useId`. |
| `InfoTip.tsx` | `InfoTip`, `FieldTip` — the "i" affordance. |
| `Section.tsx` | `Section` — titled, optionally collapsible card. |
| `Tabs.tsx` | `Tabs`, `TabDef` — WAI-ARIA tabs with arrow keys. |
| `Drawer.tsx` | `Drawer` — side panel used by list screens. |
| `ConfirmDialog.tsx` | `useConfirm()` — promise-based replacement for `window.confirm`. |
| `use-dialog.ts` | `useDialog` — focus trap, Escape, scroll lock, focus restore. |
| `Icon.tsx` | `Icon`, `IconName` — a fixed set of lucide icons by kebab name (`ICON_NAMES` in `icon-names.ts`), not all of lucide. |
| `Checkbox.tsx`, `CharCounter.tsx`, `PasswordInput.tsx`, `PasswordStrength.tsx`, `MfaCodeInput.tsx`, `Captcha.tsx` | Specialised controls. |
| `cn.ts` | `cn()` = `clsx` + `tailwind-merge`. |

### Front-end admin bar (uncommitted work at the time of writing)

| File | Role |
|---|---|
| `src/lib/admin-bar.ts` | Pure model: `adminBarFor`, `adminAccessFor`, `adminEditHref`, `exitPreviewHref`. |
| `src/components/admin-bar/AdminBar.tsx` | Client: `AdminBarProvider`, `AdminBarView`, `RegisterEditTarget`. |
| `src/components/admin-bar/AdminEditTarget.tsx` | Async server component a public page renders to name its document. |
| `src/app/[locale]/layout.tsx` | Computes the bar model and wraps the site in `AdminBarProvider`. |
| Public pages that render `<AdminEditTarget>` | `src/app/[locale]/[slug]/page.tsx`, `booking/[slug]/page.tsx`, `contact/page.tsx`, `shop/[slug]/page.tsx`, `shop/category/[slug]/page.tsx`, `shop/tag/[slug]/page.tsx`, `src/components/site/HomeSections.tsx` (`HomeHero`). |
| `.claude/skills/new-site/templates/{base/locale-layout,content/author-page,content/category-page,content/detail-page}.tsx.tpl` | Same wiring in the new-site scaffolding templates. |

---

## 2. Data model

Not applicable. The admin UI owns no tables. It reads and writes through `/api/cms/*` (client components) or through service functions in `src/cms/core` and `src/cms/modules` (server pages). Two pieces of browser state exist:

| Key | Where | Purpose |
|---|---|---|
| `localStorage['cms:last-activity']` | `IdleLogout.tsx` | Last activity timestamp shared across tabs. Wrapped in `try/catch`; the component degrades to per-tab behaviour. |
| per-tab session id | `locks/session-id.ts` | Identifies this tab to the edit-lock relay. |

---

## 3. How it works

### 3.1 Route tree and gating

```
src/app/admin/
  layout.tsx            <html>, fonts, BrandStyle, noindex
  login/page.tsx        public
  403/page.tsx          public
  actions/mdx-preview.ts
  (shell)/layout.tsx    requirePerm(cms.access) + chrome
    page.tsx            dashboard
    [collection]/...    generic list/new/edit
    orders/, media/, seo/, settings/, ...
```

`(shell)` is a route group, so it adds no URL segment. Gating is layered:

1. `src/proxy.ts` classifies the path with `resolveAdminRequest(pathname, getAdminPath())`. For `/<ADMIN_PATH>/**` it stamps the requested public path onto the request in `ADMIN_PATH_HEADER` (overwriting any client copy), rewrites onto the `/admin/**` route tree when the segment is not `admin`, and returns early. When the admin has moved, a direct `/admin/**` gets a plain 404. The admin skips SEO redirects and i18n routing.
2. `(shell)/layout.tsx` reads that header, runs it through `safeNextPath`, and calls `requirePerm(PERMISSIONS.access, requested)`. An anonymous user goes to login with `?next=`. A user without `cms.access` goes to `/admin/403`.
3. **Each page runs its own guard as well** (`requirePerm(PERMISSIONS.ordersRead)` and so on). Hiding a sidebar item is not access control. The API route behind every write checks again.
4. Module-owned screens also call `isModuleEnabled(config, '<module>')` and `notFound()` when the module is off, because a bookmarked URL must behave the same as the hidden sidebar entry.

`requirePerm` (in `src/cms/modules/auth/guards.ts`) re-reads permissions from the database and returns the user with **fresh** permissions. The shell uses that result to build the nav. See 05 for the details.

### 3.2 The shell layout

`src/app/admin/(shell)/layout.tsx` does all of the following on the server for each request:

1. Resolves `user`, `moduleFlags = resolveModuleFlags(config)` and the brand name.
2. Builds `collections = visibleAdminCollections(config.collections.map(collectionSummary), moduleFlags)`. The rule: not `hidden`, and either no `module` or `moduleFlags[module] === true`.
3. Builds `tools: SidebarTool[]` in a fixed order, gating each on permission and (where relevant) module:

| Tool | href | Gate | Group |
|---|---|---|---|
| Submissions | `/admin/submissions` | `formsRead` | system |
| Newsletter | `/admin/newsletter` | `moduleFlags.newsletter` + `newsletterRead` | system |
| SEO | `/admin/seo` | `seoRead` | system |
| Media | `/admin/media` | `mediaRead` | system |
| Users | `/admin/users` | `usersManage` | system |
| Roles | `/admin/roles` | `rolesManage` | system |
| Orders | `/admin/orders` | `commerce` + `ordersRead` | `ecommerce` |
| Customers | `/admin/customers` | `customers` + `customersRead` | `ecommerce` |
| Gift cards | `/admin/gift-cards` | `commerce` + `ordersRead` | `ecommerce` |
| Reviews | `/admin/reviews` | `commerce` + `reviewsRead` | `ecommerce` |
| Abandoned carts | `/admin/abandoned` | `commerce` + `ordersRead` | `ecommerce` |
| Reservations | `/admin/reservations` | `booking` + `reservationsRead` | `booking` |
| Availability | `/admin/availability` | `booking` + `scheduleRead` | `booking` |
| Audit log | `/admin/audit` | `auditRead` | system |
| Your account | `/admin/account` | none (signed in only) | system |
| Cookies, Settings | `/admin/cookies`, `/admin/settings` | `settingsRead` | system |
| Scripts | `/admin/scripts` | `scriptsManage` | system |

4. Builds `TopBarItem[]` from the collections (`isCollection: true`) followed by the tools. The top bar uses them only to work out its title.
5. Renders the providers and chrome:

```tsx
<AdminNavProvider>
  <ModuleFlagsProvider flags={moduleFlags}>
    <EditLockProvider enabled={locksEnabled()} wsUrl={process.env.NEXT_PUBLIC_CMS_LOCK_WS_URL ?? ''} currentUserId={user.userId}>
      <div className="flex min-h-screen bg-neutral-100">
        <Sidebar siteName collections locale={user.locale} tools />
        <MobileNavBackdrop />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar userName={user.name} items={items} />
          <main className="min-w-0 flex-1 overflow-x-hidden p-4 md:p-6 lg:p-8">{children}</main>
        </div>
        <IdleLogout idleSeconds={sessionIdleSeconds()} adminPath={getAdminPath()} />
      </div>
    </EditLockProvider>
  </ModuleFlagsProvider>
</AdminNavProvider>
```

The layout resolves every value that only the server can read (idle window, admin path, lock config) and passes it down as a prop. Client code cannot read those environment variables.

### 3.3 Sidebar grouping

`Sidebar` delegates sorting to the pure `groupSidebarItems(collections, tools)` in `shared.ts`:

- **content**: visible collections whose `module` is not listed in `MODULE_GROUPS`.
- **modules**: one section per `MODULE_GROUPS` entry (`commerce -> "Ecommerce"/ecommerce`, `booking -> "Booking"/booking`). A section holds that module's collections plus the tools whose `group` matches. Empty sections are dropped.
- **system**: tools with no `group`, or a `group` that no `MODULE_GROUPS` entry claims. An orphaned tool therefore still shows up.

Render order: brand block, **Back to site** (`<Link href="/">`, never styled active), Dashboard, "Content", module sections, "System". An item is active when `pathname === href` or `pathname.startsWith(href + '/')`. Collection icons come from `collection.icon`, and each tool sets its own `icon`.

Below `md` the `<aside id="admin-sidebar">` is a fixed off-canvas drawer, translated off-screen unless `useAdminNav().open`. `AdminNavProvider` closes the drawer when the pathname changes (the state is adjusted during render, not in an effect) and on Escape. `MobileNavToggle` (in the top bar) carries `aria-expanded` and `aria-controls="admin-sidebar"`.

### 3.4 Top bar

`TopBar` finds the longest `items[].href` that prefixes the pathname and uses its label as the title. For a collection it appends " · New" (path ends with `/new`) or " · Edit" (below the list path). The title is a `<p aria-hidden>`, not a heading, because every page renders its own `<h1>`. Sign out calls `cmsApi.logout()`, then `router.push('/admin/login')` and `router.refresh()`. The button keeps `aria-label="Sign out"` because its text is hidden on narrow screens.

### 3.5 Idle sign-out

`IdleLogout` is a UX layer, not the security boundary. The JWT expiry and `requireApiAuth` enforce the idle window on the server.

- Activity events (`pointerdown`, `keydown`, `wheel`, `touchstart`, `visibilitychange`) update `lastActivity` and `localStorage['cms:last-activity']`. A `storage` listener syncs the other tabs.
- Throttled keepalive: at most once per `sessionRefreshAfterSeconds(idleSeconds)`, it sends `GET /api/cms/auth/me`. The route slides the cookie and returns `sessionExpiresAt`, which becomes the hard client deadline (minus a 10 s grace).
- A 5 s interval evaluates `idleState(...)` from `src/cms/modules/auth/session-idle.ts`. In `'warning'` (the last `IDLE_WARNING_SECONDS = 60`) it shows a `role="alertdialog"` with "Stay signed in" / "Sign out now". In `'expired'` it calls `cmsApi.logout('idle')` and does a full navigation to `/${adminPath}/login?timeout=1`, which `LoginForm` reads to explain what happened.
- Window: `ADMIN_SESSION_IDLE_MINUTES` (default 60, minimum 60 s).

### 3.6 Module flags in client components

`ModuleFlagsProvider` makes the shell's resolved flags available anywhere in the tree. `useModuleFlags()` returns `{}` outside the shell, meaning nothing is assumed on. Its current consumer is the rich-text "+ Block" dialog (`InsertShortcodeDialog`), which greys out shortcodes whose module is off. Use it in preference to threading a prop through groups, repeaters and language tabs.

### 3.7 Generic collection screens

All three generic pages call `resolveAdminCollection(segment, suffix)` from `src/lib/cms/collection-route.ts`. It returns the collection when the segment is a key. When the segment is an unambiguous alias (for example the plural label `pages`) it redirects to `/${getAdminPath()}/<key><suffix>`. Anything else gets `notFound()`.

Static tool folders take precedence over `[collection]`. A collection whose key matches a tool folder name (`orders`, `media`, `seo`, ...) cannot be reached through the generic routes. An alias can also collide: the layout comment explains that Reservations lives at `/admin/reservations` and not `/admin/bookings` because `bookings` is an alias of the `booking` collection.

**List** (`[collection]/page.tsx`): requires `contentRead`, calls `promoteDueScheduled(key)` so overdue scheduled documents show as published, then fetches page 1 with `listDocumentGroups(key, { pageSize: 25, defaultLocale, titlePath, titleOrder })`. It passes `DocumentListItem[]` to `DocumentList`. "Import .md" appears only when `mdxBodyField(collection.fields)` is non-null, and links to `new?import=1`.

`DocumentList` (client):
- Filter state (`q`, `status`, `page`) is seeded from the URL and mirrored back with `router.replace` (no history entries). Search is debounced by 300 ms.
- It skips the fetch on the first render, then calls `cmsApi.list(key, { page, pageSize, grouped: 1, status, search })` on each change. It also refetches on `visibilitychange`/`focus`.
- One row per translation group. Each configured locale gets a chip coloured by status, and a missing locale gets a dashed chip. Archived uses a dashed border plus line-through so the state is not conveyed by colour alone.
- Delete asks through `useConfirm`, then deletes **every variant** of the group (`cmsApi.remove` per variant id).

**New** (`[collection]/new/page.tsx`): requires `contentWrite`. It computes `canPublish`, merges admin-defined custom fields (`mergeCustomFields`), loads `getCustomFieldsConfig(key)` and `getSeoFieldsFor(collection)`, and renders `DocumentForm` with `renderMdxPreview={previewMdxAction}`.

**Edit** (`[collection]/[id]/page.tsx`): requires `contentRead`. It also computes `canPublish` and `canWrite`, rejects a non-integer id with `notFound()`, promotes due scheduled documents, and loads the row, its translation group, and `documentVersionNumber` per variant. Tabs are the editable locales plus every locale that already has a variant, so existing translations stay editable. It builds `DocumentInitial[]`, with `scheduledFor` as a full UTC instant (`toWireDateTime`). It also builds the "Preview draft" link from `previewTargetFor(group, ?locale, row)`, so the preview follows the language tab rather than the row id in the URL. It passes `serverStamp = "id:updatedAtMs|..."`.

### 3.8 DocumentForm

`DocumentForm` edits one translation group. Each locale is a tab with its own `LocaleState` (data, SEO columns, status, dates, `version`, `exists`, `dirty`). The slug is shared across the group.

Rendering pipeline:

1. `visibleFields(collection.fields, active.data)` applies `showIf`. The `seo` data group is removed here and rendered by `SeoPanel` instead.
2. Custom fields: when `customFields` is supplied, the `custom` group keeps only `visibleCustomFields(customFields, categoryIds)`. Category-scoped fields therefore appear as soon as the editor picks a category.
3. `buildBlocks(fields, 'Content', { nestRepeaters: Boolean(collection.sections?.length) })` groups leaf fields into titled `Section`s by `field.section`. Groups and repeaters stand alone unless `nestRepeaters` is on and they name a section. `collection.sections[]` supplies descriptions and `collapsed`. A collapsed section still opens when it contains an error or advisory.
4. Each field goes through `FieldInput` with `path`, `errorsByPath`, `siblings`, `root`, `peers`, `defaultLocale` and `renderMdxPreview`.
5. `SeoPanel` renders below the content when `seoFields.length > 0`.
6. The right rail holds Save/Cancel/"Unsaved", the Document section (Slug, Status, status badge), the Publishing section ("Publish at" only for `scheduled`, Published date, Modified date) and `VersionHistory` for saved variants.

Save (`submit`):

- Sends `create` or `update` for the **active locale only**, with `expectedVersion: active.version` for optimistic concurrency and `translationGroupId`.
- Without `canPublish`, on an existing row it omits `status`/`publishedAt`/`scheduledFor` unless the status is non-live, so a writer's save never touches publishing (see `status-options.ts` and `core/documents/publish-rights.ts`).
- When the slug changed, or the collection has `shared` fields, it then PATCHes every existing sibling locale with the new slug and/or merged shared data, each carrying its own `expectedVersion`. A 409 there becomes an amber **warning**: the active locale saved, but the siblings were not overwritten.
- A new document goes to `/admin/<key>/<id>`. An edit bumps the local version, shows a `role="status"` "EL saved." message, and calls `router.refresh()`.
- Server validation errors: `err.issues.fieldErrors` / `pathErrors` are routed to the exact control by dotted path (`tiers.0.min`).

Supporting mechanisms:

| Concern | Mechanism |
|---|---|
| Unsaved-work guard | `useUnsavedChangesGuard(anyDirty)`. Cancel also asks through `useConfirm`. |
| Hydration race | The whole form sits in `<fieldset disabled={!hydrated || readOnly} className="contents">` (`useHydrated`). |
| Edit lock | `useEditLock({ type: 'document', key: documentLockKey(...), enabled: isEdit && canWrite })`. `EditLockBanner` sits outside the fieldset, so "take over" and "copy unsaved" stay usable while the form is read-only. |
| Server copy moved on | When `serverStamp` changes (after a refresh, restore or another editor's save), the form re-seeds clean locales and keeps dirty ones, with a warning. The form is deliberately not remounted through `key`, which would lose the active tab and unsaved work. |
| Language in URL | `?locale=` selects the tab, and `switchLocale` updates it with `router.replace`. Messages are cleared on switch. |
| Status options | `statusOptionDisabled` disables options instead of removing them. `statusHint` explains why, below the select. |
| Publish at | Stored as UTC ISO. Shown with `isoToLocalInput` (only once hydrated), typed back with `localInputToIso`. |
| Advisories | `ADVISORIES[collection.advisories](active.data, locale)` merged under server `pathErrors`. They never block a save. |
| Markdown import | `ImportMarkdownDialog` -> `cmsApi.parseImport` -> `applyImported` fills the active tab. Nothing is saved. Opened by `?import=1`. |
| Copy from default | On a missing locale tab: clones the default locale's data and SEO columns into the form. |

**There is no autosave.** The only unsaved-work protection is the guard hook plus the Cancel confirmation.

### 3.9 Version history

`VersionHistory` lists `cmsApi.versions(collection, id)` (newest first) and reloads when `reloadKey` (the local version number) changes. Restore calls `cmsApi.restore(collection, id, versionId)` and then does a **full page reload**, not `router.refresh()`. MySQL `updated_at` has one-second resolution, so a stamp-based refresh could miss the change and a later Save would write the stale form back. It is mounted with `key={active.rowId}`, so each language tab has its own history.

### 3.10 SEO panel

`SeoPanel` receives the resolved `SeoFieldDef[]` (`getSeoFieldsFor(collection)`, which applies the admin overrides from Settings -> Fields -> SEO & AEO). Fields are split into tabs (`SEO_TABS`, `seoFieldsByTab`) using the `ui/Tabs` component. Each def has a `storage`:

- `column`: `metaTitle`, `metaDescription`, `ogImageUuid`, `robots` (noindex/nofollow), `includeInSitemap`. The panel binds these to `SeoColumns` in the form state and writes them through `onColumnsChange` (= `patchActive`).
- `data`: rendered through `FieldInput` into `data.seo` via `onValuesChange`.

Tab badges count filled fields. The robots column counts only when it actually restricts. See 06 for what the fields do.

### 3.11 MDX preview server action

`previewMdxAction(source, locale)` in `src/app/admin/actions/mdx-preview.ts`:

1. `requireApiPerm(PERMISSIONS.contentRead)` returns `{ status: 'denied' }` on failure. It re-reads permissions from the database.
2. Rejects sources over 512 KiB with `{ status: 'invalid' }`.
3. Rate limit `checkRateLimit('cms-mdx-preview', userId, { max: 120, windowMs: 60_000 })` returns `{ status: 'throttled' }`.
4. `renderMdxPreview(source, locale)` from `src/lib/cms/mdx-preview`.

It is a Server Action and not a route handler because the preview is an RSC tree (async `MdxRuntime` plus client components). `react-dom/server` is unavailable under the `react-server` condition. Pages pass it to `DocumentForm` as `renderMdxPreview`. `src/cms/**` does not import site code, so the renderer is injected. `fields/mdx/preview-state.ts` drops stale replies.

### 3.12 Front-end admin bar

The bar is a navigation convenience, not access control. Every link lands on an admin screen that runs its own guard.

```
[locale]/layout.tsx
  sessionUser = getCurrentUser()      // signed cookie read, no DB
  draft       = draftMode()
  adminBar    = adminBarFor(sessionUser, getAdminPath(), { preview: draft.isEnabled, siteLocale: locale })
  <AdminBarProvider bar={adminBar}>   // renders <AdminBarView/> above <Header/>, or nothing
     ...page...
        <AdminEditTarget doc={doc}/>  // server: checks session, renders <RegisterEditTarget href/>
                                      // client: pushes href up via context
```

`adminBarFor` returns one of three models:

| Situation | Result |
|---|---|
| Signed-in user with `cms.access` | `{ admin: { href: '/<adminPath>', userName, canEdit: hasPerm(contentRead) }, locale: user.locale === 'en' ? 'en' : 'el', preview }` |
| No admin session, but draft mode on | `{ admin: null, locale: <page locale>, preview: true }`, which only offers "Exit preview". The draft cookie outlives the admin session. |
| Otherwise | `null`: no bar and no context |

`AdminBarView` renders `<nav aria-label="Εργαλεία διαχειριστή" | "Admin tools">` with:
- **Admin** -> `admin.href`
- **Edit** -> the registered edit href, only when `admin.canEdit` and a page registered one
- **Preview** badge and **Exit preview** -> `exitPreviewHref(pathname)` = `/api/cms/preview/disable?redirect=<path>`. The route runs the target through `safeRedirectPath`.
- the user name, right-aligned

The labels are hard-coded Greek/English in `LABELS`. The bar does not use next-intl messages. Its links are plain `<a>` elements, so each one does a full navigation (the admin has its own root layout).

`AdminEditTarget({ doc: { type, id, locale } })` is an async server component. It re-checks the session itself (`adminAccessFor(await getCurrentUser(), adminPath)?.canEdit`). For a visitor it renders nothing, so neither the admin path nor document ids appear in public HTML. For an editor it renders `RegisterEditTarget` with `adminEditHref(adminPath, doc)` = `/<admin>/<type>/<id>?locale=<locale>`. The `?locale=` opens the matching language tab (section 3.8).

`RegisterEditTarget` sets the href in an effect and clears it on unmount, but only if the value is still its own. A client navigation to another document page therefore does not blank the new page's link.

The layout's "Back to site" link is the reverse path: `Sidebar` renders `<Link href="/">` at the top of the nav.

---

## 4. HTTP API

The admin's only server action is `previewMdxAction` (section 3.11). All other traffic from client components goes through `cmsApi` in `src/cms/admin/api-client.ts` to route handlers under `/api/cms/*`. Those handlers are built with `createRoute` and documented in the guides for each area.

### 4.1 `cmsApi` conventions

- `request<T>(path, init)` always sends `Content-Type: application/json`, returns `undefined` for 204, and parses the uniform envelope. Non-2xx or `ok: false` throws `CmsApiError(status, { error, message?, issues? })`, with `code = body.error`. An unparseable body becomes `error: 'bad_response'`.
- `ListResponse<T>` = `{ ok, items, page, pageSize, total, pageCount }`. `DataResponse<T>` = `{ ok, data }`.
- Generic document CRUD: `list(collection, query)`, `get`, `create`, `update` (PATCH), `remove`, `versions`, `restore`, `parseImport`.
- The generic helpers are reused for non-document resources whose route shares the shape: `list('orders')`, `update('reviews', id)`, `list('newsletter')`, `list('abandoned-carts')`, `create('gift-cards')`.
- Named helpers cover everything else: auth/2FA, settings, forms, SEO redirects/404/meta, users, roles, media, API tokens, audit, cookies, scripts, shipping, gift cards, order refunds/shipments, reservation payments.
- Exceptions: `uploadMedia` posts `FormData` (no JSON header). `login` sends the captcha token in an `x-captcha-token` header. `logout` always sends a body because `createRoute` rejects a bodyless POST.
- Direct `fetch` is used in only two places: `IdleLogout` (`/api/cms/auth/me` keepalive) and `AvailabilityCalendar` (`/api/cms/booking/schedule`). Use `cmsApi` for new code.

### 4.2 Error display

Show the most specific server message with `apiErrorText(err, fallback)`:

```ts
try {
  await cmsApi.updateScript(id, body);
} catch (err) {
  setError(apiErrorText(err, 'Could not save the snippet.'));
}
```

The priority order is `issues.fieldErrors`, then `issues.pathErrors`, then `issues.formErrors` (at most two, joined), then `err.message`, then the fallback. `DocumentForm` does not use it because it routes each issue to its own control.

---

## 5. Admin UI

### 5.1 Screens

| Route | Guard (page) | Module gate | Server data | Client component |
|---|---|---|---|---|
| `/admin` | `access` | — | `listDocumentGroups` counts/drafts, `listSubmissions` (if `formsRead`) | server-only markup |
| `/admin/[collection]` | `contentRead` | collection module (via `visibleAdminCollections` in nav only) | `listDocumentGroups` | `DocumentList` |
| `/admin/[collection]/new` | `contentWrite` | — | custom/SEO field config | `DocumentForm` |
| `/admin/[collection]/[id]` | `contentRead` (+`contentWrite` for lock, `contentPublish`) | — | group, versions | `DocumentForm` |
| `/admin/submissions` | `formsRead` | — | `listSubmissions` | `SubmissionsTable` |
| `/admin/newsletter` | `newsletterRead` | `newsletter` | `listSubscribers({status:'active'})` | `SubscribersTable` |
| `/admin/seo` | `seoRead` | — | redirects, 404s, meta | `SeoManager` |
| `/admin/media` | `mediaRead` (`mediaWrite` -> `canWrite`) | — | `listMedia`, `countMedia` | `MediaLibrary` |
| `/admin/users` | `usersManage` | — | `listUsers`, `listRoles` | `UsersManager` |
| `/admin/roles` | `rolesManage` | — | `listRolesDetailed`, `ASSIGNABLE_PERMISSIONS` | `RolesManager` |
| `/admin/orders` | `ordersRead` (`ordersWrite`) | `commerce` | `listOrders`, `orderStats`, currency | `OrdersTable` |
| `/admin/customers` | `customersRead` (`customersWrite`) | `customers` | `listCustomers` | `CustomersTable` |
| `/admin/gift-cards` | `ordersRead` (`ordersWrite`) | `commerce` + gift cards enabled | direct Drizzle select (200 rows) | `GiftCardsTable` |
| `/admin/reviews` | `reviewsRead` | `commerce` | `listReviews({status:'pending'})`, `reviewStats` | `ReviewsTable` |
| `/admin/abandoned` | `ordersRead` | `commerce` | `listAbandoned({status:'pending'})` | `AbandonedCartsTable` |
| `/admin/reservations` | `reservationsRead` (`reservationsWrite`) | `booking` | `listReservations` from URL filters | `ReservationsTable` (keyed on filters) |
| `/admin/availability` | `scheduleRead` (`scheduleWrite`) | `booking` | none | `AvailabilityCalendar` |
| `/admin/audit` | `auditRead` | — | `listAuditLogs` from `?q&type&group&page` | server-only GET form + links, no client JS |
| `/admin/account` | `requireAuth` only | — | `getMfaStatus`, `mfaRequiredBySetting` | `AccountSecurity` |
| `/admin/cookies` | `settingsRead` | — | `listCookieCatalog` | `CookiesManager` (+ `CookieScanner`) |
| `/admin/settings` | `settingsRead` | per tab | see 5.2 | `SettingsForm` |
| `/admin/scripts` | `scriptsManage` | — | `listSnippets`, non-required cookie categories | `ScriptsManager` |
| `/admin/api-tokens` | none (redirect) | — | — | redirects to `/admin/settings?tab=Connect to Praion.ai` |

The `(write)` permission in brackets becomes a `canWrite` prop. Screens hide write controls for read-only roles, and the API refuses the writes regardless.

### 5.2 Settings screen composition

`settings/page.tsx` assembles four kinds of tab and passes them to `SettingsForm`:

- **Group tabs** come from `MANAGED_SETTINGS` groups, skipping settings whose `module` is off. One main Save PATCHes everything through `cmsApi.updateSiteSettings`.
- **`moduleTabs`**: `{ Ecommerce: [Shipping, Coupons, Wishlist, Gift cards] }` when commerce is on. These render as sub-tabs next to a built-in "General" sub-tab.
- **`fieldsTabs`**: "SEO & AEO" (`SeoFieldsManager`) plus one `CustomFieldsManager` per eligible collection. Eligible means not hidden, has a `routing.pathTemplate`, is not `topic`/`author`/`category`, and its module is on.
- **`extraTabs`**: Branding (`BrandSettings`), Structured data (`StructuredDataSettings`), and "Connect to Praion.ai" (`ApiTokensManager`, only with `moduleFlags.pm` and `tokensManage`).

Each bespoke tab saves itself. The active tab and sub-tab live in `?tab=` and `?sub=`. An unknown value falls back to the first tab. `SettingsForm` also uses `useUnsavedChangesGuard`. Database loads that depend on newer migrations are wrapped in try/catch, so a missing table breaks only its own tab and shows `role="alert"` text naming `npm run db:migrate`.

### 5.3 Per-feature managers

| Component | Screen | API it calls (`cmsApi.*` unless noted) |
|---|---|---|
| `DocumentList` | `/admin/[collection]` | `list(key,{grouped:1,...})`, `remove` |
| `DocumentForm` | `/admin/[collection]/new`, `/[id]` | `create`, `update`; `previewMdxAction` (server action) |
| `VersionHistory` | edit screen rail | `versions`, `restore` |
| `ImportMarkdownDialog` | edit/new | `parseImport` -> `POST /api/cms/{collection}/import` |
| `SubmissionsTable` | `/admin/submissions` | `listSubmissions`, `getSubmission`, `updateSubmission` |
| `SubscribersTable` | `/admin/newsletter` | `list('newsletter')`, `update('newsletter')`, `remove('newsletter')` |
| `SeoManager` | `/admin/seo` | `listRedirects`, `createRedirect`, `updateRedirect`, `deleteRedirect`, `list404`, `update404`, `delete404`, `listMeta`, `upsertMeta`, `deleteMeta` |
| `MediaLibrary` (+`MediaAltText`) | `/admin/media` | `listMedia`, `uploadMedia`, `deleteMedia`, `updateMedia` |
| `UsersManager` | `/admin/users` | `listUsers`, `createUser`, `updateUser`, `deleteUser` |
| `RolesManager` | `/admin/roles` | `listRoles`, `createRole`, `updateRole`, `deleteRole` |
| `OrdersTable` (+`OrderFulfilment`) | `/admin/orders` | `list('orders')`, `get('orders')`, `update('orders')`, `createOrder`, `saveOrder`, `refundOrderPayment`, `createShipment`, `list('product')`; CSV link `/api/cms/orders/export` |
| `CustomersTable` | `/admin/customers` | `list('customers')`, `update('customers')` |
| `GiftCardsTable` | `/admin/gift-cards` | `listGiftCards`, `giftCardHistory`, `create('gift-cards')`, `update('gift-cards')` |
| `ReviewsTable` | `/admin/reviews` | `list('reviews')`, `update('reviews')`, `remove('reviews')`, `reviewStats` |
| `AbandonedCartsTable` | `/admin/abandoned` | `list('abandoned-carts')`, `deleteAbandonedCart`, `remindAbandoned` |
| `ReservationsTable` (+`ReservationPayments`) | `/admin/reservations` | `get('reservations')`, `update('reservations')`, `sendReservationPaymentLink`, `recordReservationPayment`, `refundReservationPayment` |
| `AvailabilityCalendar` | `/admin/availability` | direct `fetch('/api/cms/booking/schedule')` |
| `CookiesManager`, `CookieScanner` | `/admin/cookies` | `getCookieCatalog`, `create/update/deleteCookieCategory`, `create/update/deleteCookieService`, `getCookieScan` |
| `ScriptsManager` | `/admin/scripts` | `listScripts`, `createScript`, `updateScript`, `deleteScript` |
| `AccountSecurity`, `MfaEnrollPanel`, `RecoveryCodesPanel` | `/admin/account` | `get2faStatus`, `start2faEnroll`, `confirm2faEnroll`, `disable2fa`, `regenerate2faRecoveryCodes` |
| `LoginForm`, `MfaBypassDialog` | `/admin/login` | `login`, `verify2fa`, `send2faCode`, `bypass2fa` |
| `SettingsForm` | `/admin/settings` (group tabs) | `updateSiteSettings` |
| `BrandSettings`, `StructuredDataSettings`, `SeoFieldsManager`, `CustomFieldsManager` | Settings tabs | `updateSiteSettings` |
| `ShippingSettings`, `CouponsManager`, `WishlistSettings`, `GiftCardSettings` | Settings -> Ecommerce | `updateSiteSettings` |
| `ShippingMethodsManager` | Settings -> Ecommerce -> Shipping | `saveShippingZone`, `deleteShippingZone`, `saveShippingMethod`, `deleteShippingMethod` |
| `CourierCredentials` | Settings -> Ecommerce -> Shipping | `saveCourierSecret` |
| `ApiTokensManager` | Settings -> Connect to Praion.ai | `listApiTokens`, `importApiToken`, `revokeApiToken` |
| `TopBar` / `IdleLogout` | shell | `logout`; `fetch('/api/cms/auth/me')` |

Field-level components that call the API: `MediaPicker` (`listMedia`, `uploadMedia`), `RelationPicker` (`list(field.to)`), `TermPicker` (`list`, `create`, `update`, `remove` on the taxonomy collection).

Edit locks are used by `DocumentForm`, `OrdersTable` and `ReservationsTable` (all through `useEditLock`).

### 5.4 Field components

`FieldInput` handles, in order:

1. `field.hidden` -> null.
2. `isFieldVisible(field, siblings, peers)` false -> null. The value stays in `data`.
3. `group` -> `GroupControl`, which uses `buildBlocks` internally, so sub-sections work inside groups too.
4. `repeater` -> `RepeaterControl` (add/remove/duplicate/reorder with `IconButton`s, row summary from the first text field).
5. `variations` -> `VariationsEditor` in a `Section`, reading the sibling `attributesKey`.
6. `localized: true` -> `LocalizedField`: a per-locale tab strip that stores `{ [locale]: value }`.
7. Everything else -> `<Field label required description error composite={isComposite(field)}><LeafControl/></Field>`.

`LeafControl` by kind:

| `kind` | Control |
|---|---|
| `text` | `TextInput` (`maxLength`) |
| `textarea` | `Textarea` (`rows`, `maxLength`) |
| `richText` | `RichTextEditor` (TipTap JSON) |
| `code` | `MdxBodyEditor` when `isMdxPreviewField(field)`, else a monospace `Textarea` (spellcheck on only for `mdx`) |
| `number` | `TextInput type=number`. `min`/`max` come from the literal or from `boundsFrom` against `root`. Optional "Count from text" button (`countWordsFrom`). |
| `boolean` | checkbox with "Enable"/"Enabled" |
| `select` | `Select`, or `MultiSelect` chips when `multiple` |
| `date` | `date` or `datetime-local` (`withTime`) |
| `monthDay` | `MonthDayControl` |
| `color` | `ColorControl` |
| `image` | `MediaPicker` (value = media uuid) |
| `relation` | `TermPicker` for `picker: 'categoryTree' | 'termList'`, else `RelationPicker` |

`isComposite` marks `richText`, `image`, `relation`, `color`, `monthDay` and multi-`select`. For those, `Field` renders a labelled `role="group"` instead of cloning an `id` onto a React component, where it would never reach the DOM. `code`/MDX is deliberately **not** composite: its textarea takes the `id`.

---

## 6. Styling and accessibility conventions

- **Tailwind v4** utility classes only (`tailwindcss@4`, `@tailwindcss/postcss`). There are no CSS modules under `src/cms` or `src/app/admin`. Variants use `class-variance-authority`, and classes merge with `cn()` (`clsx` + `tailwind-merge`).
- Palette: a neutral base plus the brand tokens `warm-gold`, `warm-gold-dark`, `warm-gold-deep`, `midnight-navy` and `soft-pearl`, defined in `src/app/globals.css` and overridden at runtime by `<BrandStyle />`. Fonts are `font-body` (Inter) and `font-display` (Fraunces). Corners are `rounded-sm`.
- Page skeleton: `<div className="flex flex-col gap-6"><h1 className="text-xl font-semibold text-neutral-900">...</h1>...</div>`. Exactly one `<h1>` per page, because the top bar title is not a heading.
- Server -> client props must be serialisable. Pages pass DB rows as `JSON.parse(JSON.stringify(rows))` so Dates become strings, or convert explicitly (`toISOString()`). `ResolvedCollection` is plain data and can cross the boundary. The full `CmsConfig` (it holds Maps) cannot.
- Tables: use `Table/Thead/Tbody/Th/Td`. `Table` wraps the table in a focusable `overflow-x-auto` group (`tabIndex=0`, `role="group"`, `aria-label`) so a table that scrolls sideways can be reached by keyboard. The shell's `<main>` is `overflow-x-hidden`, so every wide element needs its own scroll box.
- Labels: always wrap controls in `Field`. It mints ids with `useId`, ties the description (behind an `InfoTip`) through `aria-describedby`, and sets `aria-invalid`. For a label plus several elements, pass a render function: `<Field label="...">{(control) => <Select {...control} />}</Field>`.
- Dialogs: use `useConfirm()` for confirmations and `useDialog()` for custom modals (focus trap, Escape, scroll lock, focus restore). `window.confirm` remains only in `useUnsavedChangesGuard`, which needs a synchronous answer.
- Tabs: use `ui/Tabs` (roving tabindex, arrow keys, panels stay mounted via `hidden`).
- Messages: errors use `role="alert"`. Successes and non-fatal warnings use `role="status"`. A save that half-succeeded is amber, not red.
- Status and state are never conveyed by colour alone: shapes (hollow ring, dashed chip, line-through), `sr-only` text and `aria-label` on badges.
- Icons are decorative (`aria-hidden`). Icon-only buttons need an `aria-label`. `IconButton` has a 36 px minimum hit area.
- Server-rendered interactive screens that accept input before hydration should gate on `useHydrated()`. `DocumentForm`, `ReviewsTable` and `SubscribersTable` do.

---

## 7. Configuration

| Setting | Read by | Effect |
|---|---|---|
| `collection.icon`, `label`, `labelPlural`, `hidden`, `module`, `titlePath`, `sections`, `advisories`, `seo`, `fields` | `site.config.ts` -> sidebar, dashboard, list, form | See 03. `icon` must be a key in `ICONS` (`ui/Icon.tsx`). Unknown names render the `FileEdit` fallback. |
| Module flags (`resolveModuleFlags`) | shell, dashboard, settings, module pages | Hide module collections/tools; module pages `notFound()`. |
| `ADMIN_SESSION_IDLE_MINUTES` | `sessionIdleSeconds()` -> `IdleLogout` | Idle window (default 60). |
| `CMS_LOCK_INTERNAL_SECRET` | `locksEnabled()` | Enables edit locks. Without it the provider is inert. |
| `NEXT_PUBLIC_CMS_LOCK_WS_URL` | `EditLockProvider` | Dev override for the lock relay URL. |
| `ADMIN_PATH` | `getAdminPath()` | The public admin segment. Server code builds every admin link and redirect with `adminHref(getAdminPath(), …)` (`src/cms/admin/admin-path.ts`); client components (`Sidebar`, `TopBar`, `DocumentList`, `DocumentForm`, `IdleLogout`, `LoginForm`) receive it as an `adminPath` prop. `src/proxy.ts` rewrites `/<ADMIN_PATH>/**` onto the `src/app/admin` route tree. |
| Settings `?tab=` / `?sub=`, editor `?locale=` / `?import=1`, list `?q=&status=&page=` | URL | Deep-linkable UI state. |

---

## 8. Extending

### 8.1 Add a new admin screen

1. Create `src/app/admin/(shell)/<name>/page.tsx` as an async server component:

```tsx
import { notFound } from 'next/navigation';

import { WidgetsManager } from '@/cms/admin';
import { isModuleEnabled } from '@/cms/core';
import { hasPerm, PERMISSIONS, requirePerm } from '@/cms/modules/auth';
import { listWidgets } from '@/cms/modules/widgets';
import config from '@/site.config';

export const dynamic = 'force-dynamic';

export default async function WidgetsPage() {
  if (!(await isModuleEnabled(config, 'widgets'))) notFound(); // if module-owned
  const user = await requirePerm(PERMISSIONS.widgetsRead);      // ALWAYS guard the page itself
  const canWrite = hasPerm(user.permissions, PERMISSIONS.widgetsWrite);
  const rows = await listWidgets();
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-neutral-900">Widgets</h1>
      <WidgetsManager initial={JSON.parse(JSON.stringify(rows))} canWrite={canWrite} />
    </div>
  );
}
```

2. Create `src/cms/admin/WidgetsManager.tsx` (`'use client'`). Build it from the UI kit (`Table`, `Button`, `Field`, `Drawer`, `useConfirm`). Call the API through new named helpers on `cmsApi`, or through the generic `list/update/remove` when your route follows the list/data envelope. Report failures with `apiErrorText`.
3. Export it from `src/cms/admin/index.ts`.
4. Pick a folder name that is not a collection key or alias. Otherwise the static route shadows `[collection]`.
5. Add the nav item (8.2) and a test (section 9).

### 8.2 Add a nav item gated by a module and permission

In `src/app/admin/(shell)/layout.tsx`, push onto `tools` next to the related entries:

```ts
if (moduleFlags.widgets && can(PERMISSIONS.widgetsRead))
  tools.push({ href: href('widgets'), label: 'Widgets', icon: 'widgets', group: 'widgets' });
```

- Without `group` (or with an unknown one) the item lands in **System**.
- To give a module its own sidebar heading, add `{ module: 'widgets', label: 'Widgets', group: 'widgets' }` to `MODULE_GROUPS` in `src/cms/admin/shared.ts`. The module's collections (`collection.module === 'widgets'`) then move into that section too. Extend `test/cms/sidebar-groups.test.ts`.
- Add the icon to `ICONS` in `src/cms/admin/ui/Icon.tsx` (import it from `lucide-react`) and its name to `ICON_NAMES` in `src/cms/admin/ui/icon-names.ts`; `ICONS` is `Record<IconName, …>`, so missing either half fails `tsc`.
- The sidebar entry only controls visibility. Keep the page guard (8.1) and the module `notFound()`.
- `TopBar` picks up the label automatically, because `items` is built from `tools`.

### 8.3 Add a field component

A new `kind` touches the config, validation and UI:

1. `src/cms/config/fields.ts`: add the kind to `FieldKind`, define `interface FooField extends BaseField { kind: 'foo'; ... }`, add it to the `Field` union and an `f.foo()` builder.
2. `src/cms/config/zod.ts`: produce its validator (see 03).
3. `src/cms/admin/fields/Foo.tsx`: a `'use client'` control with the signature `{ value: unknown; onChange: (v: unknown) => void; ... }`. Accept and forward `id`, `aria-describedby` and `aria-invalid` onto the real DOM control, if it has one.
4. `src/cms/admin/fields/FieldInput.tsx`:
   - add `case 'foo': return <Foo {...a11y} value={...} onChange={onChange} />;` to `LeafControl`;
   - if the control has no single labelable element, add `'foo'` to `isComposite`;
   - if it needs sibling or document context, read `siblings` / `root` / `peers` from the props rather than adding new plumbing.
5. If it needs module switches, call `useModuleFlags()`. If it needs the API, use `cmsApi`.
6. Also check `summaryValue` (repeater row summaries) and anything else that switches on `kind` (`grep -rn "kind ===" src/cms`).

### 8.4 Link a public page to its admin edit screen via the admin bar

In the server component that loads the document for display, render `AdminEditTarget` with the loaded row:

```tsx
import { AdminEditTarget } from '@/components/admin-bar/AdminEditTarget';

export default async function ThingPage({ params }: PageProps) {
  const doc = await resolveRenderDoc(/* ... */); // must expose { type, id, locale }
  if (!doc) notFound();
  return (
    <>
      <AdminEditTarget doc={doc} />
      {/* ...page... */}
    </>
  );
}
```

- `doc` needs `type` (collection key), `id` (the row actually displayed) and `locale`. When a reader returns a summary without these, extend it as `listProductsByCategory`/`listProductsByTag` were extended (the `document` field on `CategoryProducts`/`TagProducts` in `src/cms/modules/commerce/read.ts`).
- Render it at most once per page. The last registration wins.
- `test/site/admin-edit-wiring.test.ts` fails when a `.tsx` under `src/app/[locale]` or `src/components` calls one of `resolveRenderDoc(`, `getPublishedDocument(`, `getProduct(`, `resolveBookingPricing(`, `listProductsByCategory(`, `listProductsByTag(` without also containing `<AdminEditTarget `. If you add a new document loader, add it to `DOCUMENT_LOADERS` in that test.
- For sites generated by the new-site skill, the same wiring lives in `.claude/skills/new-site/templates/content/*.tsx.tpl` and `base/locale-layout.tsx.tpl`. Keep them in step.

---

## 9. Testing

Run a single file:

```bash
npx tsx --tsconfig ./tsconfig.test.json --test test/components/admin-bar.test.tsx
```

`npm test` runs the whole suite (see the `test` glob in `package.json`). `.tsx` tests must `import '../setup/react-global'` first. They render with `renderToStaticMarkup`, and there is no DOM harness. For that reason logic is pulled into pure modules (`shared.ts`, `status-options.ts`, `local-datetime.ts`, `login-error.ts`, `mfa-bypass-hotkey.ts`, `fields/mdx/*`) that can be tested directly. `tsconfig.test.json` maps `server-only` to a stub.

| Test | Covers |
|---|---|
| `test/components/admin-bar.test.tsx` | `adminBarFor` (visitor/non-admin/admin, `canEdit` = `cms.content.read`, locale fallback to `el`, preview-only bar with no admin data), `adminEditHref`, `exitPreviewHref`, `AdminBarView` markup and labels, `AdminBarProvider` renders children only for `null`. |
| `test/components/admin-sidebar-back-to-site.test.tsx` | "Back to site" exists, has `href="/"`, sits between brand and Dashboard, never marked active. Renders `Sidebar` inside Next's `PathnameContext`. |
| `test/site/admin-edit-wiring.test.ts` | Source scan: every document-rendering page/section registers `<AdminEditTarget>`; `HomeHero` passes `doc`. |
| `test/cms/sidebar-groups.test.ts` | `groupSidebarItems` sectioning. |
| `test/cms/admin-content-collections.test.ts` | `visibleAdminCollections`. |
| `test/cms/form-sections.test.ts` | `buildBlocks`. |
| `test/cms/show-if.test.ts` | `showIf` visibility. |
| `test/cms/publish-rights.test.ts` | status-option rules against the server rule. |
| `test/cms/local-datetime.test.ts` | UTC/local conversion (pin `TZ`). |
| `test/booking/advisories.test.ts` | `ADVISORIES['booking-pricing']` path mapping. |
| `test/cms/admin-deep-link.test.ts`, `test/cms/safe-next.test.ts` | Post-login return path. |
| `test/cms/edit-lock.test.ts`, `test/core/locks.test.ts` | Lock phase/rooms logic. |
| `test/cms/admin-table-markup.test.tsx`, `admin-info-tips.test.tsx`, `admin-help-tips.test.tsx`, `info-tip.test.tsx`, `drawer.test.tsx` | UI kit markup and a11y. |
| `test/cms/mdx-markdown-actions.test.ts`, `mdx-preview-state.test.ts`, `insert-shortcode-dialog.test.tsx` | Body editor. |
| `test/cms/orders-editor-readonly.test.tsx`, `order-fulfilment.test.tsx`, `order-editor-lines.test.ts`, `reservations-admin.test.tsx`, `scripts-manager.test.tsx`, `user-create-form.test.tsx`, `media-alt-text.test.tsx`, `brand-settings.test.tsx`, `structured-data-settings.test.tsx`, `commerce-settings-ui.test.tsx`, `recovery-codes-panel.test.tsx` | Individual managers. |
| `test/cms/session-idle.test.ts` | `idleState`, refresh cadence. |

New screens should get at least a markup test of the client component, rendered with fixtures, that asserts the `canWrite=false` state hides write controls.

---

## 10. Gotchas and invariants

- **The nav is not access control.** Every page calls `requirePerm` (or `requireAuth` for `/admin/account`), and every route handler checks again. A new page without its own guard is reachable by any `cms.access` user who types the URL.
- **Module pages must `notFound()` when the module is off.** The sidebar hides them, but bookmarks do not.
- **Static tool routes shadow `[collection]`.** Do not name a tool folder after a collection key or alias (`bookings` -> `booking` is the documented example).
- **Never write a literal `/admin` link.** The route folder is `src/app/admin`, but the public segment is `ADMIN_PATH`: `src/proxy.ts` rewrites `/<ADMIN_PATH>/**` onto the route tree and, once the admin has moved, answers `/admin/**` with a plain 404 (outside i18n). Build hrefs and redirects with `adminHref(adminPath, 'path')` from `src/cms/admin/admin-path.ts`; in a client component take `adminPath` as a prop resolved on the server (it is not a `NEXT_PUBLIC_` variable). `usePathname()` returns the public URL, so compare active links against `adminHref(...)`, not `/admin/...`. Covered by `test/cms/admin-path.test.ts`.
- **Collection icons must be one of `ICON_NAMES`** (`src/cms/admin/ui/icon-names.ts`), not any lucide name. `<Icon name>` is typed `IconName`, so a bad literal fails `tsc`; `CollectionDefinition.icon` and the taxonomy `icon` option are typed `IconName` as well, so a bad collection icon fails `tsc` too; `collectionIcon()` remains as a runtime fallback (draws `file-text`, warns once outside production). To add an icon, import it in `ui/Icon.tsx` and list it in `icon-names.ts` (the map is `Record<IconName, …>`, so missing either half fails to compile). Do not bundle all of lucide.
- **Do not remount `DocumentForm` with `key`.** Use `serverStamp`. A remount loses the active tab and unsaved work in other tabs.
- **Save writes only the active locale.** Siblings receive only slug and `shared` field changes, guarded by `expectedVersion`. A 409 on a sibling is reported as a warning, not an error.
- **There is no autosave.** Unsaved-work protection is `useUnsavedChangesGuard` (beforeunload + capture-phase click on same-origin `<a href="/...">`) plus Cancel's confirm. Programmatic `router.push` calls are not guarded.
- **Date-times are UTC on the wire.** "Publish at" and the generic `date` field with `withTime: true` both convert with `local-datetime.ts` (`dateFieldToInput`/`dateFieldFromInput` for the field): the box shows the editor's clock, the stored value is a UTC instant, and the conversion waits for hydration. A value saved before this (zone-less `2026-10-01T09:30`) still displays as typed and is rewritten as UTC on the next save.
- **Advisories never block a save,** and must return paths the form actually renders. Otherwise the message is dropped silently. `advisories.ts` renames engine paths to form paths for that reason.
- **Restore reloads the page.** Do not "optimise" it to `router.refresh()` (one-second `updated_at` resolution).
- **Server Actions are public endpoints.** Any new one under `src/app/admin/actions` must call `requireApiPerm` itself and must return a status instead of throwing.
- **Admin bar privacy:** `AdminEditTarget` must keep checking the session server-side. Rendering `RegisterEditTarget` unconditionally would leak the admin path and document ids into public HTML. The bar reads the JWT snapshot (`getCurrentUser`, no database), so a just-revoked user may still see links, but the admin screens refuse them.
- **Admin bar in the layout:** `getCurrentUser()` and `draftMode()` in `src/app/[locale]/layout.tsx` read request state. The layout already read the customer cookie, so this is not expected to change static/dynamic rendering. Verify with a build if you depend on static output.
- **`DocumentList` first render:** the server page reads `?q=&status=&page=` through `parseDocumentListQuery` (`src/cms/admin/document-list-query.ts`), the same function that seeds the client's controls, and the client skips its first fetch on that basis. Keep both on that one parser. Delete is shown only when `canDeleteDocumentGroup` allows it: `cms.content.write`, plus `cms.content.publish` if any language is published or scheduled, mirroring the DELETE route (the list deletes every language, so a refused live one would leave the group half deleted).
- **Language tabs use `ui/TabList`.** `DocumentForm` cannot use `Tabs` (one form is re-rendered per language and a switch also moves `?locale=`), so it uses the controlled `TabList` that `Tabs` is built on: arrow keys/Home/End, one tab stop, every tab `aria-controls` the single form panel, which is `aria-labelledby` the selected tab. Build any new controlled tab strip on `TabList` too.
- **The form holds the slug the server stored.** Create and PATCH normalise a new slug; after a save `DocumentForm` adopts `res.data.slug` (`slugAfterSave`) and propagates that, not the typed value, to sibling languages.
- **Category/tag edit links:** `readProductsByCategory`/`readProductsByTag` pick the term row by slug with `limit(1)` and no locale filter. The Edit link opens whichever locale row came back, which is not necessarily the page's language.
