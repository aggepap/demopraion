'use client';

import { useMemo, useState } from 'react';

import {
  CUSTOM_FIELD_KINDS,
  CUSTOM_GROUP_RENDER,
  CUSTOM_KEY_PATTERN,
  type CustomFieldDef,
  type CustomFieldGroup,
  type CustomFieldKind,
  type CustomFieldsConfig,
  type CustomGroupRender,
} from '../core/fields/definitions';
import { CUSTOM_FIELDS_KEY } from '../core/settings/schema';
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
import { Button, Field, Icon, IconButton, Section, Select, TextInput } from './ui';
import { useConfirm } from './ui/ConfirmDialog';
import { cn } from './ui/cn';

/**
 * Editor for a collection's admin-defined ("ACF-style") custom fields.
 *
 * Writes the whole `cms.customFields` blob through the settings API — the same
 * pattern as `CouponsManager`/`ShippingSettings`, so it inherits the existing
 * allowlist, cache purge and audit entry. Definitions are compiled into real
 * `Field`s server-side (`core/fields`), which is what makes them show up in the
 * document form and in validation.
 */

const RENDER_LABEL: Record<CustomGroupRender, string> = {
  specs: 'With the specifications table',
  tab: 'Its own product-page tab',
  hidden: 'Not shown on the product page',
};

export interface CustomFieldsManagerProps {
  /** Collection these definitions belong to (e.g. `product`). */
  collectionKey: string;
  /** The full stored blob, so a save doesn't clobber other collections. */
  initial: Record<string, CustomFieldsConfig>;
  /** Site locales — one label input per language. */
  locales: string[];
  /** Top-level field keys already defined in code; a custom key can't shadow one. */
  reservedKeys: string[];
  /** Collection keys a `relation` field may point at. */
  collectionKeys: string[];
  /** Categories available for conditional visibility. */
  categories: { id: number; label: string }[];
}

const emptyConfig = (): CustomFieldsConfig => ({ groups: [], fields: [] });

