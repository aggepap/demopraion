'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { cmsApi, CmsApiError } from './api-client';
import { payloadFields } from './payload-fields';
import { InfoTip } from './ui';

/** What a column shows when the form did not ask for that value. */
const EMPTY = '—';

const STATUSES = ['new', 'handled', 'archived', 'spam'] as const;
type Status = (typeof STATUSES)[number];

/**
 * What the statuses mean. They only sort the list for whoever triages it —
 * nothing is sent, hidden or deleted by choosing one — and nothing said so.
 */
const STATUS_HELP =
  'new — not looked at yet. handled — answered or dealt with. archived — kept for the record, no longer needs anything. spam — junk. The status only sorts this list; nothing is sent or deleted.';
const SOURCE_HELP =
  'The page the visitor sent the form from, as reported by their browser. Empty when the browser did not say.';

const STATUS_COLORS: Record<string, string> = {
  new: 'bg-blue-100 text-blue-800',
  handled: 'bg-green-100 text-green-800',
  archived: 'bg-neutral-100 text-neutral-600',
  spam: 'bg-red-100 text-red-700',
};

interface SubmissionRow {
  id: number;
  formType: string;
  email: string;
  status: Status;
  emailStatus: string;
  sourcePageSlug: string | null;
  sourceLocale: string | null;
  createdAt: string;
}

interface SubmissionsResult {
  items: SubmissionRow[];
  page: number;
  pageSize: number;
  total: number;
  types: string[];
}

interface SubmissionDetail extends SubmissionRow {
  payload: Record<string, unknown>;
  referrerUrl: string | null;
  ua: string | null;
  emailError: string | null;
  notes: string | null;
}

const inputClass =
  'rounded-sm border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-warm-gold focus:outline-none focus:ring-1 focus:ring-warm-gold';

