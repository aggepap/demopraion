'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useId, useMemo, useState } from 'react';

import { showIfConditions, visibleFields } from '../config';
/*
 * TYPE ONLY, and it must stay that way. `core/import/parse` reaches the drizzle
 * schema (for the status enum) and the MDX validator (for the guard), neither of
 * which has any business in a browser bundle — the same reason
 * `core/fields/mdx-validate.ts` explains for keeping itself out of the
 * `@/cms/config` barrel. The one predicate this file needs from it is a line
 * long and is written out below instead.
 */
import type { ImportedDocument } from '../core/import/parse';
import type { Field as FieldDef, ResolvedCollection } from '../config';
import {
  CUSTOM_FIELDS_DATA_KEY,
  documentCategoryIds,
  visibleCustomFields,
  type CustomFieldsConfig,
} from '../core/fields/definitions';
import { SEO_FIELDS_DATA_KEY, type SeoFieldDef } from '../core/seo/fields';
import { ADVISORIES } from './advisories';
import { cmsApi, CmsApiError } from './api-client';
import { documentLockKey } from '../core/locks/keys';
import { EditLockBanner } from './locks/EditLockBanner';
import { useEditLock } from './locks/use-edit-lock';
import { FieldInput } from './fields/FieldInput';
import { ImportMarkdownDialog } from './ImportMarkdownDialog';
import type { RenderMdxPreview } from './fields/mdx/preview-state';
import { SeoPanel, type SeoColumns } from './SeoPanel';
import { buildBlocks, labelText } from './shared';
import { Badge, Button, Field, Icon, InfoTip, Section, Select, TabList, tabDomIds, TextInput } from './ui';
import { useConfirm } from './ui/ConfirmDialog';
import { useUnsavedChangesGuard } from './use-unsaved-changes';
import { useHydrated } from './use-hydrated';
import { adminHref } from './admin-path';
import { slugAfterSave } from './document-save';
import { isoToLocalInput, localInputToIso, localTimeZoneName } from './local-datetime';
import { STATUS_HELP, statusHint, statusOptionDisabled } from './status-options';
import { VersionHistory } from './VersionHistory';

const STATUSES = ['draft', 'published', 'scheduled', 'archived'] as const;

/** Statuses that take a document off the public site rather than onto it. */
const NON_LIVE_STATUSES = new Set<string>(['draft', 'archived']);

const STATUS_TONE: Record<string, 'neutral' | 'green' | 'amber'> = {
  draft: 'neutral',
  published: 'green',
  scheduled: 'amber',
  archived: 'neutral',
};

/** One persisted locale variant, as loaded by the edit page. */
export interface DocumentInitial {
  id: number;
  slug: string;
  locale: string;
  status: string;
  data: Record<string, unknown>;
  metaTitle: string | null;
  metaDescription: string | null;
  /*
   * The rest of the SEO block. These columns have existed since the first
   * migration and were accepted by the write API all along, but nothing in the
   * admin could set them — see `SeoPanel`. (`canonical_path` is absent on
   * purpose: it is the routing index, derived from the slug, not an editable
   * field. The canonical *override* is `data.seo.canonicalUrl`.)
   */
  noindex: boolean;
  nofollow: boolean;
  includeInSitemap: boolean;
  ogImageUuid: string | null;
  /** `YYYY-MM-DD` or null — hydrates the backdating inputs. */
  publishedAt: string | null;
  modifiedAt: string | null;
  scheduledFor: string | null;
  /** Optimistic-concurrency token for this variant. */
  version: number;
}

/** A logical document: its shared slug + every existing locale variant. */
export interface DocumentGroupInitial {
  translationGroupId: string | null;
  slug: string;
  variants: DocumentInitial[];
}

/** In-memory editing state for a single language tab. */
interface LocaleState {
  /** Persisted row id, once this language exists. */
  rowId?: number;
  status: string;
  /**
   * The status as stored, which the options depend on: a writer may not take a
   * LIVE document down, whatever the select currently shows. Null before the
   * first save.
   */
  savedStatus: string | null;
  data: Record<string, unknown>;
  metaTitle: string;
  metaDescription: string;
  noindex: boolean;
  nofollow: boolean;
  includeInSitemap: boolean;
  ogImageUuid: string;
  publishedAt: string;
  modifiedAt: string;
  /** A UTC instant (ISO), or ''. Shown and typed in local time — see `local-datetime`. */
  scheduledFor: string;
  /** The version this tab was loaded at; sent back on save. */
  version: number;
  /** True once a row exists in the DB for this locale. */
  exists: boolean;
  /** Unsaved edits since the last save/load. */
  dirty: boolean;
}

/** Minimal shape of the row echoed back by create/update. */
interface SavedRow {
  id: number;
  translationGroupId: string | null;
  /** As stored — the server normalises a new slug (see `slugAfterSave`). */
  slug: string;
}

/**
 * Whether this collection has a markdown body, i.e. whether a `.md` file could
 * describe it. Mirrors `mdxBodyField` in `core/import` — see the import note
 * above for why it is not shared.
 */
function hasMarkdownBody(fields: FieldDef[]): boolean {
  return fields.filter((f) => f.kind === 'code' && f.language === 'mdx').length === 1;
}

/** Seed a new document's data from field `default`s (top-level, non-localized). */
function seedDefaults(fields: FieldDef[]): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  for (const f of fields) {
    const dv = (f as { default?: unknown }).default;
    if (dv !== undefined && !f.localized) d[f.key] = dv;
  }
  return d;
}

/**
 * Config-driven create/edit form with a language switcher. One logical document
 * spans a translation group; each configured locale is a tab. The slug is
 * shared across languages; status, dates, SEO, and all content are edited per
 * language. Saving persists the active language (creating its row on first
 * save) and keeps the shared slug in sync across sibling locales.
 */
