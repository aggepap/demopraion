import 'server-only';

import { hasPerm } from '../../modules/auth';
import { permissionLabel } from '../../modules/auth/permission-labels';
import { ApiError } from '../errors';

import { listRolesDetailed } from './service';

/**
 * The core rule — "you cannot grant what you do not hold" — now lives in
 * `can-grant.ts` so `roles/service.ts` can apply it on delete without importing
 * this module, which imports it. Re-exported here because this is where callers
 * have always found it.
 */
export { assertCanGrant } from './can-grant';

/**
 * The same rule for assigning a role rather than defining one.
 *
 * What matters is not the role's name but what it carries: assigning it hands the
 * account every permission in it, so the actor must already hold every one of
 * them. An unknown id is left alone deliberately — the write below fails on the
 * foreign key, and inventing a different answer here would only tell an attacker
 * which role ids exist.
 */
export async function assertCanAssignRoles(
  granted: readonly string[],
  roleIds: readonly number[],
): Promise<void> {
  if (!roleIds.length) return;
  const roles = await listRolesDetailed();
  const byId = new Map(roles.map((r) => [r.id, r]));
  for (const id of roleIds) {
    const role = byId.get(id);
    if (!role) continue;
    const beyond = role.permissions.filter((p) => !hasPerm(granted, p));
    if (beyond.length) {
      throw new ApiError(
        'forbidden',
        `You cannot assign the role "${role.name}" — it grants a permission you do not ` +
          `hold yourself: ${beyond.map(permissionLabel).join(', ')}.`,
      );
    }
  }
}

/** The roles this actor is allowed to attach to an account, for the UI to reflect. */
export function assignableRoleIds(
  granted: readonly string[],
  roles: readonly { id: number; permissions: string[] }[],
): number[] {
  return roles.filter((r) => r.permissions.every((p) => hasPerm(granted, p))).map((r) => r.id);
}
