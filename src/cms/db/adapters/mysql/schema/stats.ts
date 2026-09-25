/**
 * Anonymous aggregate counters: how many times something happened to a subject
 * on a UTC day. No visitor id, IP or session is stored — see
 * `core/stats/policy.ts`. The composite primary key is what the
 * `INSERT … ON DUPLICATE KEY UPDATE` increment relies on.
 */
import { date, int, mysqlTable, primaryKey, varchar } from 'drizzle-orm/mysql-core';

export const statCounters = mysqlTable(
  'stat_counters',
  {
    /** What is being counted, e.g. `wishlist`, `popup`. */
    scope: varchar('scope', { length: 32 }).notNull(),
    /** The counted thing's id within the scope (a product or popup document id). */
    subjectId: int('subject_id').notNull(),
    /** e.g. `add`, `impression`, `click`. */
    metric: varchar('metric', { length: 32 }).notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    count: int('count').notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.scope, t.subjectId, t.metric, t.day] }),
  })
);

export type StatCounterRow = typeof statCounters.$inferSelect;
