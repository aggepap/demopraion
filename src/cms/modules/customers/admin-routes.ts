import 'server-only';

import { z } from 'zod';

import { createRoute } from '../../core/api/handler';
import { idParam } from '../../core/api/params';
import { ok, paginated } from '../../core/api/respond';
import { logAudit } from '../../core/audit';
import { notFound } from '../../core/errors';
import { PERMISSIONS, requireApiPerm } from '../auth';
import { getCustomerForAdmin, listCustomers, setCustomerStatus } from './admin';
import { issueCustomerToken } from './service';
import { sendVerifyEmail } from './emails';

/** Admin list/detail/update for customer accounts. Read needs `customersRead`;
 *  disabling or re-sending a confirmation needs `customersWrite`. */
export function customersListRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.customersRead),
    query: z.object({
      search: z.string().trim().max(191).optional(),
      page: z.coerce.number().int().positive().optional(),
      pageSize: z.coerce.number().int().positive().max(100).optional(),
    }),
    handler: async ({ query }) => {
      const result = await listCustomers(query);
      return paginated(result.items, {
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
      });
    },
  });
}

export function customerGetRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.customersRead),
    handler: async ({ params }) => {
      const detail = await getCustomerForAdmin(idParam(params.id));
      if (!detail) throw notFound();
      return ok(detail);
    },
  });
}

export function customerUpdateRoute(opts: { defaultLocale: string }) {
  return createRoute({
    rateLimit: { scope: 'admin-customers', max: 60, windowMs: 60_000 },
    guard: () => requireApiPerm(PERMISSIONS.customersWrite),
    input: z
      .object({
        status: z.enum(['active', 'disabled']).optional(),
        /** Re-send the confirmation email; never reveals whether it was needed. */
        resendVerification: z.boolean().optional(),
      })
      .strict(),
    handler: async ({ input, params, auth }) => {
      const id = idParam(params.id);
      const detail = await getCustomerForAdmin(id);
      if (!detail) throw notFound();

      if (input.status) {
        await setCustomerStatus(id, input.status);
        await logAudit({
          userId: auth.userId,
          action: 'customer.status',
          subjectType: 'customer',
          subjectId: id,
          before: { status: detail.customer.status },
          after: { status: input.status },
        });
      }

      if (input.resendVerification && detail.customer.emailVerifiedAt === null) {
        const token = await issueCustomerToken(id, 'verify_email');
        try {
          await sendVerifyEmail({
            to: detail.customer.email,
            token,
            locale: detail.customer.locale,
            defaultLocale: opts.defaultLocale,
          });
        } catch (err) {
          console.error('[cms/customers] admin resend failed', err);
        }
        await logAudit({
          userId: auth.userId,
          action: 'customer.resend_verification',
          subjectType: 'customer',
          subjectId: id,
        });
      }

      const updated = await getCustomerForAdmin(id);
      return ok(updated);
    },
  });
}
