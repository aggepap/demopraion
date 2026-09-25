import 'server-only';

import { z } from 'zod';

import { PERMISSIONS, requireApiPerm } from '../../modules/auth';
import { listAuditLogs } from '../audit';
import { createRoute } from '../api/handler';
import { paginated } from '../api/respond';

const auditQuery = z.object({
  search: z.string().trim().max(200).optional(),
  subjectType: z.string().trim().max(64).optional(),
  /** An `AUDIT_ACTION_GROUPS` key — filters by what happened, not what it happened to. */
  group: z.string().trim().max(32).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(200).optional(),
});

/**
 * GET /api/cms/audit — audit-log entries (read-only), filtered and paged.
 *
 * Previously the newest 200 rows and nothing else: no filter, and no way to
 * reach an older entry through the API at all.
 */
export function auditListRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.auditRead),
    query: auditQuery,
    handler: async ({ query }) => {
      const result = await listAuditLogs(query ?? {});
      return paginated(result.items, {
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
      });
    },
  });
}
