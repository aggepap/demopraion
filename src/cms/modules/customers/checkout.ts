/**
 * Where an account meets an order: who the order belongs to, and whether
 * checkout should make an account out of it.
 *
 * Pure — `checkout-service.ts` does the writing. Kept apart so the decision can
 * be read (and tested) without a database or a request.
 */
import type { CustomerAddressRow } from './policy';

export type { CustomerAddressRow };

export type CheckoutAccountPlan =
  /** Attach the order to the customer who is already signed in. */
  | { action: 'link'; customerId: number }
  /** Make an account from this checkout, after the order is safely stored. */
  | { action: 'create'; password: string }
  /** A guest order, which is the normal case and always allowed. */
  | { action: 'none' };

export function planCheckoutAccount(input: {
  accountsEnabled: boolean;
  signedInCustomerId: number | null;
  createAccount: boolean;
  password: string;
}): CheckoutAccountPlan {
  // Switched off means off on the server too: the tick is hidden in the page,
  // and a hidden checkbox stops nobody from posting the field.
  if (!input.accountsEnabled) return { action: 'none' };
  if (input.signedInCustomerId !== null) {
    return { action: 'link', customerId: input.signedInCustomerId };
  }
  if (input.createAccount && input.password) return { action: 'create', password: input.password };
  return { action: 'none' };
}

export interface CheckoutPrefill {
  name: string;
  email: string;
  phone: string;
  address1: string;
  city: string;
  postal: string;
  country: string;
}

const text = (value: string | null | undefined): string => value ?? '';

/**
 * What a signed-in customer's checkout form starts with.
 *
 * The default shipping address wins over the first one; its name and phone win
 * over the account's, because the person receiving the parcel is not always the
 * account holder. The email is always the account's — it is what the order
 * confirmation goes to, and what ties the order to the account.
 */
export function checkoutPrefill(
  customer: { name: string | null; email: string; phone: string | null },
  addresses: readonly CustomerAddressRow[]
): CheckoutPrefill {
  const address = addresses.find((a) => a.isDefaultShipping) ?? addresses[0];
  return {
    name: text(address?.name ?? customer.name),
    email: customer.email,
    phone: text(address?.phone ?? customer.phone),
    address1: text(address?.address1),
    city: text(address?.city),
    postal: text(address?.postal),
    country: text(address?.country),
  };
}
