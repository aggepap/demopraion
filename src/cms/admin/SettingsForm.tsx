'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState, type ReactNode } from 'react';

import {
  formatMultiValue,
  MANAGED_SETTINGS,
  MODULE_LABELS,
  moduleLabel,
  parseMultiValue,
  readBooleanSetting,
  type LocaleSettings,
  type SettingFieldDef,
} from '../core/settings/schema';
import { cmsApi, CmsApiError } from './api-client';
import { buildSettingsPatch, type SettingsSnapshot } from './settings-patch';
import { useUnsavedChangesGuard } from './use-unsaved-changes';
import { Badge, Button, Checkbox, Field, Section, Select, Textarea, TextInput } from './ui';
import { cn } from './ui/cn';

/** Human label for a locale: `EL — Ελληνικά` (autonym via Intl, best-effort). */
function localeLabel(locale: string): string {
  try {
    const name = new Intl.DisplayNames([locale], { type: 'language' }).of(locale);
    return name && name.toLowerCase() !== locale
      ? `${locale.toUpperCase()} — ${name}`
      : locale.toUpperCase();
  } catch {
    return locale.toUpperCase();
  }
}

/**
 * A checkbox group over a comma-separated value.
 *
 * Not a `<select multiple>`: that control hides how many options exist, needs
 * a modifier key to pick a second one, and silently deselects everything when
 * someone clicks without it — the exact interaction where "we sell both"
 * quietly becomes "we sell neither".
 *
 * Clearing every box is allowed and means "unset", which every reader treats
 * as its own default. Refusing an empty set here would be enforcing a rule
 * only this one control knows about.
 */
function MultiSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label?: string }[];
  onChange: (next: string) => void;
}) {
  const chosen = new Set(parseMultiValue(value));
  return (
    <div className="flex flex-col gap-1.5">
      {options.map((o) => (
        <label key={o.value} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={chosen.has(o.value)}
            onChange={(e) => {
              // Rebuilt in the OPTIONS' order, not click order, so the stored
              // string is the same however it was arrived at.
              const next = new Set(chosen);
              if (e.target.checked) next.add(o.value);
              else next.delete(o.value);
              onChange(formatMultiValue(options.map((x) => x.value).filter((v) => next.has(v))));
            }}
            className="h-4 w-4"
          />
          <span>{o.label ?? o.value}</span>
        </label>
      ))}
    </div>
  );
}

/**
 * One managed setting, rendered from its descriptor.
 *
 * Every explanation goes behind the "i" — a `Field` description, or a checkbox's
 * `info` — so a tab of settings reads as a list of questions rather than a page of
 * prose. A warning belongs in the label or in a module's `offNote`, not here.
 */
