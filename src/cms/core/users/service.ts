import 'server-only';

import { and, desc, eq, inArray, isNull } from 'drizzle-orm';

import { adapter, getDb, schema } from '../../db';
import { hashPassword } from '../../modules/auth';
import { ApiError } from '../errors';
import { normalizeEmail } from './schema';

export interface RoleSummary {
  id: number;
  name: string;
  permissionsCount: number;
}

export interface UserSummary {
  id: number;
  email: string;
  name: string;
  locale: string;
  disabled: boolean;
  /**
   * Whether the account holds a second factor. A boolean rather than the method
   * name: the management screen only needs to know there is something to reset,
   * and which app somebody uses is not an administrator's business.
   */
  mfaEnabled: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  roleIds: number[];
  roleNames: string[];
}

export async function listRoles(): Promise<RoleSummary[]> {
  const rows = await getDb().select().from(schema.adminRoles).orderBy(schema.adminRoles.name);
  return rows.map((r) => ({ id: r.id, name: r.name, permissionsCount: (r.permissions ?? []).length }));
}

/**
 * Ids of enabled users who still hold a wildcard (`*`) role.
 *
 * Used to keep the admin from being locked out of itself: disabling the last
 * one leaves nobody able to re-enable anyone, and the only way back in is a
 * direct database edit.
 */
export async function enabledSuperadminIds(): Promise<number[]> {
  const db = getDb();
  const [users, userRoles, roles] = await Promise.all([
    db.select({ id: schema.adminUsers.id, disabledAt: schema.adminUsers.disabledAt }).from(schema.adminUsers),
    db.select().from(schema.adminUserRoles),
    db.select({ id: schema.adminRoles.id, permissions: schema.adminRoles.permissions }).from(schema.adminRoles),
  ]);
  const wildcardRoleIds = new Set(roles.filter((r) => (r.permissions ?? []).includes('*')).map((r) => r.id));
  const enabled = new Set(users.filter((u) => !u.disabledAt).map((u) => u.id));
  return [
    ...new Set(
      userRoles
        .filter((ur) => wildcardRoleIds.has(ur.roleId) && enabled.has(ur.userId))
        .map((ur) => ur.userId),
    ),
  ];
}

export async function listUsers(): Promise<UserSummary[]> {
  const db = getDb();
  const [users, userRoles, roles] = await Promise.all([
    db.select().from(schema.adminUsers).orderBy(desc(schema.adminUsers.createdAt)),
    db.select().from(schema.adminUserRoles),
    db.select({ id: schema.adminRoles.id, name: schema.adminRoles.name }).from(schema.adminRoles),
  ]);
  const roleName = new Map(roles.map((r) => [r.id, r.name]));
  return users.map((u) => {
    const roleIds = userRoles.filter((ur) => ur.userId === u.id).map((ur) => ur.roleId);
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      locale: u.locale,
      disabled: Boolean(u.disabledAt),
      mfaEnabled: Boolean(u.mfaMethod),
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
      roleIds,
      roleNames: roleIds.map((id) => roleName.get(id) ?? String(id)),
    };
  });
}

async function setUserRoles(userId: number, roleIds: number[]): Promise<void> {
  const db = getDb();
  await db.delete(schema.adminUserRoles).where(eq(schema.adminUserRoles.userId, userId));
  if (roleIds.length) {
    await db.insert(schema.adminUserRoles).values(roleIds.map((roleId) => ({ userId, roleId })));
  }
}

/** One account, by id — read before a delete so the audit entry can name it. */
export async function findUser(id: number): Promise<UserSummary | null> {
  const users = await listUsers();
  return users.find((u) => u.id === id) ?? null;
}

/**
 * Everything an account's roles grant, or null when there is no such account.
 *
 * Unlike `loadUserPermissions` this does not skip a disabled account: the
 * question is "how powerful is the account being edited", and re-enabling a
 * disabled superadmin is exactly the kind of edit that needs the answer.
 */
