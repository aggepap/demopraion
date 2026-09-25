import 'server-only';

import { NextResponse } from 'next/server';

import { isActiveCustomer, type CustomerRow } from './policy';
import { readCustomerCookie } from './session';
import { findCustomerById } from './service';

/**
 * The signed-in customer, or a 401.
 *
 * The cookie proves the token was signed by us; the database decides whether it
 * still counts. `token_version` is re-read on every request, which is what
 * makes a stateless session revocable: a password change, "sign out
 * everywhere" and account deletion all bump it and every outstanding token
 * stops working at once.
 */
export async function requireApiCustomer(): Promise<CustomerRow | NextResponse> {
  const unauthorized = () =>
    NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const claims = await readCustomerCookie();
  if (!claims) return unauthorized();

  const customer = await findCustomerById(claims.customerId);
  if (!customer || !isActiveCustomer(customer)) return unauthorized();
  if (customer.tokenVersion !== claims.tokenVersion) return unauthorized();
  return customer;
}

/** The signed-in customer for a page, or `null` (the page then redirects). */
export async function readCurrentCustomer(): Promise<CustomerRow | null> {
  const claims = await readCustomerCookie();
  if (!claims) return null;
  const customer = await findCustomerById(claims.customerId);
  if (!customer || !isActiveCustomer(customer)) return null;
  return customer.tokenVersion === claims.tokenVersion ? customer : null;
}
