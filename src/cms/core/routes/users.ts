import 'server-only';

import { z } from 'zod';

import { PERMISSIONS, requireApiPerm } from '../../modules/auth';
import { clearMfa } from '../../modules/auth/mfa';
import { logAudit } from '../audit';
import { createRoute } from '../api/handler';
import { idParam } from '../api/params';
import { created, noContent, ok } from '../api/respond';
import { ApiError, notFound } from '../errors';
import { localeOrDefault } from '../paths';
import { assertCanManageAccount } from '../roles/can-grant';
import { assignableRoleIds, assertCanAssignRoles } from '../roles/grants';
import { listRolesDetailed } from '../roles/service';
import { createUserBody, strongPasswordOrBlank, updateRoleIds } from '../users/schema';
import {
  accountPermissions,
  createUser,
  deleteUser,
  findUser,
  listRoles,
  listUsers,
  updateUser,
} from '../users/service';

/** GET /api/cms/users — users + roles (for the management screen). */
export function usersListRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.usersManage),
    /*
     * `assignable` is sent so the screen can stop offering a role its user cannot
     * actually give. The server refuses either way — this is so the refusal is not
     * the first the editor hears of it, having already ticked the box.
     */
    handler: async ({ auth }) =>
      ok({
        users: await listUsers(),
        roles: await listRoles(),
        assignableRoleIds: assignableRoleIds(auth.permissions, await listRolesDetailed()),
      }),
  });
}

/**
 * Assigning roles is a separate privilege from managing users — and holding that
 * privilege is not the same as being allowed to assign any role there is.
 *
 * `usersManage` alone must not let a principal attach the `superadmin` role to an
 * account; that much was already here. What was missing is the rest of the rule:
 * `rolesManage` must not let them either, unless they already hold everything the
 * role carries. Without that second half, an ordinary "looks after the team's
 * accounts" role — `cms.users.manage` plus `cms.roles.manage`, no wildcard — could
 * tick the seeded `superadmin` box on its own account and be a real superadmin on
 * the next request, since the guards read permissions from the database rather than
 * from the session token (F-058). The same escalation through the role-*editing*
 * route was closed earlier (F-040); this is its sibling.
 *
 * The permission guard runs before the body is parsed, so both checks happen here,
 * only when the request actually carries `roleIds`. Creation always does now that a
 * role is mandatory (`createUserBody`), which means creating an account takes
 * `rolesManage` as well as `usersManage` — no power lost, since a `usersManage`
 * holder on their own could only ever have created an account with no role, and an
 * account with no role cannot sign in.
 */
async function requireRoleAssignment(
  roleIds: number[] | undefined,
  actorPermissions: readonly string[],
): Promise<Response | null> {
  if (roleIds === undefined) return null;
  const res = await requireApiPerm(PERMISSIONS.rolesManage);
  if (res instanceof Response) return res;
  await assertCanAssignRoles(actorPermissions, roleIds);
  return null;
}

/**
 * `usersManage` reaches only accounts no more powerful than the actor.
 *
 * Every edit this API offers — password reset, second-factor reset, role change,
 * disable, delete — is a takeover or a lockout when aimed at a more privileged
 * account, and `usersManage` used to reach all of them: a "looks after the team"
 * role could set a superadmin's password and sign in as them. Checked on every
 * write to another account, before anything is changed; a missing account is a
 * 404 here rather than a silent no-op further down.
 */
async function assertCanManageUser(targetId: number, actorPermissions: readonly string[]): Promise<void> {
  const target = await accountPermissions(targetId);
  if (!target) throw notFound('User not found.');
  assertCanManageAccount(actorPermissions, target);
}

/**
 * Disabling an account is the one user edit that can lock the admin out of
 * itself, and it slipped past `requireRoleAssignment` because a body of
 * `{ disabled: true }` carries no `roleIds`. Two ways out were reachable:
 * disabling your own account, and disabling the last remaining superadmin —
 * after which nobody can re-enable anyone and the only way back in is a direct
 * database edit.
 */
async function assertDisableAllowed(
  targetId: number,
  disabled: boolean | undefined,
  actorId: number,
): Promise<void> {
  if (disabled !== true) return;
  if (targetId === actorId) {
    throw new ApiError('conflict', 'You cannot disable your own account.');
  }
  // The "last enabled superadmin" rule lives in `updateUser`, inside the same
  // transaction as the write and behind a row lock — checking it here as well
  // would only re-introduce the race this comment used to describe.
}

export function userCreateRoute(opts: {
  /** The site's default locale (`config.defaultLocale`), used when no language is chosen for the user. */
  defaultLocale: string;
}) {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.usersManage),
    input: createUserBody,
    handler: async ({ input, auth }) => {
      const denied = await requireRoleAssignment(input.roleIds, auth.permissions);
      if (denied) return denied;
      const id = await createUser({ ...input, locale: localeOrDefault(input.locale, opts.defaultLocale) });
      await logAudit({ userId: auth.userId, action: 'user.create', subjectType: 'admin_user', subjectId: id });
      return created({ id });
    },
  });
}

