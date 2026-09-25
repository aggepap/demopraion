import { notFound } from 'next/navigation';

import { AbandonedCartsTable } from '@/cms/admin';
import { isModuleEnabled } from '@/cms/core';
import { listAbandoned } from '@/cms/modules/commerce';
import { PERMISSIONS, requirePerm } from '@/cms/modules/auth';
import config from '@/site.config';

export const dynamic = 'force-dynamic';

export default async function AbandonedCartsPage() {
  if (!(await isModuleEnabled(config, 'commerce'))) notFound();
  await requirePerm(PERMISSIONS.ordersRead);

  const pending = await listAbandoned({ status: 'pending' });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-neutral-900">Abandoned carts</h1>
      <AbandonedCartsTable
        initial={JSON.parse(JSON.stringify(pending.items))}
        // The counts the server already knows, so the pager is right on the first paint
        // rather than appearing only after a tab change.
        initialPageInfo={{
          total: pending.total,
          pageSize: pending.pageSize,
          pageCount: Math.max(1, Math.ceil(pending.total / pending.pageSize)),
        }}
      />
    </div>
  );
}
