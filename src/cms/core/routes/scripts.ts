import 'server-only';

import { PERMISSIONS, requireApiPerm } from '../../modules/auth';
import { logAudit } from '../audit';
import { createRoute } from '../api/handler';
import { idParam } from '../api/params';
import { created, noContent, ok } from '../api/respond';
import { snippetInputSchema } from '../scripts/schema';
import {
  createSnippet,
  deleteSnippet,
  listSnippets,
  revalidateScripts,
  updateSnippet,
} from '../scripts/service';

/*
 * Every route here, reads included, sits behind `scriptsManage`: the list holds
 * the code itself and whatever an administrator wrote in the notes.
 *
 * The audit entry keeps the full snippet as saved. When code runs for every
 * visitor, "who changed it, and to what" is the first question after an incident.
 */
const guard = () => requireApiPerm(PERMISSIONS.scriptsManage);

export function scriptListRoute() {
  return createRoute({
    guard,
    handler: async () => ok(await listSnippets()),
  });
}

export function scriptCreateRoute() {
  return createRoute({
    guard,
    input: snippetInputSchema,
    handler: async ({ input, auth }) => {
      const id = await createSnippet(input);
      revalidateScripts();
      await logAudit({ userId: auth.userId, action: 'scripts.create', subjectType: 'script_snippet', subjectId: id, after: input });
      return created({ id });
    },
  });
}

export function scriptUpdateRoute() {
  return createRoute({
    guard,
    input: snippetInputSchema,
    handler: async ({ params, input, auth }) => {
      const id = idParam(params.id);
      await updateSnippet(id, input);
      revalidateScripts();
      await logAudit({ userId: auth.userId, action: 'scripts.update', subjectType: 'script_snippet', subjectId: id, after: input });
      return ok({ ok: true });
    },
  });
}

export function scriptDeleteRoute() {
  return createRoute({
    guard,
    handler: async ({ params, auth }) => {
      const id = idParam(params.id);
      await deleteSnippet(id);
      revalidateScripts();
      await logAudit({ userId: auth.userId, action: 'scripts.delete', subjectType: 'script_snippet', subjectId: id });
      return noContent();
    },
  });
}
