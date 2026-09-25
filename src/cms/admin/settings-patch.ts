import { I18N_LOCALES_KEY, moduleSettingKey } from '../core/settings/schema';

/** The main Save's share of the Settings screen: fields, module flags, languages. */
export interface SettingsSnapshot {
  values: Record<string, string>;
  modules: Record<string, boolean>;
  locales: { editing: string[]; public: string[] };
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * The body of a main-Save PATCH: only what differs from what the screen opened with.
 *
 * The screen shows a concrete value for every field — a select with nothing stored
 * shows its first option, the language sets show "everything installed" — and
 * saving used to send all of it, so the first save turned every displayed default
 * into a stored value and "unset, follow the default" was lost for good. Comparing
 * against the opening snapshot (not against "was it touched") also means a value
 * changed and changed back is not sent.
 */
export function buildSettingsPatch(
  opened: SettingsSnapshot,
  now: SettingsSnapshot,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(now.values)) {
    if (value !== opened.values[key]) body[key] = value;
  }
  for (const [name, on] of Object.entries(now.modules)) {
    if (on !== opened.modules[name]) body[moduleSettingKey(name)] = on;
  }
  if (
    !sameList(now.locales.editing, opened.locales.editing) ||
    !sameList(now.locales.public, opened.locales.public)
  ) {
    body[I18N_LOCALES_KEY] = now.locales;
  }
  return body;
}
