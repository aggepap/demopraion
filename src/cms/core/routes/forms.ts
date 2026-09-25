import 'server-only';

import { z } from 'zod';

import { formStatusValues } from '../../db/adapters/mysql/schema/forms';
import { PERMISSIONS, requireApiPerm } from '../../modules/auth';
import { logAudit } from '../audit';
import { createRoute } from '../api/handler';
import { idParam } from '../api/params';
import { ok } from '../api/respond';
import { notFound } from '../errors';
import { getSubmission, listSubmissions, updateSubmission } from '../forms/service';

const listQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
  formType: z.string().max(64).optional(),
  status: z.enum(formStatusValues).optional(),
  search: z.string().max(200).optional(),
});

/** GET /api/cms/forms — paginated submissions + distinct types. */
export function submissionsListRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.formsRead),
    query: listQuery,
    handler: async ({ query }) => ok(await listSubmissions(query ?? {})),
  });
}

/** GET /api/cms/forms/:id — one submission with its full payload. */
export function submissionGetRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.formsRead),
    handler: async ({ params }) => {
      const row = await getSubmission(idParam(params.id));
      if (!row) throw notFound('Submission not found.');
      return ok(row);
    },
  });
}

const updateBody = z.object({
  status: z.enum(formStatusValues).optional(),
  notes: z.string().max(4000).nullish(),
});

/** PATCH /api/cms/forms/:id — triage (status / notes). */
export function submissionUpdateRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.formsWrite),
    input: updateBody,
    handler: async ({ params, input, auth }) => {
      const id = idParam(params.id);
      const before = await getSubmission(id);
      if (!before) throw notFound('Submission not found.');
      await updateSubmission(id, input);
      await logAudit({
        userId: auth.userId,
        action: 'submission.update',
        subjectType: 'form_submission',
        subjectId: id,
        after: input,
      });
      return ok(await getSubmission(id));
    },
  });
}
