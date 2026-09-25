import 'server-only';

import { eq } from 'drizzle-orm';

import { getDb, schema } from '../../db';
import { readSessionCookie, type SessionClaims } from './session';

export interface CurrentUser extends SessionClaims {
  /**
   * Epoch seconds this session dies, set by `requireApiAuth` only.
   *
   * Absent on the page-guard path, which reads the cookie without deciding
   * anything about its lifetime. `/auth/me` passes it to the browser so the
   * idle watcher can sign out while the cookie is still valid — otherwise its
   * logout request 401s and the event never reaches the audit log.
   */
  sessionExpiresAt?: number;
}

/** Identity from the session JWT — fast, no DB hit. Use for page chrome. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  return readSessionCookie();
}

/**
 * Load a user with their merged permission set fresh from the DB. This is the
 * authority for permission checks (guards call it), so a role change takes
 * effect on the next request rather than after the JWT expires (fixes v1
 * stale-permissions, BACKEND.md §13.13). Returns null if disabled/deleted.
 */
export async function loadUserPermissions(
  userId: number,
): Promise<{ user: typeof schema.adminUsers.$inferSelect; permissions: string[] } | null> {
  const db = getDb();
  const [user] = await db
    .select()
    .from(schema.adminUsers)
    .where(eq(schema.adminUsers.id, userId))
    .limit(1);
  if (!user || user.disabledAt) return null;

  const roleRows = await db
    .select({ permissions: schema.adminRoles.permissions })
    .from(schema.adminUserRoles)
    .innerJoin(schema.adminRoles, eq(schema.adminRoles.id, schema.adminUserRoles.roleId))
    .where(eq(schema.adminUserRoles.userId, userId));

  const permissions = Array.from(new Set(roleRows.flatMap((row) => row.permissions ?? [])));
  return { user, permissions };
}
