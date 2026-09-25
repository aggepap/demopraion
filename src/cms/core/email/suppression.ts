/**
 * The suppression list — read and write.
 *
 * Separated from `unsubscribe.ts` (pure, signs links) because this half touches
 * the database, the split the rest of the core follows.
 *
 * Every send of unsolicited mail must consult `isSuppressed` first. There is
 * exactly one such sender today (the abandoned-cart reminder), and it filters in
 * SQL rather than per-row so a large list costs nothing per run.
 */
import 'server-only';

import { eq, inArray } from 'drizzle-orm';

import { getDb, schema } from '../../db';
import type { SuppressionReason } from '../../db/adapters/mysql/schema/email';
import { normalizeEmail } from './unsubscribe';

/**
 * Record an address as unsubscribed. Idempotent — clicking the link twice, or a
 * mail client prefetching it and the human then clicking, must not error.
 */
export async function suppressEmail(
  email: string,
  reason: SuppressionReason = 'unsubscribe',
): Promise<void> {
  const normalized = normalizeEmail(email);
  if (normalized === '') return;
  await getDb()
    .insert(schema.emailSuppressions)
    .values({ email: normalized, reason })
    // `email` is unique; a repeat click is a no-op rather than a duplicate-key
    // error surfacing as a 409 on an unsubscribe page.
    .onDuplicateKeyUpdate({ set: { email: normalized } });
}

/** Whether this address has asked not to be mailed. */
export async function isSuppressed(email: string): Promise<boolean> {
  const normalized = normalizeEmail(email);
  if (normalized === '') return false;
  const [row] = await getDb()
    .select({ id: schema.emailSuppressions.id })
    .from(schema.emailSuppressions)
    .where(eq(schema.emailSuppressions.email, normalized))
    .limit(1);
  return Boolean(row);
}

/**
 * Which of `emails` are suppressed, as a lowercase Set.
 *
 * One query for a batch, so the reminder job can filter a page of due carts
 * without a round trip each. Returns an empty Set for an empty input rather than
 * issuing a `WHERE email IN ()`.
 */
export async function suppressedAmong(emails: readonly string[]): Promise<Set<string>> {
  const normalized = [...new Set(emails.map(normalizeEmail).filter((e) => e !== ''))];
  if (normalized.length === 0) return new Set();
  const rows = await getDb()
    .select({ email: schema.emailSuppressions.email })
    .from(schema.emailSuppressions)
    .where(inArray(schema.emailSuppressions.email, normalized));
  return new Set(rows.map((r) => r.email.toLowerCase()));
}