export function SubmissionsTable({ initial }: { initial: SubmissionsResult }) {
  const [data, setData] = useState<SubmissionsResult | null>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * The filters live in the URL.
   *
   * All four were component state, so an agent who narrowed the list to "new only" lost it
   * on any reload and could not send it to a colleague — and the list came back unfiltered
   * with nothing to say it had changed, which is the part that costs real time. The audit
   * log in the same app already does this properly, with a plain GET form.
   */
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [formType, setFormType] = useState(searchParams.get('type') ?? '');
  const [status, setStatus] = useState(searchParams.get('status') ?? '');
  const [search, setSearch] = useState(searchParams.get('search') ?? '');
  const [page, setPage] = useState(Number(searchParams.get('page')) || 1);

  /*
   * `replace`, not `push`: narrowing a filter is not a place someone wants to go "back" to
   * one step at a time, and `scroll: false` keeps the list where they were reading it.
   */
  function syncUrl(next: { type?: string; status?: string; search?: string; page?: number }) {
    const params = new URLSearchParams();
    const type = next.type ?? formType;
    const st = next.status ?? status;
    const q = next.search ?? search;
    const p = next.page ?? page;
    if (type) params.set('type', type);
    if (st) params.set('status', st);
    if (q) params.set('search', q);
    if (p > 1) params.set('page', String(p));
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const [selected, setSelected] = useState<SubmissionDetail | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // The server already provided the unfiltered first page; skip the mount
  // fetch and only refetch on a filter/page change or an explicit reload.
  const isFirst = useRef(true);
  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    cmsApi
      .listSubmissions<SubmissionsResult>({ formType, status, search, page })
      .then((res) => {
        if (active) setData(res.data);
      })
      .catch((e) => {
        if (active) setError(e instanceof CmsApiError ? e.message : 'Failed to load');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [formType, status, search, page, reloadKey]);

  async function openDetail(id: number) {
    try {
      const res = await cmsApi.getSubmission<SubmissionDetail>(id);
      setSelected(res.data);
    } catch {
      /* ignore */
    }
  }

  async function patch(id: number, body: { status?: Status; notes?: string }) {
    const res = await cmsApi.updateSubmission<SubmissionDetail>(id, body);
    setSelected(res.data);
    setReloadKey((k) => k + 1);
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-neutral-600">
          Type
          <select
            className={inputClass}
            value={formType}
            onChange={(e) => {
              setPage(1);
              setFormType(e.target.value);
              syncUrl({ type: e.target.value, page: 1 });
            }}
          >
            <option value="">All</option>
            {data?.types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-600">
          <span className="flex items-center gap-1">
            Status
            <InfoTip label="About statuses">{STATUS_HELP}</InfoTip>
          </span>
          <select
            className={inputClass}
            value={status}
            onChange={(e) => {
              setPage(1);
              setStatus(e.target.value);
              syncUrl({ status: e.target.value, page: 1 });
            }}
          >
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-600">
          Search
          <input
            className={inputClass}
            placeholder="email or source…"
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
              syncUrl({ search: e.target.value, page: 1 });
            }}
          />
        </label>
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <div
        tabIndex={0}
        role="group"
        aria-label="Submissions table, scrollable"
        className="focus-visible:ring-warm-gold min-w-0 overflow-x-auto rounded-sm border border-neutral-200 focus:outline-none focus-visible:ring-2"
      >
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs text-neutral-600 uppercase">
            <tr>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">
                <span className="inline-flex items-center gap-1">
                  Source
                  <InfoTip label="About the source">{SOURCE_HELP}</InfoTip>
                </span>
              </th>
              <th className="px-3 py-2">Status</th>
              <th className="relative px-3 py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-neutral-600">
                  Loading…
                </td>
              </tr>
            ) : data && data.items.length > 0 ? (
              data.items.map((s) => (
                <tr key={s.id} className="hover:bg-neutral-50">
                  <td className="px-3 py-2 whitespace-nowrap text-neutral-600">
                    {new Date(s.createdAt).toISOString().slice(0, 10)}
                  </td>
                  <td className="px-3 py-2">{s.formType}</td>
                  <td className="px-3 py-2">{s.email || EMPTY}</td>
                  <td className="px-3 py-2 text-neutral-600">{s.sourcePageSlug ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${STATUS_COLORS[s.status] ?? 'bg-neutral-100'}`}
                    >
                      {s.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => openDetail(s.id)}
                      className="text-xs text-neutral-700 hover:underline"
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-neutral-600">
                  No submissions.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {data && data.total > data.pageSize ? (
        <div className="flex items-center justify-between text-sm text-neutral-600">
          <span>
            {data.total} total · page {data.page}/{totalPages}
          </span>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => {
                setPage((p) => p - 1);
                syncUrl({ page: page - 1 });
              }}
              className="rounded border border-neutral-300 px-3 py-1 disabled:opacity-40"
            >
              Prev
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => {
                setPage((p) => p + 1);
                syncUrl({ page: page + 1 });
              }}
              className="rounded border border-neutral-300 px-3 py-1 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      ) : null}

      {selected ? (
        <SubmissionDetailPanel
          detail={selected}
          onClose={() => setSelected(null)}
          onPatch={patch}
        />
      ) : null}
    </div>
  );
}

/**
 * What the visitor actually filled in.
 *
 * This was `JSON.stringify(payload, null, 2)` in a `<pre>`: a triager read an
 * enquiry as source code, with the message — the only part that needs reading
 * carefully — wrapped inside a scroll box and its Greek escaped.
 *
 * The ordering and the value classification are in `payload-fields`, which is
 * unit-tested; this only draws the result. The raw JSON stays reachable below,
 * because a rendering that guesses at untyped data must never be the only way
 * to see what is stored.
 */
function PayloadView({ payload }: { payload: Record<string, unknown> }) {
  const fields = payloadFields(payload);

  if (fields.length === 0) {
    return <p className="mb-4 text-sm text-neutral-600">No fields were recorded.</p>;
  }

  return (
    <div className="mb-4">
      <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-2 rounded-sm border border-neutral-200 p-3 text-sm">
        {fields.map((f) =>
          f.kind === 'block' ? (
            // Prose gets the full width and its own line breaks kept — the
            // message is the field a reply is written from.
            <div key={f.key} className="col-span-2">
              <dt className="mb-1 text-neutral-600">{f.label}</dt>
              <dd className="rounded-sm bg-neutral-50 p-2 break-words whitespace-pre-wrap text-neutral-900">
                {f.text}
              </dd>
            </div>
          ) : (
            // `contents` so the dt/dd still land in the parent grid. Every group
            // is wrapped: a `dl` takes bare dt/dd groups OR div-wrapped ones,
            // never a mix, and the block branch above has to be a div.
            <div key={f.key} className="contents">
              <dt className="break-words text-neutral-600">{f.label}</dt>
              <dd className="min-w-0 break-words text-neutral-900">
                {f.kind === 'list' ? (
                  <ul className="flex flex-wrap gap-1">
                    {f.items?.map((item, i) => (
                      <li
                        key={`${i}-${item}`}
                        className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs"
                      >
                        {item}
                      </li>
                    ))}
                  </ul>
                ) : f.href ? (
                  <a
                    href={f.href}
                    // Only `url` leaves the admin; mailto:/tel: hand off to a
                    // local app and must not open a blank tab.
                    target={f.kind === 'url' ? '_blank' : undefined}
                    rel={f.kind === 'url' ? 'noopener noreferrer' : undefined}
                    className="text-warm-gold-deep hover:underline"
                  >
                    {f.text}
                  </a>
                ) : (
                  f.text
                )}
              </dd>
            </div>
          )
        )}
      </dl>

      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-neutral-600 hover:text-neutral-900">
          Raw JSON
        </summary>
        <p className="mt-1 text-xs text-neutral-600">
          Exactly what the form sent, field names included — useful when a value is missing above.
        </p>
        <pre className="mt-1 max-h-64 overflow-auto rounded-sm bg-neutral-50 p-3 text-xs">
          {JSON.stringify(payload, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function SubmissionDetailPanel({
  detail,
  onClose,
  onPatch,
}: {
  detail: SubmissionDetail;
  onClose: () => void;
  onPatch: (id: number, body: { status?: Status; notes?: string }) => Promise<void>;
}) {
  const [notes, setNotes] = useState(detail.notes ?? '');
  const [saving, setSaving] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="h-full w-full max-w-lg overflow-y-auto bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {detail.formType} · #{detail.id}
          </h2>
          <button onClick={onClose} className="text-neutral-600 hover:text-neutral-700">
            ✕
          </button>
        </div>

        <dl className="mb-4 grid grid-cols-[7rem_1fr] gap-y-1 text-sm">
          <dt className="text-neutral-600">Email</dt>
          <dd>
            {/*
              A triager's next action is almost always "reply to this person", and the
              address was plain text — they had to select it and copy it by hand.

              Not every form asks for one: the ΔΕΘ questionnaire's email field is
              optional, and `form_submissions.email` is NOT NULL, so those rows
              carry ''. Wrapping that in an anchor produced a zero-width,
              clickable `mailto:` — a link to nowhere that a triager could not
              see but could still hit.
            */}
            {detail.email ? (
              <a href={`mailto:${detail.email}`} className="text-warm-gold-deep hover:underline">
                {detail.email}
              </a>
            ) : (
              EMPTY
            )}
          </dd>
          <dt className="text-neutral-600">Date</dt>
          <dd>{new Date(detail.createdAt).toISOString().slice(0, 16).replace('T', ' ')} UTC</dd>
          <dt className="flex items-center gap-1 text-neutral-600">
            Source
            <InfoTip label="About the source">{SOURCE_HELP}</InfoTip>
          </dt>
          <dd>
            {detail.sourcePageSlug ?? '—'} {detail.sourceLocale ? `(${detail.sourceLocale})` : ''}
          </dd>
          <dt className="text-neutral-600">Notification</dt>
          <dd>
            {/*
              Was the raw exception, verbatim. Every submission in an environment without
              mail credentials showed "failed — Error: Missing email env vars:
              AZURE_TENANT_ID, AZURE_CLIENT_ID, …" to whoever opened it: meaningless to a
              triager, nothing they can act on, and an inventory of infrastructure names
              on a screen that does not need them. The detail stays in the tooltip for
              whoever is actually debugging it.
            */}
            {detail.emailStatus === 'sent' ? (
              <span className="text-green-700">Sent to the team</span>
            ) : detail.emailStatus === 'failed' ? (
              <span className="text-amber-800" title={detail.emailError ?? undefined}>
                Not sent — nobody was notified, so this one needs a reply
              </span>
            ) : detail.emailStatus === 'skipped' ? (
              <span className="text-neutral-600">Not sent (notifications are off)</span>
            ) : (
              <span className="text-neutral-600">Sending…</span>
            )}
          </dd>
        </dl>

        <h3 className="mb-1 text-sm font-semibold text-neutral-700">Form entries</h3>
        <PayloadView payload={detail.payload} />

        <div className="mb-3">
          <span className="mb-1 flex items-center gap-1 text-sm font-semibold text-neutral-700">
            Status
            <InfoTip label="About statuses">{STATUS_HELP}</InfoTip>
          </span>
          <div className="flex flex-wrap gap-2">
            {STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => onPatch(detail.id, { status: s })}
                className={`rounded px-2 py-1 text-xs ${
                  detail.status === s ? 'ring-2 ring-neutral-900' : ''
                } ${STATUS_COLORS[s] ?? 'bg-neutral-100'}`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/*
          `htmlFor`/`id`, so clicking the word focuses the box and a screen reader says
          what the box is for. F-003 fixed this in the document form and the login screen;
          this panel was written separately and never got it.
        */}
        <div className="mb-2 flex items-center gap-1">
          <label htmlFor="submission-notes" className="block text-sm font-semibold text-neutral-700">
            Notes
          </label>
          <InfoTip label="About notes">
            For your team only: never sent to the person or shown on the site.
          </InfoTip>
        </div>
        <textarea
          id="submission-notes"
          className="w-full rounded-sm border border-neutral-300 px-3 py-2 text-sm"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <button
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            await onPatch(detail.id, { notes });
            setSaving(false);
          }}
          className="bg-warm-gold text-midnight-navy hover:bg-warm-gold-dark mt-2 rounded-sm px-3 py-2 text-sm font-medium disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save notes'}
        </button>
      </div>
    </div>
  );
}
