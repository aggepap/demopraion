import { notFound } from 'next/navigation';

import { SubscribersTable } from '@/cms/admin';
import { isModuleEnabled } from '@/cms/core';
import { hasPerm, PERMISSIONS, requirePerm } from '@/cms/modules/auth';
import { listSubscribers } from '@/cms/modules/newsletter';
import config from '@/site.config';

/**
 * The newsletter list. Reachable only while the module is on — the sidebar
 * entry is hidden either way, but a bookmarked URL has to answer the same.
 *
 * Opens on `active`: the question this screen is usually asked is "who can we
 * write to", and the people who have left are the smaller, rarer view.
 */
export default async function NewsletterPage() {
  const user = await requirePerm(PERMISSIONS.newsletterRead);
  if (!(await isModuleEnabled(config, 'newsletter'))) notFound();

  const initial = await listSubscribers({ status: 'active' });
  const pageCount = Math.max(1, Math.ceil(initial.total / Math.max(1, initial.pageSize)));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">Newsletter</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Addresses captured by the footer band and the article sidebar cards, with the consent
          recorded for each.
        </p>
      </div>
      <SubscribersTable
        initial={initial.items}
        initialPageInfo={{ total: initial.total, pageSize: initial.pageSize, pageCount }}
        counts={initial.counts}
        canWrite={hasPerm(user.permissions, PERMISSIONS.newsletterWrite)}
      />
    </div>
  );
}
