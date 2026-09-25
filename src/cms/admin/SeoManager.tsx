'use client';

import { useState } from 'react';

import { cmsApi } from './api-client';
import { apiErrorText } from './api-error-text';
import { Field, InfoTip } from './ui';
import { useConfirm } from './ui/ConfirmDialog';

const REDIRECT_KINDS = ['literal', 'wildcard', 'regex'] as const;
const STATUS_CODES = [301, 302, 307, 308] as const;

/**
 * What each status code means, in the words someone choosing one needs.
 * Exported so the tests can hold every code to having one.
 */
export const STATUS_CODE_HELP: Record<(typeof STATUS_CODES)[number], { short: string; help: string }> = {
  301: {
    short: 'permanent',
    help: 'Permanent move. Browsers remember it and search engines move the old page’s ranking to the new address. The usual choice.',
  },
  302: {
    short: 'temporary',
    help: 'Temporary move. Search engines keep the old address in their results, because it is expected to come back.',
  },
  307: {
    short: 'temporary, keeps method',
    help: 'Temporary, like 302, but a form submission is sent on unchanged instead of becoming a plain page visit.',
  },
  308: {
    short: 'permanent, keeps method',
    help: 'Permanent, like 301, but a form submission is sent on unchanged instead of becoming a plain page visit.',
  },
};

const STATUS_CODE_TIP = (
  <>
    {STATUS_CODES.map((c) => (
      <span key={c} className="block">
        <strong>{c}</strong> — {STATUS_CODE_HELP[c].help}
      </span>
    ))}
  </>
);

interface Redirect {
  id: number;
  source: string;
  target: string;
  statusCode: number;
  kind: string;
  active: boolean;
  hits: number;
  notes: string | null;
}

interface NotFound {
  id: number;
  path: string;
  locale: string | null;
  hits: number;
  lastSeen: string;
  ignored: boolean;
}

interface MetaRow {
  id: number;
  path: string;
  locale: string;
  title: string | null;
  description: string | null;
  robots: string | null;
  canonical: string | null;
  ogImage: string | null;
}

const input = 'rounded-sm border border-neutral-300 bg-white px-2 py-1.5 text-sm focus:border-warm-gold focus:outline-none focus:ring-1 focus:ring-warm-gold';

/** How many rows of each table are shown before "Show more". */
const PAGE = 25;

/** Case-insensitive substring match over whichever fields a row can be found by. */
function matches(query: string, ...fields: (string | null | undefined)[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => (f ?? '').toLowerCase().includes(q));
}

/**
 * Search box above a table, with a live count of what is on screen.
 *
 * The count is announced (`aria-live`) because filtering a table gives no other
 * signal to anyone who cannot see rows disappear — and "0 of 143" is the answer
 * to a search that found nothing, which is otherwise indistinguishable from a
 * table that failed to load.
 */
function SearchBox({
  label,
  value,
  onChange,
  shown,
  total,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  shown: number;
  total: number;
}) {
  const id = label.toLowerCase().replace(/[^a-z]+/g, '-');
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        type="search"
        className={`${input} w-full min-w-[14rem] sm:w-64`}
        placeholder={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <p className="text-xs text-neutral-600" aria-live="polite">
        Showing {shown} of {total}
      </p>
    </div>
  );
}

