/**
 * Dynamic route params, validated.
 *
 * `createRoute` runs zod over `query` and `input` but hands `params` through
 * untouched — they arrive as `Record<string, string>` straight from the router.
 * `Number('abc')` is `NaN`, and a `NaN` id reaches Drizzle as a filter value or,
 * worse, as an FK on an insert or a `subjectId` on an audit row. It is not an
 * injection vector (every caller is behind a permission guard and mysql2 is
 * parameterised), but it turns a client mistake into a 500 or a meaningless
 * audit entry instead of the 400 it should be.
 */
import { badRequest } from '../errors';

/** A positive, safe-integer path id, or a 400. */
export function idParam(raw: string | undefined, label = 'id'): number {
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0) throw badRequest(`Invalid ${label}.`);
  return n;
}

/**
 * Canonical 8-4-4-4-12 hex form. Deliberately not version- or variant-checked:
 * the point is the *shape*, and rows seeded before uuid v7 must stay addressable.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A uuid path param, or a 400.
 *
 * Unlike a bad numeric id, a bad uuid was not merely a wrong-status problem.
 * Media is keyed by uuid, and `LocalDiskStorage.path()` does
 * `join(this.dir, key)` on the strength of a comment — "key is a uuid, no path
 * separators, safe to join directly" — that nothing enforced. `deleteMedia` also
 * hands the value to `unlink()` before any database lookup could refuse it, so
 * the assumption in that comment was the whole of the defence. This makes it a
 * check.
 */
export function uuidParam(raw: string | undefined, label = 'id'): string {
  if (!raw || !UUID_RE.test(raw)) throw badRequest(`Invalid ${label}.`);
  return raw;
}
