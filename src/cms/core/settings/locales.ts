import 'server-only';

import { getSetting } from './index';
import {
  I18N_LOCALES_KEY,
  resolveLocaleSet,
  type LocaleSettings,
  type StoredLocaleSettings,
} from './schema';

/**
 * Effective language enablement: the installed (compile-time) locales narrowed
 * by the `i18n.locales` value in `site_settings`. This is the runtime companion
 * to `resolveModuleFlags` — it lets the admin decide which installed languages
 * are editable and which are public, without a code change.
 *
 * - `editing` = stored editing set (∩ installed), always including `main`.
 * - `public`  = stored public set (∩ editing), always including `main`.
 * - Unset value → every installed locale enabled (preserves prior behavior).
 *
 * `main` (the URL-unprefixed default) stays compile-time — it is never toggled.
 * Best-effort + cached exactly like every other setting read (a DB-less build
 * falls back to "all installed enabled").
 */
export async function resolveLocaleSettings(config: {
  locales: readonly string[];
  defaultLocale: string;
}): Promise<LocaleSettings> {
  const supported = [...config.locales];
  const main = config.defaultLocale;
  const stored = (await getSetting<StoredLocaleSettings>(I18N_LOCALES_KEY)) ?? {};

  const editing = resolveLocaleSet(stored.editing, supported, main);
  const publicSet = resolveLocaleSet(stored.public, editing, main);

  return { supported, main, editing, public: publicSet };
}
