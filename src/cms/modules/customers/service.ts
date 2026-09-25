import 'server-only';

import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { adapter, getDb, schema } from '../../db';
import type { CustomerTokenPurpose } from '../../db/adapters/mysql/schema/customers';
import { hashPassword, verifyPassword } from '../auth/password';
import { isDuplicateKeyError } from '../../core/errors';
import {
  anonymisedCustomer,
  applyDefaultAddressFlags,
  buildCustomerExport,
  canAddAddress,
  canClaimGuestOrders,
  isActiveCustomer,
  normalizeCustomerEmail,
  type CustomerAddressRow,
  type CustomerRow,
} from './policy';
import { hashCustomerToken, isTokenUsable, newCustomerToken, tokenExpiry } from './tokens';

/**
 * Customer accounts against the database. The rules live in `policy.ts`; this
 * file is the reads and writes that apply them.
 */

/**
 * A bcrypt hash of nothing in particular, compared against when the email is
 * unknown so that "no such account" and "wrong password" take the same time.
 * The same trick as the admin login — an attacker must not be able to discover
 * which addresses have accounts by timing the response.
 */
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEe.7aQpVUu/Ttc1eRcpNu9QN8Z9K.rwMv6';

export async function findCustomerByEmail(email: string): Promise<CustomerRow | null> {
  const [row] = await getDb()
    .select()
    .from(schema.customers)
    .where(eq(schema.customers.email, normalizeCustomerEmail(email)))
    .limit(1);
  return row ?? null;
}

export async function findCustomerById(id: number): Promise<CustomerRow | null> {
  const [row] = await getDb()
    .select()
    .from(schema.customers)
    .where(eq(schema.customers.id, id))
    .limit(1);
  return row ?? null;
}

export type RegisterOutcome =
  | { kind: 'created'; customer: CustomerRow; verifyToken: string }
  | { kind: 'exists'; customer: CustomerRow };

/**
 * Register, or report that the address is taken — WITHOUT telling the caller
 * which. The route answers the same either way and the person who owns the
 * address is emailed; see `routes.ts`.
 */
export async function registerCustomer(input: {
  email: string;
  password: string;
  name?: string;
  phone?: string;
  /** Required: the base must not decide that a site is Greek. */
  locale: string;
  marketingOptIn?: boolean;
}): Promise<RegisterOutcome> {
  const email = normalizeCustomerEmail(input.email);
  /*
   * Hashed BEFORE the existence check, and always. Hashing only for a new
   * address would make registration measurably slower for addresses that do not
   * have an account — the same enumeration oracle the identical response text
   * exists to close, just told by a stopwatch.
   */
  const passwordHash = await hashPassword(input.password);

  const existing = await findCustomerByEmail(email);
  if (existing) return { kind: 'exists', customer: existing };

  const db = getDb();
  try {
    await db.insert(schema.customers).values({
      email,
      passwordHash,
      name: input.name ?? null,
      phone: input.phone ?? null,
      locale: input.locale,
      marketingOptIn: input.marketingOptIn ?? false,
    });
  } catch (err) {
    // Two registrations for one address at the same moment: the loser must get
    // the same answer as any other "already registered", not a 409 that says so.
    if (!isDuplicateKeyError(err)) throw err;
    const raced = await findCustomerByEmail(email);
    if (raced) return { kind: 'exists', customer: raced };
    throw err;
  }
  const customer = await findCustomerByEmail(email);
  if (!customer) throw new Error('Customer vanished immediately after being created.');
  const verifyToken = await issueCustomerToken(customer.id, 'verify_email');
  return { kind: 'created', customer, verifyToken };
}

export type AuthOutcome =
  | { kind: 'ok'; customer: CustomerRow }
  | { kind: 'fail' }
  | { kind: 'disabled' };

/** Check an email and password in constant-ish time. */
export async function authenticateCustomer(email: string, password: string): Promise<AuthOutcome> {
  const customer = await findCustomerByEmail(email);
  const hash = customer?.passwordHash ?? DUMMY_HASH;
  const matches = await verifyPassword(password, hash);
  if (!customer || !matches) return { kind: 'fail' };
  if (!isActiveCustomer(customer)) return { kind: 'disabled' };
  await getDb()
    .update(schema.customers)
    .set({ lastLoginAt: new Date() })
    .where(eq(schema.customers.id, customer.id));
  return { kind: 'ok', customer };
}

/** Issue a one-time link, replacing any outstanding one for the same purpose. */
export async function issueCustomerToken(
  customerId: number,
  purpose: CustomerTokenPurpose
): Promise<string> {
  const db = getDb();
  // Outstanding links for the same purpose are spent: asking for a new reset
  // link must not leave the old one working.
  await db
    .update(schema.customerTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(schema.customerTokens.customerId, customerId),
        eq(schema.customerTokens.purpose, purpose),
        isNull(schema.customerTokens.usedAt)
      )
    );
  const { token, hash } = newCustomerToken();
  await db.insert(schema.customerTokens).values({
    customerId,
    purpose,
    tokenHash: hash,
    expiresAt: tokenExpiry(purpose, new Date()),
  });
  return token;
}

