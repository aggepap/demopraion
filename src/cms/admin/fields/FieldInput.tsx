'use client';

import { useState, type InputHTMLAttributes } from 'react';
import type { JSONContent } from '@tiptap/react';

import { isFieldVisible, type Field as FieldDef } from '../../config';
import { overlappingRangeRows } from '../../core/fields/month-day';
import { buildBlocks, labelText } from '../shared';
import { Button, Field, Icon, IconButton, Section, Select, Textarea, TextInput } from '../ui';
import { useConfirm } from '../ui/ConfirmDialog';
import { cn } from '../ui/cn';
import { dateFieldFromInput, dateFieldToInput } from '../local-datetime';
import { useHydrated } from '../use-hydrated';
import { MediaPicker } from './MediaPicker';
import { RelationPicker } from './RelationPicker';
import { MdxBodyEditor } from './MdxBodyEditor';
import { RichTextEditor } from './RichTextEditor';
import { isMdxPreviewField, type RenderMdxPreview } from './mdx/preview-state';
import { TermPicker } from './TermPicker';
import { VariationsEditor } from './VariationsEditor';

export interface FieldInputProps {
  field: FieldDef;
  /** Current document locale (for label resolution). */
  locale: string;
  /** All site locales (for `localized` field tabs). */
  locales: string[];
  value: unknown;
  onChange: (value: unknown) => void;
  error?: string[];
  /**
   * Dotted path of this field within `data` (`header.eyebrow`, `toc.0.label`).
   * Set by whichever container rendered it; the top level passes the bare key.
   */
  path?: string;
  /**
   * Every validation message the server returned, keyed by that same dotted
   * path. Groups and repeaters forward it down untouched so a message lands on
   * the exact control it is about instead of dying at the top level.
   */
  errorsByPath?: Record<string, string[]>;
  /** Sibling fields' values at this level — used by custom controls (e.g.
   *  `variations`, which reads the sibling `attributes` field) and by `showIf`. */
  siblings?: Record<string, unknown>;
  /** Sibling field DEFINITIONS at this level, so a `showIf` on an unset
   *  discriminator can fall back to its declared default. */
  peers?: readonly FieldDef[];
  /**
   * The whole document's `data`, forwarded down every level unchanged.
   *
   * `siblings` deliberately narrows to the current level so a condition inside a
   * repeater reads its own row. A `boundsFrom` needs the opposite: a price band
   * is constrained by the experience's party-size range, which is several levels
   * above it. Read-only — nothing writes through this.
   */
  root?: Record<string, unknown>;
  /** Site default locale — used by controls that manage cross-locale entities
   *  (e.g. the category tree picker). */
  defaultLocale?: string;
  /**
   * Renders an unsaved MDX body for the live preview pane.
   *
   * Injected by the site (as a Server Action) rather than imported, because the
   * renderer is `@/components/cms/MdxRuntime` and `src/cms/**` may not reach
   * site code — the same reason `CodeField.allowedComponents` arrives through
   * the config. Absent means the editor shows no preview pane, which is what
   * every non-document `FieldInput` caller gets.
   */
  renderMdxPreview?: RenderMdxPreview;
}

/**
 * The field-editor registry: renders the right control for a field kind — the
 * thing that makes the admin config-driven. Groups/repeaters get their own
 * Section chrome; `localized` leaves get per-locale tabs; the rest are a
 * labelled control.
 */
/**
 * Words in a body of MDX, as a reader would count them.
 *
 * Component tags, expressions, code fences and link targets are markup rather than
 * words, so they come out first — otherwise `<QuickAnswer summary="...">` inflates the
 * figure and the reading time shown to visitors is wrong in the direction that makes
 * the page look longer than it is.
 */
