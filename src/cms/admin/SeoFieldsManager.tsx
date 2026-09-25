'use client';

import { useMemo, useState } from 'react';

import {
  CUSTOM_KEY_PATTERN,
  type CustomFieldDef,
  type CustomFieldKind,
} from '../core/fields/definitions';
import {
  resolveSeoFields,
  type SeoFieldOverrides,
} from '../core/seo/field-overrides';
import {
  SEO_BUILTIN_KEYS,
  SEO_FIELD_BY_KEY,
  SEO_TABS,
  type SeoTab,
} from '../core/seo/fields';
import { SEO_FIELDS_KEY } from '../core/settings/schema';
import { cmsApi, CmsApiError } from './api-client';
import {
  CHOICE_KINDS,
  KIND_LABEL,
  LabelInputs,
  OptionsEditor,
  slugifyKey,
  SubFieldsEditor,
  ToggleCheckbox,
} from './fields/DefinitionEditors';
import { labelText } from './shared';
import { Badge, Button, Field, Icon, IconButton, Section, Select, TextInput } from './ui';
import { useConfirm } from './ui/ConfirmDialog';

/**
 * Settings → Fields → SEO & AEO.
 *
 * The fifteen built-in fields are declared in code and are ALWAYS present; this
 * screen edits a set of deltas on top of them (`cms.seoFields`). That is why
 * there is no "add a built-in" button and no way to reach an empty state: the
 * list below is the shipped set, and everything on it is a modification of
 * something that already exists. Extras are the one genuinely additive part.
 *
 * Unlike `CustomFieldsManager` this is site-wide rather than per-collection —
 * the SEO block is the same on every content type — with a per-collection
 * "off" list as the only narrowing.
 */

/**
 * Kinds an admin may pick for an extra SEO field.
 *
 * `relation` is missing on purpose: a custom relation is not written to
 * `document_relations` (only top-level relation fields are), so it would be an
 * inert pointer that no reverse lookup could ever find. Better absent than
 * present-and-quietly-useless.
 */
const EXTRA_KINDS: CustomFieldKind[] = [
  'text',
  'textarea',
  'richText',
  'number',
  'select',
  'multiselect',
  'boolean',
  'date',
  'image',
  'repeater',
];

export interface SeoFieldsManagerProps {
  /** The stored overrides, already sanitised server-side. */
  initial: SeoFieldOverrides;
  /** Site locales — one label input per language. */
  locales: string[];
  /** Collections that carry the SEO block, for the per-collection "off" list. */
  collections: { key: string; label: string }[];
}

