import 'server-only';

import { revalidateTag } from 'next/cache';
import { z } from 'zod';

import type { CmsConfig } from '../../config';
import { PERMISSIONS, requireApiPerm } from '../../modules/auth';
import { logAudit } from '../audit';
import { createRoute } from '../api/handler';
import { ok } from '../api/respond';
import { ApiError, invalidInput } from '../errors';
import { sanitizeSeoFieldOverrides } from '../seo/field-overrides';
import { validateSettingValue } from '../settings/validate';
import {
  CUSTOM_FIELDS_KEY,
  EXTRA_MANAGED_KEYS,
  getSettings,
  getSettingUncached,
  I18N_LOCALES_KEY,
  MANAGED_SETTING_KEYS,
  MANAGED_SETTINGS,
  moduleSettingKey,
  resolveLocaleSet,
  SEO_FIELDS_KEY,
  setSetting,
  SETTINGS_TAG,
} from '../settings';

/** All settings keys this API manages: the general fields, structured extras
 *  (e.g. shipping config), one flag per configured module (`module.<name>`),
 *  plus language enablement (`i18n.locales`). Writes to any other key are ignored. */
function managedKeys(config: CmsConfig): string[] {
  return [
    ...MANAGED_SETTING_KEYS,
    ...EXTRA_MANAGED_KEYS,
    ...Object.keys(config.modules).map(moduleSettingKey),
    I18N_LOCALES_KEY,
  ];
}

const localeSettingsBody = z
  .object({ editing: z.array(z.string()), public: z.array(z.string()) })
  .partial();

/**
 * Normalize an incoming `i18n.locales` value: drop anything not installed,
 * force the (fixed) main locale into both sets, keep `public ⊆ editing`, and
 * order both by the installed-locale order. Returns null if the shape is
 * invalid (the write is then skipped, matching the ignore-unknown policy).
 */
function normalizeLocaleSettings(config: CmsConfig, value: unknown) {
  const parsed = localeSettingsBody.safeParse(value);
  if (!parsed.success) return null;
  const installed = new Set(config.locales);
  const main = config.defaultLocale;
  const editing = resolveLocaleSet(
    parsed.data.editing?.filter((l) => installed.has(l)),
    config.locales,
    main,
  );
  const publicSet = resolveLocaleSet(
    parsed.data.public?.filter((l) => editing.includes(l)),
    editing,
    main,
  );
  return { editing, public: publicSet };
}

/** GET /api/cms/settings — current values for the managed keys. */
export function settingsGetRoute(config: CmsConfig) {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.settingsRead),
    handler: async () => ok(await getSettings(managedKeys(config))),
  });
}

const updateBody = z.record(z.string(), z.unknown());

/**
 * The copy of `cms.customFields` a save was built on, sent alongside it.
 *
 * Not a stored setting and never written — it exists so a save can be refused when
 * the stored copy has moved on, and it is REQUIRED. A check the losing caller can
 * skip by simply not sending it is not a protection: the per-collection merge only
 * shields collections a request does not mention, and the shape that caused the
 * data loss was a caller posting the whole blob, which mentions all of them. So the
 * contract is explicit — say which copy you edited, or the write is refused.
 */
const CUSTOM_FIELDS_BASELINE_KEY = 'cms.customFields.baseline';

/**
 * The copy of `cms.seoFields` a save was built on. Same contract as the custom
 * fields baseline above, for the same reason: one global blob, several admins,
 * and a plain `setSetting` would let the second save silently discard the
 * first. Unlike the custom fields there is nothing to merge per collection —
 * the SEO set is site-wide — so the baseline is the only protection there is,
 * which makes it required rather than optional.
 */
const SEO_FIELDS_BASELINE_KEY = 'cms.seoFields.baseline';

/**
 * Merge the custom-field config per collection instead of replacing the lot.
 *
 * Every collection's custom fields live in one `cms.customFields` blob, and the
 * Settings screen handed the same snapshot to every sub-tab. Each save posted the
 * whole blob back and the route stored it with a plain `setSetting`, so two people
 * editing *different* collections destroyed each other: whoever saved second wrote
 * back a copy of the first one's collection from before their edit. No conflict, no
 * warning, nothing in the audit log to tell that save apart from any other. Same
 * class as the document lost update (F-011) and the sibling-locale propagation
 * (F-044), on a third write path (F-062).
 *
 * A request now says only what it changed, and the collections it does not mention
 * are left as they are in the database. `baseline` is how the remaining case — two
 * people on the *same* collection — is caught rather than silently resolved: the
 * caller states the copy it edited, and if the stored one has moved since, the save
 * is refused instead of overwriting work it never saw.
 */
