import { RolesManager } from '@/cms/admin';
import { ASSIGNABLE_PERMISSIONS, listRolesDetailed } from '@/cms/core/roles/service';
import { PERMISSIONS, requirePerm } from '@/cms/modules/auth';

export const dynamic = 'force-dynamic';

/**
 * Roles screen. Gated by `cms.roles.manage` — the same permission that already
 * guarded assigning a role to a user, since anyone who can do that can already
 * grant themselves the existing superadmin role.
 */
export default async function RolesPage() {
  const user = await requirePerm(PERMISSIONS.rolesManage);
  const roles = await listRolesDetailed();
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-neutral-900">Roles</h1>
      <RolesManager
        initial={JSON.parse(
          JSON.stringify({
            roles,
            assignable: ASSIGNABLE_PERMISSIONS,
            // What this user holds. The picker disables the rest, so a refusal is not the
            // first they hear of it after filling in the whole form (F-058's rule, applied
            // to the screen where permissions are defined rather than assigned).
            grantable: user.permissions,
          }),
        )}
      />
    </div>
  );
}
