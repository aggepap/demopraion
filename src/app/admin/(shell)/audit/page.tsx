import Link from 'next/link';
import { Fragment } from 'react';

import { Field, Table, Tbody, Td, Th, Thead } from '@/cms/admin';
import { adminHref } from '@/cms/admin/admin-path';
import { getAdminPath } from '@/cms/core/paths';
import { listAuditLogs } from '@/cms/core/audit';
import { AUDIT_ACTION_GROUPS } from '@/cms/core/audit-groups';
import { auditActionLabel, auditSubjectLabel } from '@/cms/core/audit-labels';
import { PERMISSIONS, requirePerm } from '@/cms/modules/auth';

export const dynamic = 'force-dynamic';

/**
 * The audit log, filtered and paged.
 *
 * It used to print the newest 200 entries as one unbroken table — several
 * thousand pixels tall, with no search, no filter and no way to reach anything
 * older. This is the screen someone opens with a single question in mind ("who
 * changed this, and when?"), and answering it meant scrolling and using the
 * browser's own find, on a page that might not even contain the answer.
 *
 * The controls are a plain GET form and ordinary links, so the filter state
 * lives in the URL: a particular view can be bookmarked, sent to a colleague,
 * or reloaded after following a link away. A client-side filter would have
 * given none of that, and this screen needs no client JavaScript at all.
 */
const control =
  'rounded-sm border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 ' +
  'placeholder:text-neutral-500 focus:border-warm-gold focus:outline-none focus:ring-1 focus:ring-warm-gold';

