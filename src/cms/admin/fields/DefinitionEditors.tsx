'use client';

import type { CustomFieldDef, CustomFieldKind, LocalizedLabel } from '../../core/fields/definitions';
import { Button, Field, Icon, IconButton, Select, TextInput } from '../ui';
import type { FieldControlProps } from '../ui/Field';

/**
 * The pieces of a field-definition editor that more than one admin screen needs.
 *
 * `CustomFieldsManager` (per-collection ACF fields) and `SeoFieldsManager`
 * (the built-in SEO/AEO set plus admin extras) both let someone define a field,
 * and both need the same three sub-editors: per-locale labels, a select's
 * option list, and a repeater's columns. They were about to be a second copy —
 * which is how the two screens would have ended up disagreeing about what a
 * valid option or sub-field is, while the ONE server-side sanitiser
 * (`sanitizeFields`) went on applying its own rules to both.
 */

export const KIND_LABEL: Record<CustomFieldKind, string> = {
  text: 'Text',
  textarea: 'Long text',
  richText: 'Rich text',
  number: 'Number',
  select: 'Select (one)',
  multiselect: 'Select (many)',
  boolean: 'Yes / no',
  date: 'Date',
  color: 'Colour',
  image: 'Image',
  relation: 'Relation',
  repeater: 'Repeater',
};

/** Kinds that carry a fixed option list. */
export const CHOICE_KINDS: CustomFieldKind[] = ['select', 'multiselect'];

/** Repeater children — one level, simple kinds only (no nesting, no scoping). */
export const SUB_KINDS: CustomFieldKind[] = ['text', 'textarea', 'number', 'boolean', 'date', 'image'];

export const slugifyKey = (v: string) =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^([0-9])/, 'f$1');

/**
 * A bare yes/no toggle for use inside a `Field`.
 *
 * Takes the ids `Field` clones onto its child and puts them on the checkbox.
 * Without that the Field's label pointed at an id nothing had, and its
 * description — the "i" beside the label — described nothing.
 */
export function ToggleCheckbox({
  checked,
  onChange,
  disabled,
  id,
  'aria-describedby': describedBy,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
} & Partial<FieldControlProps>) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-neutral-700">
      <input
        type="checkbox"
        id={id}
        aria-describedby={describedBy}
        className="h-4 w-4 accent-warm-gold-deep"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {checked ? 'Yes' : 'No'}
    </label>
  );
}

/** One label input per site locale. */
export function LabelInputs({
  label,
  locales,
  onChange,
  legend = 'Label',
  placeholder,
}: {
  label: LocalizedLabel;
  locales: string[];
  onChange: (label: LocalizedLabel) => void;
  legend?: string;
  /** Per-locale fallback shown when the field has no override, e.g. the
   *  shipped label of a built-in. */
  placeholder?: string;
}) {
  return (
    <div className="flex flex-wrap gap-3">
      {locales.map((l) => (
        <Field
          key={l}
          label={`${legend} — ${l.toUpperCase()}`}
          className="min-w-48 flex-1"
          description={`The name shown for it in ${l.toUpperCase()}.`}
        >
          <TextInput
            value={label[l] ?? ''}
            placeholder={placeholder}
            onChange={(e) => onChange({ ...label, [l]: e.target.value })}
          />
        </Field>
      ))}
    </div>
  );
}

export function OptionsEditor({
  options,
  locales,
  onChange,
}: {
  options: { value: string; label?: LocalizedLabel }[];
  locales: string[];
  onChange: (options: { value: string; label?: LocalizedLabel }[]) => void;
}) {
  return (
    <Field
      label="Options"
      required
      description="The choices offered. The value is what gets stored; the labels are what people see in each language."
    >
      <div className="flex flex-col gap-2">
        {options.map((o, i) => (
          <div key={i} className="flex items-start gap-2">
            <TextInput
              className="w-40"
              value={o.value}
              placeholder="value"
              onChange={(e) =>
                onChange(options.map((x, j) => (j === i ? { ...x, value: slugifyKey(e.target.value) } : x)))
              }
            />
            {locales.map((l) => (
              <TextInput
                key={l}
                value={o.label?.[l] ?? ''}
                placeholder={`label ${l}`}
                onChange={(e) =>
                  onChange(
                    options.map((x, j) =>
                      j === i ? { ...x, label: { ...x.label, [l]: e.target.value } } : x,
                    ),
                  )
                }
              />
            ))}
            <IconButton
              onClick={() => onChange(options.filter((_, j) => j !== i))}
              aria-label="Remove option"
              className="hover:text-red-700"
            >
              <Icon name="trash" size={14} />
            </IconButton>
          </div>
        ))}
        <div>
          <Button variant="secondary" size="sm" onClick={() => onChange([...options, { value: '' }])}>
            <Icon name="plus" size={14} /> Add option
          </Button>
        </div>
      </div>
    </Field>
  );
}

export function SubFieldsEditor({
  subFields,
  locales,
  onChange,
}: {
  subFields: CustomFieldDef[];
  locales: string[];
  onChange: (subFields: CustomFieldDef[]) => void;
}) {
  return (
    <Field label="Sub-fields" required description="The columns of each repeater row.">
      <div className="flex flex-col gap-2">
        {subFields.map((sub, i) => (
          <div key={sub.id} className="flex items-start gap-2">
            <TextInput
              className="w-36"
              value={sub.key}
              placeholder="key"
              onChange={(e) =>
                onChange(subFields.map((x, j) => (j === i ? { ...x, key: slugifyKey(e.target.value) } : x)))
              }
            />
            <Select
              className="w-32"
              value={sub.kind}
              onChange={(e) =>
                onChange(
                  subFields.map((x, j) => (j === i ? { ...x, kind: e.target.value as CustomFieldKind } : x)),
                )
              }
            >
              {SUB_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </Select>
            {locales.map((l) => (
              <TextInput
                key={l}
                value={sub.label[l] ?? ''}
                placeholder={`label ${l}`}
                onChange={(e) =>
                  onChange(
                    subFields.map((x, j) =>
                      j === i ? { ...x, label: { ...x.label, [l]: e.target.value } } : x,
                    ),
                  )
                }
              />
            ))}
            <IconButton
              onClick={() => onChange(subFields.filter((_, j) => j !== i))}
              aria-label="Remove sub-field"
              className="hover:text-red-700"
            >
              <Icon name="trash" size={14} />
            </IconButton>
          </div>
        ))}
        <div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              onChange([...subFields, { id: crypto.randomUUID(), key: '', kind: 'text', label: {} }])
            }
          >
            <Icon name="plus" size={14} /> Add sub-field
          </Button>
        </div>
      </div>
    </Field>
  );
}
