'use client';

import { useMemo } from 'react';

import type { Field as FieldDef } from '../config';
import { seoFieldsByTab } from '../core/seo/field-overrides';
import {
  robotsColumns,
  robotsValue,
  SEO_FIELDS_DATA_KEY,
  SEO_TABS,
  type SeoFieldDef,
} from '../core/seo/fields';
import { MediaPicker } from './fields/MediaPicker';
import { FieldInput } from './fields/FieldInput';
import { labelText } from './shared';
import { Badge, CharCounter, Checkbox, Field, Section, Select, Tabs, Textarea, TextInput } from './ui';
import type { TabDef } from './ui';

/**
 * The document editor's SEO & AEO panel.
 *
 * It used to be two inputs in a collapsed box in the right rail, which said
 * fairly plainly how much anyone was expected to do there. SEO is a first-class
 * part of writing a page, so it lives in the main column at full width, with
 * the fields split across tabs — fifteen controls in one stack is a wall, and
 * the four groupings (what search shows · what a shared link shows · what an
 * answer engine reads · the switches you touch once a year) are how an editor
 * already thinks about them.
 *
 * ## Two backings, one list
 *
 * See `core/seo/fields`. Six fields write to SEO columns on the document row
 * and the rest to `data.seo`, and the editor must not be able to tell: they
 * interleave in one admin-defined order, inside whichever tab they belong to.
 * So this component switches on `def.storage` — `data` goes through the normal
 * `FieldInput` registry (repeaters, selects and the code editor all come free),
 * `column` gets a control bound to the form's document state.
 */

/** The SEO columns the form holds, as the panel reads and writes them. */
export interface SeoColumns {
  metaTitle: string;
  metaDescription: string;
  noindex: boolean;
  nofollow: boolean;
  includeInSitemap: boolean;
  ogImageUuid: string;
}

export interface SeoPanelProps {
  defs: SeoFieldDef[];
  locale: string;
  locales: string[];
  defaultLocale: string;
  /** The document's `data.seo` object. */
  values: Record<string, unknown>;
  onValuesChange: (next: Record<string, unknown>) => void;
  columns: SeoColumns;
  onColumnsChange: (patch: Partial<SeoColumns>) => void;
  /** Server validation messages, keyed by dotted path (`seo.ogTitle`). */
  errorsByPath?: Record<string, string[]>;
}