export function SettingField({
  def: f,
  value,
  onChange,
}: {
  def: SettingFieldDef;
  value: string;
  onChange: (next: string) => void;
}) {
  if (f.type === 'boolean') {
    // The checkbox carries its own label, so the row is one hit target and the
    // words are the control's accessible name.
    return (
      <Checkbox
        label={f.label}
        info={f.description}
        checked={readBooleanSetting(value)}
        onChange={(e) => onChange(e.target.checked ? 'on' : 'off')}
      />
    );
  }
  return (
    <Field label={f.label} description={f.description}>
      {f.type === 'textarea' ? (
        <Textarea rows={3} placeholder={f.placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
      ) : f.type === 'select' ? (
        <Select value={value} onChange={(e) => onChange(e.target.value)}>
          {f.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label ?? o.value}
            </option>
          ))}
        </Select>
      ) : f.type === 'multiselect' ? (
        <MultiSelect value={value} options={f.options ?? []} onChange={onChange} />
      ) : (
        <TextInput
          type={f.type === 'email' ? 'email' : 'text'}
          placeholder={f.placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

/**
 * Admin settings editor. General fields come from the shared `MANAGED_SETTINGS`
 * descriptor (so the API validates the same set); module toggles come from the
 * site config's module list. Saves through the settings API, which purges the
 * settings cache so public readers (GA id, robots, sitemap) pick up the change.
 */
export function SettingsForm({
  settings,
  moduleFlags,
  localeSettings,
  moduleTabs,
  fieldsTabs,
  extraTabs,
}: {
  settings: Record<string, unknown>;
  moduleFlags: Record<string, boolean>;
  localeSettings: LocaleSettings;
  /**
   * Bespoke sub-tabs injected into a module's own top-level tab, keyed by tab
   * name ('Ecommerce', 'Booking'). Each renders in its own sub-tab with its own
   * save; the built-in "General" sub-tab holds that tab's `MANAGED_SETTINGS`
   * fields, saved by the main Save button.
   *
   * Keyed rather than a second `bookingTabs` prop, because a second bespoke prop
   * guarantees a third.
   */
  moduleTabs?: Record<string, { label: string; content: ReactNode }[]>;
  /** One sub-tab per collection with admin-defined custom fields. Own save. */
  fieldsTabs?: { label: string; content: ReactNode }[];
  /**
   * Whole top-level tabs whose body is bespoke — no managed settings fields, no
   * sub-tabs, and their own save. Unlike `moduleTabs` these are not tied to a
   * module's settings group, so they get no "General" sub-tab holding fields
   * that do not exist. Praion.ai's connection screen is the first of them.
   */
  extraTabs?: { label: string; content: ReactNode }[];
}) {
  const router = useRouter();
  const moduleNames = Object.keys(moduleFlags);

  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const f of MANAGED_SETTINGS) {
      const stored = typeof settings[f.key] === 'string' ? (settings[f.key] as string) : '';
      // A `select` with no stored value falls back to its first option so the
      // dropdown always shows a concrete choice (e.g. currency defaults to EUR).
      // An explicit `defaultValue` wins over both — it is what the reader will
      // do anyway, so showing anything else would be describing the site wrongly.
      v[f.key] =
        stored || f.defaultValue || (f.type === 'select' ? (f.options?.[0]?.value ?? '') : '');
    }
    return v;
  });
  const [modules, setModules] = useState<Record<string, boolean>>(() => ({ ...moduleFlags }));

  // Language enablement. `main` is fixed (always editable + public); extras
  // toggle Editing (shows an editor tab) and Public (live in the front-end
  // picker). Public implies Editing — turning Editing off drops Public too.
  const { supported, main } = localeSettings;
  const [editing, setEditing] = useState<Set<string>>(() => new Set(localeSettings.editing));
  const [publicLocales, setPublicLocales] = useState<Set<string>>(
    () => new Set(localeSettings.public)
  );

  const toggleEditing = (locale: string, on: boolean) => {
    setDirty(true);
    setEditing((prev) => {
      const next = new Set(prev);
      if (on) next.add(locale);
      else next.delete(locale);
      return next;
    });
    if (!on)
      setPublicLocales((prev) => {
        const next = new Set(prev);
        next.delete(locale);
        return next;
      });
  };

  const togglePublic = (locale: string, on: boolean) => {
    setDirty(true);
    setPublicLocales((prev) => {
      const next = new Set(prev);
      if (on) next.add(locale);
      else next.delete(locale);
      return next;
    });
  };

  /*
   * The main Save's state as a snapshot — fields, module flags, language sets —
   * so a save can send just what differs from the one the screen opened with.
   * Both sets are ordered by the installed-locale order with `main` forced in;
   * the API re-normalizes, but sending clean data keeps the optimistic UI honest.
   */
  const snapshot = (): SettingsSnapshot => ({
    values: Object.fromEntries(MANAGED_SETTINGS.map((f) => [f.key, values[f.key]])),
    modules: Object.fromEntries(moduleNames.map((name) => [name, modules[name]])),
    locales: {
      editing: supported.filter((l) => l === main || editing.has(l)),
      public: supported.filter((l) => l === main || publicLocales.has(l)),
    },
  });
  const [opened, setOpened] = useState<SettingsSnapshot>(snapshot);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  /*
   * Eight tabs of state — text fields, module toggles, language enablement —
   * and leaving the screen discarded all of it without a word. The document
   * editor was given this guard (F-012); this screen had nothing, even though
   * its state is spread across tabs and so less visible: an edit on General is
   * off-screen the moment you look at Modules.
   *
   * The bespoke sub-tabs (shipping, coupons, custom fields) own their state and
   * their own save buttons, so this flag does not see their edits.
   */
  const [dirty, setDirty] = useState(false);
  useUnsavedChangesGuard(dirty);

  /** Every edit to a managed field goes through here, so none can forget the flag. */
  const setValue = (key: string, value: string) => {
    setDirty(true);
    setValues((v) => ({ ...v, [key]: value }));
  };

  /*
   * Only the groups that apply. A field belonging to a switched-off module is
   * hidden rather than shown as a question with no consequence — a shop currency
   * on a site with no shop. Its value is untouched (and, being unchanged, not
   * sent on save), so switching the module back on brings the settings back
   * rather than losing them.
   */
  const groups = useMemo(() => {
    const g: Record<string, SettingFieldDef[]> = {};
    for (const f of MANAGED_SETTINGS) {
      if (f.module && !moduleFlags[f.module]) continue;
      (g[f.group] ??= []).push(f);
    }
    return g;
  }, [moduleFlags]);

  // One tab per settings group, plus the Modules and Languages panels. Saving
  // persists every change, on any tab, in one PATCH regardless of the active tab.
  const hasFieldsTabs = (fieldsTabs?.length ?? 0) > 0;
  // A module tab can exist purely to host bespoke sub-tabs, with no plain
  // settings group of its own, so the two sources are unioned rather than the
  // groups alone deciding which tabs exist.
  const moduleTabNames = useMemo(() => Object.keys(moduleTabs ?? {}), [moduleTabs]);
  const extraTabNames = useMemo(() => (extraTabs ?? []).map((t) => t.label), [extraTabs]);
  const tabs = useMemo(
    () => [
      ...new Set([
        ...Object.keys(groups),
        ...moduleTabNames,
        ...(hasFieldsTabs ? ['Fields'] : []),
        ...extraTabNames,
        ...(moduleNames.length ? ['Modules'] : []),
        'Languages',
      ]),
    ],
    [groups, moduleTabNames, hasFieldsTabs, extraTabNames, moduleNames.length]
  );
  /*
   * The open tab belongs in the URL.
   *
   * `?tab=seo` was ignored entirely, so "have a look at Settings → SEO" could not be sent
   * as a link: the recipient landed on General with no error, saw two unrelated fields, and
   * would reasonably conclude the field being described does not exist. A value that names
   * no real tab falls back to the first one rather than showing an empty screen.
   */
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const requestedTab = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState(
    requestedTab && tabs.includes(requestedTab) ? requestedTab : tabs[0]
  );

  function openTab(tab: string) {
    setActiveTab(tab);
    const next = new URLSearchParams(searchParams.toString());
    next.set('tab', tab);
    // A sub-tab belongs to one module tab; carrying it onto another would put a stale
    // fragment in a URL people share.
    if (!moduleTabs?.[tab]) next.delete('sub');
    // `replace` and no scroll: switching tab is one screen, not a place to go back to.
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  // Sub-tabs inside a module tab: built-in "General" (that tab's plain settings
  // fields) plus any injected bespoke tabs (shipping, coupons, …).
  const subTabsFor = (tab: string) => ['General', ...(moduleTabs?.[tab] ?? []).map((t) => t.label)];
  const activeSubTabs = subTabsFor(activeTab);
  /*
   * The sub-tab as well. F-084 put the top-level tab in the URL and left this one behind, so
   * "go and check the shipping setup" still could not be linked and still did not survive a
   * refresh — one level deeper, same cost to whoever was sent the link.
   */
  const requestedSubTab = searchParams.get('sub');
  const [storedSubTab, setStoredSubTab] = useState(requestedSubTab ?? 'General');
  /*
   * Held per render rather than in state, so a sub-tab can never leak across module
   * tabs: with two of them, remembering "Coupons" and then opening Booking would ask
   * for a sub-tab that tab does not have, and render nothing at all.
   */
  const subTab = activeSubTabs.includes(storedSubTab) ? storedSubTab : 'General';

  function openSubTab(tab: string, sub: string) {
    setStoredSubTab(sub);
    const next = new URLSearchParams(searchParams.toString());
    next.set('tab', tab);
    next.set('sub', sub);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }
  const onModuleTab = Boolean(moduleTabs?.[activeTab]);
  const onModuleExtraSubTab = onModuleTab && subTab !== 'General';

  // One sub-tab per collection under Fields; each manager saves itself.
  const [fieldsSubTab, setFieldsSubTab] = useState(fieldsTabs?.[0]?.label ?? '');
  const onFieldsTab = activeTab === 'Fields';

  // A bespoke tab owns its whole body — no settings group, no main Save.
  const activeExtraTab = (extraTabs ?? []).find((t) => t.label === activeTab) ?? null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    // Only what changed since the screen opened (or last saved): sending every
    // displayed value would store the defaults it merely shows.
    const current = snapshot();
    const body = buildSettingsPatch(opened, current);
    try {
      if (Object.keys(body).length > 0) await cmsApi.updateSiteSettings(body);
      setOpened(current);
      setSaved(true);
      setDirty(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof CmsApiError || err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const groupSection = (name: string) => {
    const fields = groups[name];
    if (!fields) return null;
    return (
      <Section title={name}>
        {fields.map((f) => (
          <SettingField key={f.key} def={f} value={values[f.key]} onChange={(next) => setValue(f.key, next)} />
        ))}
      </Section>
    );
  };

  /*
   * The tab strip sits outside the settings `<form>`, and a bespoke tab renders
   * beside it rather than within it.
   *
   * Not cosmetic: such a tab brings a whole screen, and one of them — the
   * Praion.ai connection — has a `<form>` of its own. Nested forms are invalid
   * HTML; the browser drops the inner one, so its Connect button would have
   * submitted the settings form instead and the credential would never have been
   * sent. The module and Fields sub-tabs are safe inside only because none of
   * them carries a form element.
   */
  return (
    // The field manager — and any bespoke tab, which is a whole screen rather
    // than a column of inputs — needs more room than the narrow settings fields.
    <div
      className={cn(
        'flex flex-col gap-4',
        onFieldsTab || activeExtraTab ? 'max-w-5xl' : 'max-w-2xl'
      )}
    >
      {error ? (
        <div
          role="alert"
          className="rounded-sm border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </div>
      ) : null}
      {/* `role="status"`: the confirmation appears far from the button that
          caused it, so it has to be announced rather than only shown. */}
      {saved ? (
        <div
          role="status"
          className="rounded-sm border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-700"
        >
          Settings saved.
        </div>
      ) : null}

      <div
        role="tablist"
        aria-label="Settings sections"
        className="flex flex-wrap items-center gap-1 border-b border-neutral-200"
      >
        {tabs.map((tab) => {
          const isActive = tab === activeTab;
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => openTab(tab)}
              className={cn(
                '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'border-neutral-900 text-neutral-900'
                  : 'border-transparent text-neutral-600 hover:text-neutral-800'
              )}
            >
              {tab}
            </button>
          );
        })}
      </div>

      {activeExtraTab ? <div>{activeExtraTab.content}</div> : null}

      {activeExtraTab ? null : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          {!onModuleTab && groups[activeTab] ? groupSection(activeTab) : null}

          {onModuleTab ? (
            <div className="flex flex-col gap-4">
              {activeSubTabs.length > 1 ? (
                <div className="flex flex-wrap gap-1 border-b border-neutral-200">
                  {activeSubTabs.map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => openSubTab(activeTab, st)}
                      className={cn(
                        '-mb-px border-b-2 px-3 py-1.5 text-sm font-medium transition-colors',
                        subTab === st
                          ? 'border-warm-gold-deep text-warm-gold-deep'
                          : 'border-transparent text-neutral-600 hover:text-neutral-800'
                      )}
                    >
                      {st}
                    </button>
                  ))}
                </div>
              ) : null}
              {subTab === 'General' ? groupSection(activeTab) : null}
              {(moduleTabs?.[activeTab] ?? []).map((tab) =>
                tab.label === subTab ? <div key={tab.label}>{tab.content}</div> : null
              )}
            </div>
          ) : null}

          {onFieldsTab ? (
            <div className="flex flex-col gap-4">
              <p className="text-xs text-neutral-600">
                Extra fields you define here are added to the chosen content type — they appear in
                its editor and on the public page without a code change.
              </p>
              {(fieldsTabs?.length ?? 0) > 1 ? (
                <div className="flex flex-wrap gap-1 border-b border-neutral-200">
                  {fieldsTabs?.map((t) => (
                    <button
                      key={t.label}
                      type="button"
                      onClick={() => setFieldsSubTab(t.label)}
                      className={cn(
                        '-mb-px border-b-2 px-3 py-1.5 text-sm font-medium transition-colors',
                        fieldsSubTab === t.label
                          ? 'border-warm-gold-deep text-warm-gold-deep'
                          : 'border-transparent text-neutral-600 hover:text-neutral-800'
                      )}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              ) : null}
              {fieldsTabs?.map((t) =>
                t.label === fieldsSubTab ? <div key={t.label}>{t.content}</div> : null
              )}
            </div>
          ) : null}

          {activeTab === 'Modules' && moduleNames.length > 0 ? (
            <Section
              title="Modules"
              info="Switch optional parts of the site on and off. A content type tied to a module that is off is hidden from the sidebar; its content is kept."
            >
              {moduleNames.map((name) => {
                const help = MODULE_LABELS[name];
                return (
                  <Checkbox
                    key={name}
                    className="rounded-sm border border-neutral-200 px-3 py-2"
                    label={moduleLabel(name)}
                    info={help?.description}
                    // What it takes down stays printed. Left to the toggle alone, the
                    // only way to learn that is to switch it off on a live site.
                    hint={help?.offNote}
                    checked={modules[name]}
                    onChange={(e) => {
                      setDirty(true);
                      setModules((m) => ({ ...m, [name]: e.target.checked }));
                    }}
                  />
                );
              })}
            </Section>
          ) : null}

          {activeTab === 'Languages' ? (
            <Section
              title="Languages"
              description="Translate a language with Public off, then switch it on when it's ready. The main language is always on."
            >
              <div className="flex flex-col gap-2">
                {supported.map((locale) => {
                  const isMain = locale === main;
                  const isEditing = isMain || editing.has(locale);
                  const isPublic = isMain || publicLocales.has(locale);
                  return (
                    <div
                      key={locale}
                      className="flex items-center justify-between gap-4 rounded-sm border border-neutral-200 px-3 py-2"
                    >
                      <span className="flex items-center gap-2 text-sm text-neutral-800">
                        {localeLabel(locale)}
                        {isMain ? <Badge tone="green">Main</Badge> : null}
                      </span>
                      <div className="flex items-center gap-4">
                        <Checkbox
                          label="Editing"
                          info="The language shows as a tab in the content editors, so it can be translated. Turning it off also turns off Public."
                          checked={isEditing}
                          disabled={isMain}
                          onChange={(e) => toggleEditing(locale, e.target.checked)}
                        />
                        <Checkbox
                          label="Public"
                          info="The language is live: listed in the site's language picker and reachable on the public site. Needs Editing."
                          checked={isPublic}
                          disabled={isMain || !isEditing}
                          onChange={(e) => togglePublic(locale, e.target.checked)}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Section>
          ) : null}

          {/* The bespoke sub-tabs (shipping, coupons, custom fields) have their own
          save; only show the main Save for the field-based tabs. */}
          {onModuleExtraSubTab || onFieldsTab ? null : (
            <div>
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save settings'}
              </Button>
            </div>
          )}
        </form>
      )}
    </div>
  );
}
