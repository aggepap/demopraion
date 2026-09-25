'use client';

/**
 * WooCommerce-style variation matrix editor (the `variations` field kind).
 *
 * Derives its axes from the sibling `attributes` field and lets the editor
 * auto-generate every value combination, then edit per-combination price, SKU,
 * stock, image, weight and enabled state. The generic repeater can't express
 * the cartesian product, so this is a bespoke control.
 *
 * Stored value: `Variation[]` (see below). Kept in sync with `attributes` via
 * the "Generate" action — regenerating preserves rows whose combination still
 * exists (matched by option signature) and drops combinations that no longer do.
 */
import { useMemo } from 'react';

import { Button, IconButton, Icon, Table, Tbody, Td, Th, Thead, TextInput } from '../ui';
import { MediaPicker } from './MediaPicker';

interface Variation {
  id: string;
  /** Maps attribute id → selected value id (stable across label translations). */
  options: Record<string, string>;
  sku?: string;
  price?: number;
  stock?: number;
  image?: string;
  enabled?: boolean;
  weight?: number;
}

/** A localized label is a `{ [locale]: string }` map (or a legacy plain string). */
type Localized = string | Record<string, string> | undefined;

/** One attribute value as authored in the `attributes` repeater. */
interface AttrValue {
  id?: string;
  label?: Localized;
  color?: string;
  image?: string;
}
/** One attribute (axis) as authored in the `attributes` repeater. */
interface Attr {
  id?: string;
  name?: Localized;
  swatchType?: string;
  values?: AttrValue[];
}

interface AxisValue {
  id: string;
  label: string;
  color?: string;
  image?: string;
}
interface Axis {
  id: string;
  name: string;
  swatchType: string;
  values: AxisValue[];
}

/** Resolve a (possibly localized) label to a display string, with fallbacks. */
function resolveLoc(v: Localized, locale: string, defaultLocale: string): string {
  if (typeof v === 'string') return v.trim();
  if (v && typeof v === 'object') {
    const pick = (l: string) => (typeof v[l] === 'string' && v[l].trim() ? v[l] : undefined);
    const any = Object.values(v).find((x) => typeof x === 'string' && x.trim());
    return (pick(locale) || pick(defaultLocale) || any || '').trim();
  }
  return '';
}

/** Attributes complete enough to form an axis (have an id + ≥1 value with id). */
function toAxes(attributes: Record<string, unknown>[], locale: string, defaultLocale: string): Axis[] {
  const axes: Axis[] = [];
  for (const raw of attributes) {
    const a = raw as Attr;
    if (typeof a.id !== 'string' || !a.id) continue;
    const values = (Array.isArray(a.values) ? a.values : [])
      .filter((v): v is AttrValue => typeof v?.id === 'string' && !!v.id)
      .map((v) => ({
        id: v.id!,
        label: resolveLoc(v.label, locale, defaultLocale) || v.id!,
        color: v.color,
        image: v.image,
      }));
    if (values.length === 0) continue;
    axes.push({
      id: a.id,
      name: resolveLoc(a.name, locale, defaultLocale) || a.id,
      swatchType: a.swatchType ?? 'button',
      values,
    });
  }
  return axes;
}

/** Cartesian product of the axes → one `{ [attrId]: valueId }` map per combination. */
function combinations(axes: Axis[]): Record<string, string>[] {
  return axes.reduce<Record<string, string>[]>(
    (acc, axis) => acc.flatMap((combo) => axis.values.map((v) => ({ ...combo, [axis.id]: v.id }))),
    [{}],
  );
}

/** Order-independent signature of an options map, for matching combinations. */
function signature(options: Record<string, string>): string {
  return Object.keys(options)
    .sort()
    .map((k) => `${k}=${options[k]}`)
    .join('|');
}

