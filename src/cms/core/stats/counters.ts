import 'server-only';

import { and, eq, gte, inArray, sql } from 'drizzle-orm';

import { getDb, schema } from '../../db';
import { counterDay, isValidCounterPart, sumCounters } from './policy';

/** Add `by` to today's bucket. Best-effort: a failed count never fails the caller. */
export async function incrementCounter(entry: {
  scope: string;
  subjectId: number;
  metric: string;
  by?: number;
  at?: Date;
}): Promise<void> {
  const by = entry.by ?? 1;
  if (
    !isValidCounterPart(entry.scope) ||
    !isValidCounterPart(entry.metric) ||
    !Number.isSafeInteger(entry.subjectId) ||
    entry.subjectId <= 0 ||
    !Number.isSafeInteger(by) ||
    by <= 0
  ) {
    throw new Error('Invalid counter entry.');
  }
  try {
    await getDb()
      .insert(schema.statCounters)
      .values({
        scope: entry.scope,
        subjectId: entry.subjectId,
        metric: entry.metric,
        day: counterDay(entry.at ?? new Date()),
        count: by,
      })
      .onDuplicateKeyUpdate({ set: { count: sql`${schema.statCounters.count} + ${by}` } });
  } catch (err) {
    console.error('[cms/stats] counter increment failed', err);
  }
}

/** Totals per subject and metric, optionally from a UTC day onwards. */
export async function readCounters(opts: {
  scope: string;
  subjectIds?: readonly number[];
  since?: Date;
}): Promise<Map<number, Record<string, number>>> {
  if (opts.subjectIds && opts.subjectIds.length === 0) return new Map();
  const t = schema.statCounters;
  const rows = await getDb()
    .select({ subjectId: t.subjectId, metric: t.metric, count: sql<number>`sum(${t.count})` })
    .from(t)
    .where(
      and(
        eq(t.scope, opts.scope),
        opts.subjectIds ? inArray(t.subjectId, [...opts.subjectIds]) : undefined,
        opts.since ? gte(t.day, counterDay(opts.since)) : undefined
      )
    )
    .groupBy(t.subjectId, t.metric);
  return sumCounters(rows);
}