function countWords(mdx: string): number {
  const prose = mdx
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*_>`|-]+/g, ' ');
  return prose.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

export function FieldInput(props: FieldInputProps) {
  const { field, locale, path, errorsByPath } = props;
  const label = labelText(field.label, locale, field.key);
  // An explicit `error` still wins; otherwise look this field's own path up in
  // the server's message map.
  const error = props.error ?? (path ? errorsByPath?.[path] : undefined);

  // Machine fields (e.g. auto-generated ids) are stored but never shown.
  if (field.hidden) return null;
  // Conditional fields: not applicable to what is being edited right now. The
  // value stays in `data` — this only stops it being rendered.
  if (!isFieldVisible(field, props.siblings, props.peers)) return null;

  if (field.kind === 'group') return <GroupControl {...props} label={label} error={error} />;
  if (field.kind === 'repeater') return <RepeaterControl {...props} label={label} error={error} />;
  if (field.kind === 'variations') {
    const attrs = props.siblings?.[field.attributesKey];
    return (
      <Section title={label} description={field.description} defaultOpen>
        <VariationsEditor
          value={props.value}
          onChange={props.onChange}
          attributes={Array.isArray(attrs) ? (attrs as Record<string, unknown>[]) : []}
          locale={locale}
          defaultLocale={props.defaultLocale ?? locale}
        />
      </Section>
    );
  }
  if (field.localized) return <LocalizedField {...props} label={label} />;

  return (
    <Field
      label={label}
      required={field.required}
      description={field.description}
      error={error}
      composite={isComposite(field)}
    >
      <LeafControl {...props} />
    </Field>
  );
}

/**
 * Kinds whose control is a whole widget rather than one labelable element.
 *
 * These render their own composite UI (a chip list plus a search box, a tree, a
 * thumbnail plus buttons, a TipTap surface), so an `id` cloned onto them lands
 * on a React component and never reaches the DOM — leaving the visible label
 * attached to nothing. `Field` labels the group for these instead.
 */
function isComposite(field: FieldDef): boolean {
  switch (field.kind) {
    /*
     * NOT `code`/mdx, despite appearances.
     *
     * An MDX body looks composite — toolbar, textarea, preview pane — and was
     * briefly listed here for that reason. But the list is about whether a single
     * labelable DOM control exists, and for MDX one does: the textarea. Marking it
     * composite made `Field` skip the clone path, so `LeafControl` received no
     * `id`, `MdxBodyEditor` had none to put on its <textarea>, and the label
     * pointed at nothing while `role="group"` absorbed the name. The body became
     * unreachable by its label — for a screen reader and for anything else
     * addressing it that way.
     *
     * The plumbing for the composite reading was never built; the plumbing for
     * this one already exists end to end (`LeafControl` spreads `a11y` into
     * `MdxBodyEditor`, which puts `id` on the textarea at its `editor` block), so
     * leaving `code` out is what makes the label work.
     */
    case 'richText':
    case 'image':
    case 'relation':
    case 'color':
    case 'monthDay':
      return true;
    case 'select':
      return Boolean(field.multiple);
    default:
      return false;
  }
}

/** EL/EN (etc.) tabbed editing for a `localized` leaf field. Stores a
 *  `{ [locale]: value }` map — the shape the zod validator expects. */
function LocalizedField({ field, locale, locales, value, onChange, error, label, renderMdxPreview }: FieldInputProps & { label: string }) {
  const map = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

  /*
   * The sub-tab starts on, and follows, the language the document is being
   * edited in. It used to start on `locales[0]` and never move: with the
   * document on its EN tab, this field still showed EL, so anything typed went
   * into the EL entry of the map. Nothing said so, and the EN page then rendered
   * as if the field had been left empty.
   */
  const preferred = locales.includes(locale) ? locale : (locales[0] ?? locale);
  const [active, setActive] = useState(preferred);
  const [wasPreferred, setWasPreferred] = useState(preferred);
  if (preferred !== wasPreferred) {
    setWasPreferred(preferred);
    setActive(preferred);
  }

  return (
    <Field
      label={label}
      required={field.required}
      description={field.description}
      error={error}
      composite={isComposite(field)}
    >
      {/* The tab strip sits above the control, so this field has two children
          and `Field` could not clone the ids onto either of them — its label
          pointed at nothing, on every localized field in the admin. The
          function form hands the ids over to be placed on the real input. */}
      {(a11y) => (
        <>
          <div className="mb-1.5 flex gap-1">
            {locales.map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={active === l}
                aria-label={`${label} — ${l.toUpperCase()}`}
                onClick={() => setActive(l)}
                className={cn(
                  'rounded-sm px-2 py-0.5 text-xs font-medium uppercase',
                  active === l ? 'bg-warm-gold/20 text-warm-gold-deep' : 'text-neutral-600 hover:bg-neutral-100',
                )}
              >
                {l}
              </button>
            ))}
          </div>
          <LeafControl
            {...a11y}
            field={field}
            locale={locale}
            locales={locales}
            value={map[active]}
            onChange={(v) => onChange({ ...map, [active]: v })}
            renderMdxPreview={renderMdxPreview}
          />
        </>
      )}
    </Field>
  );
}

/**
 * The leaf control for a single (non-group/repeater) field.
 *
 * `Field` mints the id its `<label htmlFor>` points at and hands it down here;
 * without forwarding it onto the real DOM control the label would again be
 * attached to nothing. The rich pickers (media, relations, colour) render their
 * own composite UI and are left alone — they carry their own labelling.
 */
function LeafControl({
  field,
  locale,
  locales,
  value,
  onChange,
  defaultLocale,
  siblings,
  root,
  renderMdxPreview,
  id,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
}: FieldInputProps & { id?: string; 'aria-describedby'?: string; 'aria-invalid'?: true }) {
  const a11y = { id, 'aria-describedby': describedBy, 'aria-invalid': invalid };
  switch (field.kind) {
    case 'text':
      return (
        <TextInput
          {...a11y}
          value={typeof value === 'string' ? value : ''}
          maxLength={field.maxLength}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'textarea':
      return (
        <Textarea
          {...a11y}
          rows={field.rows ?? 4}
          value={typeof value === 'string' ? value : ''}
          maxLength={field.maxLength}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'richText':
      return <RichTextEditor value={value as JSONContent | undefined} onChange={onChange} />;
    case 'code': {
      // An editorial body gets the full editor; every other `code` field (JSON
      // schema blobs, raw HTML) keeps the plain textarea it has always had.
      if (isMdxPreviewField(field)) {
        return (
          <MdxBodyEditor
            {...a11y}
            value={typeof value === 'string' ? value : ''}
            onChange={onChange}
            locale={locale}
            allowedComponents={field.allowedComponents}
            palette={field.componentPalette}
            renderPreview={renderMdxPreview}
            rows={field.rows}
          />
        );
      }
      return (
        <Textarea
          {...a11y}
          className="min-h-[22rem] font-mono text-xs leading-relaxed"
          rows={field.rows ?? 20}
          /*
           * Spellcheck off for code, on for MDX.
           *
           * An editorial body is an MDX field, which is this same `code` kind with a
           * different language — so it inherited "this is source, do not check the
           * spelling". But an article body is prose with the occasional component tag
           * in it, and a writer typing a few thousand words was getting no help at all
           * with typos that then went to the public site. Real code stays unchecked,
           * where the squiggles would be noise.
           */
          spellCheck={field.language === 'mdx'}
          placeholder={`${field.language ?? 'code'} source`}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    }
    case 'number': {
      // A literal bound wins; otherwise take it from the document field named by
      // `boundsFrom`, so a price band cannot be spun past the party size the
      // experience actually accepts.
      const bound = (key: string | undefined): number | undefined => {
        const raw = key ? root?.[key] : undefined;
        return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
      };
      const input = (
        <TextInput
          {...a11y}
          type="number"
          value={typeof value === 'number' ? value : ''}
          min={field.min ?? bound(field.boundsFrom?.min)}
          max={field.max ?? bound(field.boundsFrom?.max)}
          step={field.integer ? 1 : 'any'}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      );
      if (!field.countWordsFrom) return input;
      const source = siblings?.[field.countWordsFrom];
      const words = typeof source === 'string' ? countWords(source) : 0;
      return (
        <div className="flex items-center gap-2">
          {input}
          {/*
            Offered, not imposed. A number the editor chose deliberately must not be
            replaced by one this button prefers, so it only ever acts when clicked — and
            it says what it would set, so clicking it is not a guess.
          */}
          <button
            type="button"
            disabled={words === 0 || words === value}
            onClick={() => onChange(words)}
            className="shrink-0 rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-100 disabled:opacity-40"
          >
            {words > 0 ? `Count from text (${words})` : 'Count from text'}
          </button>
        </div>
      );
    }
    case 'boolean':
      return (
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-neutral-700">
          <input
            {...a11y}
            type="checkbox"
            className="h-4 w-4 accent-warm-gold-deep"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
          />
          {/* Unchecked reads as an INVITATION, checked as a state. It used to
              say "Disabled", which states a status in the one place the reader
              is looking for an action — next to an empty box, "Disabled" and
              "not ticked" are the same fact told twice, and it scanned as
              "this setting is unavailable" rather than "tick to turn on". */}
          {value ? 'Enabled' : 'Enable'}
        </label>
      );
    case 'select':
      return field.multiple ? (
        <MultiSelect field={field} locale={locale} value={value} onChange={onChange} />
      ) : (
        <Select
          {...a11y}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value || undefined)}
        >
          <option value="">— select —</option>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {labelText(o.label, locale, o.value)}
            </option>
          ))}
        </Select>
      );
    case 'date':
      return <DateControl a11y={a11y} withTime={field.withTime} value={value} onChange={onChange} />;
    case 'monthDay':
      return <MonthDayControl value={typeof value === 'string' ? value : ''} onChange={onChange} />;
    case 'color':
      return <ColorControl value={typeof value === 'string' ? value : ''} onChange={onChange} />;
    case 'image':
      return <MediaPicker value={typeof value === 'string' ? value : ''} onChange={onChange} />;
    case 'relation':
      return field.picker === 'categoryTree' || field.picker === 'termList' ? (
        <TermPicker
          field={field}
          locale={locale}
          locales={locales}
          defaultLocale={defaultLocale ?? locale}
          value={value}
          onChange={onChange}
        />
      ) : (
        <RelationPicker field={field} value={value} onChange={onChange} />
      );
    default:
      return null;
  }
}

/** Searchable multi-select with selected-as-chips (for `select multiple`). */
function MultiSelect({
  field,
  locale,
  value,
  onChange,
}: {
  field: Extract<FieldDef, { kind: 'select' }>;
  locale: string;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const selected = Array.isArray(value) ? (value as string[]) : [];
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const optionLabel = (v: string) =>
    labelText(field.options.find((o) => o.value === v)?.label, locale, v);
  const available = field.options
    .map((o) => o.value)
    .filter((v) => !selected.includes(v) && optionLabel(v).toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="flex flex-col gap-2">
      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((v) => (
            <span key={v} className="inline-flex items-center gap-1 rounded-sm bg-warm-gold/15 px-2 py-1 text-xs text-warm-gold-deep">
              {optionLabel(v)}
              <button
                type="button"
                aria-label="Remove"
                onClick={() => {
                  const next = selected.filter((x) => x !== v);
                  onChange(next.length ? next : undefined);
                }}
                className="hover:text-red-700"
              >
                <Icon name="x" size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="relative">
        <TextInput
          value={q}
          aria-label="Search options"
          placeholder="Search options…"
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
        {open && available.length > 0 ? (
          <ul className="absolute z-10 mt-1 max-h-52 w-full overflow-auto rounded-sm border border-neutral-200 bg-white shadow-lg">
            {available.map((v) => (
              <li key={v}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange([...selected, v]);
                    setQ('');
                  }}
                  className="block w-full px-3 py-1.5 text-left text-sm hover:bg-neutral-50"
                >
                  {optionLabel(v)}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

/** A hex-colour swatch + text input, kept in sync. Stores `#rrggbb`. */
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * One value as it should read inside a collapsed row's summary.
 *
 * `02-29` is how a season boundary is STORED; "29 Feb" is how the editor chose
 * it, from a month dropdown and a day dropdown. Echoing the storage format back
 * makes the reader translate it in their head to recognise their own row —
 * which is the whole job the summary exists to do.
 */
function summaryValue(field: FieldDef | undefined, value: unknown): string {
  if (field?.kind === 'monthDay' && typeof value === 'string') {
    const parts = /^(\d{2})-(\d{2})$/.exec(value);
    const name = parts ? MONTH_NAMES[Number(parts[1]) - 1] : undefined;
    if (parts && name) return `${Number(parts[2])} ${name.slice(0, 3)}`;
  }
  return String(value);
}

/* February is 29, not 28: a season boundary is yearless, so it has no leap year
 * to be checked against. `monthDayToInt` accepts `02-29` for the same reason. */
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * A `date` field. With `withTime` it stores a UTC instant and shows the
 * editor's local clock, exactly like "Publish at" — see `local-datetime.ts`.
 * The conversion waits for hydration: the server rendering this does not know
 * the editor's time zone, and guessing would mismatch the client's first render.
 */
function DateControl({
  a11y,
  withTime,
  value,
  onChange,
}: {
  a11y: Pick<InputHTMLAttributes<HTMLInputElement>, 'id' | 'aria-describedby' | 'aria-invalid'>;
  withTime: boolean | undefined;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const hydrated = useHydrated();
  return (
    <TextInput
      {...a11y}
      type={withTime ? 'datetime-local' : 'date'}
      value={withTime && !hydrated ? '' : dateFieldToInput(value, withTime)}
      onChange={(e) => onChange(dateFieldFromInput(e.target.value, withTime))}
    />
  );
}

/**
 * A yearless `MM-DD` as a month + day pair.
 *
 * A native `<input type="date">` cannot express this: it always carries a year,
 * and the value here names a boundary of a season that recurs annually. Two
 * selects also make the format correct by construction — the previous plain text
 * box accepted `1/6`, `June` and `06/01` alike and only failed on save, because
 * `pattern` is enforced server-side and was never forwarded to the input.
 */
function MonthDayControl({ value, onChange }: { value: string; onChange: (v: unknown) => void }) {
  const parsed = /^(\d{2})-(\d{2})$/.exec(value);
  /*
   * A half-made choice lives here, not in the form value: picking a month before
   * a day emits nothing (see below), so without local state the month select
   * would snap straight back to blank under the editor's cursor.
   */
  const [draft, setDraft] = useState({ month: '', day: '' });
  const month = parsed ? parsed[1] : draft.month;
  const day = parsed ? parsed[2] : draft.day;

  const maxDay = month ? DAYS_IN_MONTH[Number(month) - 1] : 31;

  // Only a complete pair is a value. `undefined` rather than `''` so clearing
  // one half doesn't post a string the `mm-dd` shape would have to tolerate.
  const emit = (next: { month: string; day: string }) => {
    setDraft(next);
    onChange(next.month && next.day ? `${next.month}-${next.day}` : undefined);
  };

  return (
    <div className="flex items-center gap-2">
      <Select
        aria-label="Month"
        value={month}
        className="w-36"
        onChange={(e) => {
          const nextMonth = e.target.value;
          // 31 January → February would otherwise leave an impossible 02-31.
          const limit = nextMonth ? DAYS_IN_MONTH[Number(nextMonth) - 1] : 31;
          const nextDay = day && Number(day) > limit ? pad(limit) : day;
          emit({ month: nextMonth, day: nextDay });
        }}
      >
        <option value="">Month</option>
        {MONTH_NAMES.map((name, i) => (
          <option key={name} value={pad(i + 1)}>
            {name}
          </option>
        ))}
      </Select>
      <Select
        aria-label="Day"
        value={day}
        className="w-24"
        onChange={(e) => emit({ month, day: e.target.value })}
      >
        <option value="">Day</option>
        {Array.from({ length: maxDay }, (_, i) => pad(i + 1)).map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </Select>
    </div>
  );
}

export function ColorControl({ value, onChange }: { value: string; onChange: (v: unknown) => void }) {
  const valid = /^#[0-9a-fA-F]{6}$/.test(value);
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        aria-label="Pick colour"
        value={valid ? value : '#000000'}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-10 shrink-0 cursor-pointer rounded-sm border border-neutral-200 bg-white p-0.5"
      />
      <TextInput
        value={value}
        placeholder="#000000"
        maxLength={7}
        className="w-32 font-mono"
        onChange={(e) => {
          const v = e.target.value.trim();
          onChange(v === '' ? undefined : v);
        }}
      />
    </div>
  );
}

/**
 * A `group` field → a titled Section containing its sub-fields. Children that
 * declare a `section` are split into labelled runs inside it — how
 * admin-defined custom fields get a heading per group.
 */
function GroupControl({
  field,
  locale,
  locales,
  value,
  onChange,
  defaultLocale,
  label,
  error,
  path,
  errorsByPath,
  root,
  renderMdxPreview,
}: FieldInputProps & { label: string }) {
  const g = field as Extract<FieldDef, { kind: 'group' }>;
  const obj = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

  const renderSub = (sub: FieldDef) => (
    <FieldInput
      key={sub.key}
      field={sub}
      locale={locale}
      locales={locales}
      defaultLocale={defaultLocale}
      value={obj[sub.key]}
      onChange={(v) => onChange({ ...obj, [sub.key]: v })}
      path={path ? `${path}.${sub.key}` : sub.key}
      errorsByPath={errorsByPath}
      // Siblings are the group's OWN object, not the document's: a `showIf`
      // names a key at its own level.
      siblings={obj}
      peers={g.fields}
      // `root` stays the document at every level; only `siblings` narrows.
      root={root}
      renderMdxPreview={renderMdxPreview}
    />
  );

  const sectioned = g.fields.some((sub) => sub.section);
  return (
    <Section title={label} description={field.description} defaultOpen>
      {/* A message about the group itself — e.g. the whole group is required
          and absent. Sub-field messages render on their own controls below. */}
      {error?.length ? (
        <p className="mb-3 rounded-sm border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error.join(', ')}
        </p>
      ) : null}
      {sectioned
        ? buildBlocks(g.fields, label).map((block, i) =>
            block.type === 'field' ? (
              renderSub(block.field)
            ) : (
              <div key={`${block.title}-${i}`} className="flex flex-col gap-4">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
                  {block.title}
                </h4>
                {block.fields.map(renderSub)}
              </div>
            ),
          )
        : g.fields.map(renderSub)}
    </Section>
  );
}

/** A `repeater` field → titled Section with collapsible, reorderable rows. */
function RepeaterControl({
  field,
  locale,
  locales,
  value,
  onChange,
  label,
  error,
  path,
  errorsByPath,
  root,
}: FieldInputProps & { label: string }) {
  const rows: Record<string, unknown>[] = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  const repeater = field as Extract<FieldDef, { kind: 'repeater' }>;
  const max = repeater.max;
  const min = repeater.min ?? 0;
  // Singular noun for one row — "Add image" / "Image 1" instead of "Add gallery".
  const itemLabel = repeater.itemLabel ?? label;

  /*
   * Rows whose date range collides with an earlier row.
   *
   * Reported here, as the editor picks the dates, because the alternative is
   * finding out at quote time: `validatePricingConfig` refuses an overlapping
   * season, but nothing calls it on save, so two prices covering one date could
   * be saved, published, and only surface as a failed quote to a customer.
   *
   * The LATER row is the one flagged — it is the one that just changed — and it
   * names the row it clashes with, since "these overlap" is useless without
   * saying with what. Not memoised: `rows` is a fresh array every render, and a
   * handful of rows makes the pair loop far cheaper than the comparison would be.
   */
  const overlapping = repeater.noOverlap
    ? overlappingRangeRows(rows, repeater.noOverlap)
    : null;
  const [open, setOpen] = useState<Set<number>>(new Set());
  const { confirm, dialog } = useConfirm();

  const commit = (next: Record<string, unknown>[]) => onChange(next.length ? next : undefined);
  const toggle = (i: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const newRow = (): Record<string, unknown> =>
    repeater.autoId ? { id: crypto.randomUUID() } : {};

  const summaryOf = (row: Record<string, unknown>, i: number): string => {
    // First visible text-ish field; resolve a localized `{ [locale]: string }`
    // map to a readable label.
    const textField = repeater.fields.find(
      (f) => !f.hidden && (f.kind === 'text' || f.kind === 'textarea'),
    );
    const v = textField ? row[textField.key] : undefined;
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const first = Object.values(v as Record<string, unknown>).find(
        (x) => typeof x === 'string' && x.trim(),
      );
      if (typeof first === 'string') return first.trim();
    }
    // No text field to borrow from — a row of numbers can still say what it is,
    // if the collection said how to read it. A template with nothing filled in
    // is a blank row, which the numbered fallback describes better.
    if (repeater.summaryTemplate) {
      let filled = false;
      const rendered = repeater.summaryTemplate.replace(/\{(\w+)\}/g, (_, key: string) => {
        const v = row[key];
        if (v === undefined || v === null || v === '') return '?';
        filled = true;
        return summaryValue(
          repeater.fields.find((f) => f.key === key),
          v,
        );
      });
      if (filled) return rendered;
    }
    return `${itemLabel} ${i + 1}`;
  };

  /*
   * Open/closed is tracked by row INDEX, so every structural change has to move
   * those flags with the rows. Reordering was fixed for the swap and the other
   * two operations were left behind: removing a row let every later row's flag
   * describe its neighbour (remove the first of three with the third open, and
   * nothing was open afterwards — the row being edited just shut), and
   * duplicating shifted them the same way in the other direction.
   *
   * All three go through these two helpers now, so a fourth operation cannot
   * quietly reintroduce it.
   */
  const swapOpen = (i: number, j: number) =>
    setOpen((prev) => {
      const set = new Set(prev);
      const iOpen = prev.has(i);
      const jOpen = prev.has(j);
      set.delete(i);
      set.delete(j);
      if (iOpen) set.add(j);
      if (jOpen) set.add(i);
      return set;
    });

  /** Re-index the flags after `count` rows appear (`count > 0`) or one row is
   *  removed (`count < 0`) at `at`. `alsoOpen` opens a specific new index. */
  const shiftOpen = (at: number, count: number, alsoOpen?: number) =>
    setOpen((prev) => {
      const set = new Set<number>();
      for (const idx of prev) {
        if (count < 0 && idx === at) continue; // the removed row itself
        set.add(idx > at ? idx + count : idx);
      }
      if (alsoOpen !== undefined) set.add(alsoOpen);
      return set;
    });

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    swapOpen(i, j);
    commit(next);
  };

  /**
   * Move a row all the way, in one action.
   *
   * One step at a time is fine for a nudge and absurd for a list of ten: getting the
   * last item to the top was nine separate clicks, each with its own re-render. This is
   * the cheap half of what a drag handle would give, and the half people actually
   * needed — a table of contents gets reordered by moving one entry to the front, not
   * by shuffling it past its neighbours.
   *
   * The open/closed flags travel with the rows for the same reason the swap does: they
   * are tracked by index, so a structural change that does not move them makes a row's
   * flag describe its neighbour.
   */
  const moveTo = (from: number, to: number) => {
    if (from === to || to < 0 || to >= rows.length) return;
    const next = [...rows];
    const [row] = next.splice(from, 1);
    next.splice(to, 0, row);
    setOpen((prev) => {
      const wasOpen = prev.has(from);
      const set = new Set<number>();
      for (const idx of prev) {
        if (idx === from) continue;
        // Every row between the two ends shifts by one, in the direction of travel.
        let moved = idx;
        if (from < to && idx > from && idx <= to) moved = idx - 1;
        else if (to < from && idx >= to && idx < from) moved = idx + 1;
        set.add(moved);
      }
      if (wasOpen) set.add(to);
      return set;
    });
    commit(next);
  };

  return (
    <Section
      title={label}
      description={field.description}
      defaultOpen
      right={<span className="text-xs text-neutral-400">{rows.length}{max ? `/${max}` : ''}</span>}
    >
      {error?.length ? (
        <p className="mb-3 rounded-sm border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error.join(', ')}
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        {rows.map((row, i) => {
          const isOpen = open.has(i);
          const clashesWith = overlapping?.get(i);
          /*
           * Messages addressed at anything INSIDE this row.
           *
           * An open row renders them on the fields they belong to. A closed one
           * rendered nothing at all — so a problem inside a collapsed option
           * (its group brackets leaving a party size unpriced, say) was
           * invisible in the form and surfaced only as "price on request" on the
           * live site, which is the failure this whole message channel exists to
           * prevent. Same reasoning as the overlap banner below.
           */
          const rowPrefix = `${path || field.key}.${i}.`;
          const nested = isOpen
            ? []
            : Object.entries(errorsByPath ?? {})
                .filter(([key]) => key.startsWith(rowPrefix))
                .flatMap(([, messages]) => messages);
          return (
            <div
              key={i}
              className={cn(
                'rounded-sm border',
                clashesWith === undefined && nested.length === 0
                  ? 'border-neutral-200'
                  : 'border-red-300',
              )}
            >
              <div className="flex items-center gap-1 px-2 py-1.5">
                <button type="button" onClick={() => toggle(i)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={14} className="text-neutral-400" />
                  <span className="truncate text-sm text-neutral-700">{summaryOf(row, i)}</span>
                </button>
                {rows.length > 2 ? (
                  <IconButton onClick={() => moveTo(i, 0)} disabled={i === 0} aria-label="Move to top">
                    <Icon name="chevrons-up" size={14} />
                  </IconButton>
                ) : null}
                <IconButton onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">
                  <Icon name="chevron-up" size={14} />
                </IconButton>
                <IconButton onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label="Move down">
                  <Icon name="chevron-down" size={14} />
                </IconButton>
                {rows.length > 2 ? (
                  <IconButton
                    onClick={() => moveTo(i, rows.length - 1)}
                    disabled={i === rows.length - 1}
                    aria-label="Move to bottom"
                  >
                    <Icon name="chevrons-down" size={14} />
                  </IconButton>
                ) : null}
                <IconButton
                  onClick={() => {
                    commit([
                      ...rows.slice(0, i + 1),
                      { ...row, ...(repeater.autoId ? { id: crypto.randomUUID() } : {}) },
                      ...rows.slice(i + 1),
                    ]);
                    // The copy lands at i+1 and opens, the same way a freshly
                    // added row does — you duplicated it to change something.
                    shiftOpen(i, 1, i + 1);
                  }}
                  disabled={max !== undefined && rows.length >= max}
                  aria-label="Duplicate"
                >
                  <Icon name="copy" size={14} />
                </IconButton>
                <IconButton
                  onClick={async () => {
                    if (rows.length <= min) return;
                    const ok = await confirm({
                      title: `Remove "${summaryOf(row, i)}"?`,
                      message: 'This entry is removed from the list. This cannot be undone.',
                      confirmLabel: 'Remove',
                    });
                    if (!ok) return;
                    commit(rows.filter((_, x) => x !== i));
                    shiftOpen(i, -1);
                  }}
                  disabled={rows.length <= min}
                  aria-label="Remove"
                  className="hover:text-red-700"
                >
                  <Icon name="trash" size={14} />
                </IconButton>
              </div>
              {/* Outside the `isOpen` body on purpose: a collapsed row must still
                  show why it is wrong, or the message vanishes exactly when the
                  editor stops looking at the row. */}
              {clashesWith === undefined ? null : (
                <p className="border-t border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  Overlaps {itemLabel.toLowerCase()} {clashesWith + 1}. Two rows covering the same
                  date is ambiguous.
                </p>
              )}
              {nested.length === 0 ? null : (
                <p className="border-t border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {nested.join(' ')} Open this {itemLabel.toLowerCase()} to fix it.
                </p>
              )}
              {isOpen ? (
                <div
                  className={cn(
                    'border-t border-neutral-100 p-3',
                    // `auto-fit` rather than a fixed column count: the row is
                    // laid out from however many fields are actually visible,
                    // so a `showIf` hiding one closes the gap instead of
                    // leaving a hole in the grid.
                    repeater.inlineFields
                      ? 'grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]'
                      : 'flex flex-col gap-4',
                  )}
                >
                  {repeater.fields.map((sub) => (
                    <FieldInput
                      key={sub.key}
                      field={sub}
                      locale={locale}
                      locales={locales}
                      value={row[sub.key]}
                      onChange={(v) => {
                        const next = [...rows];
                        next[i] = { ...row, [sub.key]: v };
                        commit(next);
                      }}
                      // zod reports array issues with the row index in the
                      // path, so it has to be part of the address here too.
                      path={path ? `${path}.${i}.${sub.key}` : `${field.key}.${i}.${sub.key}`}
                      errorsByPath={errorsByPath}
                      // This ROW is the sibling scope, so a condition inside a
                      // repeater reads the row it belongs to, not row 0 and not
                      // the document.
                      siblings={row}
                      peers={repeater.fields}
                      root={root}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
        <div>
          <Button
            variant="secondary"
            size="sm"
            disabled={max !== undefined && rows.length >= max}
            onClick={() => {
              commit([...rows, newRow()]);
              setOpen((prev) => new Set(prev).add(rows.length));
            }}
          >
            <Icon name="plus" size={14} /> Add {itemLabel.toLowerCase()}
          </Button>
        </div>
      </div>
      {dialog}
    </Section>
  );
}