export function VariationsEditor({
  value,
  onChange,
  attributes,
  locale,
  defaultLocale,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
  attributes: Record<string, unknown>[];
  locale: string;
  defaultLocale: string;
}) {
  const rows: Variation[] = useMemo(() => (Array.isArray(value) ? (value as Variation[]) : []), [value]);
  const axes = useMemo(() => toAxes(attributes, locale, defaultLocale), [attributes, locale, defaultLocale]);
  const expected = useMemo(() => combinations(axes), [axes]);
  const expectedSigs = useMemo(() => new Set(expected.map(signature)), [expected]);
  const rowSigs = useMemo(() => new Set(rows.map((r) => signature(r.options))), [rows]);

  const missing = expected.filter((c) => !rowSigs.has(signature(c))).length;
  const orphaned = rows.filter((r) => !expectedSigs.has(signature(r.options))).length;
  const inSync = axes.length > 0 && missing === 0 && orphaned === 0;

  const commit = (next: Variation[]) => onChange(next.length ? next : undefined);

  const generate = () => {
    const bySig = new Map(rows.map((r) => [signature(r.options), r]));
    // One row per expected combination, reusing any existing row's edits;
    // combinations no longer present are dropped (orphans).
    const next = expected.map((options) => {
      const existing = bySig.get(signature(options));
      return existing ? { ...existing, options } : { id: crypto.randomUUID(), options, enabled: true };
    });
    commit(next);
  };

  const patch = (id: string, p: Partial<Variation>) =>
    commit(rows.map((r) => (r.id === id ? { ...r, ...p } : r)));

  const remove = (id: string) => commit(rows.filter((r) => r.id !== id));

  if (axes.length === 0) {
    return (
      <p className="text-sm text-neutral-600">
        Add at least one attribute with values (e.g. a “Color” attribute with values) to generate variations.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Button type="button" variant="secondary" size="sm" onClick={generate}>
          <Icon name="refresh-cw" size={14} /> Generate variations
        </Button>
        <span className="text-xs text-neutral-600">
          {inSync
            ? `${rows.length} variation${rows.length === 1 ? '' : 's'}, in sync with attributes`
            : [
                missing ? `${missing} to add` : null,
                orphaned ? `${orphaned} to remove` : null,
              ]
                .filter(Boolean)
                .join(', ') || `${expected.length} possible`}
        </span>
      </div>

      {rows.length > 0 ? (
        <Table>
          <Thead>
            <tr>
              {axes.map((a) => (
                <Th key={a.id}>{a.name}</Th>
              ))}
              <Th className="w-16">On</Th>
              <Th>SKU</Th>
              <Th className="w-28">Price</Th>
              <Th className="w-24">Stock</Th>
              <Th className="w-24">Weight</Th>
              <Th>Image</Th>
              <Th className="w-10" />
            </tr>
          </Thead>
          <Tbody>
            {rows.map((row) => {
              const stale = !expectedSigs.has(signature(row.options));
              return (
                <tr key={row.id} className={stale ? 'bg-red-50/60' : undefined}>
                  {axes.map((a) => {
                    const val = a.values.find((v) => v.id === row.options[a.id]);
                    const label = val?.label ?? '—';
                    return (
                      <Td key={a.id}>
                        <span className="inline-flex items-center gap-1.5">
                          {val?.color ? (
                            <span
                              className="inline-block h-4 w-4 shrink-0 rounded-full border border-neutral-300"
                              style={{ backgroundColor: val.color }}
                            />
                          ) : null}
                          <span className={stale ? 'text-red-700' : undefined}>{label}</span>
                        </span>
                      </Td>
                    );
                  })}
                  <Td>
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-warm-gold-deep"
                      checked={row.enabled !== false}
                      onChange={(e) => patch(row.id, { enabled: e.target.checked })}
                    />
                  </Td>
                  <Td>
                    <TextInput
                      value={row.sku ?? ''}
                      placeholder="SKU"
                      onChange={(e) => patch(row.id, { sku: e.target.value || undefined })}
                    />
                  </Td>
                  <Td>
                    <TextInput
                      type="number"
                      min={0}
                      step="any"
                      value={typeof row.price === 'number' ? row.price : ''}
                      placeholder="base"
                      onChange={(e) =>
                        patch(row.id, { price: e.target.value === '' ? undefined : Number(e.target.value) })
                      }
                    />
                  </Td>
                  <Td>
                    <TextInput
                      type="number"
                      min={0}
                      step={1}
                      value={typeof row.stock === 'number' ? row.stock : ''}
                      onChange={(e) =>
                        patch(row.id, { stock: e.target.value === '' ? undefined : Number(e.target.value) })
                      }
                    />
                  </Td>
                  <Td>
                    <TextInput
                      type="number"
                      min={0}
                      step="any"
                      value={typeof row.weight === 'number' ? row.weight : ''}
                      placeholder="base"
                      onChange={(e) =>
                        patch(row.id, { weight: e.target.value === '' ? undefined : Number(e.target.value) })
                      }
                    />
                  </Td>
                  <Td>
                    <MediaPicker
                      value={row.image ?? ''}
                      onChange={(uuid) => patch(row.id, { image: uuid || undefined })}
                    />
                  </Td>
                  <Td>
                    <IconButton
                      type="button"
                      aria-label="Remove variation"
                      className="hover:text-red-700"
                      onClick={() => remove(row.id)}
                    >
                      <Icon name="trash" size={14} />
                    </IconButton>
                  </Td>
                </tr>
              );
            })}
          </Tbody>
        </Table>
      ) : null}
    </div>
  );
}