/**
 * Spend a one-time link. The row is marked used in the same statement that
 * claims it, so two simultaneous uses cannot both succeed.
 */
async function consumeToken(
  token: string,
  purpose: CustomerTokenPurpose
): Promise<CustomerRow | null> {
  const db = getDb();
  const hash = hashCustomerToken(token);
  const [row] = await db
    .select()
    .from(schema.customerTokens)
    .where(
      and(eq(schema.customerTokens.tokenHash, hash), eq(schema.customerTokens.purpose, purpose))
    )
    .limit(1);
  if (!isTokenUsable(row ?? null, new Date())) return null;

  const claimed = await db
    .update(schema.customerTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(schema.customerTokens.id, row.id), isNull(schema.customerTokens.usedAt)));
  if (adapter.affectedRows(claimed) === 0) return null;

  return findCustomerById(row.customerId);
}

/** Confirm an address, then attach any guest orders placed with it. */
export async function verifyCustomerEmail(token: string): Promise<CustomerRow | null> {
  const customer = await consumeToken(token, 'verify_email');
  if (!customer) return null;
  await getDb()
    .update(schema.customers)
    .set({ emailVerifiedAt: new Date() })
    .where(eq(schema.customers.id, customer.id));
  const verified = await findCustomerById(customer.id);
  if (verified) await claimGuestOrders(verified);
  return verified;
}

/**
 * Set a new password from a reset link. The token version moves on, so every
 * other session — including whoever prompted the reset — is signed out.
 */
export async function resetCustomerPassword(token: string, password: string): Promise<boolean> {
  const customer = await consumeToken(token, 'reset_password');
  if (!customer || !isActiveCustomer(customer)) return false;
  await getDb()
    .update(schema.customers)
    .set({
      passwordHash: await hashPassword(password),
      tokenVersion: sql`${schema.customers.tokenVersion} + 1`,
      // Using a link sent to the address proves the address.
      emailVerifiedAt: customer.emailVerifiedAt ?? new Date(),
    })
    .where(eq(schema.customers.id, customer.id));
  const updated = await findCustomerById(customer.id);
  if (updated) await claimGuestOrders(updated);
  return true;
}

export async function changeCustomerPassword(
  customerId: number,
  currentPassword: string,
  newPassword: string
): Promise<boolean> {
  const customer = await findCustomerById(customerId);
  if (!customer?.passwordHash || !isActiveCustomer(customer)) return false;
  if (!(await verifyPassword(currentPassword, customer.passwordHash))) return false;
  await getDb()
    .update(schema.customers)
    .set({
      passwordHash: await hashPassword(newPassword),
      tokenVersion: sql`${schema.customers.tokenVersion} + 1`,
    })
    .where(eq(schema.customers.id, customerId));
  return true;
}

export async function updateCustomerProfile(
  customerId: number,
  input: { name?: string | null; phone?: string | null; locale?: string; marketingOptIn?: boolean }
): Promise<CustomerRow | null> {
  await getDb()
    .update(schema.customers)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.locale !== undefined ? { locale: input.locale } : {}),
      ...(input.marketingOptIn !== undefined ? { marketingOptIn: input.marketingOptIn } : {}),
    })
    .where(eq(schema.customers.id, customerId));
  return findCustomerById(customerId);
}

/**
 * Attach this customer's guest orders to the account.
 *
 * Only for a verified address, and only orders that have no owner yet — an
 * order already attached to someone stays there.
 */
export async function claimGuestOrders(customer: CustomerRow): Promise<number> {
  if (!canClaimGuestOrders(customer)) return 0;
  const result = await getDb()
    .update(schema.orders)
    .set({ customerId: customer.id })
    .where(and(eq(schema.orders.email, customer.email), isNull(schema.orders.customerId)));
  return adapter.affectedRows(result);
}

// ── Addresses ───────────────────────────────────────────────────────────────

export async function listCustomerAddresses(customerId: number): Promise<CustomerAddressRow[]> {
  return getDb()
    .select()
    .from(schema.customerAddresses)
    .where(eq(schema.customerAddresses.customerId, customerId))
    .orderBy(desc(schema.customerAddresses.isDefaultShipping), schema.customerAddresses.id);
}

export interface AddressInput {
  label?: string | null;
  name?: string | null;
  phone?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  postal?: string | null;
  country?: string | null;
  isDefaultShipping?: boolean;
  isDefaultBilling?: boolean;
}

