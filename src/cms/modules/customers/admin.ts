import 'server-only';

import { and, desc, eq, isNull, like, or, sql, type SQL } from 'drizzle-orm';

import { getDb, schema } from '../../db';
import { likeTerm } from '../../core/db/like';
import { findCustomerById } from './service';

/**
 * The admin's view of customer accounts.
 *
 * Read-mostly on purpose. An administrator can look at an account, disable it
 * and re-send a confirmation email — and that is all. There is no "sign in as",
 * no password reveal and no password set: the account belongs to the shopper,
 * and an admin screen that could take it over would make every one of them a
 * target.
 */

export interface AdminCustomerRow {
  id: number;
  email: string;
  name: string | null;
  status: string;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  lastLoginAt: Date | null;
  orderCount: number;
  deletedAt: Date | null;
}

export interface ListCustomersOptions {
  search?: string;
  page?: number;
  pageSize?: number;
}

const MAX_PAGE_SIZE = 100;

export async function listCustomers(opts: ListCustomersOptions = {}) {
  const db = getDb();
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, opts.pageSize ?? 25));
  const page = Math.max(1, opts.page ?? 1);

  const filters: SQL[] = [];
  const search = opts.search?.trim();
  if (search) {
    const term = likeTerm(search);
    const match = or(like(schema.customers.email, term), like(schema.customers.name, term));
    if (match) filters.push(match);
  }
  const where = filters.length ? and(...filters) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: schema.customers.id,
        email: schema.customers.email,
        name: schema.customers.name,
        status: schema.customers.status,
        emailVerifiedAt: schema.customers.emailVerifiedAt,
        createdAt: schema.customers.createdAt,
        lastLoginAt: schema.customers.lastLoginAt,
        deletedAt: schema.customers.deletedAt,
        // One query rather than one per row: the list shows this for every
        // customer, and a per-row count is the classic N+1.
        orderCount: sql<number>`(
          select count(*) from ${schema.orders} where ${schema.orders.customerId} = ${schema.customers.id}
        )`,
      })
      .from(schema.customers)
      .where(where)
      .orderBy(desc(schema.customers.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ total: sql<number>`count(*)` })
      .from(schema.customers)
      .where(where),
  ]);

  return { items: rows, total: Number(total), page, pageSize };
}

/** One account with its orders, for the detail panel. */
export async function getCustomerForAdmin(id: number) {
  const customer = await findCustomerById(id);
  if (!customer) return null;
  const db = getDb();
  const [orders, addresses] = await Promise.all([
    db
      .select({
        id: schema.orders.id,
        reference: schema.orders.reference,
        status: schema.orders.status,
        total: schema.orders.total,
        currency: schema.orders.currency,
        createdAt: schema.orders.createdAt,
      })
      .from(schema.orders)
      .where(eq(schema.orders.customerId, id))
      .orderBy(desc(schema.orders.id))
      .limit(100),
    db.select().from(schema.customerAddresses).where(eq(schema.customerAddresses.customerId, id)),
  ]);
  /*
   * The password hash never leaves the server, even for an administrator —
   * listed field by field rather than deleted from the row, so a column added
   * to `customers` later is not published here by default.
   */
  return {
    customer: {
      id: customer.id,
      email: customer.email,
      name: customer.name,
      phone: customer.phone,
      locale: customer.locale,
      status: customer.status,
      emailVerifiedAt: customer.emailVerifiedAt,
      marketingOptIn: customer.marketingOptIn,
      lastLoginAt: customer.lastLoginAt,
      createdAt: customer.createdAt,
      deletedAt: customer.deletedAt,
    },
    orders,
    addresses,
  };
}

/**
 * Switch an account off (or back on). Disabling bumps the token version, so the
 * customer is signed out everywhere immediately rather than at their next login.
 */
export async function setCustomerStatus(id: number, status: 'active' | 'disabled') {
  const db = getDb();
  await db
    .update(schema.customers)
    .set({
      status,
      ...(status === 'disabled' ? { tokenVersion: sql`${schema.customers.tokenVersion} + 1` } : {}),
    })
    .where(and(eq(schema.customers.id, id), isNull(schema.customers.deletedAt)));
  return findCustomerById(id);
}
