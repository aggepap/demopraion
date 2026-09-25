import { notFound } from 'next/navigation';

import { OrdersTable } from '@/cms/admin';
import { isModuleEnabled } from '@/cms/core';
import { getSiteCurrency, listOrders, orderStats } from '@/cms/modules/commerce';
import { hasPerm, PERMISSIONS, requirePerm } from '@/cms/modules/auth';
import config from '@/site.config';

export const dynamic = 'force-dynamic';

export default async function OrdersPage() {
  if (!(await isModuleEnabled(config, 'commerce'))) notFound();
  const user = await requirePerm(PERMISSIONS.ordersRead);
  // The sidebar shows this screen on `ordersRead` alone, so a read-only role
  // reaches it — and every write control on it would be refused.
  const canWrite = hasPerm(user.permissions, PERMISSIONS.ordersWrite);

  const [initial, stats, currency] = await Promise.all([listOrders({}), orderStats(), getSiteCurrency()]);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-neutral-900">Orders</h1>
      <OrdersTable
        initial={JSON.parse(JSON.stringify(initial))}
        stats={JSON.parse(JSON.stringify(stats))}
        currency={currency}
        canWrite={canWrite}
      />
    </div>
  );
}