/**
 * Create or update one address. `id` is always checked against the signed-in
 * customer, so another customer's address id updates nothing.
 */
export async function saveCustomerAddress(
  customerId: number,
  input: AddressInput,
  id?: number
): Promise<CustomerAddressRow[] | null> {
  const db = getDb();
  const values = {
    label: input.label ?? null,
    name: input.name ?? null,
    phone: input.phone ?? null,
    address1: input.address1 ?? null,
    address2: input.address2 ?? null,
    city: input.city ?? null,
    postal: input.postal ?? null,
    country: input.country ? input.country.toUpperCase().slice(0, 2) : null,
  };

  let savedId = id;
  if (!id && !canAddAddress((await listCustomerAddresses(customerId)).length)) {
    return null;
  }
  if (id) {
    const result = await db
      .update(schema.customerAddresses)
      .set(values)
      .where(
        and(
          eq(schema.customerAddresses.id, id),
          eq(schema.customerAddresses.customerId, customerId)
        )
      );
    if (adapter.affectedRows(result) === 0) return null;
  } else {
    const inserted = await db.insert(schema.customerAddresses).values({ ...values, customerId });
    savedId = adapter.insertId(inserted);
  }

  const addresses = await listCustomerAddresses(customerId);
  const withFlags = applyDefaultAddressFlags(addresses, savedId as number, {
    shipping: input.isDefaultShipping,
    billing: input.isDefaultBilling,
  });
  for (const address of withFlags) {
    const before = addresses.find((a) => a.id === address.id);
    if (
      before &&
      (before.isDefaultShipping !== address.isDefaultShipping ||
        before.isDefaultBilling !== address.isDefaultBilling)
    ) {
      await db
        .update(schema.customerAddresses)
        .set({
          isDefaultShipping: address.isDefaultShipping,
          isDefaultBilling: address.isDefaultBilling,
        })
        .where(
          and(
            eq(schema.customerAddresses.id, address.id),
            eq(schema.customerAddresses.customerId, customerId)
          )
        );
    }
  }
  return listCustomerAddresses(customerId);
}

export async function deleteCustomerAddress(customerId: number, id: number): Promise<boolean> {
  const result = await getDb()
    .delete(schema.customerAddresses)
    .where(
      and(eq(schema.customerAddresses.id, id), eq(schema.customerAddresses.customerId, customerId))
    );
  return adapter.affectedRows(result) > 0;
}

// ── Orders ──────────────────────────────────────────────────────────────────

/** This customer's orders. Always filtered by `customer_id` — never by email. */
export async function listCustomerOrders(customerId: number, limit = 50) {
  return getDb()
    .select({
      id: schema.orders.id,
      reference: schema.orders.reference,
      status: schema.orders.status,
      total: schema.orders.total,
      currency: schema.orders.currency,
      createdAt: schema.orders.createdAt,
    })
    .from(schema.orders)
    .where(eq(schema.orders.customerId, customerId))
    .orderBy(desc(schema.orders.id))
    .limit(limit);
}

/**
 * One order of this customer's, by reference. The customer id is part of the
 * WHERE clause rather than checked afterwards, so a reference belonging to
 * somebody else is simply not found.
 */
export async function getCustomerOrder(customerId: number, reference: string) {
  const db = getDb();
  const [order] = await db
    .select()
    .from(schema.orders)
    .where(and(eq(schema.orders.customerId, customerId), eq(schema.orders.reference, reference)))
    .limit(1);
  if (!order) return null;
  const items = await db
    .select()
    .from(schema.orderItems)
    .where(eq(schema.orderItems.orderId, order.id));
  return { ...order, items };
}

// ── GDPR ────────────────────────────────────────────────────────────────────

export async function exportCustomerData(customerId: number) {
  const customer = await findCustomerById(customerId);
  if (!customer) return null;
  const [addresses, orders] = await Promise.all([
    listCustomerAddresses(customerId),
    listCustomerOrders(customerId, 500),
  ]);
  return buildCustomerExport(customer, addresses, orders, new Date());
}

/**
 * Delete the person, keep the orders.
 *
 * The orders are business records with their own retention period, so they stay
 * — with `customer_id` cleared, since the account they pointed at is gone.
 */
export async function deleteCustomerAccount(customerId: number): Promise<boolean> {
  const customer = await findCustomerById(customerId);
  if (!customer) return false;
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.orders)
      .set({ customerId: null })
      .where(eq(schema.orders.customerId, customerId));
    await tx
      .delete(schema.customerAddresses)
      .where(eq(schema.customerAddresses.customerId, customerId));
    await tx.delete(schema.customerTokens).where(eq(schema.customerTokens.customerId, customerId));
    await tx
      .update(schema.customers)
      .set(anonymisedCustomer(customer, new Date()))
      .where(eq(schema.customers.id, customerId));
  });
  return true;
}
