/**
 * Anonymous aggregate counters — the pure half.
 *
 * `stat_counters` holds one row per scope / subject / metric / UTC day and
 * nothing else: no visitor id, no IP, no session. That is what lets the
 * storefront count "added to wishlist" or "popup shown" without consent — there
 * is no personal data in it to consent to.
 */

/** The UTC calendar day a hit is counted under, as `YYYY-MM-DD`. */
export function counterDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

const PART = /^[a-z][a-z0-9_]{0,31}$/;

/** Scope and metric names: short lowercase identifiers. */
export function isValidCounterPart(value: string): boolean {
  return PART.test(value);
}

export interface CounterRow {
  subjectId: number;
  metric: string;
  count: number;
}

/** Add day buckets together, per subject then per metric. */
export function sumCounters(rows: readonly CounterRow[]): Map<number, Record<string, number>> {
  const out = new Map<number, Record<string, number>>();
  for (const row of rows) {
    const totals = out.get(row.subjectId) ?? {};
    totals[row.metric] = (totals[row.metric] ?? 0) + Number(row.count);
    out.set(row.subjectId, totals);
  }
  return out;
}
