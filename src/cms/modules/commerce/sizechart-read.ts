/**
 * Size-chart read helpers (addendum §3).
 *
 * Resolves the effective chart for a product — the product's own `sizeChart`
 * relation wins; otherwise the first of its categories that defines one — then
 * projects the stored document into a locale-specific table the storefront
 * renders. The projection is pure so it unit-tests without a DB.
 *
 * Localized labels (title, note, column headers) are stored as `{ locale: … }`
 * maps inside a single document (like the category title), so one row carries
 * every language; the row cells are plain shared text.
 */
import { and, eq, inArray } from 'drizzle-orm';

import { getDb, schema } from '../../db';
import { DEFAULT_CATEGORY_TYPE } from './read';
import { DEFAULT_SIZECHART_TYPE } from './sizechart';

type Localized = string | Record<string, string> | undefined;

function resolveLoc(v: Localized, locale: string): string {
  if (typeof v === 'string') return v.trim();
  if (v && typeof v === 'object') {
    const pick = v[locale];
    const any = Object.values(v).find((x) => typeof x === 'string' && x.trim());
    return String(pick ?? any ?? '').trim();
  }
  return '';
}

export interface ResolvedSizeChart {
  title: string;
  note?: string;
  /** Measurement column headers (after the leading size column). */
  headers: string[];
  /** One row per size; `cells` align positionally to `headers`. */
  rows: { size: string; cells: string[] }[];
  /**
   * A row carries more values than there are columns, which means a column was
   * removed without realigning the rows. The values below it cannot be trusted to
   * sit under the right heading, and a size chart that shows a waist measurement
   * as a length makes someone order the wrong garment — so the table is not shown
   * at all when this is set. See the note on the check that sets it.
   */
  misaligned?: boolean;
}

interface RawColumn {
  label?: Localized;
}
interface RawRow {
  size?: string;
  cells?: { value?: string }[];
}

/**
 * Project a size-chart document's `data` into a table for `locale`. Returns null
 * when the chart has neither a title nor any rows (nothing worth showing).
 */
export function projectSizeChart(data: Record<string, unknown>, locale: string): ResolvedSizeChart | null {
  const columns = (Array.isArray(data.columns) ? data.columns : []) as RawColumn[];
  const rawRows = (Array.isArray(data.rows) ? data.rows : []) as RawRow[];

  const headers = columns.map((c) => resolveLoc(c.label, locale));
  const rows = rawRows
    .map((r) => ({
      size: String(r.size ?? '').trim(),
      cells: (Array.isArray(r.cells) ? r.cells : []).map((c) => String(c?.value ?? '').trim()),
    }))
    .filter((r) => r.size || r.cells.some(Boolean));

  const title = resolveLoc(data.title as Localized, locale);
  if (!title && rows.length === 0) return null;

  /*
   * Columns and cells are two separate repeaters aligned only by position, and
   * the generic repeater editor knows nothing about that relationship: removing a
   * middle column leaves every row's cells one place to the left of where their
   * headings now are. Nothing warned, and the storefront zipped them together
   * anyway, so a waist measurement rendered as a length and the last measurement
   * disappeared (F-045).
   *
   * More cells than columns is the detectable signature of exactly that. Which
   * cell belonged to which heading is not recoverable — the information was
   * thrown away — so this cannot be repaired here, only refused. A missing chart
   * gets reported and fixed; a chart with plausible wrong numbers gets someone
   * the wrong size.
   */
  const misaligned = rows.some((r) => r.cells.length > headers.length);

  const note = resolveLoc(data.note as Localized, locale);
  return { title, note: note || undefined, headers, rows, ...(misaligned ? { misaligned: true } : {}) };
}

/** Load a single published size-chart document by id, or null. */
async function loadSizeChart(id: number): Promise<Record<string, unknown> | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const db = getDb();
  const [row] = await db
    .select({ data: schema.documents.data })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.id, id),
        eq(schema.documents.type, DEFAULT_SIZECHART_TYPE),
        eq(schema.documents.status, 'published'),
      ),
    )
    .limit(1);
  return row ? (row.data as Record<string, unknown>) : null;
}

/** The `sizeChart` relation id defined on the first of `categoryIds` that has one. */
async function categorySizeChartId(categoryIds: number[]): Promise<number | null> {
  const ids = categoryIds.filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) return null;
  const db = getDb();
  const rows = await db
    .select({ id: schema.documents.id, data: schema.documents.data })
    .from(schema.documents)
    .where(and(eq(schema.documents.type, DEFAULT_CATEGORY_TYPE), inArray(schema.documents.id, ids)));
  const byId = new Map(rows.map((r) => [r.id, r.data as Record<string, unknown>]));
  // Preserve the product's category order — the first category with a chart wins.
  for (const id of ids) {
    const chart = byId.get(id)?.sizeChart;
    if (typeof chart === 'number' && chart > 0) return chart;
  }
  return null;
}

/**
 * The effective size chart for a product, resolved + projected for `locale`.
 * Product's own `sizeChart` wins; otherwise the first category's. Null when none.
 */
export async function getSizeChartForProduct(
  data: Record<string, unknown>,
  locale: string,
): Promise<ResolvedSizeChart | null> {
  const own = typeof data.sizeChart === 'number' ? data.sizeChart : null;
  const categoryIds = Array.isArray(data.categories) ? (data.categories as number[]) : [];
  const chartId = own ?? (await categorySizeChartId(categoryIds));
  if (!chartId) return null;
  const chartData = await loadSizeChart(chartId);
  const chart = chartData ? projectSizeChart(chartData, locale) : null;

  /*
   * A misaligned chart is withheld here rather than in the component, so the
   * "Size guide" link in the buy box goes away with it — showing the link and
   * then nothing to anchor to would just move the problem.
   *
   * Logged, because the symptom a shopper sees (no size guide) says nothing about
   * the cause, and whoever removed the column has no reason to connect the two.
   */
  if (chart?.misaligned) {
    console.warn(
      `[commerce/sizechart] chart ${chartId} has rows with more values than columns — ` +
        'a column was removed without realigning the rows, so the table is not shown. ' +
        'Fix the row values in the admin.',
    );
    return null;
  }
  return chart;
}
