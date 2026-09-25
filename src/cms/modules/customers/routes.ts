import 'server-only';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createRoute } from '../../core/api/handler';
import { ok } from '../../core/api/respond';
import { logAudit } from '../../core/audit';
import { badRequest, notFound } from '../../core/errors';
import { passwordMessage } from '../auth/password-policy';
import {
  sendAlreadyRegisteredEmail,
  sendPasswordChangedEmail,
  sendResetEmail,
  sendVerifyEmail,
} from './emails';
import { requireApiCustomer } from './guards';
import { publicCustomer } from './policy';
import { clearCustomerCookie, setCustomerCookie } from './session';
import {
  authenticateCustomer,
  changeCustomerPassword,
  deleteCustomerAccount,
  deleteCustomerAddress,
  exportCustomerData,
  findCustomerByEmail,
  getCustomerOrder,
  issueCustomerToken,
  listCustomerAddresses,
  listCustomerOrders,
  registerCustomer,
  resetCustomerPassword,
  saveCustomerAddress,
  updateCustomerProfile,
  verifyCustomerEmail,
} from './service';

/**
 * The customer-facing account API.
 *
 * Three rules run through all of it:
 *
 * - **Nothing here tells a stranger who has an account.** Register, forgot and
 *   login answer the same whatever the address is; the owner of the address is
 *   told by email instead.
 * - **Every authenticated route scopes by the signed-in customer's id**, in the
 *   query rather than after it, so another customer's id or order reference
 *   simply finds nothing.
 * - **Everything that sends mail or checks a password is rate limited**, and
 *   the two enumerable, unauthenticated ones also take a captcha when the site
 *   has reCAPTCHA keys.
 */

export interface CustomerRouteOptions {
  defaultLocale: string;
}

const email = z.string().trim().toLowerCase().email().max(191);
const password = z.string().min(1).max(200);
const locale = z.string().trim().max(10).optional();

/** The shared "we accepted it, and we are not saying more" answer. */
const acknowledged = () => ok({ ok: true });

/** Sending must never decide whether the account operation succeeded. */
async function safeSend(send: () => Promise<void>): Promise<void> {
  try {
    await send();
  } catch (err) {
    console.error('[cms/customers] email send failed', err);
  }
}

function rejectWeakPassword(value: string): void {
  const problem = passwordMessage(value);
  if (problem) throw badRequest(problem);
}

export function customerRegisterRoute(opts: CustomerRouteOptions) {
  return createRoute({
    rateLimit: { scope: 'customer-register', max: 5, windowMs: 60_000 },
    captcha: { rateLimit: { scope: 'customer-register-captcha', max: 30, windowMs: 60_000 } },
    input: z
      .object({
        email,
        password,
        name: z.string().trim().max(191).optional(),
        phone: z.string().trim().max(40).optional(),
        locale,
        marketingOptIn: z.boolean().optional(),
      })
      .strict(),
    handler: async ({ input }) => {
      rejectWeakPassword(input.password);
      const mailLocale = input.locale ?? opts.defaultLocale;
      const result = await registerCustomer({ ...input, locale: mailLocale });

      if (result.kind === 'exists') {
        // Same answer as a fresh registration; the owner is told by email.
        await safeSend(() =>
          sendAlreadyRegisteredEmail({
            to: result.customer.email,
            locale: mailLocale,
            defaultLocale: opts.defaultLocale,
          })
        );
        return acknowledged();
      }

      await safeSend(() =>
        sendVerifyEmail({
          to: result.customer.email,
          token: result.verifyToken,
          locale: mailLocale,
          defaultLocale: opts.defaultLocale,
        })
      );
      return acknowledged();
    },
  });
}

export function customerLoginRoute() {
  return createRoute({
    // Counts password guesses, not requests — the captcha budget is separate.
    rateLimit: { scope: 'customer-login', max: 10, windowMs: 60_000 },
    input: z.object({ email, password }).strict(),
    handler: async ({ input }) => {
      const result = await authenticateCustomer(input.email, input.password);
      if (result.kind !== 'ok') {
        // One message for wrong password, unknown address and disabled account.
        throw badRequest('Those details do not match an account.');
      }
      await setCustomerCookie({
        customerId: result.customer.id,
        email: result.customer.email,
        tokenVersion: result.customer.tokenVersion,
      });
      return ok({ customer: publicCustomer(result.customer) });
    },
  });
}

