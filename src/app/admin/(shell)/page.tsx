import Link from 'next/link';

import config from '@/site.config';
import { getBrand } from '@/cms/core/brand';
import { collectionSummary, Icon, InfoTip, labelText, visibleAdminCollections } from '@/cms/admin';
import { resolveModuleFlags } from '@/cms/core';
import { listDocumentGroups } from '@/cms/core/documents/service';
import { listSubmissions } from '@/cms/core/forms/service';
import { hasPerm, PERMISSIONS, requirePerm } from '@/cms/modules/auth';
import { adminHref } from '@/cms/admin/admin-path';
import { collectionIcon } from '@/cms/admin/ui/icon-names';
import { getAdminPath } from '@/cms/core/paths';

export const dynamic = 'force-dynamic';

/**
 * How many DOCUMENTS a collection holds — not how many rows.
 *
 * `listDocuments` counts one row per locale, so the dashboard said "6 items"
 * for the same collection whose list screen said "3 total". Two different
 * answers to "how many articles do I have", one click apart. The list screen
 * groups by translation group; this has to do the same.
 */
async function countOf(type: string): Promise<number> {
  try {
    return (await listDocumentGroups(type, { pageSize: 1, defaultLocale: config.defaultLocale })).total;
  } catch {
    return 0;
  }
}

/**
 * How many of a collection are waiting for someone to do something.
 *
 * The dashboard said only how many items exist, which is a fact nobody acts on: it does
 * not answer the question a person opens this screen with, which is "what needs me
 * today". Drafts are the answer that costs nothing to find — the same grouped count with
 * a status filter.
 */
async function draftCountOf(type: string): Promise<number> {
  try {
    return (
      await listDocumentGroups(type, {
        pageSize: 1,
        status: 'draft',
        defaultLocale: config.defaultLocale,
      })
    ).total;
  } catch {
    return 0;
  }
}

export default async function DashboardPage() {
  // The dashboard IS the admin root, so the literal was right by accident —
  // `getAdminPath()` keeps it right if `ADMIN_PATH` ever moves the admin, the
  // way every other redirect in `guards.ts` already does.
  const adminPath = getAdminPath();
  const user = await requirePerm(PERMISSIONS.access, adminHref(adminPath));
  const locale = user.locale || config.defaultLocale;
  const moduleFlags = await resolveModuleFlags(config);
  const { name: siteName } = await getBrand(config.brand);

  const collections = visibleAdminCollections(config.collections.map(collectionSummary), moduleFlags);

  const [counts, drafts] = await Promise.all([
    Promise.all(collections.map((c) => countOf(c.key))),
    Promise.all(collections.map((c) => draftCountOf(c.key))),
  ]);

  const canForms = hasPerm(user.permissions, PERMISSIONS.formsRead);
  const recent = canForms ? (await listSubmissions({ pageSize: 6 })).items : [];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-2xl font-semibold text-neutral-900">{siteName}</h1>
        <p className="text-sm text-neutral-600">Manage your site content.</p>
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-1.5">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-600">Content</h2>
          <InfoTip label="About these counts">
            Each item is counted once, however many languages it has. “In draft” counts items with at
            least one language still a draft, which visitors do not see.
          </InfoTip>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {collections.map((c, i) => (
            <div key={c.key} className="rounded-sm border border-neutral-200 bg-white p-4">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-sm bg-warm-gold/15 text-warm-gold-deep">
                  <Icon name={collectionIcon(c.icon, c.key)} size={18} />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-neutral-900">
                    {labelText(c.labelPlural, locale, c.key)}
                  </div>
                  <div className="text-xs text-neutral-600">
                    {counts[i]} {counts[i] === 1 ? 'item' : 'items'}
                    {drafts[i] > 0 ? (
                      // The only part of this card anyone acts on.
                      <> · <span className="text-warm-gold-deep">{drafts[i]} in draft</span></>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2 text-sm">
                <Link href={adminHref(adminPath, c.key)} className="-my-1.5 py-1.5 text-warm-gold-deep hover:underline">
                  View
                </Link>
                <span className="text-neutral-600">·</span>
                <Link
                  href={adminHref(adminPath, `${c.key}/new`)}
                  className="-my-1.5 inline-flex items-center gap-1 py-1.5 text-neutral-600 hover:text-neutral-900"
                >
                  <Icon name="plus" size={13} /> New
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>

      {canForms ? (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-600">
                Recent submissions
              </h2>
              <InfoTip label="About recent submissions">
                The latest messages sent through your site’s forms. Open one to see everything that person
                sent, under Submissions.
              </InfoTip>
            </div>
            <Link href={adminHref(adminPath, 'submissions')} className="-my-1 py-1 text-xs text-warm-gold-deep hover:underline">
              View all →
            </Link>
          </div>
          {recent.length ? (
            <div className="overflow-hidden rounded-sm border border-neutral-200 bg-white">
              <ul className="divide-y divide-neutral-100">
                {recent.map((s) => (
                  <li key={s.id}>
                    {/*
                      A row you can read is a row you should be able to open. Seeing a new
                      enquiry here and then having to go to "View all" and find it again by
                      eye is a small tax paid every single time.
                    */}
                    <Link
                      href={adminHref(adminPath, `submissions?search=${encodeURIComponent(s.email)}`)}
                      className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-neutral-50"
                    >
                      <span className="w-24 shrink-0 text-neutral-600">
                        {new Date(s.createdAt).toISOString().slice(0, 10)}
                      </span>
                      <span className="w-24 shrink-0 truncate text-neutral-600">{s.formType}</span>
                      <span className="min-w-0 flex-1 truncate">{s.email}</span>
                      <span className="shrink-0 text-xs text-neutral-600">{s.status}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="rounded-sm border border-dashed border-neutral-300 px-4 py-8 text-center text-sm text-neutral-600">
              No submissions yet.
            </p>
          )}
        </section>
      ) : null}
    </div>
  );
}
