/**
 * Admin identity + RBAC. Ported from v1 `src/admin/db/schema/auth.ts`
 * (unchanged — the model was sound).
 */
import { relations } from 'drizzle-orm';
import {
  int,
  json,
  mysqlTable,
  primaryKey,
  timestamp,
  varbinary,
  varchar,
} from 'drizzle-orm/mysql-core';

export const adminUsers = mysqlTable('admin_users', {
  id: int('id').autoincrement().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 191 }).notNull(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  locale: varchar('locale', { length: 8 }).notNull().default('el'),
  lastLoginAt: timestamp('last_login_at'),
  disabledAt: timestamp('disabled_at'),
  /**
   * The second factor this account has enrolled: `totp` | `email`. Null means
   * password only.
   *
   * A pending TOTP enrollment is `totp_secret_encrypted` set while this is
   * still null — the secret exists so the user can scan it, but nothing
   * requires it until they have proved their app produces matching codes. That
   * avoids a separate pending table and makes an abandoned enrollment
   * self-cleaning: the next attempt simply overwrites the secret.
   */
  mfaMethod: varchar('mfa_method', { length: 16 }),
  /**
   * The base32 TOTP seed, AES-256-GCM under `CMS_TOKEN_ENCRYPTION_KEY`.
   * Encrypted rather than hashed for the reason `core/tokens/crypto.ts` sets
   * out: verification recomputes an HMAC *with* the secret, so it has to come
   * back out.
   */
  totpSecretEncrypted: varbinary('totp_secret_encrypted', { length: 255 }),
  mfaEnrolledAt: timestamp('mfa_enrolled_at'),
  /**
   * The highest TOTP counter step this account has ever signed in with.
   *
   * The replay guard. A code stays valid for about ninety seconds across the
   * ±1 drift window, which is ample time for one glimpsed over a shoulder or
   * read out of a proxy log to be used again. Refusing any step at or below
   * this closes the window the moment it is spent. A column rather than the
   * in-memory nonce cache in `core/tokens/replay.ts` because that cache is
   * per-process: under PM2 cluster mode the replay would simply land on a
   * different worker.
   */
  totpLastStep: int('totp_last_step'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
});

export const adminRoles = mysqlTable('admin_roles', {
  id: int('id').autoincrement().primaryKey(),
  name: varchar('name', { length: 64 }).notNull().unique(),
  /** `*` is the superadmin wildcard; specific keys follow `admin.<area>.<verb>`. */
  permissions: json('permissions').$type<string[]>().notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const adminUserRoles = mysqlTable(
  'admin_user_roles',
  {
    userId: int('user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'cascade' }),
    roleId: int('role_id')
      .notNull()
      .references(() => adminRoles.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.roleId] }),
  }),
);

export const adminUsersRelations = relations(adminUsers, ({ many }) => ({
  userRoles: many(adminUserRoles),
}));

export const adminRolesRelations = relations(adminRoles, ({ many }) => ({
  userRoles: many(adminUserRoles),
}));

export const adminUserRolesRelations = relations(adminUserRoles, ({ one }) => ({
  user: one(adminUsers, { fields: [adminUserRoles.userId], references: [adminUsers.id] }),
  role: one(adminRoles, { fields: [adminUserRoles.roleId], references: [adminRoles.id] }),
}));

export type AdminUser = typeof adminUsers.$inferSelect;
export type NewAdminUser = typeof adminUsers.$inferInsert;
export type AdminRole = typeof adminRoles.$inferSelect;
export type NewAdminRole = typeof adminRoles.$inferInsert;