export function SeoManager({
  redirects: initialRedirects,
  notFounds: initialNotFounds,
  metas: initialMetas,
}: {
  redirects: Redirect[];
  notFounds: NotFound[];
  metas: MetaRow[];
}) {
  const [redirects, setRedirects] = useState(initialRedirects);
  const [notFounds, setNotFounds] = useState(initialNotFounds);
  const [metas, setMetas] = useState(initialMetas);
  /** Surfaces refusals from any action on this screen. */
  const [error, setError] = useState<string | null>(null);
  /*
   * All three delete buttons on this screen fired straight from the click, with
   * nothing in between — while the Cookies screen next door already asked first.
   * Deleting a redirect is the one that actually costs something: a live path
   * stops redirecting and starts 404ing for everyone, and there is no undo. The
   * rows are dense and the buttons sit right next to "ignore" and "→ redirect".
   */
  const { confirm, dialog } = useConfirm();

  /*
    Search + a visible cap on all three tables.

    Each one printed every row it had, in document order, with no way to look
    anything up. On a real site the 404 monitor is the longest list in the admin
    — every mistyped link anyone ever followed — and finding one path meant
    scrolling past hundreds and using the browser's own find. The redirect and
    meta tables grow the same way, just slower.

    Filtering here rather than on the server is deliberate: all three lists are
    already fully loaded as props, so a keystroke costs nothing and needs no
    round trip. The cap is what keeps the page short; "Show more" raises it.
  */
  const [redirectQ, setRedirectQ] = useState('');
  const [notFoundQ, setNotFoundQ] = useState('');
  const [metaQ, setMetaQ] = useState('');
  const [redirectShown, setRedirectShown] = useState(PAGE);
  const [notFoundShown, setNotFoundShown] = useState(PAGE);
  const [metaShown, setMetaShown] = useState(PAGE);

  const matchedRedirects = redirects.filter((r) => matches(redirectQ, r.source, r.target, r.notes));
  const matchedNotFounds = notFounds.filter((nf) => matches(notFoundQ, nf.path, nf.locale));
  const matchedMetas = metas.filter((m) => matches(metaQ, m.path, m.locale, m.title));
  const visibleRedirects = matchedRedirects.slice(0, redirectShown);
  const visibleNotFounds = matchedNotFounds.slice(0, notFoundShown);
  const visibleMetas = matchedMetas.slice(0, metaShown);

  const [metaForm, setMetaForm] = useState({
    path: '',
    locale: 'el',
    title: '',
    description: '',
    robots: '',
    canonical: '',
    ogImage: '',
  });

  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  const [statusCode, setStatusCode] = useState<number>(301);
  const [kind, setKind] = useState<string>('literal');
  const [busy, setBusy] = useState(false);
  // A toggle with no busy state took two round trips and looked idle throughout, so a
  // second click sent a second PATCH.
  const [togglingId, setTogglingId] = useState<number | null>(null);
  /*
   * Editing a rule's target, in place.
   *
   * There was no edit at all — a typo in a target could only be fixed by deleting the rule
   * and writing it again, which throws away the hit counter that says whether anyone is
   * using it. It also made the 404 monitor's "→ redirect" shortcut a one-way street: it
   * always creates a rule pointing at the home page, and correcting that meant the same
   * delete-and-retype.
   *
   * The target only. Changing a source is really a different rule — same source is what
   * makes it the same rule — and leaving that alone keeps the hit count meaning something.
   */
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTarget, setEditTarget] = useState('');

  async function refreshRedirects() {
    const res = await cmsApi.listRedirects<Redirect[]>();
    setRedirects(res.data);
  }
  async function refreshNotFounds() {
    const res = await cmsApi.list404<NotFound[]>();
    setNotFounds(res.data);
  }

  async function addRedirect(e: React.FormEvent) {
    e.preventDefault();
    if (!source || !target) return;
    setBusy(true);
    /*
     * Through `run()`, like everything else.
     *
     * This one had a `try/finally` and no `catch`, so a refusal was swallowed: the button
     * came back to life, nothing appeared, and the rule was never created. And this is
     * the action with by far the most reasons to be refused — a self-loop, a cycle
     * through an existing rule, a wildcard without `/*`, a regex that would stall the
     * server, a duplicate source. Every one of those refusals was written specifically so
     * the author would be told at the moment of writing, and none of them arrived.
     */
    await run(async () => {
      await cmsApi.createRedirect({ source, target, statusCode, kind });
      setSource('');
      setTarget('');
      await refreshRedirects();
    }, 'Could not create this redirect.');
    setBusy(false);
  }

  async function toggleRedirect(r: Redirect) {
    // Also `run()`: turning a rule on can be refused for the same reasons as writing it,
    // because an inactive rule that would now close a loop is only a problem once active.
    setTogglingId(r.id);
    await run(async () => {
      await cmsApi.updateRedirect(r.id, { active: !r.active });
      await refreshRedirects();
    }, 'Could not change this redirect.');
    setTogglingId(null);
  }
  async function saveTarget(r: Redirect) {
    const next = editTarget.trim();
    if (!next || next === r.target) {
      setEditingId(null);
      return;
    }
    await run(async () => {
      await cmsApi.updateRedirect(r.id, { target: next });
      setEditingId(null);
      await refreshRedirects();
    }, 'Could not change this target.');
  }

  async function removeRedirect(r: Redirect) {
    const ok = await confirm({
      title: `Delete the redirect for ${r.source}?`,
      message: `${r.source} will stop redirecting to ${r.target} and go back to 404ing for everyone. This cannot be undone.`,
      confirmLabel: 'Delete redirect',
    });
    if (!ok) return;
    await run(async () => {
      await cmsApi.deleteRedirect(r.id);
      await refreshRedirects();
    }, 'Could not delete this redirect.');
  }

  /**
   * Every one of these can be refused by the server — a redirect for this path
   * may already exist (409), or the entry may have been removed in another tab.
   * None of them caught anything, so a refusal escaped as an unhandled promise
   * rejection: the row simply did not change and nothing said why.
   */
  async function run(fn: () => Promise<void>, fallback: string) {
    setError(null);
    try {
      await fn();
    } catch (err) {
      // The field-level sentence, not the "Validation failed." summary.
      setError(apiErrorText(err, fallback));
    }
  }

  async function redirectFrom404(nf: NotFound) {
    await run(async () => {
      await cmsApi.createRedirect({ source: nf.path, target: '/', statusCode: 301 });
      await cmsApi.update404(nf.id, { ignored: true });
      await Promise.all([refreshRedirects(), refreshNotFounds()]);
    }, 'Could not create a redirect for this path.');
  }
  async function toggle404(nf: NotFound) {
    await run(async () => {
      await cmsApi.update404(nf.id, { ignored: !nf.ignored });
      await refreshNotFounds();
    }, 'Could not update this entry.');
  }
  async function remove404(nf: NotFound) {
    const ok = await confirm({
      title: `Delete the log entry for ${nf.path}?`,
      message: 'Only the record of these hits is removed — the path itself is unaffected. Use "ignore" to keep the entry but hide it.',
      confirmLabel: 'Delete entry',
    });
    if (!ok) return;
    await run(async () => {
      await cmsApi.delete404(nf.id);
      await refreshNotFounds();
    }, 'Could not delete this entry.');
  }

  async function refreshMetas() {
    const res = await cmsApi.listMeta<MetaRow[]>();
    setMetas(res.data);
  }
  async function saveMeta(e: React.FormEvent) {
    e.preventDefault();
    if (!metaForm.path) return;
    // Same as `addRedirect`: an invalid canonical URL or a bad robots value is refused by
    // the server, and the refusal used to vanish — the form emptied itself either way.
    await run(async () => {
      await cmsApi.upsertMeta({
        path: metaForm.path,
        locale: metaForm.locale,
        title: metaForm.title || null,
        description: metaForm.description || null,
        robots: metaForm.robots || null,
        canonical: metaForm.canonical || null,
        ogImage: metaForm.ogImage || null,
      });
      setMetaForm({ path: '', locale: 'el', title: '', description: '', robots: '', canonical: '', ogImage: '' });
      await refreshMetas();
    }, 'Could not save this override.');
  }
  async function removeMeta(m: MetaRow) {
    const ok = await confirm({
      title: `Delete the meta override for ${m.path}?`,
      message: 'That path goes back to the title and description the page generates for itself. This cannot be undone.',
      confirmLabel: 'Delete override',
    });
    if (!ok) return;
    await run(async () => {
      await cmsApi.deleteMeta(m.id);
      await refreshMetas();
    }, 'Could not delete this override.');
  }
  const setMeta = (k: keyof typeof metaForm, v: string) => setMetaForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="flex flex-col gap-10">
      {error ? (
        <p role="alert" className="rounded-sm border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-600">Redirects</h2>
        <SearchBox
          label="Search redirects"
          value={redirectQ}
          onChange={setRedirectQ}
          shown={visibleRedirects.length}
          total={redirects.length}
        />

        <form onSubmit={addRedirect} className="flex flex-wrap items-end gap-2">
          <Field
            label="Source"
            className="min-w-[16rem] flex-1"
            description="The old address a visitor asks for, as a path on this site."
          >
            <input
              className={input}
              placeholder="Source (e.g. /old-path)"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
          </Field>
          <span className="pb-1.5 text-neutral-600">→</span>
          <Field
            label="Target"
            className="min-w-[16rem] flex-1"
            description="Where the visitor is sent instead: a path on this site or a full https:// address."
          >
            <input
              className={input}
              placeholder="Target (e.g. /new-path)"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
          </Field>
          <Field label="Status code" description={STATUS_CODE_TIP}>
            <select
              aria-label="Redirect status code"
              className={input}
              value={statusCode}
              onChange={(e) => setStatusCode(Number(e.target.value))}
            >
              {STATUS_CODES.map((c) => (
                <option key={c} value={c}>
                  {c} — {STATUS_CODE_HELP[c].short}
                </option>
              ))}
            </select>
          </Field>
          <select
            aria-label="Redirect kind"
            aria-describedby="redirect-kind-hint"
            className={input}
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            {REDIRECT_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={busy}
            className="rounded-sm bg-warm-gold font-medium px-3 py-1.5 text-sm text-midnight-navy hover:bg-warm-gold-dark disabled:opacity-50"
          >
            Add
          </button>
          {/*
            What the three kinds actually mean, said before the rule is written.
            The choice has to be made first, and nothing explained it — a wildcard source
            has to end in `/*` or it is refused, and "regex" means JavaScript regex, neither
            of which anyone would guess. The rules for each are enforced at the boundary, so
            the only thing missing was saying them out loud.
          */}
          <p id="redirect-kind-hint" className="basis-full text-xs text-neutral-600">
            {kind === 'literal'
              ? 'literal — matches this exact path and nothing else. Use this unless you need more.'
              : kind === 'wildcard'
                ? 'wildcard — end the source with /* to catch everything below it, e.g. /docs/* .'
                : 'regex — a JavaScript regular expression. Avoid a repeat inside a repeat, such as (a+)+ , which would stall every request.'}
          </p>
        </form>

        <div
          tabIndex={0}
          role="group"
          aria-label="Redirects table, scrollable"
          className="min-w-0 overflow-x-auto rounded-sm border border-neutral-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-gold"
        >
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-600">
              <tr>
                {/*
                  The matching order, numbered.
                  Overlapping rules are resolved by taking the first one that matches, and
                  nothing on this screen said so — someone adding a broader rule over a path
                  an older one already covered had no way to see which would win.
                */}
                <th className="px-3 py-2">
                  <span className="inline-flex items-center gap-1">
                    #
                    <InfoTip label="About the order">
                      Rules are checked in this order, and the first one that matches a path wins.
                    </InfoTip>
                  </span>
                </th>
                <th className="px-3 py-2">
                  <span className="inline-flex items-center gap-1">
                    Source → Target
                    <InfoTip label="About the target">Click a target to change where the rule sends visitors.</InfoTip>
                  </span>
                </th>
                <th className="px-3 py-2">
                  <span className="inline-flex items-center gap-1">
                    Code
                    <InfoTip label="About status codes">{STATUS_CODE_TIP}</InfoTip>
                  </span>
                </th>
                <th className="px-3 py-2">Kind</th>
                <th className="px-3 py-2">
                  <span className="inline-flex items-center gap-1">
                    Hits
                    <InfoTip label="About hits">
                      How many visits this rule has redirected. A rule still at 0 after a while is probably not needed.
                    </InfoTip>
                  </span>
                </th>
                <th className="px-3 py-2">
                  <span className="inline-flex items-center gap-1">
                    Active
                    <InfoTip label="About active">
                      Click to switch a rule off without deleting it. A disabled rule redirects nobody but keeps its hit count.
                    </InfoTip>
                  </span>
                </th>
                <th className="relative px-3 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {visibleRedirects.length ? (
                visibleRedirects.map((r, i) => (
                  <tr key={r.id} className="hover:bg-neutral-50">
                    <td className="px-3 py-2 text-xs text-neutral-600">{i + 1}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {r.source} <span className="text-neutral-600">→</span>{' '}
                      {editingId === r.id ? (
                        <input
                          autoFocus
                          aria-label={`Target for ${r.source}`}
                          className="rounded-sm border border-neutral-300 px-1.5 py-0.5 font-mono text-xs"
                          value={editTarget}
                          onChange={(e) => setEditTarget(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void saveTarget(r);
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          onBlur={() => void saveTarget(r)}
                        />
                      ) : (
                        <button
                          type="button"
                          title="Click to change where this goes"
                          onClick={() => {
                            setEditingId(r.id);
                            setEditTarget(r.target);
                          }}
                          className="rounded-sm px-1 underline decoration-dotted hover:bg-neutral-100"
                        >
                          {r.target}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2">{r.statusCode}</td>
                    <td className="px-3 py-2 text-neutral-600">{r.kind}</td>
                    <td className="px-3 py-2 text-neutral-600">{r.hits}</td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => toggleRedirect(r)}
                        disabled={togglingId === r.id}
                        className="py-1 text-xs underline disabled:no-underline disabled:opacity-50"
                      >
                        {togglingId === r.id ? 'saving…' : r.active ? 'active' : 'disabled'}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => removeRedirect(r)} className="py-1 text-xs text-red-700 hover:underline">
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-neutral-600">
                    No redirects.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {matchedRedirects.length > redirectShown ? (
          <div>
            <button
              type="button"
              onClick={() => setRedirectShown((n) => n + PAGE)}
              className="min-h-[2.25rem] rounded-sm border border-neutral-300 bg-white px-3.5 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
            >
              Show more redirects ({matchedRedirects.length - redirectShown} left)
            </button>
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-600">404 monitor</h2>
        <SearchBox
          label="Search 404 paths"
          value={notFoundQ}
          onChange={setNotFoundQ}
          shown={visibleNotFounds.length}
          total={notFounds.length}
        />
        <div
          tabIndex={0}
          role="group"
          aria-label="404 monitor table, scrollable"
          className="min-w-0 overflow-x-auto rounded-sm border border-neutral-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-gold"
        >
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-600">
              <tr>
                <th className="px-3 py-2">
                  <span className="inline-flex items-center gap-1">
                    Path
                    <InfoTip label="About the 404 monitor">
                      Addresses on this site that visitors asked for and that do not exist, with the language in brackets when known.
                    </InfoTip>
                  </span>
                </th>
                <th className="px-3 py-2">
                  <span className="inline-flex items-center gap-1">
                    Hits
                    <InfoTip label="About 404 hits">
                      How many times this missing address was requested. High numbers usually mean a broken link somewhere.
                    </InfoTip>
                  </span>
                </th>
                <th className="px-3 py-2">Last seen</th>
                <th className="relative px-3 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {visibleNotFounds.length ? (
                visibleNotFounds.map((nf) => (
                  // Tinted, not faded — `opacity-50` put this row's text under the
                  // 4.5:1 minimum, and an ignored path is still one someone reads.
                  <tr key={nf.id} className={nf.ignored ? 'bg-neutral-50' : 'hover:bg-neutral-50'}>
                    <td className="px-3 py-2 font-mono text-xs">
                      {nf.path}
                      {nf.locale ? <span className="text-neutral-600"> ({nf.locale})</span> : null}
                    </td>
                    <td className="px-3 py-2 text-neutral-600">{nf.hits}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-neutral-600">
                      {new Date(nf.lastSeen).toISOString().slice(0, 10)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-3">
                        <button onClick={() => redirectFrom404(nf)} className="py-1 text-xs text-neutral-700 hover:underline">
                          → redirect
                        </button>
                        <button onClick={() => toggle404(nf)} className="py-1 text-xs text-neutral-600 hover:underline">
                          {nf.ignored ? 'unignore' : 'ignore'}
                        </button>
                        <button onClick={() => remove404(nf)} className="py-1 text-xs text-red-700 hover:underline">
                          delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-neutral-600">
                    No 404s logged.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {matchedNotFounds.length > notFoundShown ? (
          <div>
            <button
              type="button"
              onClick={() => setNotFoundShown((n) => n + PAGE)}
              className="min-h-[2.25rem] rounded-sm border border-neutral-300 bg-white px-3.5 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
            >
              Show more paths ({matchedNotFounds.length - notFoundShown} left)
            </button>
          </div>
        ) : null}
        <p className="text-xs text-neutral-600">
          “→ redirect” creates a 301 from the path to <code>/</code> and ignores the entry — set the real
          target above.{' '}
          <InfoTip label="About ignore and delete">
            “ignore” marks a path as dealt with: the row is shaded but stays in the list and keeps counting
            hits. “delete” removes only the log entry; the path is logged again if it is requested again.
          </InfoTip>
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-600">
          Per-path meta overrides
        </h2>
        <SearchBox
          label="Search paths"
          value={metaQ}
          onChange={setMetaQ}
          shown={visibleMetas.length}
          total={metas.length}
        />
        <form onSubmit={saveMeta} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Field label="Path" description="The page address this applies to, e.g. /pricing. Saving the same path and language again updates it.">
            <input
              className={input}
              placeholder="Path (e.g. /pricing)"
              value={metaForm.path}
              onChange={(e) => setMeta('path', e.target.value)}
            />
          </Field>
          <Field label="Language" description="Which language version of the page gets these values.">
            <select className={input} value={metaForm.locale} onChange={(e) => setMeta('locale', e.target.value)}>
              <option value="el">el</option>
              <option value="en">en</option>
            </select>
          </Field>
          <Field label="Title" description="Replaces the page title shown in the browser tab and in search results.">
            <input className={input} placeholder="Title" value={metaForm.title} onChange={(e) => setMeta('title', e.target.value)} />
          </Field>
          <Field
            label="Robots"
            description="Tells search engines what to do with the page. “noindex” keeps it out of results; “nofollow” asks them not to follow its links. Empty = the page’s normal setting."
          >
            <input className={input} placeholder="Robots (e.g. noindex)" value={metaForm.robots} onChange={(e) => setMeta('robots', e.target.value)} />
          </Field>
          <Field label="Description" className="sm:col-span-2" description="Replaces the summary search engines show under the title.">
            <input className={input} placeholder="Description" value={metaForm.description} onChange={(e) => setMeta('description', e.target.value)} />
          </Field>
          <Field
            label="Canonical URL"
            description="The address search engines should treat as the original when the same content is reachable at several addresses. Leave empty to use the page’s own address."
          >
            <input className={input} placeholder="Canonical URL" value={metaForm.canonical} onChange={(e) => setMeta('canonical', e.target.value)} />
          </Field>
          <Field
            label="OG image URL"
            description="The picture shown when the page is shared on social media or in messaging apps. A full https:// address or a path on this site."
          >
            <input className={input} placeholder="OG image URL" value={metaForm.ogImage} onChange={(e) => setMeta('ogImage', e.target.value)} />
          </Field>
          <div className="sm:col-span-2">
            <button type="submit" className="rounded-sm bg-warm-gold font-medium px-3 py-1.5 text-sm text-midnight-navy hover:bg-warm-gold-dark">
              Save override
            </button>
          </div>
        </form>

        <div
          tabIndex={0}
          role="group"
          aria-label="Per-path meta overrides table, scrollable"
          className="min-w-0 overflow-x-auto rounded-sm border border-neutral-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-gold"
        >
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-600">
              <tr>
                <th className="px-3 py-2">Path</th>
                <th className="px-3 py-2">Locale</th>
                <th className="px-3 py-2">Title</th>
                <th className="px-3 py-2">Robots</th>
                <th className="relative px-3 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {visibleMetas.length ? (
                visibleMetas.map((m) => (
                  <tr key={m.id} className="hover:bg-neutral-50">
                    <td className="px-3 py-2 font-mono text-xs">{m.path}</td>
                    <td className="px-3 py-2 text-neutral-600">{m.locale}</td>
                    <td className="px-3 py-2 text-neutral-600">{m.title ?? '—'}</td>
                    <td className="px-3 py-2 text-neutral-600">{m.robots ?? '—'}</td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => removeMeta(m)} className="py-1 text-xs text-red-700 hover:underline">
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-neutral-600">
                    No overrides.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {matchedMetas.length > metaShown ? (
          <div>
            <button
              type="button"
              onClick={() => setMetaShown((n) => n + PAGE)}
              className="min-h-[2.25rem] rounded-sm border border-neutral-300 bg-white px-3.5 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
            >
              Show more overrides ({matchedMetas.length - metaShown} left)
            </button>
          </div>
        ) : null}
        <p className="text-xs text-neutral-600">
          Overrides apply to pages using the shared metadata helper. Re-saving an existing (path, locale)
          updates it.
        </p>
      </section>
      {dialog}
    </div>
  );
}