export function customerLogoutRoute() {
  return createRoute({
    handler: async () => {
      await clearCustomerCookie();
      return ok({ ok: true });
    },
  });
}

export function customerMeRoute() {
  return createRoute({
    handler: async () => {
      const customer = await requireApiCustomer();
      // Not an error: the header asks on every page, and a guest is the normal answer.
      if (customer instanceof NextResponse) return ok({ customer: null });
      return ok({ customer: publicCustomer(customer) });
    },
  });
}

export function customerVerifyRoute() {
  return createRoute({
    rateLimit: { scope: 'customer-verify', max: 20, windowMs: 60_000 },
    input: z.object({ token: z.string().min(10).max(200) }).strict(),
    handler: async ({ input }) => {
      const customer = await verifyCustomerEmail(input.token);
      if (!customer) throw badRequest('This link is no longer valid. Ask for a new one.');
      // Signed in on the spot: the link proved the address.
      await setCustomerCookie({
        customerId: customer.id,
        email: customer.email,
        tokenVersion: customer.tokenVersion,
      });
      return ok({ customer: publicCustomer(customer) });
    },
  });
}

export function customerForgotRoute(opts: CustomerRouteOptions) {
  return createRoute({
    rateLimit: { scope: 'customer-forgot', max: 5, windowMs: 60_000 },
    captcha: { rateLimit: { scope: 'customer-forgot-captcha', max: 30, windowMs: 60_000 } },
    input: z.object({ email, locale }).strict(),
    handler: async ({ input }) => {
      const customer = await findCustomerByEmail(input.email);
      if (customer?.passwordHash && customer.deletedAt === null) {
        const token = await issueCustomerToken(customer.id, 'reset_password');
        await safeSend(() =>
          sendResetEmail({
            to: customer.email,
            token,
            locale: input.locale ?? customer.locale ?? opts.defaultLocale,
            defaultLocale: opts.defaultLocale,
          })
        );
      }
      // Identical answer whether or not the address has an account.
      return acknowledged();
    },
  });
}

export function customerResetRoute() {
  return createRoute({
    rateLimit: { scope: 'customer-reset', max: 10, windowMs: 60_000 },
    input: z.object({ token: z.string().min(10).max(200), password }).strict(),
    handler: async ({ input }) => {
      rejectWeakPassword(input.password);
      const done = await resetCustomerPassword(input.token, input.password);
      if (!done) throw badRequest('This link is no longer valid. Ask for a new one.');
      // Deliberately NOT signed in here: the new password is typed once more,
      // which is what proves it was remembered rather than mistyped.
      await clearCustomerCookie();
      return acknowledged();
    },
  });
}

export function customerPasswordRoute(opts: CustomerRouteOptions) {
  return createRoute({
    rateLimit: { scope: 'customer-password', max: 10, windowMs: 60_000 },
    input: z.object({ currentPassword: password, newPassword: password }).strict(),
    handler: async ({ input }) => {
      const customer = await requireApiCustomer();
      if (customer instanceof NextResponse) return customer;
      rejectWeakPassword(input.newPassword);
      const done = await changeCustomerPassword(
        customer.id,
        input.currentPassword,
        input.newPassword
      );
      if (!done) throw badRequest('Your current password is not right.');
      // Every other session is dead now, including this one — sign back in.
      await clearCustomerCookie();
      await safeSend(() =>
        sendPasswordChangedEmail({
          to: customer.email,
          locale: customer.locale,
          defaultLocale: opts.defaultLocale,
        })
      );
      return acknowledged();
    },
  });
}

export function customerProfileRoute() {
  return createRoute({
    rateLimit: { scope: 'customer-profile', max: 30, windowMs: 60_000 },
    input: z
      .object({
        name: z.string().trim().max(191).nullable().optional(),
        phone: z.string().trim().max(40).nullable().optional(),
        locale,
        marketingOptIn: z.boolean().optional(),
      })
      .strict(),
    handler: async ({ input }) => {
      const customer = await requireApiCustomer();
      if (customer instanceof NextResponse) return customer;
      const updated = await updateCustomerProfile(customer.id, input);
      return ok({ customer: updated ? publicCustomer(updated) : null });
    },
  });
}