export function SeoFieldsManager({ initial, locales, collections }: SeoFieldsManagerProps) {
  const [config, setConfigRaw] = useState<SeoFieldOverrides>(() => structuredClone(initial));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  const setConfig = (next: SeoFieldOverrides) => {
    setConfigRaw(next);
    setSaved(false);
  };

  // The list exactly as an editor will see it, disabled fields included, so
  // reordering here is reordering the real thing rather than a parallel model.
  const ordered = useMemo(() => {
    const withAll: SeoFieldOverrides = { ...config, disabled: [], perCollection: {} };
    return resolveSeoFields(withAll);
  }, [config]);

  const isOff = (key: string) => config.disabled.includes(key);

  const toggleOff = (key: string, off: boolean) =>
    setConfig({
      ...config,
      disabled: off ? [...config.disabled, key] : config.disabled.filter((k) => k !== key),
    });

  const setOrder = (key: string, order: number) =>
    setConfig({ ...config, order: { ...config.order, [key]: order } });

  /** Swap a field with its neighbour by rewriting both explicit orders. */
  const move = (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= ordered.length) return;
    const a = ordered[index];
    const b = ordered[j];
    setConfig({ ...config, order: { ...config.order, [a.key]: b.order, [b.key]: a.order } });
  };

  const patchExtra = (index: number, patch: Partial<CustomFieldDef>) =>
    setConfig({
      ...config,
      extra: config.extra.map((f, i) => (i === index ? { ...f, ...patch } : f)),
    });

  const addExtra = () =>
    setConfig({
      ...config,
      extra: [...config.extra, { id: crypto.randomUUID(), key: '', kind: 'text', label: {}, group: 'general' }],
    });

  // Blocking problems, mirroring the server sanitiser's silent-drop rules —
  // a row it would discard must not look saved.
  const problems = useMemo(() => {
    const out: string[] = [];
    const builtIn = new Set<string>(SEO_BUILTIN_KEYS);
    const seen = new Set<string>();
    for (const f of config.extra) {
      const where = f.key || '(unnamed field)';
      if (!f.key) out.push('An extra field is missing a key.');
      else if (!CUSTOM_KEY_PATTERN.test(f.key))
        out.push(`"${where}" — key must start with a letter and use only letters, digits or _.`);
      else if (builtIn.has(f.key)) out.push(`"${where}" — that key belongs to a built-in SEO field.`);
      else if (seen.has(f.key)) out.push(`"${where}" — duplicate key.`);
      seen.add(f.key);
      if (CHOICE_KINDS.includes(f.kind) && !(f.options?.length ?? 0))
        out.push(`"${where}" — a select needs at least one option.`);
      if (f.kind === 'repeater' && !(f.subFields?.length ?? 0))
        out.push(`"${where}" — a repeater needs at least one sub-field.`);
    }
    return out;
  }, [config.extra]);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await cmsApi.updateSiteSettings({
        [SEO_FIELDS_KEY]: config,
        // States which copy this save was built on, so a change someone else
        // has already stored is refused rather than silently overwritten.
        'cms.seoFields.baseline': initial,
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof CmsApiError || err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const extraIndexByKey = new Map(config.extra.map((f, i) => [f.key, i]));

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <div className="rounded-sm border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      ) : null}
      {saved ? (
        <div className="rounded-sm border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-700">
          SEO fields saved.
        </div>
      ) : null}
      {problems.length > 0 ? (
        <ul className="flex list-disc flex-col gap-1 rounded-sm border border-amber-300 bg-amber-50 px-6 py-2 text-sm text-amber-800">
          {problems.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      ) : null}

      <Section
        title="SEO & AEO fields"
        description="These appear on every content type, in this order. Turning one off hides it from the editor — values already saved are kept, and come back if you turn it on again."
        right={<span className="text-xs text-neutral-600">{ordered.length}</span>}
      >
        <div className="flex flex-col gap-2">
          {ordered.map((def, i) => {
            const extraIndex = def.builtIn ? undefined : extraIndexByKey.get(def.key);
            return (
              <FieldRow
                key={def.key}
                fieldKey={def.key}
                builtIn={def.builtIn}
                shippedLabel={labelText(
                  SEO_FIELD_BY_KEY.get(def.key)?.field.label ?? def.field.label,
                  locales[0],
                  def.key,
                )}
                kindLabel={KIND_LABEL[def.field.kind as CustomFieldKind] ?? def.field.kind}
                tab={def.tab}
                off={isOff(def.key)}
                canRequire={def.storage === 'data'}
                required={Boolean(config.required[def.key])}
                labels={config.labels[def.key] ?? {}}
                description={config.descriptions[def.key] ?? ''}
                locales={locales}
                first={i === 0}
                last={i === ordered.length - 1}
                extra={extraIndex !== undefined ? config.extra[extraIndex] : undefined}
                onMove={(dir) => move(i, dir)}
                onToggleOff={(v) => toggleOff(def.key, v)}
                onTab={(t) => setConfig({ ...config, tab: { ...config.tab, [def.key]: t } })}
                onLabels={(label) => setConfig({ ...config, labels: { ...config.labels, [def.key]: label } })}
                onDescription={(text) =>
                  setConfig({ ...config, descriptions: { ...config.descriptions, [def.key]: text } })
                }
                onRequired={(on) =>
                  setConfig({ ...config, required: { ...config.required, [def.key]: on } })
                }
                onPatchExtra={extraIndex !== undefined ? (p) => patchExtra(extraIndex, p) : undefined}
                onRemoveExtra={
                  extraIndex === undefined
                    ? undefined
                    : async () => {
                        const ok = await confirm({
                          title: 'Remove this field?',
                          message: 'Values already saved on documents are dropped. This cannot be undone.',
                          confirmLabel: 'Remove',
                        });
                        if (ok) setConfig({ ...config, extra: config.extra.filter((_, x) => x !== extraIndex) });
                      }
                }
                onResetOrder={() =>
                  setConfig({
                    ...config,
                    // Drop the explicit order so the field falls back to its
                    // shipped position rather than pinning to 0.
                    order: Object.fromEntries(
                      Object.entries(config.order).filter(([k]) => k !== def.key),
                    ),
                  })
                }
                order={def.order}
                onOrder={(n) => setOrder(def.key, n)}
              />
            );
          })}
          <div>
            <Button variant="secondary" size="sm" onClick={addExtra}>
              <Icon name="plus" size={14} /> Add SEO field
            </Button>
          </div>
        </div>
      </Section>

      {collections.length > 0 ? (
        <Section
          title="Per-collection exceptions"
          defaultOpen={false}
          description="Hide individual SEO fields on one content type only. Everything not listed here shows the full set."
        >
          <div className="flex flex-col gap-3">
            {collections.map((c) => (
              <PerCollectionRow
                key={c.key}
                label={c.label}
                allKeys={ordered.map((d) => ({
                  key: d.key,
                  label: labelText(d.field.label, locales[0], d.key),
                }))}
                disabled={config.perCollection[c.key]?.disabled ?? []}
                onChange={(disabled) =>
                  setConfig({
                    ...config,
                    perCollection: disabled.length
                      ? { ...config.perCollection, [c.key]: { disabled } }
                      : Object.fromEntries(
                          Object.entries(config.perCollection).filter(([k]) => k !== c.key),
                        ),
                  })
                }
              />
            ))}
          </div>
        </Section>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="button" onClick={save} disabled={saving || problems.length > 0}>
          {saving ? 'Saving…' : 'Save SEO fields'}
        </Button>
        <span className="text-xs text-neutral-600">
          Six of the built-ins write to the document&rsquo;s own SEO columns; the rest are stored under{' '}
          <code>data.seo</code>. Either way the value is per language, because each language is its own row.
        </span>
      </div>
      {dialog}
    </div>
  );
}

function FieldRow({
  fieldKey,
  builtIn,
  shippedLabel,
  kindLabel,
  tab,
  off,
  canRequire,
  required,
  labels,
  description,
  locales,
  first,
  last,
  extra,
  order,
  onMove,
  onToggleOff,
  onTab,
  onLabels,
  onDescription,
  onRequired,
  onPatchExtra,
  onRemoveExtra,
  onResetOrder,
  onOrder,
}: {
  fieldKey: string;
  builtIn: boolean;
  shippedLabel: string;
  kindLabel: string;
  tab: SeoTab;
  off: boolean;
  canRequire: boolean;
  required: boolean;
  labels: Record<string, string>;
  description: string;
  locales: string[];
  first: boolean;
  last: boolean;
  extra?: CustomFieldDef;
  order: number;
  onMove: (dir: -1 | 1) => void;
  onToggleOff: (off: boolean) => void;
  onTab: (tab: SeoTab) => void;
  onLabels: (labels: Record<string, string>) => void;
  onDescription: (text: string) => void;
  onRequired: (on: boolean) => void;
  onPatchExtra?: (patch: Partial<CustomFieldDef>) => void;
  onRemoveExtra?: () => void;
  onResetOrder: () => void;
  onOrder: (n: number) => void;
}) {
  const [open, setOpen] = useState(Boolean(extra && !extra.key));
  const summary = labels[locales[0]] || shippedLabel;

  return (
    <div className="rounded-sm border border-neutral-200">
      <div className="flex items-center gap-1 px-2 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} className="text-neutral-600" />
          <span className={`truncate text-sm ${off ? 'text-neutral-400 line-through' : 'text-neutral-700'}`}>
            {summary}
          </span>
          <Badge tone="neutral">{SEO_TABS.find((t) => t.key === tab)?.label ?? tab}</Badge>
          <span className="shrink-0 text-xs text-neutral-600">{kindLabel}</span>
          {builtIn ? null : <Badge tone="gold">custom</Badge>}
        </button>
        <IconButton onClick={() => onMove(-1)} disabled={first} aria-label={`Move ${summary} up`}>
          <Icon name="chevron-up" size={14} />
        </IconButton>
        <IconButton onClick={() => onMove(1)} disabled={last} aria-label={`Move ${summary} down`}>
          <Icon name="chevron-down" size={14} />
        </IconButton>
        {onRemoveExtra ? (
          <IconButton onClick={onRemoveExtra} aria-label={`Remove ${summary}`} className="hover:text-red-700">
            <Icon name="trash" size={14} />
          </IconButton>
        ) : null}
      </div>

      {open ? (
        <div className="flex flex-col gap-3 border-t border-neutral-100 p-3">
          <div className="flex flex-wrap items-start gap-3">
            <Field
              label="Key"
              className="w-44"
              description={
                builtIn
                  ? 'Fixed. The frontend and the database both refer to this field by name.'
                  : 'Stored as data.seo.<key>'
              }
            >
              <TextInput
                value={extra ? extra.key : fieldKey}
                disabled={builtIn}
                placeholder="readingTime"
                onChange={(e) => onPatchExtra?.({ key: slugifyKey(e.target.value) })}
              />
            </Field>
            <Field
              label="Type"
              className="w-44"
              description={builtIn ? 'Fixed — changing it would orphan every stored value.' : undefined}
            >
              <Select
                value={extra ? extra.kind : ''}
                disabled={builtIn}
                onChange={(e) => onPatchExtra?.({ kind: e.target.value as CustomFieldKind })}
              >
                {builtIn ? <option value="">{kindLabel}</option> : null}
                {EXTRA_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Tab"
              className="w-44"
              description="Which tab of the SEO panel in the editor the field sits on: General, Social, AEO or Advanced."
            >
              <Select value={tab} onChange={(e) => onTab(e.target.value as SeoTab)}>
                {SEO_TABS.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Position" className="w-28" description="Lower numbers come first.">
              <TextInput
                type="number"
                value={order}
                onChange={(e) => (e.target.value === '' ? onResetOrder() : onOrder(Number(e.target.value)))}
              />
            </Field>
          </div>

          <LabelInputs
            label={labels}
            locales={locales}
            onChange={onLabels}
            placeholder={builtIn ? shippedLabel : undefined}
          />

          <Field
            label="Help text"
            description={builtIn ? 'Replaces the shipped explanation. Leave empty to keep it.' : 'Shown next to the input.'}
          >
            <TextInput value={description} onChange={(e) => onDescription(e.target.value)} />
          </Field>

          {extra && CHOICE_KINDS.includes(extra.kind) ? (
            <OptionsEditor
              options={extra.options ?? []}
              locales={locales}
              onChange={(options) => onPatchExtra?.({ options })}
            />
          ) : null}

          {extra && extra.kind === 'repeater' ? (
            <SubFieldsEditor
              subFields={extra.subFields ?? []}
              locales={locales}
              onChange={(subFields) => onPatchExtra?.({ subFields })}
            />
          ) : null}

          <div className="flex flex-wrap gap-6">
            <Field
              label="Shown in the editor"
              description="Off hides the field from the SEO panel on every content type. Values already saved are kept and come back when it is on again."
            >
              <ToggleCheckbox checked={!off} onChange={(on) => onToggleOff(!on)} />
            </Field>
            <Field
              label="Required to publish"
              description={
                canRequire
                  ? undefined
                  : 'Not available: this field writes to a document column, which the write API validates on its own — a rule set here would hold in the form and nowhere else.'
              }
            >
              <ToggleCheckbox checked={required} disabled={!canRequire} onChange={onRequired} />
            </Field>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PerCollectionRow({
  label,
  allKeys,
  disabled,
  onChange,
}: {
  label: string;
  allKeys: { key: string; label: string }[];
  disabled: string[];
  onChange: (disabled: string[]) => void;
}) {
  return (
    <Field label={label} description="Ticked fields are hidden on this content type.">
      <div className="flex flex-wrap gap-2">
        {allKeys.map((f) => {
          const on = disabled.includes(f.key);
          return (
            <button
              key={f.key}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? disabled.filter((k) => k !== f.key) : [...disabled, f.key])}
              className={
                on
                  ? 'rounded-sm border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-700'
                  : 'rounded-sm border border-neutral-200 px-2 py-1 text-xs text-neutral-600 hover:border-neutral-300'
              }
            >
              {f.label}
            </button>
          );
        })}
      </div>
    </Field>
  );
}
