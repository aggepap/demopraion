import 'server-only';

import { and, count, eq, inArray, isNull, ne } from 'drizzle-orm';

import { adapter, getDb, schema } from '../../db';
import { ALL_PERMISSIONS } from '../../modules/auth/permissions';
import { ApiError } from '../errors';
import { assertCanGrant } from './can-grant';

/**
 * Role management.
 *
 * Until now roles could only be created by editing `db/seeds/roles.ts` and
 * re-running `npm run db:seed-roles`, so a site had exactly the two the seed
 * defines. Everything needed for more was already in place — the `admin_roles`
 * table, the join table, the wildcard-aware `hasPerm`, and a `cms.roles.manage`
 * permission that was being enforced for *assigning* a role — but there was no
 * way to make one.
 *
 * A concrete consequence: both seeded roles hold `cms.content.publish`, so the
 * publish gate (`requirePublishRights`) had no principal that could exercise its
 * refusal path. It could not be tested because the role could not be created.
 *
 * Every guard here exists because this table decides who can do what. Getting it
 * wrong locks people out of their own admin, and the only way back is the
 * database.
 */

/** `*` plus every declared key. Anything else is a typo that would silently
 *  never match, since `hasPerm` compares strings. */
export const ASSIGNABLE_PERMISSIONS: string[] = ['*', ...ALL_PERMISSIONS];

export interface RoleDetail {
  id: number;
  name: string;
  permissions: string[];
  /** How many accounts hold this role — what a delete would strip. */
  userCount: number;
}

export async function listRolesDetailed(): Promise<RoleDetail[]> {
  const db = getDb();
  const [roles, counts] = await Promise.all([
    db.select().from(schema.adminRoles).orderBy(schema.adminRoles.name),
    db
      .select({ roleId: schema.adminUserRoles.roleId, n: count() })
      .from(schema.adminUserRoles)
      .groupBy(schema.adminUserRoles.roleId),
  ]);
  const byRole = new Map(counts.map((c) => [c.roleId, Number(c.n)]));
  return roles.map((r) => ({
    id: r.id,
    name: r.name,
    permissions: r.permissions ?? [],
    userCount: byRole.get(r.id) ?? 0,
  }));
}

/**
 * Would the admin still have an enabled superadmin if `roleId` stopped granting
 * `*`? Read under `FOR UPDATE` so two concurrent requests cannot each see the
 * other's superadmin and both succeed — the same race that was fixed for
 * disabling a user (`updateUser`), which is where this lock pattern comes from.
 */
async function assertNotLastWildcard(
  tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  roleId: number,
  action: string,
): Promise<void> {
  const roles = await tx
    .select({
      id: schema.adminRoles.id,
      name: schema.adminRoles.name,
      permissions: schema.adminRoles.permissions,
    })
    .from(schema.adminRoles);

  const thisRole = roles.find((r) => r.id === roleId);
  // Only a role that currently grants `*` can be the last one granting it.
  if (!thisRole || !(thisRole.permissions ?? []).includes('*')) return;

  const otherWildcardIds = roles
    .filter((r) => r.id !== roleId && (r.permissions ?? []).includes('*'))
    .map((r) => r.id);

  // Another role still grants `*`; is anyone enabled actually holding it?
  if (otherWildcardIds.length) {
    const others = await tx
      .select({ userId: schema.adminUserRoles.userId })
      .from(schema.adminUserRoles)
      .innerJoin(schema.adminUsers, eq(schema.adminUsers.id, schema.adminUserRoles.userId))
      .where(
        and(inArray(schema.adminUserRoles.roleId, otherWildcardIds), isNull(schema.adminUsers.disabledAt)),
      )
      .for('update');
    if (others.length) return;
  }

  // Nothing else grants it. Does this role have an enabled holder that would lose it?
  const holders = await tx
    .select({ userId: schema.adminUserRoles.userId })
    .from(schema.adminUserRoles)
    .innerJoin(schema.adminUsers, eq(schema.adminUsers.id, schema.adminUserRoles.userId))
    .where(and(eq(schema.adminUserRoles.roleId, roleId), isNull(schema.adminUsers.disabledAt)))
    .for('update');

  if (holders.length) {
    throw new ApiError(
      'conflict',
      `"${thisRole.name}" is the only role granting full access to an enabled account — ` +
        `${action} would lock everyone out of the admin.`,
    );
  }
}

