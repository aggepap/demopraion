/**
 * Size-chart collection preset (addendum §3).
 *
 * A size chart is an ordinary `document` (type = 'sizechart' by default), so it
 * reuses the whole content stack — admin CRUD, validation, versioning,
 * publishing, the read layer. It's a REUSABLE entity: one chart is assigned to
 * many products (or a whole category) via a `sizeChart` relation, rather than
 * re-authored per product.
 *
 * The table is modelled as `columns` (the measurements, e.g. Chest / Waist) +
 * `rows` (each a size with a `cells` list of values, positionally aligned to
 * the columns). Column labels + the chart title are per-language; the numbers
 * are shared. Gated by the `commerce` module and given no public route (it's
 * surfaced inside the product page, not on its own URL).
 */
import type { IconName } from '../../admin/ui/icon-names';
import { defineCollection, f, type CollectionDefinition, type Field } from '../../config';

export interface SizeChartCollectionOptions {
  /** Collection key / document type. Default `sizechart`. */
  key?: string;
  label?: string;
  labelPlural?: string;
  icon?: IconName;
  /** Extra fields appended to the preset. */
  extraFields?: Field[];
}

export const DEFAULT_SIZECHART_TYPE = 'sizechart';

export function sizeChartCollection(opts: SizeChartCollectionOptions = {}): CollectionDefinition {
  return defineCollection({
    key: opts.key ?? DEFAULT_SIZECHART_TYPE,
    label: opts.label ?? 'Size chart',
    labelPlural: opts.labelPlural ?? 'Size charts',
    icon: opts.icon ?? 'ruler',
    module: 'commerce',
    // No storefront route — a chart renders inside the product page it's assigned to.
    fields: [
      f.text('title', {
        label: 'Chart title',
        required: true,
        maxLength: 191,
        localized: true,
        description: 'Heading above the chart on the product page, and its name in the size-chart picker.',
      }),
      f.textarea('note', { label: 'Note', rows: 2, localized: true, description: 'Optional line shown under the chart (e.g. measuring tips).' }),
      // Measurement columns — the header cells after the leading "Size" column.
      f.repeater('columns', [f.text('label', { label: 'Measurement', required: true, localized: true, description: 'Column heading, e.g. Chest.' })], {
        label: 'Columns',
        itemLabel: 'Column',
        description: 'The measurements, e.g. Chest, Waist, Length.',
      }),
      // Rows — one per size. `cells` align positionally to `columns`.
      f.repeater(
        'rows',
        [
          f.text('size', { label: 'Size', required: true, description: 'e.g. S, M, 42' }),
          f.repeater('cells', [f.text('value', { label: 'Value', description: 'One measurement, e.g. 96 or 94–98.' })], {
            label: 'Values',
            itemLabel: 'Value',
            description: 'One value per column, in the same order as the columns.',
          }),
        ],
        { label: 'Rows', itemLabel: 'Row', description: 'One row per size.' },
      ),
      ...(opts.extraFields ?? []),
    ],
  });
}
