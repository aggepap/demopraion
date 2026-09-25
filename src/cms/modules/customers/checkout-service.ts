import 'server-only';

import { eq } from 'drizzle-orm';

import { getDb, schema } from '../../db';
import { passwordMessage } from '../auth/password-policy';
import { planCheckoutAccount } from './checkout';
import { sendVerifyEmail } from './emails';
import { readCustomerCookie } from './session';
import { findCustomerById, registerCustomer } from './service';

/**
 * The account half of checkout, called by the checkout route's binder.
 *
 * Runs after the order is committed and is never allowed to fail it: a shopper
 * who has just paid must not be told their order failed because their password
 * was too short.
 */

/** Who is signed in, for the order's `customer_id`. */
export async function resolveCheckoutCustomerId(): Promise<number | null> {
  const claims = await readCustomerCookie();
  if (!claims) return null;
  const customer = await findCustomerById(claims.customerId);
  // Same revocation check as every other account request.
  if (!customer || customer.tokenVersion !== claims.tokenVersion || customer.deletedAt !== null) {
    return null;
  }
  return customer.status === 'active' ? customer.id : null;
}

/**
 * Link the order, or make an account from it.
 *
 * The order THIS checkout just placed is linked to the new account straight
 * away — the person typed the address and is holding the confirmation, so there
 * is nothing to prove. Their EARLIER guest orders are a different matter and
 * still wait for the verification link, because anyone can type an address that
 * is not theirs.
 */
export async function attachCheckoutAccount(args: {
  orderId: number;
  email: string;
  name: string;
  phone?: string;
  locale: string;
  createAccount: boolean;
  password: string;
  signedInCustomerId: number | null;
  accountsEnabled: boolean;
  defaultLocale: string;
}): Promise<void> {
  const plan = planCheckoutAccount({
    accountsEnabled: args.accountsEnabled,
    signedInCustomerId: args.signedInCustomerId,
    createAccount: args.createAccount,
    password: args.password,
  });
  if (plan.action === 'none') return;
  // A signed-in order was already stamped with its customer id by `createOrder`.
  if (plan.action === 'link') return;

  // The same password rules as the account pages; a bad one simply means no
  // account, because the order is already placed.
  if (passwordMessage(plan.password)) return;

  const result = await registerCustomer({
    email: args.email,
    password: plan.password,
    name: args.name,
    phone: args.phone,
    locale: args.locale,
  });
  if (result.kind === 'exists') return;

  await getDb()
    .update(schema.orders)
    .set({ customerId: result.customer.id })
    .where(eq(schema.orders.id, args.orderId));

  try {
    await sendVerifyEmail({
      to: result.customer.email,
      token: result.verifyToken,
      locale: args.locale,
      defaultLocale: args.defaultLocale,
    });
  } catch (err) {
    console.error('[cms/customers] checkout verification email failed', err);
  }
}