/** Does this field carry something? Drives the per-tab count in the header. */
function isFilled(def: SeoFieldDef, values: Record<string, unknown>, columns: SeoColumns): boolean {
  if (def.storage === 'column') {
    switch (def.column) {
      case 'metaTitle':
        return columns.metaTitle !== '';
      case 'metaDescription':
        return columns.metaDescription !== '';
      case 'ogImageUuid':
        return columns.ogImageUuid !== '';
      case 'robots':
        // Only a deliberate restriction counts. "Index, follow" is the state
        // every document is already in, so counting it would show every tab as
        // filled on a document nobody has touched.
        return columns.noindex || columns.nofollow;
      case 'includeInSitemap':
        return !columns.includeInSitemap;
      default:
        return false;
    }
  }
  const v = values[def.key];
  if (v === undefined || v === null || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

export function SeoPanel({
  defs,
  locale,
  locales,
  defaultLocale,
  values,
  onValuesChange,
  columns,
  onColumnsChange,
  errorsByPath,
}: SeoPanelProps) {
  const byTab = useMemo(() => seoFieldsByTab(defs), [defs]);
  // Peers for `showIf` inside the group — only the JSON-backed fields are in
  // `data.seo`, so only they can be a condition's sibling.
  const peers = useMemo<FieldDef[]>(
    () => defs.filter((d) => d.storage === 'data').map((d) => d.field),
    [defs],
  );

  if (byTab.length === 0) return null;

  const setValue = (key: string, value: unknown) => onValuesChange({ ...values, [key]: value });

  const renderOne = (def: SeoFieldDef) => {
    const control =
      def.storage === 'column' ? (
        <ColumnControl key={def.key} def={def} locale={locale} columns={columns} onChange={onColumnsChange} />
      ) : (
        <FieldInput
          key={def.key}
          field={def.field}
          locale={locale}
          locales={locales}
          defaultLocale={defaultLocale}
          value={values[def.key]}
          onChange={(v) => setValue(def.key, v)}
          path={`${SEO_FIELDS_DATA_KEY}.${def.key}`}
          errorsByPath={errorsByPath}
          siblings={values}
          peers={peers}
        />
      );

    // The counter is appended rather than baked into each control, so it works
    // the same over a bespoke column input and a registry-rendered one.
    if (!def.counter) return control;
    const text = def.storage === 'column' ? columnText(def, columns) : String(values[def.key] ?? '');
    return (
      <div key={def.key} className="flex flex-col gap-1">
        {control}
        <div className="flex justify-end">
          <CharCounter value={text} min={def.counter.min} max={def.counter.max} />
        </div>
      </div>
    );
  };

  const tabs: TabDef[] = byTab.map(({ tab, fields }) => {
    const filled = fields.filter((d) => isFilled(d, values, columns)).length;
    return {
      id: tab,
      label: SEO_TABS.find((t) => t.key === tab)?.label ?? tab,
      badge: filled ? (
        <Badge tone="gold" aria-label={`${filled} filled in`}>
          {filled}
        </Badge>
      ) : null,
      content: <>{fields.map(renderOne)}</>,
    };
  });

  return (
    <Section
      title="SEO & AEO"
      description="How this page appears in search results, when it is shared, and to the AI assistants that quote it."
    >
      <Tabs tabs={tabs} label="SEO sections" />
    </Section>
  );
}

/** The current text of a column-backed field, for the character counter. */
function columnText(def: SeoFieldDef, columns: SeoColumns): string {
  if (def.column === 'metaTitle') return columns.metaTitle;
  if (def.column === 'metaDescription') return columns.metaDescription;
  return '';
}

/**
 * A field whose value is a column on the `documents` row.
 *
 * Five of these six had no control anywhere in the admin before now — they were
 * in the table, in the write API and in the version snapshot, and unreachable.
 */
function ColumnControl({
  def,
  locale,
  columns,
  onChange,
}: {
  def: SeoFieldDef;
  locale: string;
  columns: SeoColumns;
  onChange: (patch: Partial<SeoColumns>) => void;
}) {
  const field = def.field;
  const label = labelText(field.label, locale, def.key);
  const description = field.description;

  switch (def.column) {
    case 'metaTitle':
      return (
        <Field label={label} description={description}>
          <TextInput
            value={columns.metaTitle}
            maxLength={255}
            onChange={(e) => onChange({ metaTitle: e.target.value })}
          />
        </Field>
      );

    case 'metaDescription':
      return (
        <Field label={label} description={description}>
          <Textarea
            rows={3}
            value={columns.metaDescription}
            maxLength={320}
            onChange={(e) => onChange({ metaDescription: e.target.value })}
          />
        </Field>
      );

    case 'ogImageUuid':
      return (
        <Field label={label} description={description} composite>
          <MediaPicker
            value={columns.ogImageUuid}
            onChange={(uuid) => onChange({ ogImageUuid: uuid ?? '' })}
          />
        </Field>
      );

    case 'robots': {
      const options = field.kind === 'select' ? field.options : [];
      return (
        <Field label={label} description={description}>
          <Select
            value={robotsValue(columns.noindex, columns.nofollow)}
            onChange={(e) => onChange(robotsColumns(e.target.value))}
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {labelText(o.label, locale, o.value)}
              </option>
            ))}
          </Select>
        </Field>
      );
    }

    case 'includeInSitemap':
      return (
        <Checkbox
          label={label}
          info={description}
          checked={columns.includeInSitemap}
          onChange={(e) => onChange({ includeInSitemap: e.target.checked })}
        />
      );

    default:
      return null;
  }
}
