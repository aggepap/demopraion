import { notFound } from 'next/navigation';

import { CustomersTable } from '@/cms/admin';
import { isModuleEnabled } from '@/cms/core';
import { hasPerm, PERMISSIONS, requirePerm } from '@/cms/modules/auth';
import { listCustomers } from '@/cms/modules/customers';
import config from '@/site.config';

export const dynamic = 'force-dynamic';

export default async function CustomersPage() {
  if (!(await isModuleEnabled(config, 'customers'))) notFound();
  const user = await requirePerm(PERMISSIONS.customersRead);
  // The sidebar shows this screen on `customersRead` alone, so a read-only role
  // reaches it; the write controls are hidden AND refused server-side.
  const canWrite = hasPerm(user.permissions, PERMISSIONS.customersWrite);

  const result = await listCustomers({});
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-neutral-900">Customers</h1>
      <CustomersTable
        initial={JSON.parse(JSON.stringify(result.items))}
        initialTotal={result.total}
        canWrite={canWrite}
      />
    </div>
  );
}
