/**
 * The two tables a second factor needs beyond the columns on `admin_users`.
 *
 * Both store their credential as a bcrypt hash rather than plaintext, using the
 * same `hashPassword`/`verifyPassword` the passwords themselves go through —
 * one hashing primitive in the codebase, not two. The cost is not an accident
 * here either: bcrypt at cost 12 puts a hard ceiling on how fast a six-digit
 * space can be walked, underneath the attempt counter that is meant to stop it
 * long before.
 *
 * Note the asymmetry with `admin_users.totp_secret_encrypted`, which is
 * *encrypted*: a TOTP seed has to come back out to recompute an HMAC, whereas
 * an emailed code and a recovery code are only ever compared against. Hash what
 * you can, encrypt only what you must.
 */
import { index, int, mysqlTable, timestamp, varchar } from 'drizzle-orm/mysql-core';

import { adminUsers } from './auth';

export const adminMfaCodes = mysqlTable(
  'admin_mfa_codes',
  {
    id: int('id').autoincrement().primaryKey(),
    userId: int('user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
    /** bcrypt of the six digits that were emailed. Never stored in the clear. */
    codeHash: varchar('code_hash', { length: 255 }).notNull(),
    /** `login` | `enroll` — a code issued to prove a mailbox must not complete a sign-in. */
    purpose: varchar('purpose', { length: 24 }).notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    /**
     * Wrong guesses against this code. Capped, then the row is consumed: a
     * six-digit space is 10^6, and without a cap the expiry window alone is an
     * invitation to walk it.
     */
    attempts: int('attempts').notNull().default(0),
    consumedAt: timestamp('consumed_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    // Every read is "the live codes for this user and purpose", and the
    // send-rate check counts recent rows the same way.
    byUser: index('idx_admin_mfa_codes_user').on(t.userId, t.purpose),
  }),
);

export const adminRecoveryCodes = mysqlTable(
  'admin_recovery_codes',
  {
    id: int('id').autoincrement().primaryKey(),
    userId: int('user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
    /** bcrypt of the normalised code — see `core/security/recovery-codes.ts`. */
    codeHash: varchar('code_hash', { length: 255 }).notNull(),
    /**
     * Marked rather than deleted, so the audit trail and this table agree about
     * how many of a user's codes are gone. A row that vanishes cannot be
     * distinguished from one that was never issued.
     */
    usedAt: timestamp('used_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    byUser: index('idx_admin_recovery_codes_user').on(t.userId),
  }),
);

export type AdminMfaCode = typeof adminMfaCodes.$inferSelect;
export type NewAdminMfaCode = typeof adminMfaCodes.$inferInsert;
export type AdminRecoveryCode = typeof adminRecoveryCodes.$inferSelect;
export type NewAdminRecoveryCode = typeof adminRecoveryCodes.$inferInsert;
