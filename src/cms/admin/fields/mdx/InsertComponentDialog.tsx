'use client';

import { useMemo, useRef, useState } from 'react';

import type { MdxComponentSpec, MdxPropSpec } from '../../../config';
import { Badge, Button, Select, TextInput, Textarea } from '../../ui';
import { cn } from '../../ui/cn';
import { useDialog } from '../../ui/use-dialog';
import {
  autoNumberValue,
  buildSnippet,
  emptyValues,
  missingRequired,
  type PropValue,
  type SnippetValues,
} from './snippet';

/**
 * The "Insert component" dialog.
 *
 * Two steps — choose, then configure — because the alternative (a bespoke
 * dropdown listing fifteen tags) makes the author guess what each one is for,
 * and the props are the part they cannot guess at all.
 *
 * Item *bodies* are deliberately not collected here. A dialog holding five
 * prose textareas is a worse writing surface than the editor behind it, so the
 * scaffold goes in empty and the caret lands in the first body slot.
 */
export function InsertComponentDialog({
  palette,
  selection,
  onInsert,
  onClose,
}: {
  palette: readonly MdxComponentSpec[];
  /** Text selected in the editor, offered as the new block's body. */
  selection: string;
  onInsert: (text: string, caret: number) => void;
  onClose: () => void;
}) {
  const [spec, setSpec] = useState<MdxComponentSpec | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useDialog({ open: true, onClose, panelRef });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="mdx-insert-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div onClick={onClose} aria-hidden="true" className="absolute inset-0 bg-neutral-900/50" />
      <div
        ref={panelRef}
        className="relative flex max-h-[85vh] w-full max-w-lg flex-col rounded-sm border border-neutral-200 bg-white shadow-xl"
      >
        <div className="flex items-center gap-2 border-b border-neutral-200 px-5 py-3">
          {spec ? (
            <button
              type="button"
              onClick={() => setSpec(null)}
              className="rounded-sm px-1.5 py-0.5 text-sm text-neutral-500 hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-gold"
            >
              ← Back
            </button>
          ) : null}
          <h2
            id="mdx-insert-title"
            className="font-display text-base font-semibold text-neutral-900"
          >
            {spec ? spec.label : 'Insert component'}
          </h2>
        </div>

        {spec ? (
          <ConfigureStep
            spec={spec}
            selection={selection}
            onInsert={onInsert}
            onCancel={onClose}
          />
        ) : (
          <ChooseStep palette={palette} onPick={setSpec} />
        )}
      </div>
    </div>
  );
}