const updateBody = z.object({
  name: z.string().trim().min(1, 'Enter a name.').max(191, 'Name is too long.').optional(),
  locale: z.string().max(8).optional(),
  disabled: z.boolean().optional(),
  /*
   * The same complexity policy as a new account's password, and for the same reason:
   * whoever can create an account can reset one, so a rule that only guards creation
   * is a rule with a door next to it. Blank stays allowed — it is how this field says
   * "leave the current password alone" — and a union would have swallowed the
   * specific "Password needs …" sentence inside a generic union error.
   */
  password: strongPasswordOrBlank.optional(),
  roleIds: updateRoleIds.optional(),
  /**
   * Clear the target's second factor — the last resort for somebody who has
   * lost both their authenticator and their recovery codes.
   *
   * No new permission: whoever holds `usersManage` can already set this
   * account's password, so they can already take it over. Withholding the reset
   * would not protect anything; it would only mean the recovery path runs
   * through a hand-written SQL statement during an outage. Both are bounded the
   * same way — only on an account no more powerful than the actor
   * (`assertCanManageUser`).
   */
  resetMfa: z.boolean().optional(),
});

export function userUpdateRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.usersManage),
    input: updateBody,
    handler: async ({ params, input, auth, ip, req }) => {
      const denied = await requireRoleAssignment(input.roleIds, auth.permissions);
      if (denied) return denied;
      const id = idParam(params.id);
      await assertCanManageUser(id, auth.permissions);
      await assertDisableAllowed(id, input.disabled, auth.userId);
      await updateUser(id, input);
      if (input.resetMfa) {
        const target = await findUser(id);
        if (!target) throw notFound('User not found.');
        await clearMfa(id);
        // Its own audit action, not folded into `user.update`. Removing
        // somebody's second factor is the one edit here that lowers an
        // account's security, and it should be findable by searching for
        // exactly that rather than by reading every update row.
        await logAudit({
          userId: auth.userId,
          action: 'auth.2fa.admin_reset',
          subjectType: 'admin_user',
          subjectId: id,
          after: { email: target.email },
        });
      }
      if (input.password) {
        /*
         * Its own action, not folded into `user.update`.
         *
         * Setting somebody else's password is a security event — it hands over
         * an account — and it is one of the things people come to this log
         * looking for by name. Buried inside a generic "edited a user" row it
         * is unfindable: the filter cannot separate it from a display-name
         * change, and neither can a person reading the table.
         */
        await logAudit({
          userId: auth.userId,
          action: 'user.password.reset',
          subjectType: 'admin_user',
          subjectId: id,
          ip,
          ua: req.headers.get('user-agent'),
        });
      }
      await logAudit({ userId: auth.userId, action: 'user.update', subjectType: 'admin_user', subjectId: id });
      return ok({ ok: true });
    },
  });
}

/**
 * DELETE /api/cms/users/:id — remove an account outright.
 *
 * The users API had create and update but no delete, so an account could only
 * ever be disabled. That is the right default and stays the recommended action
 * — see `deleteUser` for what deletion costs the audit trail — but "only ever"
 * was too strong: an account created by mistake, or by a test run, had no way
 * out of the table except a hand-written SQL statement.
 *
 * Same permission and the same reach as the other user writes, and no more:
 * this grants no power a `usersManage` holder did not already have, since
 * `disabled: true` could already take any account they may manage out of
 * service — and neither reaches an account more powerful than the actor
 * (`assertCanManageUser`). What it adds is irreversibility, which is why the
 * audit entry is built from the row BEFORE it goes — once deleted, every
 * `user_id` and `created_by` pointing at it is nulled by the schema, and this
 * entry's `before` (shown on the audit screen) is the only remaining record of
 * who the account belonged to.
 *
 * The two lockout guards mirror the disable path exactly. Deleting yourself is
 * refused here, where the actor is known; deleting the last enabled superadmin
 * is refused inside `deleteUser`'s transaction, under the row lock, because
 * checking it out here would re-introduce the race that check exists to close.
 */
export function userDeleteRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.usersManage),
    handler: async ({ params, auth }) => {
      const id = idParam(params.id);
      if (id === auth.userId) {
        throw new ApiError('conflict', 'You cannot delete your own account.');
      }
      const before = await findUser(id);
      if (!before) throw notFound('User not found.');
      await assertCanManageUser(id, auth.permissions);
      await deleteUser(id);
      await logAudit({
        userId: auth.userId,
        action: 'user.delete',
        subjectType: 'admin_user',
        subjectId: id,
        before: { email: before.email, name: before.name, roleNames: before.roleNames },
      });
      return noContent();
    },
  });
}