export function DocumentForm({
  collection,
  locales,
  defaultLocale,
  canPublish = true,
  canWrite = true,
  initialGroup,
  serverStamp = '',
  customFields,
  seoFields = [],
  renderMdxPreview,
  adminPath,
}: {
  /** The admin URL segment (`ADMIN_PATH`), resolved on the server. */
  adminPath: string;
  /** Already merged with any admin-defined custom fields (see `core/fields`). */
  collection: ResolvedCollection;
  locales: string[];
  defaultLocale: string;
  /**
   * Whether this user holds `cms.content.publish`. Publishing is a separate
   * permission from editing, and the form used to ignore that: the Status
   * dropdown offered "published" and "scheduled" to someone the server would
   * refuse, so the only way to find out was to fill in a document and be told no.
   */
  canPublish?: boolean;
  /**
   * Whether this user holds `cms.content.write`. Only an editor takes the edit
   * lock: someone here to read must not lock the document out from under
   * somebody who can actually change it.
   */
  canWrite?: boolean;
  initialGroup?: DocumentGroupInitial;
  /**
   * Changes whenever the stored rows change. Used to notice that the server's copy
   * moved on — see the adoption effect below for why this is a prop and not a
   * remount `key`.
   */
  serverStamp?: string;
  /**
   * The raw custom-field definitions behind `collection`'s `custom` group.
   * Supplied so category-scoped fields appear/disappear as the editor changes
   * the categories, instead of only after a save + reload.
   */
  customFields?: CustomFieldsConfig;
  /**
   * The built-in SEO/AEO fields, already resolved against the admin's overrides.
   * Empty for a collection with `seo: false`, which then shows no SEO panel.
   *
   * Passed in rather than derived here because resolving them reads a setting,
   * and this is a client component — the same reason `customFields` is a prop.
   */
  seoFields?: SeoFieldDef[];
  /**
   * Renders an unsaved MDX body for the live preview pane, supplied by the site
   * as a Server Action. Optional: without it the body editor still works, it
   * just has no preview — the CMS core cannot render MDX itself.
   */
  renderMdxPreview?: RenderMdxPreview;
}) {
  const router = useRouter();
  const isEdit = Boolean(initialGroup);
  /** Ties the language tabs to the one form panel they all switch. */
  const tabsId = useId();
  const languagePanelId = `${tabsId}-language-panel`;

  // Top-level fields shared across the translation group (identical in every
  // locale row) — e.g. price, dimensions, the variation matrix.
  const sharedKeys = useMemo(
    () => new Set(collection.fields.filter((f) => f.shared).map((f) => f.key)),
    [collection.fields],
  );

  const seedStates = useCallback((): Record<string, LocaleState> => {
    const map: Record<string, LocaleState> = {};
    for (const l of locales) {
      const v = initialGroup?.variants.find((x) => x.locale === l);
      map[l] = v
        ? {
            rowId: v.id,
            status: v.status,
            savedStatus: v.status,
            data: v.data,
            metaTitle: v.metaTitle ?? '',
            metaDescription: v.metaDescription ?? '',
            noindex: v.noindex,
            nofollow: v.nofollow,
            includeInSitemap: v.includeInSitemap,
            ogImageUuid: v.ogImageUuid ?? '',
            publishedAt: v.publishedAt ?? '',
            modifiedAt: v.modifiedAt ?? '',
            scheduledFor: v.scheduledFor ?? '',
            version: v.version,
            exists: true,
            dirty: false,
          }
        : {
            status: 'draft',
            savedStatus: null,
            data: seedDefaults(collection.fields),
            metaTitle: '',
            metaDescription: '',
            // The column defaults, matching what the database would insert —
            // a new document must not look de-indexed in the form and then be
            // stored as indexed.
            noindex: false,
            nofollow: false,
            includeInSitemap: true,
            ogImageUuid: '',
            publishedAt: '',
            modifiedAt: '',
            scheduledFor: '',
            version: 0,
            exists: false,
            dirty: false,
          };
    }
    // Normalize shared fields from the primary row so every language tab shows
    // the same structural data even if older rows drifted apart.
    if (initialGroup && sharedKeys.size) {
      const primary =
        initialGroup.variants.find((x) => x.locale === defaultLocale) ?? initialGroup.variants[0];
      if (primary) {
        for (const key of sharedKeys) {
          const shared = (primary.data as Record<string, unknown>)[key];
          if (shared === undefined) continue;
          for (const l of locales) {
            map[l] = { ...map[l], data: { ...map[l].data, [key]: structuredClone(shared) } };
          }
        }
      }
    }
    return map;
  }, [collection.fields, defaultLocale, initialGroup, locales, sharedKeys]);

  // Seed one editing state per configured locale (once).
  const [states, setStates] = useState<Record<string, LocaleState>>(seedStates);

  const [slug, setSlug] = useState(initialGroup?.slug ?? '');
  const [savedSlug, setSavedSlug] = useState(initialGroup?.slug ?? '');
  const [groupId, setGroupId] = useState<string | null>(initialGroup?.translationGroupId ?? null);

  /*
   * Which language is being edited belongs in the URL.
   *
   * It was local state only, so a reload always landed on the first language that had a
   * version — throwing an editor working on the English translation back to the Greek
   * one — and "have a look at the English copy" could not be sent as a link. A query
   * param costs nothing and fixes both.
   *
   * An unknown or not-configured value in the param is ignored rather than honoured:
   * a hand-edited URL must not put the form into a language this collection has no tab
   * for.
   */
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedLocale = searchParams.get('locale');
  const firstExisting = locales.find((l) => states[l].exists);
  const [activeLocale, setActiveLocale] = useState(
    requestedLocale && locales.includes(requestedLocale)
      ? requestedLocale
      : isEdit
        ? (firstExisting ?? defaultLocale)
        : defaultLocale,
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Save succeeded, but a follow-up (cross-locale propagation) did not. */
  const [warning, setWarning] = useState<string | null>(null);
  /*
   * Said out loud, not inferred.
   *
   * Success was signalled only by the "Unsaved" label disappearing — an absence, which
   * is the weakest possible confirmation and indistinguishable from a save that never
   * started on a slow connection. `role="status"` so it is announced rather than only
   * seen.
   */
  const [saved, setSaved] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pathErrors, setPathErrors] = useState<Record<string, string[]>>({});
  const { confirm, dialog } = useConfirm();
  /*
   * Opened by `?import=1` so the list screen's "Import .md" button can land the
   * editor straight on the New form with the picker already up, rather than
   * making them find the button a second time.
   */
  const [importOpen, setImportOpen] = useState(searchParams.get('import') === '1');
  // Shared with the moderation screens, which had the same problem and no guard.
  const hydrated = useHydrated();

  /*
   * Take on the server's copy when it changes, without throwing the editor out of
   * what they were doing.
   *
   * The page used to force this by putting the group's last-modified stamps in the
   * form's React `key`, which remounts the whole form. That did fix the stale-form
   * problem it was added for — a restored version stayed invisible until a manual
   * reload, and the next Save wrote the old content back over it — but a remount
   * resets everything the form holds, and `router.refresh()` after an ordinary save
   * changes those stamps too. So the form's own save remounted it, asynchronously,
   * whenever the refresh happened to land: the language tab you were on snapped
   * back to the first one and unsaved edits in the other tabs were gone, with no
   * message and nothing to blame. On a fast machine the refresh landed before the
   * next click and it was invisible; under load it was not.
   *
   * Adopting the data instead keeps `activeLocale` and anything still unsaved. A
   * locale with unsaved edits is deliberately left alone rather than overwritten —
   * losing typed work to a background refresh is the worse failure — and is called
   * out, because its `version` is now behind and its next save will be refused as
   * the conflict it genuinely is.
   */
  const [seenStamp, setSeenStamp] = useState(serverStamp);
  if (serverStamp !== seenStamp) {
    // Adjusted during render, not in an effect: an effect would paint the old
    // content for a frame first, and React supports exactly this pattern for
    // reacting to a changed prop.
    const fresh = seedStates();
    const keptDirty = locales.filter((l) => states[l]?.dirty && fresh[l]?.exists);
    setSeenStamp(serverStamp);
    setStates(
      Object.fromEntries(locales.map((l) => [l, states[l]?.dirty ? states[l] : fresh[l]])),
    );
    if (keptDirty.length) {
      setWarning(
        `This document changed elsewhere — a restored version, or another editor. ` +
          `${keptDirty.map((l) => l.toUpperCase()).join(', ')} still has unsaved changes, so ` +
          `they were kept rather than discarded. Saving will be refused as a conflict; ` +
          `reload to take their copy and lose yours.`,
      );
    }
    // Nothing clears `warning` here on purpose. A save that succeeded but could not
    // copy its shared fields to the other locales sets that warning and then calls
    // `router.refresh()`, which lands right here — clearing it would erase the only
    // notice the editor gets that half of their save did not happen.
  }
  const anyDirty = locales.some((l) => states[l].dirty);

  // Unsaved work was protected on exactly one path — the Cancel button. A
  // sidebar link, the logo, or a browser reload all discarded it without a word
  // (F-012). The guard now lives in a shared hook, because the Settings screen
  // needed the same thing and a second copy would have drifted from this one.
  useUnsavedChangesGuard(anyDirty);

  /*
   * The lock covers the whole translation group, because this one screen edits
   * every locale of it — which row id happens to be in the URL depends only on
   * which language was opened. `groupId` is state rather than a prop because the
   * server assigns it on first save, so the key a new document starts on is not
   * the key it ends up on; `useEditLock` resubscribes when it changes.
   */
  const lockKey = documentLockKey({
    translationGroupId: groupId,
    variantIds: initialGroup?.variants.length
      ? initialGroup.variants.map((v) => v.id)
      : [0],
  });
  const lock = useEditLock({ type: 'document', key: lockKey, enabled: isEdit && canWrite });
  const readOnly = lock.readOnly;

  const active = states[activeLocale];
  /** Why some statuses are greyed out, for a role that cannot publish. */
  const writerHint = statusHint({ canPublish, saved: active.savedStatus });

  // Only collections a markdown file can describe — a product or a category has
  // nowhere to put everything below the closing `---`, and the server refuses
  // them anyway. Offering the button there would be a dead end.
  const canImport = useMemo(() => hasMarkdownBody(collection.fields), [collection.fields]);

  /**
   * Switch language tab.
   *
   * Every message on screen is about the save of one specific language. They
   * used to survive the switch, so after a rejected EL publish the untouched EN
   * tab showed the same four "… is required" errors and the same red banner, for
   * a save that had never been attempted. Each tab keeps its own content; the
   * verdict on the last save does not travel with it.
   */
  const switchLocale = (l: string) => {
    if (l === activeLocale) return;
    setActiveLocale(l);
    /*
     * `replace`, not `push`: the language tabs are one screen, and stacking a history
     * entry per switch would turn the browser's Back button into "undo my last tab
     * click" instead of "leave this document". `scroll: false` keeps the reading
     * position — switching language should not jump the page to the top.
     */
    const next = new URLSearchParams(searchParams.toString());
    next.set('locale', l);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    setError(null);
    setWarning(null);
    setSaved(null);
    setFieldErrors({});
    setPathErrors({});
  };

  // Conditional visibility: hide custom fields scoped to categories this
  // document isn't in. Recomputed from the live category selection so the form
  // reacts immediately; the server re-derives the same set from the submitted
  // data when it decides which fields are required.
  const categoryKey = documentCategoryIds(active.data).join(',');
  /*
   * `showIf` discriminators, and their current values, as a memo key.
   *
   * Depending on the whole `data` object would rebuild the field list on every
   * keystroke; depending on nothing would leave the transport fields on screen
   * after switching an experience to a stay. Only the values a condition
   * actually reads matter.
   */
  const conditionKeys = useMemo(
    () => [...new Set(collection.fields.flatMap((f) => showIfConditions(f).map((c) => c.field)))].sort(),
    [collection.fields],
  );
  const conditionKey = conditionKeys.map((k) => `${k}=${String(active.data[k] ?? '')}`).join('&');

  const effectiveFields = useMemo(() => {
    // Drop what a `showIf` hides FIRST, so a section whose every field is
    // conditional disappears with them instead of rendering an empty card —
    // `buildBlocks` groups by `section`, and a heading over nothing reads as a
    // broken form rather than an inapplicable one.
    // The compiled `seo` group is part of the collection's fields (that is how
    // it gets validated), but it is rendered by `SeoPanel`, not as one more
    // section in the stack. Leaving it in would show every SEO field twice.
    const base = visibleFields(collection.fields, active.data).filter(
      (f) => f.key !== SEO_FIELDS_DATA_KEY,
    );
    if (!customFields?.fields.length) return base;
    const categoryIds = categoryKey ? categoryKey.split(',').map(Number) : [];
    const visible = new Set(visibleCustomFields(customFields, categoryIds).map((d) => d.key));
    return base.flatMap((field) => {
      if (field.kind !== 'group' || field.key !== CUSTOM_FIELDS_DATA_KEY) return [field];
      const kept = field.fields.filter((sub) => visible.has(sub.key));
      return kept.length ? [{ ...field, fields: kept }] : [];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `conditionKey` stands in for the parts of `active.data` that matter.
  }, [collection.fields, customFields, categoryKey, conditionKey]);

  const blocks = useMemo(
    () => buildBlocks(effectiveFields, 'Content', { nestRepeaters: Boolean(collection.sections?.length) }),
    [effectiveFields, collection.sections],
  );

  /** Section title → how it presents itself. Empty for a collection that
   *  declares none, which is what keeps its form rendering as it always did. */
  const sectionMeta = useMemo(
    () => new Map((collection.sections ?? []).map((s) => [s.title, s])),
    [collection.sections],
  );

  /*
   * Advisory checks (see `advisories.ts`) run on every edit and are merged UNDER
   * the errors a save came back with: a 422 the server actually returned
   * describes the document as it was written and must not be overwritten by a
   * client-side opinion about the same field.
   *
   * Unlike `effectiveFields` this does depend on the whole `data` object — a
   * price band typed one digit at a time has to re-check on each keystroke, or
   * the message would describe the value before last.
   */
  const advisories = useMemo(() => {
    const check = collection.advisories ? ADVISORIES[collection.advisories] : undefined;
    if (!check) return {};
    try {
      return check(active.data, activeLocale);
    } catch {
      // An advisory is a convenience. A half-typed value that trips one of the
      // readers must not take the whole editor down with it.
      return {};
    }
  }, [collection.advisories, active.data, activeLocale]);

  const shownPathErrors = useMemo(
    () => ({ ...advisories, ...pathErrors }),
    [advisories, pathErrors],
  );

  /*
   * Does anything inside this section have something to say?
   *
   * By PREFIX, not by key: a message about an option's group brackets is
   * addressed `options.1.seasonal.0.brackets`, and matching only `options`
   * would leave it inside a folded card — which is the exact failure the
   * message channel exists to prevent.
   */
  const sectionHasMessage = (fields: FieldDef[]): boolean =>
    fields.some((f) =>
      [...Object.keys(shownPathErrors), ...Object.keys(fieldErrors)].some(
        (path) => path === f.key || path.startsWith(`${f.key}.`),
      ),
    );

  // The two halves of the SEO panel's state: the JSON-backed values under
  // `data.seo`, and the SEO columns held flat on the locale state.
  const rawSeo = active.data[SEO_FIELDS_DATA_KEY];
  const seoValues =
    typeof rawSeo === 'object' && rawSeo !== null && !Array.isArray(rawSeo)
      ? (rawSeo as Record<string, unknown>)
      : {};
  const seoColumns: SeoColumns = {
    metaTitle: active.metaTitle,
    metaDescription: active.metaDescription,
    noindex: active.noindex,
    nofollow: active.nofollow,
    includeInSitemap: active.includeInSitemap,
    ogImageUuid: active.ogImageUuid,
  };

  const patchActive = (patch: Partial<LocaleState>) => {
    // A "saved" banner sitting above unsaved edits states something untrue.
    setSaved(null);
    setStates((s) => ({ ...s, [activeLocale]: { ...s[activeLocale], ...patch, dirty: true } }));
  };

  const setFieldValue = (key: string, value: unknown) =>
    setStates((s) => {
      // Shared fields update every locale in memory so all tabs stay identical;
      // save propagates them to sibling rows.
      if (sharedKeys.has(key)) {
        const next: Record<string, LocaleState> = {};
        for (const l of locales) {
          next[l] = {
            ...s[l],
            data: { ...s[l].data, [key]: value },
            dirty: l === activeLocale ? true : s[l].dirty,
          };
        }
        return next;
      }
      return {
        ...s,
        [activeLocale]: {
          ...s[activeLocale],
          data: { ...s[activeLocale].data, [key]: value },
          dirty: true,
        },
      };
    });

  const copyFromDefault = () => {
    const src = states[defaultLocale];
    patchActive({
      data: structuredClone(src.data),
      metaTitle: src.metaTitle,
      metaDescription: src.metaDescription,
      // The rest of the SEO block comes across too.
      noindex: src.noindex,
      nofollow: src.nofollow,
      includeInSitemap: src.includeInSitemap,
      ogImageUuid: src.ogImageUuid,
    });
  };

  /**
   * Fill the active language tab in from a parsed `.md` file.
   *
   * Everything the file speaks for is replaced outright rather than merged: a
   * merge would leave fields from whatever was on screen before mixed in with
   * the imported ones, and no one could tell which half came from where. What
   * the file is silent about — the SEO block's `noindex`/`nofollow`, a date it
   * did not set — is left as it was, which is why those arrive as `null` rather
   * than as a default the file never chose.
   *
   * The slug is shared across the translation group, so it is only taken when
   * there is not one already: importing the English version of a saved document
   * must not rename the Greek one.
   */
  const applyImported = (imported: ImportedDocument) => {
    patchActive({
      data: imported.data,
      status: imported.status,
      metaTitle: imported.metaTitle,
      metaDescription: imported.metaDescription,
      ...(imported.noindex !== null ? { noindex: imported.noindex } : {}),
      ...(imported.nofollow !== null ? { nofollow: imported.nofollow } : {}),
      ...(imported.includeInSitemap !== null ? { includeInSitemap: imported.includeInSitemap } : {}),
      ...(imported.publishedAt ? { publishedAt: imported.publishedAt } : {}),
      ...(imported.modifiedAt ? { modifiedAt: imported.modifiedAt } : {}),
      ...(imported.scheduledFor ? { scheduledFor: imported.scheduledFor } : {}),
    });
    if (imported.slug && slug.trim() === '') setSlug(imported.slug);
    setError(null);
    setFieldErrors({});
    setPathErrors({});
    setSaved(null);
    // Said out loud: the form changing under you is otherwise the only sign the
    // import worked, and on a long form the changed part may be off-screen.
    setWarning(
      `Filled in from the file. Nothing is saved yet — check it over${
        imported.slug && slug.trim() !== '' && slug !== imported.slug
          ? `, and note the address stayed "${slug}" rather than becoming "${imported.slug}"`
          : ''
      }, then press Save.`,
    );
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setWarning(null);
    setFieldErrors({});
    setPathErrors({});
    /*
     * Without publish rights the publishing fields are left out of an update
     * entirely.
     *
     * The server decides by what a request *mentions*, not by what the row ends
     * up as — deliberately, so that editing the text of a published article is an
     * ordinary edit. But this form always sent the whole document, status and
     * dates included, so every save by a writer looked like a publish and was
     * refused. They could not fix a typo on a live page. The controls are
     * disabled for them anyway, so these values cannot have changed.
     */
    setSaved(null);
    const withholdPublishing = !canPublish && active.exists;
    const body = {
      slug,
      locale: activeLocale,
      data: active.data,
      metaTitle: active.metaTitle || null,
      metaDescription: active.metaDescription || null,
      noindex: active.noindex,
      nofollow: active.nofollow,
      includeInSitemap: active.includeInSitemap,
      ogImageUuid: active.ogImageUuid || null,
      modifiedAt: active.modifiedAt || null,
      ...(withholdPublishing
        ? /*
           * Withheld means the go-live fields, not the whole status.
           *
           * The Status select deliberately keeps `draft` and `archived` enabled for a
           * writer, because the server allows them: `requirePublishRights` gates only
           * what goes live. But the save dropped `status` entirely, so a writer who
           * archived a published article got no change and no error — they believed
           * they had taken a live page down and it was still up.
           *
           * Sending only a status that cannot go live keeps what this withholding was
           * for (F-034: an ordinary text edit must not read as a publish) and stops it
           * swallowing a change the server would have accepted.
           */
          NON_LIVE_STATUSES.has(active.status)
          ? { status: active.status }
          : {}
        : {
            status: active.status,
            publishedAt: active.publishedAt || null,
            scheduledFor: active.scheduledFor || null,
          }),
      // Proves this save is based on the copy we loaded; the server refuses it
      // if someone else has written to the document in the meantime.
      expectedVersion: active.version,
      translationGroupId: groupId ?? undefined,
    };
    try {
      let savedRowId = active.rowId;
      let nextGroupId = groupId;
      let storedSlug = slug;
      if (active.exists && active.rowId) {
        const res = await cmsApi.update<SavedRow>(collection.key, active.rowId, body);
        storedSlug = slugAfterSave(slug, res.data);
      } else {
        const res = await cmsApi.create<SavedRow>(collection.key, body);
        savedRowId = res.data.id;
        nextGroupId = res.data.translationGroupId ?? nextGroupId;
        storedSlug = slugAfterSave(slug, res.data);
      }

      // Keep the shared slug + shared structural fields (price, dimensions, the
      // variation matrix, …) consistent across the other existing locales —
      // with the slug as the server stored it, not as it was typed.
      const slugChanged = storedSlug !== savedSlug;
      const sharedData: Record<string, unknown> = {};
      for (const key of sharedKeys) sharedData[key] = active.data[key];
      const siblings = locales.filter(
        (l) => l !== activeLocale && states[l].exists && states[l].rowId,
      );
      if (siblings.length && (slugChanged || sharedKeys.size)) {
        // Its own try/catch on purpose. This is a SECOND request, about OTHER
        // language rows; sharing the outer one meant a sibling's 422 was
        // reported as "Validation failed." with field errors painted over the
        // active tab — whose save had already returned 200. The editor was told
        // their work failed when it had not.
        try {
          await Promise.all(
            siblings.map((l) => {
              const body: Record<string, unknown> = {};
              if (slugChanged) body.slug = storedSlug;
              /*
               * This carries the sibling's whole `data`, because a patch that
               * sends `data` replaces it — the shared keys alone would wipe the
               * rest of that language's content. But the copy it merges into is
               * the snapshot this tab loaded when it opened, so it is exactly the
               * shape of write that F-011 was about, one locale over: if someone
               * has legitimately saved that sibling since, this would overwrite
               * them with a stale copy and answer 200.
               *
               * `expectedVersion` closes it. A sibling that moved on refuses the
               * propagation instead of losing the other author's work, and the
               * catch below turns that into the amber warning — the primary save
               * has already succeeded and must not be reported as failed.
               */
              body.expectedVersion = states[l].version;
              if (sharedKeys.size) body.data = { ...states[l].data, ...sharedData };
              return cmsApi.update(collection.key, states[l].rowId!, body);
            }),
          );
          // Reflect the propagated shared data in local state — including each
          // sibling's new version. Without that, a second save in the same
          // session would send the version from before this propagation and be
          // refused as a conflict that never happened.
          setStates((s) => {
            const next = { ...s };
            for (const l of siblings) {
              next[l] = { ...s[l], data: { ...s[l].data, ...sharedData }, version: s[l].version + 1 };
            }
            return next;
          });
        } catch (err) {
          const conflict = err instanceof CmsApiError && err.status === 409;
          const reason = err instanceof CmsApiError ? err.message : 'unknown error';
          setWarning(
            conflict
              ? `${activeLocale.toUpperCase()} was saved. ` +
                `${siblings.map((l) => l.toUpperCase()).join(', ')} changed in another tab or by ` +
                `another editor, so the shared fields were NOT copied there — copying them would ` +
                `have overwritten that work. Reload to pick up their version, then save again.`
              : `${activeLocale.toUpperCase()} was saved. The shared fields could not be copied to ` +
                `${siblings.map((l) => l.toUpperCase()).join(', ')}: ${reason}`,
          );
        }
      }

      // Brand-new document → enter edit mode so the full group is loaded and the
      // remaining language tabs can attach translations to the persisted group.
      if (!isEdit) {
        router.push(adminHref(adminPath, `${collection.key}/${savedRowId}`));
        router.refresh();
        return;
      }

      setGroupId(nextGroupId);
      setSlug(storedSlug);
      setSavedSlug(storedSlug);
      setStates((s) => ({
        ...s,
        [activeLocale]: {
          ...s[activeLocale],
          rowId: savedRowId,
          exists: true,
          dirty: false,
          // What the server now holds. A writer's save withholds a live status,
          // so the stored one is unchanged in that case and this stays right.
          savedStatus: withholdPublishing && !NON_LIVE_STATUSES.has(s[activeLocale].status)
            ? s[activeLocale].savedStatus
            : s[activeLocale].status,
          // Every successful save appends exactly one version row, so the copy
          // we now hold is one ahead — without this a second save in the same
          // session would send a stale token and be refused as a conflict.
          version: s[activeLocale].version + 1,
        },
      }));
      setSaving(false);
      setSaved(`${activeLocale.toUpperCase()} saved.`);
      router.refresh();
    } catch (err) {
      if (err instanceof CmsApiError) {
        setError(err.message);
        const issues = err.issues as
          | { fieldErrors?: Record<string, string[]>; pathErrors?: Record<string, string[]> }
          | undefined;
        if (issues?.fieldErrors) setFieldErrors(issues.fieldErrors);
        // Full dotted paths (`header.eyebrow`) so a message inside a group or
        // repeater reaches the control it belongs to instead of stopping at
        // the top-level key.
        setPathErrors(issues?.pathErrors ?? {});
      } else {
        setError(err instanceof Error ? err.message : 'Save failed');
      }
      setSaving(false);
    }
  }

  const renderField = (field: FieldDef) => (
    <FieldInput
      key={field.key}
      field={field}
      locale={activeLocale}
      locales={locales}
      value={active.data[field.key]}
      onChange={(v) => setFieldValue(field.key, v)}
      error={shownPathErrors[field.key] ?? fieldErrors[field.key]}
      path={field.key}
      errorsByPath={shownPathErrors}
      siblings={active.data}
      root={active.data}
      peers={collection.fields}
      defaultLocale={defaultLocale}
      renderMdxPreview={renderMdxPreview}
    />
  );

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {/*
        Inputs stay inert until React has attached to them.

        The server sends the fields already filled with the stored content. If
        someone starts typing in that gap — easy on a fast machine, the page
        looks ready — the keystrokes go into a DOM node React has not adopted
        yet, and hydration then either discards them or merges them into the
        old value, producing text nobody typed. `display: contents` keeps the
        fieldset out of the layout entirely, so this changes behaviour only.
      */}
      {/*
        Outside the fieldset on purpose: it is the one control on the screen
        that must stay usable precisely when everything else is disabled.
      */}
      <EditLockBanner
        lock={lock}
        onCopyUnsaved={
          anyDirty
            ? () => {
                /*
                 * A disabled fieldset makes its text unselectable in most
                 * browsers, so someone who is taken over mid-sentence can see
                 * their work and not reach it. This turns a data-loss complaint
                 * into a paste.
                 */
                void navigator.clipboard?.writeText(
                  JSON.stringify(
                    Object.fromEntries(locales.map((l) => [l, states[l].data])),
                    null,
                    2,
                  ),
                );
              }
            : undefined
        }
      />
      {/*
        Read-only rides the fieldset that already exists for the hydration race,
        because it is the single place that reaches every control in the form —
        including the media pickers and repeaters, which have no idea a lock
        exists.
      */}
      <fieldset disabled={!hydrated || readOnly} className="contents">
      {/*
        Import sits with the language tabs, not on the list screen alone,
        because WHICH tab is showing is what an import fills in — and importing
        into an existing document's second language tab is how a translation
        gets written without a second write path.
      */}
      {canImport ? (
        <div className="flex items-center justify-end">
          <Button type="button" variant="ghost" onClick={() => setImportOpen(true)}>
            <Icon name="upload" className="mr-1.5 h-4 w-4" />
            Import .md
            {locales.length > 1 ? <span className="ml-1 uppercase">({activeLocale})</span> : null}
          </Button>
        </div>
      ) : null}

      {importOpen ? (
        <ImportMarkdownDialog
          collectionKey={collection.key}
          collectionLabel={labelText(collection.label, defaultLocale, collection.key)}
          activeLocale={activeLocale}
          onApply={applyImported}
          onClose={() => setImportOpen(false)}
        />
      ) : null}

      {/* Language tabs */}
      {locales.length > 1 ? (
        // Styled buttons that switch panels ARE tabs; without the roles a
        // screen reader announces a row of unrelated buttons and never says
        // which language is currently showing.
        <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200">
          {/*
            The shared `TabList`, so the language tabs get the whole ARIA
            pattern — arrow keys, one tab stop, `aria-controls` to the form
            below — rather than the roles alone. Controlled, because a switch
            here also moves `?locale=` and clears the last save's messages.
          */}
          <TabList
            label="Language"
            idPrefix={tabsId}
            activeId={activeLocale}
            onSelect={switchLocale}
            tabs={locales.map((l) => {
              const st = states[l];
              return {
                id: l,
                controls: languagePanelId,
                label: (
                  <>
                    <span className="uppercase">{l}</span>
                    {st.exists ? (
                      /*
                        Shape as well as colour. Draft and archived were both
                        `bg-neutral-300`, so the dot could not tell a language still being
                        written from one taken down — and on a touch screen there is no
                        hover to read the `title` with. Archived is a hollow ring; the
                        status is also named for assistive technology, since a coloured dot
                        says nothing to a screen reader.
                      */
                      <span
                        title={st.status}
                        aria-hidden="true"
                        className={`h-1.5 w-1.5 rounded-full ${
                          st.status === 'published'
                            ? 'bg-green-500'
                            : st.status === 'scheduled'
                              ? 'bg-amber-500'
                              : st.status === 'archived'
                                ? 'border border-neutral-400 bg-transparent'
                                : 'bg-neutral-400'
                        }`}
                      />
                    ) : (
                      <span title={`No ${l.toUpperCase()} version yet`} aria-hidden="true" className="text-xs text-neutral-600">
                        +
                      </span>
                    )}
                    <span className="sr-only">
                      {st.exists ? `— ${st.status}` : '— no version yet'}
                    </span>
                    {st.dirty ? <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> : null}
                  </>
                ),
              };
            })}
          />
          {/* Outside the tablist: only tabs belong inside one. */}
          <InfoTip label="What the language marks mean">
            Each language is saved and published on its own. The dot is its status: green published, amber
            scheduled, grey draft, hollow ring archived. “+” means no version in that language yet. A
            second amber dot means unsaved changes.
          </InfoTip>
        </div>
      ) : null}

      <div
        className="flex flex-col gap-6 lg:flex-row lg:items-start"
        // One panel serves every language tab: its content is re-rendered for
        // the selected one, so it is labelled by whichever tab that is.
        {...(locales.length > 1
          ? {
              role: 'tabpanel',
              id: languagePanelId,
              'aria-labelledby': tabDomIds(tabsId, activeLocale).tab,
            }
          : {})}
      >
        {/* Left: content sections */}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {error ? (
            <div role="alert" className="rounded-sm border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          {/* Amber, not red: the save itself worked — something secondary did
              not. Reporting it as a failure was the bug. */}
          {warning ? (
            <div role="status" className="rounded-sm border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {warning}
            </div>
          ) : null}

          {saved && !warning && !error ? (
            <div role="status" className="rounded-sm border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">
              {saved}
            </div>
          ) : null}

          {!active.exists && isEdit ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <span>
                No <strong className="uppercase">{activeLocale}</strong> version yet — fill it in and
                save to create it.
              </span>
              {activeLocale !== defaultLocale && states[defaultLocale].exists ? (
                <span className="inline-flex items-center gap-1.5">
                  <Button type="button" variant="ghost" onClick={copyFromDefault}>
                    Copy from {defaultLocale.toUpperCase()}
                  </Button>
                  <InfoTip label={`About copying from ${defaultLocale.toUpperCase()}`}>
                    Replaces what is in this form with the {defaultLocale.toUpperCase()} content and SEO settings,
                    ready for you to translate. Nothing is saved until you press Create.
                  </InfoTip>
                </span>
              ) : null}
            </div>
          ) : null}

          {blocks.map((block, i) =>
            block.type === 'field' ? (
              renderField(block.field)
            ) : (
              <Section
                key={`${block.title}-${i}`}
                title={block.title}
                description={sectionMeta.get(block.title)?.description}
                /*
                 * Collapsed only where the collection says so, and only while
                 * the section holds no message: a folded card cannot show the
                 * error that names the field inside it, which is the same trap
                 * `Section`'s own reveal logic exists to avoid.
                 */
                defaultOpen={
                  !sectionMeta.get(block.title)?.collapsed || sectionHasMessage(block.fields)
                }
              >
                {block.fields.map(renderField)}
              </Section>
            ),
          )}

          {/* SEO sits with the content, not beside it: it is part of writing
              the page, and as a collapsed box in the rail it was two fields
              nobody opened. */}
          {seoFields.length ? (
            <SeoPanel
              defs={seoFields}
              locale={activeLocale}
              locales={locales}
              defaultLocale={defaultLocale}
              values={seoValues}
              onValuesChange={(next) => setFieldValue(SEO_FIELDS_DATA_KEY, next)}
              columns={seoColumns}
              onColumnsChange={patchActive}
              errorsByPath={pathErrors}
            />
          ) : null}
        </div>

        {/* Right rail: sticky save + document meta */}
        {/* `order-first` below `lg`: stacked after the fields, Save and Slug sat
            under a form several thousand pixels tall, so saving meant scrolling
            past every section to reach them. The order swap has to be on this
            element — it is the flex child of the two-column wrapper. */}
        <aside aria-label="Document settings" className="order-first w-full shrink-0 lg:order-none lg:w-80">
          <div className="flex flex-col gap-4 lg:sticky lg:top-4">
            <div className="sticky top-0 z-20 flex items-center gap-2 rounded-sm border border-neutral-200 bg-white p-3 lg:static">
              <Button type="submit" disabled={saving || readOnly}>
                {saving
                  ? 'Saving…'
                  : active.exists
                    ? `Save ${activeLocale.toUpperCase()}`
                    : isEdit
                      ? `Create ${activeLocale.toUpperCase()}`
                      : `Create ${labelText(collection.label, defaultLocale, collection.key)}`}
              </Button>
              <Button
                type="button"
                variant="ghost"
                // "Unsaved" was shown right next to a Cancel that discarded
                // without a word. Any locale being dirty counts — the tab you
                // are not looking at holds unsaved work just the same.
                onClick={async () => {
                  const dirty = locales.some((l) => states[l].dirty);
                  if (dirty) {
                    const ok = await confirm({
                      title: 'Discard unsaved changes?',
                      message: 'Everything you have changed since the last save will be lost.',
                      confirmLabel: 'Discard',
                    });
                    if (!ok) return;
                  }
                  router.push(adminHref(adminPath, collection.key));
                }}
              >
                Cancel
              </Button>
              {active.dirty ? (
                <span className="ml-auto inline-flex items-center gap-1 text-xs text-amber-600">
                  Unsaved
                  <InfoTip label="About unsaved changes">
                    This language has changes that are not saved yet. Save stores only the language you are
                    looking at; other languages keep their own unsaved changes until you save them too.
                  </InfoTip>
                </span>
              ) : null}
            </div>

            <Section title="Document" collapsible={false}>
              <Field
                label="Slug"
                required
                description="The last part of the web address, e.g. “about” in /about. Shared by every language. Changing it on a live page moves the page; the old address is redirected to the new one automatically (listed under SEO → Redirects), so existing links keep working."
              >
                <TextInput value={slug} onChange={(e) => setSlug(e.target.value)} required />
              </Field>
              <Field label={`Status — ${activeLocale.toUpperCase()}`} description={STATUS_HELP}>
                {(control) => (
                  <>
                    <Select
                      {...control}
                      value={active.status}
                      onChange={(e) => patchActive({ status: e.target.value })}
                    >
                      {STATUSES.map((s) => (
                        <option
                          key={s}
                          value={s}
                          /*
                            Disabled rather than removed. A writer opening an already
                            published document has to see that it IS published — drop
                            the option and the select falls back to the first entry,
                            which would quietly offer to unpublish it on the next save.
                            On a live document a writer cannot pick draft or archived
                            either: taking it down is a publishing decision too.
                          */
                          disabled={statusOptionDisabled(s, {
                            canPublish,
                            current: active.status,
                            saved: active.savedStatus,
                          })}
                        >
                          {s}
                        </option>
                      ))}
                    </Select>
                    {/*
                      Visible, not behind the "i": it explains why options are greyed
                      out, and a writer who cannot see that thinks the form is broken.
                    */}
                    {writerHint ? <p className="text-xs text-neutral-600">{writerHint}</p> : null}
                  </>
                )}
              </Field>
              <div>
                {/*
                  Named, not just coloured. This badge is the at-a-glance answer to "what
                  is this document right now", and as a bare coloured word it was neither
                  announced as anything in particular nor findable as the status — a
                  search for the word "published" on this screen also matches the option
                  in the dropdown above it.
                */}
                <Badge
                  tone={STATUS_TONE[active.status] ?? 'neutral'}
                  aria-label={`Current status: ${active.status}`}
                >
                  {active.status}
                </Badge>
              </div>
            </Section>

            <Section title="Publishing" defaultOpen={active.status === 'scheduled'}>
              {/*
                "Scheduled" was selectable with nowhere to put the date: the
                document saved with `scheduledFor: null` and simply never went
                live — a status that silently did nothing. The field appears
                (and the section opens) as soon as that status is chosen.
              */}
              {active.status === 'scheduled' ? (
                <Field
                  label="Publish at"
                  required
                  description={
                    'When this document goes live, in your local time' +
                    (hydrated && localTimeZoneName() ? ` (${localTimeZoneName()})` : '') +
                    '. Without it, a scheduled document never publishes.'
                  }
                  error={!active.scheduledFor ? ['Pick a date and time, or change the status.'] : null}
                >
                  {/*
                    The state holds the UTC instant; the box shows and takes the
                    editor's own clock. Converted only once hydrated — the server
                    rendering this does not know the editor's time zone.
                  */}
                  <TextInput
                    type="datetime-local"
                    value={hydrated ? isoToLocalInput(active.scheduledFor) : ''}
                    disabled={!canPublish}
                    onChange={(e) => patchActive({ scheduledFor: localInputToIso(e.target.value) })}
                  />
                </Field>
              ) : null}
              <Field
                label="Published date"
                description="The date shown as when this was published. Set an earlier date if it first appeared elsewhere; left empty, publishing fills in today."
              >
                <TextInput
                  type="date"
                  value={active.publishedAt}
                  // A publication date takes a document live on its own, which is
                  // why the server counts it as publishing.
                  disabled={!canPublish}
                  onChange={(e) => patchActive({ publishedAt: e.target.value })}
                />
              </Field>
              <Field
                label="Modified date"
                /*
                  Named the schema.org property, which is the one thing an editor has no
                  way to know. What they need to know is what the date does.
                */
                description="When the content was meaningfully revised — search engines show this. Leave empty to use the published date."
              >
                <TextInput
                  type="date"
                  value={active.modifiedAt}
                  onChange={(e) => patchActive({ modifiedAt: e.target.value })}
                />
              </Field>
            </Section>

            {active.exists && active.rowId ? (
              <VersionHistory
                key={active.rowId}
                collection={collection.key}
                documentId={active.rowId}
                // Every save appends exactly one version, so the local version number
                // is the cheapest thing that changes when the list has grown.
                reloadKey={active.version}
              />
            ) : null}
          </div>
        </aside>
      </div>
      </fieldset>
      {dialog}
    </form>
  );
}
