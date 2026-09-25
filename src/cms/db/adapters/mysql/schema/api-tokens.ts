/**
 * Machine-to-machine API credentials for the PM bridge.
 *
 * ## Praion does not generate these
 *
 * Product Manager mints the credential and hands it over as a pasted setup
 * string; this table is where an imported one lands. That direction is why
 * there is no "reveal once" state to model here and no route that returns a
 * secret — praion never has one to show. See `docs/PM_BRIDGE_SPEC.md` §3.6.
 *
 * ## Encrypted, not hashed
 *
 * The usual advice for a stored credential is to hash it, and it does not apply
 * here. HMAC verification has to recompute a signature with the secret, so the
 * secret must come back out — sha256 would make the column useless. It is
 * therefore encrypted with AES-256-GCM under a key held in the environment
 * (`CMS_TOKEN_ENCRYPTION_KEY`) and never in the database, so a stolen dump on
 * its own yields nothing.
 *
 * The trade is deliberate: hashing protects against a database leak, signing
 * protects against the credential leaking in transit or in a log. The second is
 * far more likely and happens far more quietly.
 */
import {
  index,
  int,
  json,
  mysqlTable,
  timestamp,
  unique,
  varbinary,
  varchar,
} from 'drizzle-orm/mysql-core';

import { adminUsers } from './auth';

export const cmsApiTokens = mysqlTable(
  'cms_api_tokens',
  {
    id: int('id').autoincrement().primaryKey(),
    /** Operator-facing label, e.g. "Product Manager (prod)". */
    name: varchar('name', { length: 191 }).notNull(),
    /**
     * The public half of the credential — 12 lowercase hex chars, sent on every
     * request as `X-PM-Key-Id`. Hex rather than base64url because the two halves
     * of `pmk_<keyId>_<secret>` are split on `_`, and base64url's alphabet
     * contains `_`.
     */
    keyId: varchar('key_id', { length: 16 }).notNull(),
    /** AES-256-GCM ciphertext: iv ‖ authTag ‖ ciphertext. Never logged. */
    secretEncrypted: varbinary('secret_encrypted', { length: 255 }).notNull(),
    /** `pm:read` | `pm:write` | `pm:payload` | `pm:media` | `pm:*` */
    scopes: json('scopes').$type<string[]>().notNull(),
    createdBy: int('created_by').references(() => adminUsers.id, { onDelete: 'set null' }),
    /** Touched at most once a minute — see the throttle in `tokens/service.ts`. */
    lastUsedAt: timestamp('last_used_at'),
    lastUsedIp: varchar('last_used_ip', { length: 64 }),
    expiresAt: timestamp('expires_at'),
    revokedAt: timestamp('revoked_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    // Unique, not merely indexed: the guard's whole lookup is `WHERE key_id = ?`
    // returning exactly one row, and an accidental duplicate would make which
    // credential authenticates depend on row order.
    keyIdUniq: unique('uniq_cms_api_tokens_key_id').on(t.keyId),
    activeIdx: index('idx_cms_api_tokens_active').on(t.revokedAt, t.expiresAt),
  }),
);

export type CmsApiToken = typeof cmsApiTokens.$inferSelect;
export type NewCmsApiToken = typeof cmsApiTokens.$inferInsert;
