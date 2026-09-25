import { readCurrentCustomer, type CustomerRow } from '@/cms/modules/customers';
import type { Locale } from '@/lib/i18n/config';
import { redirect } from '@/lib/i18n/routing';

/**
 * The signed-in customer, or a redirect to the sign-in page.
 *
 * Every signed-in account screen starts with this, on the SERVER: the session
 * is what decides whether a page renders at all, never the browser. It throws
 * the redirect (that is how `redirect` works), so callers get a customer or
 * nothing — no `null` checks scattered through the pages.
 */
export async function requireCustomerPage(locale: Locale): Promise<CustomerRow> {
  const customer = await readCurrentCustomer();
  if (customer) return customer;
  redirect({ href: '/account/login', locale });
  // `redirect` throws; this is here only so the return type is honest.
  throw new Error('unreachable');
}