export async function accountPermissions(id: number): Promise<string[] | null> {
  const db = getDb();
  const [user] = await db
    .select({ id: schema.adminUsers.id })
    .from(schema.adminUsers)
    .where(eq(schema.adminUsers.id, id))
    .limit(1);
  if (!user) return null;
  const rows = await db
    .select({ permissions: schema.adminRoles.permissions })
    .from(schema.adminUserRoles)
    .innerJoin(schema.adminRoles, eq(schema.adminRoles.id, schema.adminUserRoles.roleId))
    .where(eq(schema.adminUserRoles.userId, id));
  return [...new Set(rows.flatMap((r) => r.permissions ?? []))];
}

export interface CreateUserInput {
  email: string;
  name: string;
  password: string;
  /** The language of the user's sign-in code emails. The route supplies the site default when none is chosen. */
  locale: string;
  roleIds?: number[];
}

export async function createUser(input: CreateUserInput): Promise<number> {
  const db = getDb();
  const passwordHash = await hashPassword(input.password);
  const res = await db.insert(schema.adminUsers).values({
    // Normalised here as well as in `createUserBody`, so a caller that skips the
    // schema cannot store a form that sign-in — which lowercases — never finds.
    email: normalizeEmail(input.email),
    name: input.name,
    passwordHash,
    locale: input.locale,
  });
  const id = adapter.insertId(res);
  await setUserRoles(id, input.roleIds ?? []);
  return id;
}

export interface UpdateUserInput {
  name?: string;
  locale?: string;
  disabled?: boolean;
  /** New password — hashed here. Omit/empty to keep the current one. */
  password?: string;
  roleIds?: number[];
}

export async function updateUser(id: number, patch: UpdateUserInput): Promise<void> {
  const db = getDb();
  const set: Record<string, unknown> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.locale !== undefined) set.locale = patch.locale;
  if (patch.disabled !== undefined) set.disabledAt = patch.disabled ? new Date() : null;
  if (patch.password) set.passwordHash = await hashPassword(patch.password);

  await db.transaction(async (tx) => {
    // The "don't strip the last superadmin" rule is enforced HERE, inside the
    // same transaction as the write and behind a row lock.
    //
    // The route used to check it separately, before calling this: with two
    // superadmins, two requests each disabling a different one both read
    // "there are 2" before either write landed, both passed, and the admin was
    // left with zero enabled superadmins and no way back in except the
    // database. Reading under `FOR UPDATE` makes the second request wait for
    // the first to commit and then see the real remaining count.
    //
    // There are TWO ways to strip the last superadmin, and this originally
    // guarded only the first. `disabled: true` locks the account; but so does
    // `roleIds` without the wildcard role — including `roleIds: []`, which
    // `assertCanGrant` waves through because an empty list grants nothing. Both
    // leave zero enabled superadmins, both are reachable from one PATCH, and
    // only one was refused. The equivalent hazard on role *definitions* has
    // always been guarded (`assertNotLastWildcard` in `roles/service.ts`).
    const touchesSuperadmin = patch.disabled === true || patch.roleIds !== undefined;
    if (touchesSuperadmin) {
      const roles = await tx
        .select({ id: schema.adminRoles.id, permissions: schema.adminRoles.permissions })
        .from(schema.adminRoles);
      const wildcardRoleIds = roles.filter((r) => (r.permissions ?? []).includes('*')).map((r) => r.id);

      // A role list that still includes a wildcard role leaves the account a
      // superadmin, so only the `disabled` flag can lock it out.
      const dropsWildcardRole =
        patch.roleIds !== undefined && !patch.roleIds.some((rid) => wildcardRoleIds.includes(rid));

      if (wildcardRoleIds.length && (patch.disabled === true || dropsWildcardRole)) {
        const locked = await tx
          .select({ userId: schema.adminUserRoles.userId })
          .from(schema.adminUserRoles)
          .innerJoin(schema.adminUsers, eq(schema.adminUsers.id, schema.adminUserRoles.userId))
          .where(
            and(
              inArray(schema.adminUserRoles.roleId, wildcardRoleIds),
              isNull(schema.adminUsers.disabledAt),
            ),
          )
          .for('update');
        const supers = [...new Set(locked.map((r) => r.userId))];
        if (supers.length <= 1 && supers.includes(id)) {
          throw new ApiError(
            'conflict',
            patch.disabled === true
              ? 'This is the last enabled superadmin — disabling it would lock everyone out of the admin.'
              : 'This is the last enabled superadmin — taking away its superadmin role would lock everyone out of the admin.',
          );
        }
      }
    }

    if (Object.keys(set).length) {
      await tx.update(schema.adminUsers).set(set).where(eq(schema.adminUsers.id, id));
    }
    if (patch.roleIds !== undefined) {
      await tx.delete(schema.adminUserRoles).where(eq(schema.adminUserRoles.userId, id));
      if (patch.roleIds.length) {
        await tx.insert(schema.adminUserRoles).values(patch.roleIds.map((roleId) => ({ userId: id, roleId })));
      }
    }
  });
}

