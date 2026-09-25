/**
 * A labelled value table — the shape both the built-in specs and the
 * admin-defined custom fields render as. Values arrive already resolved for the
 * request locale (see `resolveCustomValue` on the product page), so this stays
 * a dumb presentational component usable from a client tab panel.
 */

export interface ValueRow {
  label: string;
  /** Plain display text, or pre-rendered content for richer kinds. */
  value: string;
}

export function CustomFieldValues({ rows }: { rows: ValueRow[] }) {
  if (rows.length === 0) return null;
  return (
    <dl className="divide-y divide-border-soft rounded-sm border border-border-soft">
      {rows.map((row, i) => (
        <div key={`${row.label}-${i}`} className="flex justify-between gap-4 px-4 py-2.5">
          <dt className="font-body text-sm text-text-muted">{row.label}</dt>
          <dd className="font-body text-sm text-text-primary text-right">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
