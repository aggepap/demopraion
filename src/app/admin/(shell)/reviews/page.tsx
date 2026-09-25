import { notFound } from 'next/navigation';

import { ReviewsTable } from '@/cms/admin';
import { isModuleEnabled } from '@/cms/core';
import { listReviews, reviewStats } from '@/cms/modules/commerce';
import { PERMISSIONS, requirePerm } from '@/cms/modules/auth';
import config from '@/site.config';

export const dynamic = 'force-dynamic';

export default async function ReviewsPage() {
  if (!(await isModuleEnabled(config, 'commerce'))) notFound();
  await requirePerm(PERMISSIONS.reviewsRead);

  // The moderation queue opens on what needs attention: pending reviews.
  const [pending, stats] = await Promise.all([listReviews({ status: 'pending' }), reviewStats()]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-neutral-900">Reviews</h1>
      <ReviewsTable
        initial={JSON.parse(JSON.stringify(pending.items))}
        // The counts the server already knows, so the pager is right on the first paint
        // rather than appearing only after a tab change.
        initialPageInfo={{
          total: pending.total,
          pageSize: pending.pageSize,
          pageCount: Math.max(1, Math.ceil(pending.total / pending.pageSize)),
        }}
        stats={JSON.parse(JSON.stringify(stats))}
      />
    </div>
  );
}
