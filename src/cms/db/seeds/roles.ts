/**
 * Default role seeds. Idempotent (matched by unique `name`). `superadmin` holds
 * the `*` wildcard; `editor` gets a sensible content-focused set using the real
 * read/write split.
 *
 * Only `superadmin` is re-synced on every run — it is `*` and nothing else, so
 * there is nothing an admin could have customised. `editor` is created when
 * missing and otherwise left alone: this runs on every `db:seed-admin`, and it
 * used to overwrite the editor's permission list each time, silently reverting
 * whatever had been changed on the Roles screen. Adding only newly introduced
 * default permissions was the alternative, but without a record of which
 * defaults a site has already seen it would also re-add ones an admin had
 * deliberately removed — so a new permission reaches an existing `editor` by
 * someone ticking it on the Roles screen.
 */
import { eq } from 'drizzle-orm';

import { PERMISSIONS } from '../../modules/auth/permissions';
import { getMysqlDb } from '../adapters/mysql/client';
import { adminRoles } from '../adapters/mysql/schema';

export interface DefaultRole {
  name: string;
  permissions: string[];
  /** Overwrite the stored permissions on every run. Only safe for a role nobody can customise. */
  sync?: boolean;
}

export const DEFAULT_ROLES: DefaultRole[] = [
  { name: 'superadmin', permissions: ['*'], sync: true },
  {
    name: 'editor',
    permissions: [
      PERMISSIONS.access,
      PERMISSIONS.contentRead,
      PERMISSIONS.contentWrite,
      PERMISSIONS.contentPublish,
      PERMISSIONS.mediaRead,
      PERMISSIONS.mediaWrite,
      PERMISSIONS.seoRead,
      PERMISSIONS.seoWrite,
      PERMISSIONS.formsRead,
      // Read, not write: an editor should see who signed up, but erasing an
      // address (and the consent record with it) is not an editorial act.
      PERMISSIONS.newsletterRead,
      PERMISSIONS.ordersRead,
      PERMISSIONS.ordersWrite,
      PERMISSIONS.reviewsRead,
      PERMISSIONS.reviewsWrite,
      PERMISSIONS.reservationsRead,
      PERMISSIONS.reservationsWrite,
      PERMISSIONS.scheduleRead,
      PERMISSIONS.scheduleWrite,
    ],
  },
];

/** What the seed does with one default role, given whether a role of that name exists. */
export function planRoleSeed(role: DefaultRole, exists: boolean): 'insert' | 'update' | 'keep' {
  if (!exists) return 'insert';
  return role.sync ? 'update' : 'keep';
}

export async function seedRoles(
  db: ReturnType<typeof getMysqlDb> = getMysqlDb(),
): Promise<{ created: number; updated: number; kept: number }> {
  let created = 0;
  let updated = 0;
  let kept = 0;
  for (const role of DEFAULT_ROLES) {
    const [existing] = await db
      .select({ id: adminRoles.id })
      .from(adminRoles)
      .where(eq(adminRoles.name, role.name))
      .limit(1);
    const action = planRoleSeed(role, Boolean(existing));
    if (action === 'update' && existing) {
      await db.update(adminRoles).set({ permissions: role.permissions }).where(eq(adminRoles.id, existing.id));
      updated++;
    } else if (action === 'insert') {
      await db.insert(adminRoles).values({ name: role.name, permissions: role.permissions });
      created++;
    } else {
      kept++;
    }
  }
  return { created, updated, kept };
}