const pageLink =
  'min-h-[2.25rem] rounded-sm border border-neutral-300 bg-white px-3 py-2 text-sm font-medium ' +
  'text-neutral-800 hover:bg-neutral-50';

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; group?: string; page?: string }>;
}) {
  await requirePerm(PERMISSIONS.auditRead);
  const params = await searchParams;
  const search = params.q?.trim() ?? '';
  const subjectType = params.type?.trim() ?? '';
  const group = params.group?.trim() ?? '';
  const page = Math.max(1, Number(params.page) || 1);

  const { items, total, pageSize, subjectTypes } = await listAuditLogs({
    search,
    subjectType,
    group,
    page,
  });
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  const pageHref = (n: number) => {
    const qs = new URLSearchParams();
    if (search) qs.set('q', search);
    if (subjectType) qs.set('type', subjectType);
    if (group) qs.set('group', group);
    if (n > 1) qs.set('page', String(n));
    const q = qs.toString();
    return adminHref(getAdminPath(), `audit${q ? `?${q}` : ''}`);
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-neutral-900">Audit log</h1>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <Field
          label="Search"
          className="min-w-0 gap-1"
          description="Matches a person’s name, a record number, or an action’s technical name (hover an action in the table to see it)."
        >
          <input
            name="q"
            defaultValue={search}
            placeholder="Action, person or subject id"
            className={`${control} w-64 max-w-full`}
          />
        </Field>
        {/*
          The primary filter, and deliberately first: someone opening this
          screen is asking "show me the sign-ins", which is a question about
          what HAPPENED. The subject filter beside it answers a different
          question and used to be the only one on offer.
        */}
        <Field
          label="Activity"
          className="gap-1"
          description="What kind of thing happened: sign-ins, changes to users, content edits, and so on."
        >
          <select name="group" defaultValue={group} className={control}>
            <option value="">All activity</option>
            {AUDIT_ACTION_GROUPS.map((g) => (
              <option key={g.key} value={g.key}>
                {g.label}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Affected"
          className="gap-1"
          description="What kind of record it happened to. Combine with Activity to narrow it down further."
        >
          {/*
            The options used to be raw `subject_type` values — `admin_user`,
            `seo_redirect` — on a screen whose whole point is that a reader
            should not need to know the schema. The Action and Subject COLUMNS
            were translated a while ago; this dropdown was missed.
          */}
          <select name="type" defaultValue={subjectType} className={control}>
            <option value="">Anything</option>
            {subjectTypes.map((t) => (
              <option key={t} value={t}>
                {auditSubjectLabel(t)}
              </option>
            ))}
          </select>
        </Field>
        <button
          type="submit"
          className="min-h-[2.25rem] rounded-sm bg-warm-gold px-3.5 py-2 text-sm font-medium text-midnight-navy hover:bg-warm-gold-dark"
        >
          Filter
        </button>
        {search || subjectType || group ? (
          <Link href={adminHref(getAdminPath(), 'audit')} className={pageLink}>
            Clear
          </Link>
        ) : null}
      </form>

      <Table>
        <Thead>
          <tr>
            <Th info="Date and time in UTC (Coordinated Universal Time), not your local time.">
              When (UTC)
            </Th>
            <Th info="The admin user who did it. “system” means no signed-in user did, for example an automatic scheduled job.">
              Actor
            </Th>
            <Th info="What happened. Hover it to see the technical name, which is what Search matches.">Action</Th>
            <Th info="The record it happened to, and its number.">Subject</Th>
            <Th info="The internet address the request came from. Useful for spotting sign-ins from somewhere unexpected.">
              IP
            </Th>
          </tr>
        </Thead>
        <Tbody>
          {items.length ? (
            items.map((l) => {
              // Only rows that actually carry something get an expander, so the
              // table does not fill with disclosure triangles that open onto
              // nothing.
              const hasDetail =
                Boolean(l.ua) || l.before !== null || l.after !== null;
              return (
                <Fragment key={l.id}>
                  <tr className="hover:bg-neutral-50">
                    <Td className="whitespace-nowrap text-neutral-600">
                      {new Date(l.createdAt).toISOString().slice(0, 16).replace('T', ' ')}
                    </Td>
                    <Td>{l.userName ?? (l.userId ? `#${l.userId}` : 'system')}</Td>
                    {/*
                      The raw key stays available for anyone matching a log line to
                      code, but as a tooltip rather than as permanent noise beside
                      every human label — this screen is read daily by people who
                      have no reason to know what `auth.login.success` is.
                    */}
                    <Td title={l.action}>{auditActionLabel(l.action)}</Td>
                    {/*
                      Named the same way the Action column is. The raw type stays in the
                      tooltip, exactly as the action does, so nothing is hidden from anyone
                      who does know the schema.
                    */}
                    <Td className="text-neutral-600" title={l.subjectType ?? undefined}>
                      {l.subjectType
                        ? `${auditSubjectLabel(l.subjectType)}${l.subjectId ? ` #${l.subjectId}` : ''}`
                        : '—'}
                    </Td>
                    {/*
                      Recorded since this log existed and never once shown. "Who
                      changed this" was answerable; "from where" was not, and that
                      is the question that matters the moment the first answer is
                      surprising.
                    */}
                    <Td className="whitespace-nowrap font-mono text-xs text-neutral-600">
                      {l.ip ?? '—'}
                    </Td>
                  </tr>
                  {hasDetail ? (
                    <tr>
                      <Td colSpan={5} className="border-t-0 pt-0">
                        {/*
                          A native <details>, because this screen deliberately
                          ships no client JavaScript — the filter is a plain GET
                          form and the pager is ordinary links, so a row expander
                          should not be the one thing that needs hydration.
                        */}
                        <details className="text-xs text-neutral-600">
                          <summary className="cursor-pointer select-none py-1 text-neutral-700 hover:underline">
                            Details
                          </summary>
                          <dl className="mt-2 flex flex-col gap-2 border-l-2 border-neutral-200 pl-3">
                            {l.ua ? (
                              <div>
                                <dt className="font-medium text-neutral-700">Browser</dt>
                                <dd className="break-all font-mono">{l.ua}</dd>
                              </div>
                            ) : null}
                            {l.before !== null && l.before !== undefined ? (
                              <div>
                                <dt className="font-medium text-neutral-700">Before</dt>
                                <dd>
                                  <pre className="overflow-x-auto rounded-sm bg-neutral-100 p-2 font-mono">
                                    {JSON.stringify(l.before, null, 2)}
                                  </pre>
                                </dd>
                              </div>
                            ) : null}
                            {l.after !== null && l.after !== undefined ? (
                              <div>
                                <dt className="font-medium text-neutral-700">Details</dt>
                                <dd>
                                  <pre className="overflow-x-auto rounded-sm bg-neutral-100 p-2 font-mono">
                                    {JSON.stringify(l.after, null, 2)}
                                  </pre>
                                </dd>
                              </div>
                            ) : null}
                          </dl>
                        </details>
                      </Td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })
          ) : (
            <tr>
              <Td colSpan={5} className="py-6 text-center text-neutral-600">
                {search || subjectType || group
                  ? 'No entries match this filter.'
                  : 'No audit entries.'}
              </Td>
            </tr>
          )}
        </Tbody>
      </Table>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-neutral-600" aria-live="polite">
          {total === 0 ? 'No entries' : `Showing ${from}–${to} of ${total}`}
        </p>
        {lastPage > 1 ? (
          <nav aria-label="Audit log pages" className="flex items-center gap-2">
            {page > 1 ? (
              <Link href={pageHref(page - 1)} className={pageLink}>
                Previous
              </Link>
            ) : null}
            <span className="text-sm text-neutral-600">
              Page {page} of {lastPage}
            </span>
            {page < lastPage ? (
              <Link href={pageHref(page + 1)} className={pageLink}>
                Next
              </Link>
            ) : null}
          </nav>
        ) : null}
      </div>
    </div>
  );
}