export async function createRole(input: { name: string; permissions: string[] }): Promise<number> {
  // `insertId` goes through the adapter because retrieving it is one of the
  // few things that differs per dialect (see `db/adapter.ts`).
  const res = await getDb()
    .insert(schema.adminRoles)
    .values({ name: input.name, permissions: input.permissions });
  return adapter.insertId(res);
}

export async function updateRole(
  id: number,
  patch: { name?: string; permissions?: string[] },
): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.adminRoles)
      .where(eq(schema.adminRoles.id, id))
      .limit(1);
    if (!existing) throw new ApiError('not_found', 'Role not found.');

    // Dropping `*` from the only role that grants it is the lock-out case.
    if (patch.permissions !== undefined && !patch.permissions.includes('*')) {
      await assertNotLastWildcard(tx, id, 'removing full access from it');
    }

    const set: Record<string, unknown> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.permissions !== undefined) set.permissions = patch.permissions;
    if (Object.keys(set).length) {
      await tx.update(schema.adminRoles).set(set).where(eq(schema.adminRoles.id, id));
    }
  });
}

export async function deleteRole(id: number, actorPermissions?: readonly string[]): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.adminRoles)
      .where(eq(schema.adminRoles.id, id))
      .limit(1);
    if (!existing) throw new ApiError('not_found', 'Role not found.');

    /*
     * The same rule create and update already enforce: you may not shape a role
     * you could not have made yourself. Deleting is the third way to act on a
     * role's permission list, and it was the one without the check — a holder of
     * `cms.roles.manage` could destroy an unused break-glass role granting `*`
     * that they had no authority to create. Destructive rather than escalating,
     * but the same rule and the same reason (see `roles/grants.ts`).
     *
     * Checked inside the transaction, against the row as locked, because unlike
     * create/update the permissions come from storage rather than the request.
     * `actorPermissions` is optional so the seed CLIs — which have no actor —
     * still work.
     */
    if (actorPermissions) assertCanGrant(actorPermissions, existing.permissions ?? []);

    await assertNotLastWildcard(tx, id, 'deleting it');

    /*
     * Refuse while anyone still holds it, rather than cascading.
     *
     * `admin_user_roles.role_id` is `onDelete: 'cascade'`, so the delete would
     * succeed and silently strip the role from every account holding it. A user
     * left with no roles is still "enabled" and can still sign in — to an admin
     * where every screen 403s. That is a confusing way to lose access, and it
     * happens without anything being said.
     */
    const [held] = await tx
      .select({ n: count() })
      .from(schema.adminUserRoles)
      .where(eq(schema.adminUserRoles.roleId, id));
    const holders = Number(held?.n ?? 0);
    if (holders > 0) {
      throw new ApiError(
        'conflict',
        `${holders} ${holders === 1 ? 'account still has' : 'accounts still have'} this role. ` +
          `Move them to another role first — deleting it would leave them signed in with no permissions at all.`,
      );
    }

    await tx.delete(schema.adminRoles).where(eq(schema.adminRoles.id, id));
  });
}

/**
 * Is `name` already taken by a different role? The column is unique, so the
 * database is the real arbiter and a duplicate surfaces as a 409 through
 * `isDuplicateKeyError` — this is only for a clearer message on the common path.
 */
export async function roleNameTaken(name: string, exceptId?: number): Promise<boolean> {
  const rows = await getDb()
    .select({ id: schema.adminRoles.id })
    .from(schema.adminRoles)
    .where(
      exceptId === undefined
        ? eq(schema.adminRoles.name, name)
        : and(eq(schema.adminRoles.name, name), ne(schema.adminRoles.id, exceptId)),
    )
    .limit(1);
  return rows.length > 0;
}