function ChooseStep({
  palette,
  onPick,
}: {
  palette: readonly MdxComponentSpec[];
  onPick: (spec: MdxComponentSpec) => void;
}) {
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = palette.filter(
      (spec) =>
        needle === '' ||
        spec.label.toLowerCase().includes(needle) ||
        spec.name.toLowerCase().includes(needle) ||
        (spec.summary ?? '').toLowerCase().includes(needle),
    );
    const byGroup = new Map<string, MdxComponentSpec[]>();
    for (const spec of matches) {
      const key = spec.group ?? 'Other';
      byGroup.set(key, [...(byGroup.get(key) ?? []), spec]);
    }
    return [...byGroup.entries()];
  }, [palette, query]);

  return (
    <div className="flex min-h-0 flex-col">
      <div className="px-5 pt-4">
        <TextInput
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter components…"
          aria-label="Filter components"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {groups.length === 0 ? (
          <p className="py-6 text-center text-sm text-neutral-500">Nothing matches “{query}”.</p>
        ) : null}
        {groups.map(([group, specs]) => (
          <div key={group} className="mb-4 last:mb-0">
            <p className="mb-1.5 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
              {group}
            </p>
            <ul className="flex flex-col gap-1">
              {specs.map((spec) => (
                <li key={spec.name}>
                  <button
                    type="button"
                    onClick={() => onPick(spec)}
                    className="flex w-full items-start gap-2 rounded-sm border border-transparent px-2 py-1.5 text-left hover:border-neutral-200 hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-gold"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-neutral-900">
                        {spec.label}
                      </span>
                      {spec.summary ? (
                        <span className="block text-xs text-neutral-500">{spec.summary}</span>
                      ) : null}
                    </span>
                    <Badge tone="neutral">{`<${spec.name}>`}</Badge>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConfigureStep({
  spec,
  selection,
  onInsert,
  onCancel,
}: {
  spec: MdxComponentSpec;
  selection: string;
  onInsert: (text: string, caret: number) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<SnippetValues>(() => {
    const seed = emptyValues(spec);
    // A component with a body slot adopts whatever was selected, so "select a
    // paragraph, wrap it in a QuickAnswer" is one gesture rather than a
    // cut-and-paste around a scaffold.
    if (spec.children && selection.trim() !== '') seed.body = selection;
    return seed;
  });

  const setProp = (name: string, value: PropValue) =>
    setValues((v) => ({ ...v, props: { ...v.props, [name]: value } }));

  const setItemProp = (index: number, name: string, value: PropValue) =>
    setValues((v) => ({
      ...v,
      items: (v.items ?? []).map((item, i) =>
        i === index ? { ...item, props: { ...item.props, [name]: value } } : item,
      ),
    }));

  const setCount = (count: number) =>
    setValues((v) => {
      const items = v.items ?? [];
      if (count === items.length) return v;
      if (count < items.length) return { ...v, items: items.slice(0, count) };
      return {
        ...v,
        items: [
          ...items,
          ...Array.from({ length: count - items.length }, () => ({ props: {}, body: '' })),
        ],
      };
    });

  const snippet = useMemo(() => buildSnippet(spec, values), [spec, values]);

  const missing = missingRequired(spec, values);

  return (
    <div className="flex min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="flex flex-col gap-3">
          {(spec.props ?? []).map((prop) => (
            <PropControl
              key={prop.name}
              prop={prop}
              value={values.props[prop.name]}
              columns={columnCount(spec, values, prop)}
              onChange={(v) => setProp(prop.name, v)}
            />
          ))}

          {spec.children ? (
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium text-neutral-800">{spec.children.label}</span>
              <Textarea
                rows={4}
                value={typeof values.body === 'string' ? values.body : ''}
                placeholder={spec.children.placeholder}
                onChange={(e) => setValues((v) => ({ ...v, body: e.target.value }))}
              />
            </label>
          ) : null}

          {spec.repeat ? (
            <fieldset className="flex flex-col gap-2 rounded-sm border border-neutral-200 p-3">
              <legend className="px-1 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
                {spec.repeat.itemLabel}s
              </legend>
              <label className="flex items-center gap-2 text-sm text-neutral-700">
                How many?
                <Select
                  className="w-20"
                  value={String((values.items ?? []).length)}
                  onChange={(e) => setCount(Number(e.target.value))}
                >
                  {countOptions(spec.repeat.min, spec.repeat.max).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              </label>
              {(values.items ?? []).map((item, index) => (
                <div key={index} className="flex flex-col gap-2 border-t border-neutral-100 pt-2">
                  <p className="text-xs font-medium text-neutral-500">
                    {spec.repeat!.itemLabel} {index + 1}
                  </p>
                  {(spec.repeat!.props ?? []).map((prop) => (
                    <PropControl
                      key={prop.name}
                      prop={prop}
                      value={
                        item.props[prop.name] ??
                        (spec.repeat!.autoNumber?.prop === prop.name
                          ? autoNumberValue(index, spec.repeat!.autoNumber!.format)
                          : '')
                      }
                      onChange={(v) => setItemProp(index, prop.name, v)}
                    />
                  ))}
                </div>
              ))}
            </fieldset>
          ) : null}

          <div>
            <p className="mb-1 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
              Preview
            </p>
            {/* Showing the generated source is the cheapest way to teach the
                syntax — next time the author types it themselves. */}
            <pre className="max-h-40 overflow-auto rounded-sm bg-neutral-900 p-3 font-mono text-xs leading-relaxed text-neutral-100">
              {snippet.text}
            </pre>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-neutral-200 px-5 py-3">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-sm border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-gold"
        >
          Cancel
        </button>
        <Button
          type="button"
          disabled={missing}
          onClick={() => onInsert(snippet.text, snippet.caret)}
        >
          Insert
        </Button>
      </div>
    </div>
  );
}

function countOptions(min: number, max: number): number[] {
  return Array.from({ length: max - min + 1 }, (_, i) => min + i);
}

/** How many columns a `stringGrid` should have, per its `columnsFrom` sibling. */
function columnCount(
  spec: MdxComponentSpec,
  values: SnippetValues,
  prop: MdxPropSpec,
): number | undefined {
  if (prop.type !== 'stringGrid' || !prop.columnsFrom) return undefined;
  const headers = values.props[prop.columnsFrom];
  return Array.isArray(headers) ? Math.max(1, headers.length) : 1;
}

function PropControl({
  prop,
  value,
  columns,
  onChange,
}: {
  prop: MdxPropSpec;
  value: PropValue | undefined;
  columns?: number;
  onChange: (value: PropValue) => void;
}) {
  const label = (
    <span className="text-sm font-medium text-neutral-800">
      {prop.label}
      {prop.required ? <span className="text-warm-gold-deep ml-0.5">*</span> : null}
    </span>
  );
  const help = prop.help ? <span className="text-xs text-neutral-500">{prop.help}</span> : null;

  if (prop.type === 'stringList') {
    const list = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div className="flex flex-col gap-1">
        {label}
        <TextInput
          value={list.join(', ')}
          placeholder={prop.placeholder ?? 'One, Two, Three'}
          onChange={(e) =>
            onChange(
              e.target.value
                .split(',')
                .map((s) => s.trim())
                .filter((s) => s !== ''),
            )
          }
        />
        <span className="text-xs text-neutral-500">{prop.help ?? 'Separate with commas.'}</span>
      </div>
    );
  }

  if (prop.type === 'stringGrid') {
    const cols = columns ?? 1;
    const rows = Array.isArray(value) ? (value as string[][]) : [];
    const normalised = rows.map((row) =>
      Array.from({ length: cols }, (_, c) => row[c] ?? ''),
    );
    const setCell = (r: number, c: number, next: string) =>
      onChange(normalised.map((row, i) => (i === r ? row.map((v, j) => (j === c ? next : v)) : row)));

    return (
      <div className="flex flex-col gap-1">
        {label}
        <div className="overflow-x-auto">
          <div className="flex flex-col gap-1">
            {normalised.map((row, r) => (
              <div key={r} className="flex gap-1">
                {row.map((cell, c) => (
                  <TextInput
                    key={c}
                    className="min-w-28"
                    value={cell}
                    onChange={(e) => setCell(r, c, e.target.value)}
                    aria-label={`Row ${r + 1}, column ${c + 1}`}
                  />
                ))}
                <button
                  type="button"
                  aria-label={`Remove row ${r + 1}`}
                  onClick={() => onChange(normalised.filter((_, i) => i !== r))}
                  className="rounded-sm px-2 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-gold"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onChange([...normalised, Array.from({ length: cols }, () => '')])}
          className="self-start rounded-sm border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-gold"
        >
          + Add row
        </button>
        {help}
      </div>
    );
  }

  const Control = prop.type === 'longText' ? Textarea : TextInput;
  return (
    <label className="flex flex-col gap-1">
      {label}
      <Control
        {...(prop.type === 'longText' ? { rows: 3 } : {})}
        {...(prop.type === 'url' ? { type: 'url' } : {})}
        {...(prop.type === 'number' ? { type: 'number' } : {})}
        value={typeof value === 'string' ? value : ''}
        placeholder={prop.placeholder}
        onChange={(e: { target: { value: string } }) => onChange(e.target.value)}
        className={cn(prop.type === 'longText' && 'font-body')}
      />
      {help}
    </label>
  );
}
