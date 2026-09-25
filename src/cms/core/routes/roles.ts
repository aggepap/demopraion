import 'server-only';

import { z } from 'zod';

import { PERMISSIONS, requireApiPerm } from '../../modules/auth';
import { logAudit } from '../audit';
import { createRoute } from '../api/handler';
import { idParam } from '../api/params';
import { created, ok } from '../api/respond';
import { ApiError } from '../errors';
import { assertCanGrant } from '../roles/grants';
import {
  ASSIGNABLE_PERMISSIONS,
  createRole,
  deleteRole,
  listRolesDetailed,
  roleNameTaken,
  updateRole,
} from '../roles/service';

/**
 * Role CRUD, all behind `cms.roles.manage`.
 *
 * That permission already existed and was already enforced — on *assigning* a
 * role to a user, so that `cms.users.manage` alone could not hand out
 * `superadmin`. The roles themselves had no endpoint at all: the only way to
 * make one was to edit `db/seeds/roles.ts` and re-run the seed CLI.
 *
 * The gate is the same permission rather than a stricter one, but that alone is
 * not enough, and my first reasoning here was wrong. I argued that anyone who can
 * assign a role can already grant themselves the existing superadmin, so nothing
 * more was needed — which assumed an escalation requires *assigning* something.
 * It does not. A holder of a role that includes `cms.roles.manage` can PATCH that
 * same role to add `*` and is a superadmin on the next request, with no
 * assignment and without `cms.users.manage`. A security scan caught it.
 *
 * So the rule is the one delegated administration actually needs: you cannot
 * grant a permission you do not hold yourself. A wildcard holder can still grant
 * anything, including `*`; everyone else is bounded by their own grants, which
 * closes the self-escalation without depending on which permissions happen to be
 * bundled together.
 */

/** Permissions must be keys the checker can actually match. A typo would be
 *  stored happily and then silently never grant anything. */
const permissionsField = z
  .array(z.string())
  .max(ASSIGNABLE_PERMISSIONS.length)
  .refine((list) => list.every((p) => ASSIGNABLE_PERMISSIONS.includes(p)), {
    message: 'Unknown permission key.',
  })
  // The same key twice is harmless to `hasPerm` but makes the stored row lie
  // about what it grants, and the UI counts entries.
  .transform((list) => [...new Set(list)]);

const nameField = z
  .string()
  .trim()
  .min(1)
  .max(64)
  // The column is `varchar(64) unique`; this is also what the name is *for* —
  // a label a human picks off a list.
  .regex(/^[\p{L}\p{N} _-]+$/u, 'Use letters, numbers, spaces, hyphens or underscores.');

/** GET /api/cms/roles */
export function rolesListRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.rolesManage),
    // `grantable` so the picker keeps greying out what this user cannot grant after a
    // refresh, not just on the server-rendered first load.
    handler: async ({ auth }) =>
      ok({ roles: await listRolesDetailed(), assignable: ASSIGNABLE_PERMISSIONS, grantable: auth.permissions }),
  });
}

const createBody = z.object({ name: nameField, permissions: permissionsField });

/** POST /api/cms/roles */
export function roleCreateRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.rolesManage),
    input: createBody,
    handler: async ({ input, auth }) => {
      assertCanGrant(auth.permissions, input.permissions);
      if (await roleNameTaken(input.name)) {
        throw new ApiError('conflict', `A role named "${input.name}" already exists.`);
      }
      const id = await createRole(input);
      await logAudit({
        userId: auth.userId,
        action: 'role.create',
        subjectType: 'admin_role',
        subjectId: id,
        after: { name: input.name, permissions: input.permissions },
      });
      return created({ id });
    },
  });
}

const updateBody = z
  .object({ name: nameField.optional(), permissions: permissionsField.optional() })
  // A PATCH that changes nothing is a mistake worth reporting, not a silent 200.
  .refine((b) => b.name !== undefined || b.permissions !== undefined, {
    message: 'Nothing to update.',
  });

/** PATCH /api/cms/roles/:id */
export function roleUpdateRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.rolesManage),
    input: updateBody,
    handler: async ({ params, input, auth }) => {
      const id = idParam(params.id);
      if (input.permissions !== undefined) assertCanGrant(auth.permissions, input.permissions);
      if (input.name !== undefined && (await roleNameTaken(input.name, id))) {
        throw new ApiError('conflict', `A role named "${input.name}" already exists.`);
      }
      await updateRole(id, input);
      await logAudit({
        userId: auth.userId,
        action: 'role.update',
        subjectType: 'admin_role',
        subjectId: id,
        after: input,
      });
      return ok({ ok: true });
    },
  });
}

/** DELETE /api/cms/roles/:id */
export function roleDeleteRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.rolesManage),
    handler: async ({ params, auth }) => {
      const id = idParam(params.id);
      // The actor's own grants go in, because what a role *carries* decides
      // whether this actor may destroy it — the same rule create and update
      // apply. `deleteRole` checks it against the locked row.
      await deleteRole(id, auth.permissions);
      await logAudit({
        userId: auth.userId,
        action: 'role.delete',
        subjectType: 'admin_role',
        subjectId: id,
      });
      return ok({ ok: true });
    },
  });
}
