import { UsersManager } from '@/cms/admin';
import { listRoles, listUsers } from '@/cms/core/users/service';
import { PERMISSIONS, requirePerm } from '@/cms/modules/auth';

export default async function UsersPage() {
  const me = await requirePerm(PERMISSIONS.usersManage);
  const [users, roles] = await Promise.all([listUsers(), listRoles()]);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-neutral-900">Users</h1>
      {/*
        Who is looking, so the screen can leave the Delete control off its own
        row. The server refuses that delete regardless (409), but offering a
        button whose only outcome is an error message is a worse way to say
        "not this one" than not offering it.
      */}
      <UsersManager currentUserId={me.userId} initial={JSON.parse(JSON.stringify({ users, roles }))} />
    </div>
  );
}