async function mergeCustomFields(
  incoming: unknown,
  baseline: unknown,
  read: SettingsReader,
): Promise<Record<string, unknown>> {
  if (incoming === null || typeof incoming !== 'object' || Array.isArray(incoming)) {
    throw invalidInput(
      { fieldErrors: { [CUSTOM_FIELDS_KEY]: ['Custom fields must be an object keyed by collection.'] } },
      'Custom fields must be an object keyed by collection.',
    );
  }
  const stored = ((await read<Record<string, unknown>>(CUSTOM_FIELDS_KEY)) ?? {}) as Record<
    string,
    unknown
  >;
  const patch = incoming as Record<string, unknown>;

  if (baseline === undefined) {
    throw invalidInput(
      {
        fieldErrors: {
          [CUSTOM_FIELDS_KEY]: [
            `Send "${CUSTOM_FIELDS_BASELINE_KEY}" with the copy of these collections you edited, ` +
              `so a change someone else already saved cannot be overwritten unnoticed.`,
          ],
        },
      },
      'Custom fields must be saved against the copy they were edited from.',
    );
  }

  {
    const base = (baseline ?? {}) as Record<string, unknown>;
    for (const key of Object.keys(patch)) {
      const seen = JSON.stringify(base[key] ?? null);
      const now = JSON.stringify(stored[key] ?? null);
      if (seen !== now) {
        throw new ApiError(
          'conflict',
          `The custom fields for "${key}" were changed by someone else while you were editing. ` +
            `Reload to pick up their version, then apply your change again — saving now would ` +
            `overwrite work you have not seen.`,
        );
      }
    }
  }

  return { ...stored, ...patch };
}

/**
 * Refuse a SEO-field save built on a copy someone else has since replaced.
 *
 * Both sides are compared through the sanitiser, so a save is not rejected
 * merely because the stored blob was written by an older version of it — only a
 * genuine difference in meaning counts as a conflict.
 */
async function assertSeoFieldsBaseline(baseline: unknown, read: SettingsReader): Promise<void> {
  if (baseline === undefined) {
    throw invalidInput(
      {
        fieldErrors: {
          [SEO_FIELDS_KEY]: [
            `Send "${SEO_FIELDS_BASELINE_KEY}" with the copy of the SEO fields you edited, ` +
              `so a change someone else already saved cannot be overwritten unnoticed.`,
          ],
        },
      },
      'SEO fields must be saved against the copy they were edited from.',
    );
  }
  const stored = await read<unknown>(SEO_FIELDS_KEY);
  const seen = JSON.stringify(sanitizeSeoFieldOverrides(baseline));
  const now = JSON.stringify(sanitizeSeoFieldOverrides(stored));
  if (seen !== now) {
    throw new ApiError(
      'conflict',
      'The SEO fields were changed by someone else while you were editing. Reload to pick up ' +
        'their version, then apply your change again — saving now would overwrite work you have not seen.',
    );
  }
}

/** Reads the stored copy a conflict check compares against. */
type SettingsReader = <T>(key: string) => Promise<T | null>;

export interface SettingsUpdateDeps {
  /** Must be uncached: it is the baseline for the conflict checks. */
  read: SettingsReader;
  write: (key: string, value: unknown, updatedBy: number | null) => Promise<void>;
}

/**
 * Validate every key of a settings save, then write them — in that order.
 *
 * The writes used to be interleaved with the checks, so a 422 on the fifth key
 * left the first four already stored while the caller was told the save failed —
 * and the cache purge, which ran only after the loop, never happened, so those
 * four stayed invisible to every cached reader. Now nothing is written unless
 * every key passes. Returns the keys written.
 */
export async function applySettingsUpdate(
  config: CmsConfig,
  input: Record<string, unknown>,
  userId: number | null,
  deps: SettingsUpdateDeps,
): Promise<string[]> {
  const allowed = new Set(managedKeys(config));
  const defByKey = new Map(MANAGED_SETTINGS.map((d) => [d.key, d]));
  const writes: Array<[string, unknown]> = [];
  // Not a setting — it states which copy of `cms.customFields` this save edited.
  const baseline = input[CUSTOM_FIELDS_BASELINE_KEY];
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.has(key)) continue;
    if (key === CUSTOM_FIELDS_KEY) {
      const merged = await mergeCustomFields(value, baseline, deps.read);
      const checked = validateSettingValue(key, undefined, merged);
      if (!checked.ok) throw invalidInput({ fieldErrors: { [key]: [checked.message] } }, checked.message);
      writes.push([key, checked.value]);
      continue;
    }
    if (key === SEO_FIELDS_KEY) {
      await assertSeoFieldsBaseline(input[SEO_FIELDS_BASELINE_KEY], deps.read);
      const checked = validateSettingValue(key, undefined, value);
      if (!checked.ok) throw invalidInput({ fieldErrors: { [key]: [checked.message] } }, checked.message);
      writes.push([key, checked.value]);
      continue;
    }
    if (key === I18N_LOCALES_KEY) {
      const normalized = normalizeLocaleSettings(config, value);
      if (!normalized) continue;
      writes.push([key, normalized]);
      continue;
    }
    const checked = validateSettingValue(key, defByKey.get(key), value);
    if (!checked.ok) throw invalidInput({ fieldErrors: { [key]: [checked.message] } }, checked.message);
    writes.push([key, checked.value]);
  }
  // Every key passed; only now does anything reach the database. `setSetting`
  // purges each key's cache as it goes.
  for (const [key, value] of writes) await deps.write(key, value, userId);
  return writes.map(([key]) => key);
}

/** PATCH /api/cms/settings — upsert managed keys (unknown keys ignored). */
export function settingsUpdateRoute(config: CmsConfig) {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.settingsWrite),
    input: updateBody,
    handler: async ({ input, auth }) => {
      const changed = await applySettingsUpdate(config, input, auth.userId, {
        read: getSettingUncached,
        write: setSetting,
      });
      // Purge every settings reader (public GA/robots/sitemap, admin, module flags).
      revalidateTag(SETTINGS_TAG, { expire: 0 });
      await logAudit({
        userId: auth.userId,
        action: 'settings.update',
        subjectType: 'settings',
        after: { changed },
      });
      return ok(await getSettings(managedKeys(config)));
    },
  });
}
