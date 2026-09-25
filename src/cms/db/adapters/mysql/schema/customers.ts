/**
 * Shop customers — people who buy, not people who run the site.
 *
 * ## Why not `admin_users` with a role
 *
 * Because the two have nothing in common but a password column. A customer
 * registers themselves, verifies their own email, resets their own password and
 * can delete themselves; an administrator is created by another administrator,
 * may be forced into MFA, and holds permissions. Keeping them apart means the
 * admin guards, the permission checks and the `/admin` session never see a
 * customer row at all: a mistake in one of them cannot promote a shopper,
 * because the token a shopper holds does not verify on the admin side either.
 *
 * ## `token_version`
 *
 * The session is a stateless JWT, which cannot be withdrawn once issued. Every
 * account request compares the version in the token against this column, so
 * "sign out everywhere", a password change and account deletion all take effect
 * immediately by incrementing it.
 *
 * ## Deletion
 *
 * A deleted customer is anonymised, not removed: the orders they placed are
 * business records with their own retention rules. `deleted_at` is set, the
 * email is replaced with an address nobody can sign in as, and the personal
 * columns are emptied.
 */
import {
  boolean,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/mysql-core';

export const customerStatusValues = ['active', 'disabled'] as const;
export type CustomerStatus = (typeof customerStatusValues)[number];

export const customers = mysqlTable(
  'customers',
  {
    id: int('id').autoincrement().primaryKey(),
    /** Stored lowercased and trimmed — see `normalizeCustomerEmail`. */
    email: varchar('email', { length: 191 }).notNull(),
    name: varchar('name', { length: 191 }),
    phone: varchar('phone', { length: 40 }),
    locale: varchar('locale', { length: 10 }).notNull().default('el'),
    /** Null only for an anonymised (deleted) account, which cannot sign in. */
    passwordHash: varchar('password_hash', { length: 255 }),
    emailVerifiedAt: timestamp('email_verified_at'),
    status: mysqlEnum('status', customerStatusValues).notNull().default('active'),
    /** Bumped to invalidate every session this customer holds. */
    tokenVersion: int('token_version').notNull().default(1),
    marketingOptIn: boolean('marketing_opt_in').notNull().default(false),
    lastLoginAt: timestamp('last_login_at'),
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (t) => ({
    emailUniq: unique('uniq_customers_email').on(t.email),
  })
);

export const customerAddresses = mysqlTable(
  'customer_addresses',
  {
    id: int('id').autoincrement().primaryKey(),
    customerId: int('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    /** The customer's own name for it: "Home", "Work". */
    label: varchar('label', { length: 60 }),
    name: varchar('name', { length: 191 }),
    phone: varchar('phone', { length: 40 }),
    address1: varchar('address1', { length: 255 }),
    address2: varchar('address2', { length: 255 }),
    city: varchar('city', { length: 120 }),
    postal: varchar('postal', { length: 20 }),
    /** ISO-3166 alpha-2, so it can be matched against a shipping zone. */
    country: varchar('country', { length: 2 }),
    isDefaultShipping: boolean('is_default_shipping').notNull().default(false),
    isDefaultBilling: boolean('is_default_billing').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (t) => ({
    customerIdx: index('idx_customer_addresses_customer').on(t.customerId),
  })
);

export const customerTokenPurposes = ['verify_email', 'reset_password'] as const;
export type CustomerTokenPurpose = (typeof customerTokenPurposes)[number];

/**
 * One-time links. Only the sha256 of the secret is stored: the link IS the
 * credential, so a leaked table must not yield a working password reset for
 * every account.
 */
export const customerTokens = mysqlTable(
  'customer_tokens',
  {
    id: int('id').autoincrement().primaryKey(),
    customerId: int('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    purpose: mysqlEnum('purpose', customerTokenPurposes).notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    usedAt: timestamp('used_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    // Unique, not merely indexed: the lookup is by hash, and two rows with the
    // same hash would make "which token was this" ambiguous.
    hashUniq: unique('uniq_customer_tokens_hash').on(t.tokenHash),
    customerIdx: index('idx_customer_tokens_customer').on(t.customerId, t.purpose),
  })
);

export type CustomerRecord = typeof customers.$inferSelect;
export type NewCustomerRecord = typeof customers.$inferInsert;
export type CustomerAddressRecord = typeof customerAddresses.$inferSelect;
export type CustomerTokenRecord = typeof customerTokens.$inferSelect;