const addressBody = z
  .object({
    label: z.string().trim().max(60).nullable().optional(),
    name: z.string().trim().max(191).nullable().optional(),
    phone: z.string().trim().max(40).nullable().optional(),
    address1: z.string().trim().max(255).nullable().optional(),
    address2: z.string().trim().max(255).nullable().optional(),
    city: z.string().trim().max(120).nullable().optional(),
    postal: z.string().trim().max(20).nullable().optional(),
    country: z.string().trim().length(2).nullable().optional(),
    isDefaultShipping: z.boolean().optional(),
    isDefaultBilling: z.boolean().optional(),
  })
  .strict();

export function customerAddressesRoute() {
  return {
    GET: createRoute({
      handler: async () => {
        const customer = await requireApiCustomer();
        if (customer instanceof NextResponse) return customer;
        return ok({ addresses: await listCustomerAddresses(customer.id) });
      },
    }),
    POST: createRoute({
      rateLimit: { scope: 'customer-address', max: 30, windowMs: 60_000 },
      input: addressBody,
      handler: async ({ input }) => {
        const customer = await requireApiCustomer();
        if (customer instanceof NextResponse) return customer;
        const addresses = await saveCustomerAddress(customer.id, input);
        if (!addresses)
          throw badRequest('You have saved as many addresses as an account can hold.');
        return ok({ addresses });
      },
    }),
  };
}

const addressId = z.coerce.number().int().positive();

export function customerAddressRoute() {
  return {
    PATCH: createRoute({
      rateLimit: { scope: 'customer-address', max: 30, windowMs: 60_000 },
      input: addressBody,
      handler: async ({ input, params }) => {
        const customer = await requireApiCustomer();
        if (customer instanceof NextResponse) return customer;
        const id = addressId.safeParse(params.id);
        if (!id.success) throw notFound();
        // The id is matched together with the customer id, so somebody else's
        // address is not "forbidden" — it is simply not theirs to find.
        const addresses = await saveCustomerAddress(customer.id, input, id.data);
        if (!addresses) throw notFound();
        return ok({ addresses });
      },
    }),
    DELETE: createRoute({
      rateLimit: { scope: 'customer-address', max: 30, windowMs: 60_000 },
      handler: async ({ params }) => {
        const customer = await requireApiCustomer();
        if (customer instanceof NextResponse) return customer;
        const id = addressId.safeParse(params.id);
        if (!id.success) throw notFound();
        if (!(await deleteCustomerAddress(customer.id, id.data))) throw notFound();
        return ok({ addresses: await listCustomerAddresses(customer.id) });
      },
    }),
  };
}

export function customerOrdersRoute() {
  return createRoute({
    handler: async () => {
      const customer = await requireApiCustomer();
      if (customer instanceof NextResponse) return customer;
      return ok({ orders: await listCustomerOrders(customer.id) });
    },
  });
}

export function customerOrderRoute() {
  return createRoute({
    handler: async ({ params }) => {
      const customer = await requireApiCustomer();
      if (customer instanceof NextResponse) return customer;
      const order = await getCustomerOrder(customer.id, String(params.reference ?? ''));
      if (!order) throw notFound();
      return ok({ order });
    },
  });
}

export function customerExportRoute() {
  return createRoute({
    rateLimit: { scope: 'customer-export', max: 5, windowMs: 60_000 },
    handler: async () => {
      const customer = await requireApiCustomer();
      if (customer instanceof NextResponse) return customer;
      const data = await exportCustomerData(customer.id);
      if (!data) throw notFound();
      await logAudit({
        actorLabel: `customer:${customer.id}`,
        action: 'customer.export',
        subjectType: 'customer',
        subjectId: customer.id,
      });
      return NextResponse.json(data, {
        headers: { 'content-disposition': 'attachment; filename="my-data.json"' },
      });
    },
  });
}

export function customerDeleteRoute() {
  return createRoute({
    rateLimit: { scope: 'customer-delete', max: 5, windowMs: 60_000 },
    input: z.object({ password }).strict(),
    handler: async ({ input }) => {
      const customer = await requireApiCustomer();
      if (customer instanceof NextResponse) return customer;
      // The password is asked for again: deletion is irreversible, and a
      // borrowed unlocked browser should not be enough to do it.
      const check = await authenticateCustomer(customer.email, input.password);
      if (check.kind !== 'ok') throw badRequest('Your password is not right.');
      await deleteCustomerAccount(customer.id);
      await clearCustomerCookie();
      await logAudit({
        actorLabel: `customer:${customer.id}`,
        action: 'customer.delete',
        subjectType: 'customer',
        subjectId: customer.id,
      });
      return acknowledged();
    },
  });
}
