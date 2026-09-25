/**
 * Nobody may hand out authority they do not hold themselves.
 *
 * This is the rule the whole permission system rests on, and it has now been
 * broken three times by the same reasoning: each route that touches permissions
 * looked like it only needed to check whether the actor was allowed to touch
 * permissions *at all*. It isn't. `cms.roles.manage` says you may shape roles,
 * not that you may shape them into something more powerful than you are.
 *
 * Editing a role's permission list was the first path (F-040). Attaching an
 * existing role to an account was the second (F-058), and it was worse: a holder
 * of `cms.roles.manage` and `cms.users.manage` — a perfectly ordinary "can look
 * after the team's accounts" role — could tick the seeded `superadmin` box on
 * their own account and be a real superadmin on their very next request, because
 * the guards read permissions fresh from the database rather than from the session
 * token. *Deleting* a role was the third: create and update both called this,
 * delete did not, so a `cms.roles.manage` holder could destroy an unused role
 * granting `*` that they could never have created.
 *
 * ## Why it sits in its own file
 *
 * It is pure — permission strings in, an error or nothing out — while its
 * neighbour `assertCanAssignRoles` needs to read roles from the database. Keeping
 * them together meant `roles/service.ts` could not use this without importing the
 * module that imports it. Splitting the pure half breaks that cycle, and matches
 * the pure/IO separation the rest of the core follows. Still re-exported from
 * `grants.ts`, so every existing caller is unaffected.
 */
import { hasPerm } from '../../modules/auth/permissions';
import { permissionLabel } from '../../modules/auth/permission-labels';
import { ApiError } from '../errors';

export function assertCanGrant(granted: readonly string[], requested: readonly string[]): void {
  const beyond = requested.filter((p) => !hasPerm(granted, p));
  if (beyond.length) {
    /*
     * Named the way the picker names them. The message used to print raw keys —
     * "cms.roles.manage" — to someone who has been choosing from a list that says
     * "Manage roles" throughout, which reads as a different subject entirely.
     */
    throw new ApiError(
      'forbidden',
      `You cannot grant a permission you do not hold yourself: ` +
        `${beyond.map(permissionLabel).join(', ')}.`,
    );
  }
}

/**
 * The same rule, applied to *editing an account* rather than handing out authority.
 *
 * `cms.users.manage` resets passwords, clears second factors, changes roles,
 * disables and deletes. Against an account holding more than the actor does,
 * every one of those is a takeover or a lockout of it: set a superadmin's
 * password and you are that superadmin. So an actor may only manage an account
 * whose effective permissions they already hold — a wildcard holder may manage
 * anyone, and an account with no role is within anyone's reach. Editing your
 * own account always passes, since a set is a subset of itself.
 */
export function assertCanManageAccount(granted: readonly string[], target: readonly string[]): void {
  const beyond = target.filter((p) => !hasPerm(granted, p));
  if (beyond.length) {
    throw new ApiError(
      'forbidden',
      `You cannot change this account — it holds a permission you do not hold yourself: ` +
        `${beyond.map(permissionLabel).join(', ')}.`,
    );
  }
}
