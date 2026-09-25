/**
 * Credentials for integrations the site owner connects from the admin — an
 * OAuth refresh token, a Places API key, courier credentials.
 *
 * Encrypted with AES-256-GCM under `CMS_TOKEN_ENCRYPTION_KEY`, exactly like
 * `cms_api_tokens.secret_encrypted`, so a database dump alone yields nothing.
 * `hint` is the last four characters (empty for short values) and is the only
 * part of a secret that is ever sent back to the admin. See
 * `core/secrets/policy.ts` for which keys may be stored at all.
 */
import { int, mysqlTable, timestamp, varbinary, varchar } from 'drizzle-orm/mysql-core';

import { adminUsers } from './auth';

export const integrationSecrets = mysqlTable('integration_secrets', {
  /** Dotted name declared by a module, e.g. `google.places.apiKey`. */
  key: varchar('key', { length: 128 }).primaryKey(),
  /** iv ‖ authTag ‖ ciphertext. Never logged, never returned by an API. */
  ciphertext: varbinary('ciphertext', { length: 4096 }).notNull(),
  hint: varchar('hint', { length: 8 }).notNull().default(''),
  updatedBy: int('updated_by').references(() => adminUsers.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
});

export type IntegrationSecretRow = typeof integrationSecrets.$inferSelect;
