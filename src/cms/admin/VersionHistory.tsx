'use client';

import { useEffect, useState } from 'react';

import { cmsApi, CmsApiError } from './api-client';
import { InfoTip } from './ui';
import { useConfirm } from './ui/ConfirmDialog';

interface VersionRow {
  id: number;
  version: number;
  label: string | null;
  createdBy: number | null;
  createdAt: string;
}

/**
 * Version history panel for the edit screen. Lists the document's snapshots
 * (newest first) and restores one on demand — the restore is applied as a new
 * edit, so it too is versioned and nothing is lost.
 */
export function VersionHistory({
  collection,
  documentId,
  reloadKey,
}: {
  collection: string;
  documentId: number;
  /**
   * Changes whenever the document is written, so this list reloads.
   *
   * It used to fetch once, on mount. Save twice and the panel still showed the list
   * from before either save, so "restore two versions back" was really three versions
   * back — an editor could overwrite work they had just done while believing they were
   * reaching for something older. The list is the only place that numbering is visible,
   * so it being stale is not cosmetic.
   */
  reloadKey?: unknown;
}) {

  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);
  const { confirm, dialog } = useConfirm();

  useEffect(() => {
    let active = true;
    cmsApi
      .versions<VersionRow>(collection, documentId)
      .then((res) => {
        if (active) setVersions(res.data);
      })
      .catch((e) => {
        if (active) setError(e instanceof CmsApiError ? e.message : 'Failed to load versions');
      });
    return () => {
      active = false;
    };
  }, [collection, documentId, reloadKey]);

  async function restore(versionId: number, versionNumber: number) {
    const ok = await confirm({
      title: `Restore version ${versionNumber}?`,
      // The status and dates come back with the content — restoring a version
      // saved as a draft takes a live page down, which must not be a surprise.
      message:
        'Its content, SEO, status and dates replace what is there now. The current version stays in the list, so you can undo this.',
      confirmLabel: 'Restore',
      destructive: false,
    });
    if (!ok) return;
    setRestoring(versionId);
    setError(null);
    try {
      await cmsApi.restore(collection, documentId, versionId);
      // A full reload, not `router.refresh()`.
      //
      // The form seeds its state on mount, so a refresh handed it restored
      // props it never read: the screen kept showing the pre-restore content
      // and the next Save wrote that stale copy back, silently undoing the
      // restore. Remounting on a changed key is unreliable here because MySQL
      // `updated_at` only has one-second resolution — a restore inside the same
      // second as the load produces the same key. Restore is a rare, deliberate
      // action; a reload guarantees the screen matches the server.
      window.location.reload();
      return;
    } catch (e) {
      setError(e instanceof CmsApiError ? e.message : 'Restore failed');
    } finally {
      setRestoring(null);
    }
  }

  return (
    <aside className="w-full max-w-xs shrink-0">
      <div className="mb-3 flex items-center gap-1.5">
        <h3 className="text-sm font-semibold text-neutral-700">Version history</h3>
        <InfoTip label="About version history">
          Every save of this language keeps a copy, newest first, with times in UTC. Restore brings back
          that copy — content, SEO, status and dates — as a new save, so nothing is lost.
        </InfoTip>
      </div>
      {error ? <p className="mb-2 text-xs text-red-700">{error}</p> : null}
      {versions === null ? (
        <p className="text-xs text-neutral-600">Loading…</p>
      ) : versions.length === 0 ? (
        <p className="text-xs text-neutral-600">No versions yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-neutral-200 rounded-md border border-neutral-200">
          {versions.map((v, i) => (
            <li key={v.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
              <div>
                <div className="font-medium text-neutral-800">
                  v{v.version}
                  {i === 0 ? <span className="ml-1 text-neutral-600">(current)</span> : null}
                </div>
                {/* Locale-stable (ISO, UTC) to avoid an SSR/CSR hydration mismatch. */}
                <div className="text-neutral-600">
                  {new Date(v.createdAt).toISOString().slice(0, 16).replace('T', ' ')} UTC
                </div>
              </div>
              {i === 0 ? null : (
                <button
                  // Inside the document form: without a type this was a submit
                  // button, and Restore also fired a Save of the unrestored form.
                  type="button"
                  onClick={() => restore(v.id, v.version)}
                  disabled={restoring !== null}
                  className="rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-100 disabled:opacity-40"
                >
                  {restoring === v.id ? 'Restoring…' : 'Restore'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {dialog}
    </aside>
  );
}
