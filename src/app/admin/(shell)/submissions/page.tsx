import { SubmissionsTable } from '@/cms/admin';
import { listSubmissions } from '@/cms/core/forms/service';
import { PERMISSIONS, requirePerm } from '@/cms/modules/auth';

export default async function SubmissionsPage() {
  await requirePerm(PERMISSIONS.formsRead);
  const initial = await listSubmissions({});
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-neutral-900">Submissions</h1>
      <SubmissionsTable initial={JSON.parse(JSON.stringify(initial))} />
    </div>
  );
}