export function CustomFieldsManager({
  collectionKey,
  initial,
  locales,
  reservedKeys,
  collectionKeys,
  categories,
}: CustomFieldsManagerProps) {
  const [all, setAll] = useState<Record<string, CustomFieldsConfig>>(() => ({ ...initial }));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  const config = all[collectionKey] ?? emptyConfig();
  const setConfig = (next: CustomFieldsConfig) => {
    setAll((prev) => ({ ...prev, [collectionKey]: next }));
    setSaved(false);
  };

  const patchField = (index: number, patch: Partial<CustomFieldDef>) =>
    setConfig({
      ...config,
      fields: config.fields.map((f, i) => (i === index ? { ...f, ...patch } : f)),
    });

  const moveField = (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= config.fields.length) return;
    const fields = [...config.fields];
    [fields[index], fields[j]] = [fields[j], fields[index]];
    setConfig({ ...config, fields });
  };

  const addField = () =>
    setConfig({
      ...config,
      fields: [
        ...config.fields,
        { id: crypto.randomUUID(), key: '', kind: 'text', label: {}, showOnPdp: true },
      ],
    });

  const addGroup = () =>
    setConfig({
      ...config,
      groups: [
        ...config.groups,
        { key: '', label: {}, renderAs: 'specs', order: config.groups.length },
      ],
    });

  const patchGroup = (index: number, patch: Partial<CustomFieldGroup>) =>
    setConfig({
      ...config,
      groups: config.groups.map((g, i) => (i === index ? { ...g, ...patch } : g)),
    });

  const removeGroup = (index: number) => {
    const removed = config.groups[index];
    setConfig({
      ...config,
      groups: config.groups.filter((_, i) => i !== index),
      // Orphaned fields fall back to the ungrouped bucket rather than vanishing.
      fields: config.fields.map((f) => (f.group === removed.key ? { ...f, group: undefined } : f)),
    });
  };

  // Blocking problems — surfaced inline and used to disable Save, since the
  // server sanitiser would silently drop these rows rather than complain.
  const problems = useMemo(() => {
    const out: string[] = [];
    const reserved = new Set(reservedKeys);
    const seen = new Set<string>();
    for (const f of config.fields) {
      const where = f.key || '(unnamed field)';
      if (!f.key) out.push('A field is missing a key.');
      else if (!CUSTOM_KEY_PATTERN.test(f.key))
        out.push(`"${where}" — key must start with a letter and use only letters, digits or _.`);
      else if (reserved.has(f.key)) out.push(`"${where}" — that key is already used by the built-in schema.`);
      else if (seen.has(f.key)) out.push(`"${where}" — duplicate key.`);
      seen.add(f.key);
      if (CHOICE_KINDS.includes(f.kind) && !(f.options?.length ?? 0))
        out.push(`"${where}" — a select needs at least one option.`);
      if (f.kind === 'relation' && !f.relationTo) out.push(`"${where}" — pick a target collection.`);
      if (f.kind === 'repeater' && !(f.subFields?.length ?? 0))
        out.push(`"${where}" — a repeater needs at least one sub-field.`);
    }
    const groupKeys = new Set<string>();
    for (const g of config.groups) {
      if (!g.key) out.push('A group is missing a key.');
      else if (!CUSTOM_KEY_PATTERN.test(g.key)) out.push(`Group "${g.key}" — invalid key.`);
      else if (groupKeys.has(g.key)) out.push(`Group "${g.key}" — duplicate key.`);
      groupKeys.add(g.key);
    }
    return out;
  }, [config, reservedKeys]);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      /*
       * Only this collection, and a statement of the copy it was edited from.
       *
       * Posting the whole blob is what destroyed the other sub-tabs' work: this
       * screen loads one snapshot and hands it to every collection's editor, so a
       * save carried a copy of every other collection from before anyone touched
       * them (F-062). The server merges what it is told about and leaves the rest
       * alone; the baseline lets it refuse rather than silently win if someone else
       * has since changed this same collection.
       */
      await cmsApi.updateSiteSettings({
        [CUSTOM_FIELDS_KEY]: { [collectionKey]: config },
        'cms.customFields.baseline': { [collectionKey]: initial[collectionKey] ?? null },
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof CmsApiError || err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <div className="rounded-sm border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      ) : null}
      {saved ? (
        <div className="rounded-sm border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-700">
          Fields saved.
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
        title="Groups"
        info="A group gives its fields a heading in the editor and decides where they appear on the product page."
      >
        <div className="flex flex-col gap-2">
          {config.groups.map((group, i) => (
            <div key={i} className="flex flex-col gap-3 rounded-sm border border-neutral-200 p-3">
              <div className="flex items-start gap-3">
                <Field
                  label="Key"
                  className="w-40"
                  description="The group’s internal name, which fields use to join it. Letters, digits and _."
                >
                  <TextInput
                    value={group.key}
                    placeholder="care"
                    onChange={(e) => patchGroup(i, { key: slugifyKey(e.target.value) })}
                  />
                </Field>
                <Field
                  label="Shown on the product page"
                  className="flex-1"
                  description="Where the group’s fields appear on the product page: in the specifications table, on a tab of their own, or not at all (they stay in the editor)."
                >
                  <Select
                    value={group.renderAs}
                    onChange={(e) => patchGroup(i, { renderAs: e.target.value as CustomGroupRender })}
                  >
                    {CUSTOM_GROUP_RENDER.map((r) => (
                      <option key={r} value={r}>
                        {RENDER_LABEL[r]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <IconButton
                  onClick={() => removeGroup(i)}
                  aria-label="Remove group"
                  className="mt-6 hover:text-red-700"
                >
                  <Icon name="trash" size={14} />
                </IconButton>
              </div>
              <LabelInputs
                label={group.label}
                locales={locales}
                onChange={(label) => patchGroup(i, { label })}
              />
            </div>
          ))}
          <div>
            <Button variant="secondary" size="sm" onClick={addGroup}>
              <Icon name="plus" size={14} /> Add group
            </Button>
          </div>
        </div>
      </Section>

      <Section title="Fields" right={<span className="text-xs text-neutral-600">{config.fields.length}</span>}>
        <div className="flex flex-col gap-2">
          {config.fields.map((field, i) => (
            <FieldRow
              key={field.id}
              field={field}
              index={i}
              total={config.fields.length}
              locales={locales}
              groups={config.groups}
              collectionKeys={collectionKeys}
              categories={categories}
              onPatch={(patch) => patchField(i, patch)}
              onMove={(dir) => moveField(i, dir)}
              onRemove={async () => {
                const ok = await confirm({
                  title: 'Remove this field?',
                  message: 'Values already saved on documents are dropped. This cannot be undone.',
                  confirmLabel: 'Remove',
                });
                if (ok) setConfig({ ...config, fields: config.fields.filter((_, x) => x !== i) });
              }}
            />
          ))}
          <div>
            <Button variant="secondary" size="sm" onClick={addField}>
              <Icon name="plus" size={14} /> Add field
            </Button>
          </div>
        </div>
      </Section>

      <div className="flex items-center gap-3">
        <Button type="button" onClick={save} disabled={saving || problems.length > 0}>
          {saving ? 'Saving…' : 'Save fields'}
        </Button>
        <span className="text-xs text-neutral-600">
          Values are stored under <code>data.custom</code> and shared across languages; tick
          “Translate per language” for text that needs a version per locale.
        </span>
      </div>
      {dialog}
    </div>
  );
}

function FieldRow({
  field,
  index,
  total,
  locales,
  groups,
  collectionKeys,
  categories,
  onPatch,
  onMove,
  onRemove,
}: {
  field: CustomFieldDef;
  index: number;
  total: number;
  locales: string[];
  groups: CustomFieldGroup[];
  collectionKeys: string[];
  categories: { id: number; label: string }[];
  onPatch: (patch: Partial<CustomFieldDef>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(!field.key);
  const summary = field.label[locales[0]] || field.key || `Field ${index + 1}`;
  const scoped = (field.categoryIds?.length ?? 0) > 0;

  const toggleCategory = (id: number, on: boolean) => {
    const current = field.categoryIds ?? [];
    const next = on ? [...current, id] : current.filter((x) => x !== id);
    onPatch({ categoryIds: next.length ? next : undefined });
  };

  return (
    <div className="rounded-sm border border-neutral-200">
      <div className="flex items-center gap-1 px-2 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} className="text-neutral-600" />
          <span className="truncate text-sm text-neutral-700">{summary}</span>
          <span className="shrink-0 text-xs text-neutral-600">{KIND_LABEL[field.kind]}</span>
          {scoped ? <span className="shrink-0 text-xs text-amber-600">scoped</span> : null}
        </button>
        <IconButton onClick={() => onMove(-1)} disabled={index === 0} aria-label="Move up">
          <Icon name="chevron-up" size={14} />
        </IconButton>
        <IconButton onClick={() => onMove(1)} disabled={index === total - 1} aria-label="Move down">
          <Icon name="chevron-down" size={14} />
        </IconButton>
        <IconButton
          // The confirmation lives in the parent, which owns the dialog — a
          // per-row dialog would mount one modal per field in the list.
          onClick={onRemove}
          aria-label="Remove field"
          className="hover:text-red-700"
        >
          <Icon name="trash" size={14} />
        </IconButton>
      </div>

      {open ? (
        <div className="flex flex-col gap-3 border-t border-neutral-100 p-3">
          <div className="flex flex-wrap items-start gap-3">
            <Field
              label="Key"
              required
              className="w-44"
              description="The name the value is stored under (data.custom.<key>). Starts with a letter; letters, digits and _ only."
            >
              <TextInput
                value={field.key}
                placeholder="material"
                onChange={(e) => onPatch({ key: slugifyKey(e.target.value) })}
              />
            </Field>
            <Field
              label="Type"
              className="w-44"
              description="What kind of value editors enter, which decides the input they get: text, a number, a list of choices, an image, a link to another document and so on."
            >
              <Select
                value={field.kind}
                onChange={(e) => onPatch({ kind: e.target.value as CustomFieldKind })}
              >
                {CUSTOM_FIELD_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Group"
              className="w-44"
              description="The group the field is shown under. Ungrouped fields appear with the specifications."
            >
              <Select
                value={field.group ?? ''}
                onChange={(e) => onPatch({ group: e.target.value || undefined })}
              >
                <option value="">— ungrouped —</option>
                {groups.map((g) => (
                  <option key={g.key} value={g.key}>
                    {g.label[locales[0]] || g.key}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <LabelInputs label={field.label} locales={locales} onChange={(label) => onPatch({ label })} />

          <Field label="Help text" description="Shown under the input in the editor.">
            <TextInput
              value={field.description ?? ''}
              onChange={(e) => onPatch({ description: e.target.value || undefined })}
            />
          </Field>

          {field.kind === 'number' ? (
            <div className="flex flex-wrap gap-3">
              <Field label="Min" className="w-28" description="The smallest number editors may enter. Empty = no limit.">
                <TextInput
                  type="number"
                  value={field.min ?? ''}
                  onChange={(e) => onPatch({ min: e.target.value === '' ? undefined : Number(e.target.value) })}
                />
              </Field>
              <Field label="Max" className="w-28" description="The largest number editors may enter. Empty = no limit.">
                <TextInput
                  type="number"
                  value={field.max ?? ''}
                  onChange={(e) => onPatch({ max: e.target.value === '' ? undefined : Number(e.target.value) })}
                />
              </Field>
              <Field
                label="Unit"
                className="w-28"
                description="Shown to editors under the field as a reminder, e.g. cm. It is not added to the value on the site."
              >
                <TextInput
                  value={field.unit ?? ''}
                  placeholder="cm"
                  onChange={(e) => onPatch({ unit: e.target.value || undefined })}
                />
              </Field>
              <Field
                label="Whole numbers only"
                className="w-40"
                description="Refuses decimals, so only whole numbers such as 1, 2 or 30 can be saved."
              >
                <ToggleCheckbox
                  checked={Boolean(field.integer)}
                  onChange={(on) => onPatch({ integer: on || undefined })}
                />
              </Field>
            </div>
          ) : null}

          {CHOICE_KINDS.includes(field.kind) ? (
            <OptionsEditor
              options={field.options ?? []}
              locales={locales}
              onChange={(options) => onPatch({ options })}
            />
          ) : null}

          {field.kind === 'relation' ? (
            <Field
              label="Target collection"
              required
              className="w-56"
              description="The kind of content this field links to. Editors pick from the documents of that type."
            >
              <Select
                value={field.relationTo ?? ''}
                onChange={(e) => onPatch({ relationTo: e.target.value || undefined })}
              >
                <option value="">— select —</option>
                {collectionKeys.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          {field.kind === 'repeater' ? (
            <SubFieldsEditor
              subFields={field.subFields ?? []}
              locales={locales}
              onChange={(subFields) => onPatch({ subFields })}
            />
          ) : null}

          <div className="flex flex-wrap gap-6">
            <Field label="Translate per language" description="Store one value per locale.">
              <ToggleCheckbox
                checked={Boolean(field.perLanguage)}
                onChange={(on) => onPatch({ perLanguage: on || undefined })}
              />
            </Field>
            <Field
              label="Required"
              description="Editors must fill it in before the document can be published. Drafts can still be saved without it."
            >
              <ToggleCheckbox
                checked={Boolean(field.required)}
                onChange={(on) => onPatch({ required: on || undefined })}
              />
            </Field>
            <Field
              label="Show on the product page"
              description="Off keeps the field in the editor only; visitors never see its value."
            >
              <ToggleCheckbox
                checked={field.showOnPdp !== false}
                onChange={(on) => onPatch({ showOnPdp: on ? undefined : false })}
              />
            </Field>
          </div>

          {categories.length > 0 ? (
            <Field
              label="Only for these categories"
              description="Leave all unticked to show the field on every document."
            >
              <div className="flex flex-wrap gap-2">
                {categories.map((c) => {
                  const on = field.categoryIds?.includes(c.id) ?? false;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleCategory(c.id, !on)}
                      className={cn(
                        'rounded-sm border px-2 py-1 text-xs',
                        on
                          ? 'border-warm-gold-deep bg-warm-gold/15 text-warm-gold-deep'
                          : 'border-neutral-200 text-neutral-600 hover:border-neutral-300',
                      )}
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>
            </Field>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
