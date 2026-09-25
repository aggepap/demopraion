import { notFound } from 'next/navigation';

import { GiftCardsTable } from '@/cms/admin';
import { isModuleEnabled } from '@/cms/core';
import { hasPerm, PERMISSIONS, requirePerm } from '@/cms/modules/auth';
import { getGiftCardConfig } from '@/cms/modules/commerce';
import { getDb, schema } from '@/cms/db';
import config from '@/site.config';
import { desc } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export default async function GiftCardsPage() {
  if (!(await isModuleEnabled(config, 'commerce'))) notFound();
  const { enabled } = await getGiftCardConfig();
  // Off means the screen does not exist, not an empty table with a hint.
  if (!enabled) notFound();

  const user = await requirePerm(PERMISSIONS.ordersRead);
  const canWrite = hasPerm(user.permissions, PERMISSIONS.ordersWrite);

  const rows = await getDb()
    .select()
    .from(schema.giftCards)
    .orderBy(desc(schema.giftCards.id))
    .limit(200);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-neutral-900">Gift cards</h1>
      <GiftCardsTable
        initial={JSON.parse(
          JSON.stringify(
            rows.map((row) => ({
              id: row.id,
              codeLast4: row.codeLast4,
              currency: row.currency,
              initialAmount: row.initialAmount,
              balance: row.balance,
              status: row.status,
              expiresAt: row.expiresAt,
              recipientEmail: row.recipientEmail,
              sendAt: row.sendAt,
              sentAt: row.sentAt,
              createdAt: row.createdAt,
            }))
          )
        )}
        canWrite={canWrite}
      />
    </div>
  );
}