/**
 * Delete an account outright.
 *
 * Until now the only way to take an account out of service was `disabled: true`,
 * which is the right default — it keeps the row, and with it the `created_by` /
 * `user_id` links that make the audit trail and every document's authorship
 * mean something. Deleting is the irreversible version, and it is offered
 * because disabling is not always enough: an account created in error, an
 * integration account that must actually go, and a test suite that could create
 * accounts through the API but never remove them, so orphans accumulated run
 * after run.
 *
 * **What deletion costs.** Every foreign key pointing at `admin_users` is
 * `ON DELETE SET NULL` — audit entries, documents, media, SEO rows, settings and
 * API tokens all keep their data but lose the name attached to it. That is why
 * the route records the account's email, name and roles in the audit entry
 * before calling this: the trail can still say who was removed even once the
 * individual rows can no longer say who wrote them. Prefer `disabled` when the
 * question is "should this person still have access"; use this when the question
 * is "should this row still exist".
 *
 * The lockout rule is the same one `updateUser` enforces, for the same reason
 * and in the same place — inside the transaction, behind `FOR UPDATE`. Deleting
 * the last enabled superadmin strands the admin exactly as disabling it would,
 * and checking outside the transaction lets two concurrent deletes of two
 * different superadmins both read "there are 2" and both commit.
 */
export async function deleteUser(id: number): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const roles = await tx
      .select({ id: schema.adminRoles.id, permissions: schema.adminRoles.permissions })
      .from(schema.adminRoles);
    const wildcardRoleIds = roles.filter((r) => (r.permissions ?? []).includes('*')).map((r) => r.id);

    if (wildcardRoleIds.length) {
      const locked = await tx
        .select({ userId: schema.adminUserRoles.userId })
        .from(schema.adminUserRoles)
        .innerJoin(schema.adminUsers, eq(schema.adminUsers.id, schema.adminUserRoles.userId))
        .where(
          and(
            inArray(schema.adminUserRoles.roleId, wildcardRoleIds),
            isNull(schema.adminUsers.disabledAt),
          ),
        )
        .for('update');
      const supers = [...new Set(locked.map((r) => r.userId))];
      if (supers.length <= 1 && supers.includes(id)) {
        throw new ApiError(
          'conflict',
          'This is the last enabled superadmin — deleting it would lock everyone out of the admin.',
        );
      }
    }

    // The role rows cascade on the delete below, but say so explicitly: the
    // cascade lives in the schema, and a database whose foreign keys were not
    // created (or were created without it) would otherwise leave assignments
    // pointing at an id that no longer exists.
    await tx.delete(schema.adminUserRoles).where(eq(schema.adminUserRoles.userId, id));
    await tx.delete(schema.adminUsers).where(eq(schema.adminUsers.id, id));
  });
}
