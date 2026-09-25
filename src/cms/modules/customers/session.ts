import 'server-only';

import { cookies } from 'next/headers';

import {
  CUSTOMER_COOKIE_NAME,
  CUSTOMER_SESSION_TTL_SECONDS,
  signCustomerToken,
  verifyCustomerToken,
  type CustomerClaims,
} from './token';

/** The cookie half of the customer session; `token.ts` owns the signing. */
export async function setCustomerCookie(claims: CustomerClaims): Promise<void> {
  const token = await signCustomerToken(claims);
  const store = await cookies();
  store.set(CUSTOMER_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: CUSTOMER_SESSION_TTL_SECONDS,
  });
}

export async function clearCustomerCookie(): Promise<void> {
  const store = await cookies();
  store.delete(CUSTOMER_COOKIE_NAME);
}

/** Claims from the cookie, unverified against the database — see `guards.ts`. */
export async function readCustomerCookie(): Promise<CustomerClaims | null> {
  const store = await cookies();
  const token = store.get(CUSTOMER_COOKIE_NAME)?.value;
  return token ? verifyCustomerToken(token) : null;
}
