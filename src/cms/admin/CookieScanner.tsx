'use client';

import { useCallback, useState } from 'react';

import { cmsApi, CmsApiError } from './api-client';
import { InfoTip } from './ui';

/**
 * What the site stores, next to what it declares.
 *
 * The catalogue below this panel is typed by hand while the code that sets
 * cookies moves on its own, so the two drift silently — and a cookie policy
 * that is out of date is the one state it must not be in. Nothing could tell
 * you it had happened until now.
 *
 * It reports; it does not write. "Declare" posts through the same
 * create-service endpoint the form below uses, so the write permission, the
 * audit entry and the cache revalidation are the ones that already existed.
 */

type StorageKind = 'cookie' | 'storage';
type Audience = 'visitor' | 'admin';

interface StorageKey {
  name: string;
  kind: StorageKind;
}
interface DetectedService {
  name: string;
  provider: string | null;
  categoryKey: string;
  audience: Audience;
  purpose: Record<string, string>;
  keys: StorageKey[];
}
interface MatchedService extends DetectedService {
  declaredBy: 'stored' | 'automatic';
  declaredUnder: string;
}
interface DeclaredOnlyService {
  name: string;
  provider: string | null;
  categoryKey: string;
  enabled: boolean;
}
interface CookieScan {
  matched: MatchedService[];
  undeclared: DetectedService[];
  unknownToScanner: DeclaredOnlyService[];
}

export interface ScanCategory {
  id: number;
  key: string;
}

const ghostBtn = 'rounded-sm border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100';
const primaryBtn =
  'rounded-sm bg-warm-gold px-3 py-1.5 text-sm font-medium text-midnight-navy hover:bg-warm-gold-dark';

/** `_ga` (cookie) vs `praion-cart` (localStorage) — the distinction is the
 *  reason this is not called a cookie list. */
function KeyList({ keys }: { keys: StorageKey[] }) {
  return (
    <ul className="mt-1 flex flex-wrap gap-1">
      {keys.map((k) => (
        <li
          key={k.name}
          className="rounded-sm bg-neutral-100 px-1.5 py-0.5 font-mono text-[11px] text-neutral-700"
          title={k.kind === 'cookie' ? 'Cookie' : 'Browser storage (localStorage)'}
        >
          {k.name}
          {k.kind === 'storage' ? <span className="ml-1 text-neutral-500">storage</span> : null}
        </li>
      ))}
    </ul>
  );
}

export function CookieScanner({
  categories,
  onDeclared,
}: {
  categories: ScanCategory[];
  onDeclared: () => Promise<void> | void;
}) {
  const [scan, setScan] = useState<CookieScan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [declaring, setDeclaring] = useState<string | null>(null);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await cmsApi.getCookieScan<CookieScan>();
      setScan(res.data);
    } catch (err) {
      setError(err instanceof CmsApiError ? err.message : 'Could not run the scan.');
    } finally {
      setBusy(false);
    }
  }, []);

  const declare = async (service: DetectedService) => {
    // The category it belongs under has to exist; the scanner proposes, it does
    // not create categories behind the admin's back.
    const category = categories.find((c) => c.key === service.categoryKey);
    if (!category) {
      setError(`No “${service.categoryKey}” category yet — add it below first, then scan again.`);
      return;
    }
    setDeclaring(service.name);
    setError(null);
    try {
      await cmsApi.createCookieService({
        categoryId: category.id,
        name: service.name,
        provider: service.provider,
        purpose: service.purpose,
      });
      await onDeclared();
      await run();
    } catch (err) {
      setError(err instanceof CmsApiError ? err.message : 'Could not declare that service.');
    } finally {
      setDeclaring(null);
    }
  };

  return (
    <section className="rounded-sm border border-neutral-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1 text-sm font-semibold text-neutral-900">
            Scan
            <InfoTip label="About the scan">
              The scan does not visit the site. It checks a built-in list of the cookies and browser storage
              this site’s own code sets — analytics only when a GA4 ID is set — against the categories below.
              Trackers pasted into content or added as script snippets are not found; declare those by hand.
            </InfoTip>
          </h2>
          <p className="mt-0.5 text-xs text-neutral-600">
            What this site stores in a visitor&rsquo;s browser, against what the catalogue declares.
          </p>
        </div>
        <button type="button" className={primaryBtn} onClick={run} disabled={busy}>
          {busy ? 'Scanning…' : scan ? 'Scan again' : 'Run scan'}
        </button>
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {scan ? (
        <div className="mt-4 flex flex-col gap-5">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
              Used, not declared ({scan.undeclared.length})
            </h3>
            {scan.undeclared.length ? (
              <ul className="mt-2 divide-y divide-neutral-200 border-y border-neutral-200">
                {scan.undeclared.map((s) => (
                  <li key={s.name} className="flex flex-wrap items-start justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-neutral-900">
                        {s.name}
                        {s.provider ? <span className="ml-2 text-neutral-500">{s.provider}</span> : null}
                        {s.audience === 'admin' ? (
                          <span className="ml-2 rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-600">
                            staff only
                          </span>
                        ) : null}
                      </p>
                      <KeyList keys={s.keys} />
                    </div>
                    <button
                      type="button"
                      className={ghostBtn}
                      onClick={() => declare(s)}
                      disabled={declaring === s.name}
                    >
                      {declaring === s.name ? 'Adding…' : `Declare under ${s.categoryKey}`}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-neutral-600">
                Nothing undeclared — everything this site stores is in the catalogue.
              </p>
            )}
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
              Declared and in use ({scan.matched.length})
            </h3>
            <ul className="mt-2 flex flex-col gap-1">
              {scan.matched.map((s) => (
                <li key={s.name} className="text-sm text-neutral-700">
                  {s.name}
                  <span className="ml-2 text-neutral-500">
                    {s.declaredUnder}
                    {s.declaredBy === 'automatic' ? ' · declared automatically' : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {scan.unknownToScanner.length ? (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                Declared, not detected ({scan.unknownToScanner.length})
              </h3>
              {/* Not a fault: anything added by hand lands here, and so does a
                  service that was genuinely removed from the site. */}
              <p className="mt-1 text-xs text-neutral-600">
                The scanner does not know these. Either added by hand, or no longer used — worth checking.
              </p>
              <ul className="mt-2 flex flex-col gap-1">
                {scan.unknownToScanner.map((s) => (
                  <li key={`${s.categoryKey}:${s.name}`} className="text-sm text-neutral-700">
                    {s.name}
                    <span className="ml-2 text-neutral-500">
                      {s.categoryKey}
                      {s.enabled ? '' : ' · disabled'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
