'use client';

import { useRef, useState } from 'react';

import { cmsApi, CmsApiError } from './api-client';
import { MediaAltText } from './MediaAltText';
import { duplicateNotice } from './media-upload-notice';
import { useConfirm } from './ui/ConfirmDialog';
import { Icon, InfoTip } from './ui';

interface MediaItem {
  uuid: string;
  originalName: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  url: string;
  createdAt: string;
  altText?: string | null;
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * How many files one request returns. The endpoint is paged, so the library
 * asks for the next page instead of the whole table — see
 * `cms/core/media/service.ts`.
 */
const PAGE_SIZE = 200;

export function MediaLibrary({
  initial,
  initialTotal,
  canWrite = false,
}: {
  initial: MediaItem[];
  /** How many files exist, known on the server, so the count is right immediately. */
  initialTotal?: number;
  /**
   * Holds `cms.media.write`. Without it the screen is for looking: alt text is
   * shown, not editable, and there is no upload or delete to be refused.
   */
  canWrite?: boolean;
}) {
  const [items, setItems] = useState(initial);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Files the server already had. Not an error — the upload worked, it just
   *  did not need to store anything. */
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // A full page back means there is very likely another one. It can be one
  // request wrong (a library that is an exact multiple of the page size shows
  // the button once with nothing behind it), which is the harmless direction:
  // the alternative is hiding files that exist.
  const [hasMore, setHasMore] = useState(initial.length >= PAGE_SIZE);
  // How many pages the person has actually asked to see. Every reload restores
  // exactly this many, which is what keeps a delete from silently rolling the
  // view back to the first page — see `showPages`.
  const [pages, setPages] = useState(Math.max(1, Math.ceil(initial.length / PAGE_SIZE)));
  /*
   * A filter and a count.
   *
   * The grid had neither: reaching one file among hundreds meant scrolling and pressing
   * "Load more" repeatedly, with nothing to say how far there was to go — and every
   * other list in the admin states its size. The filter goes to the server rather than
   * over the loaded page, because the file being looked for is usually the one that has
   * not been loaded yet.
   */
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [total, setTotal] = useState<number | null>(initialTotal ?? null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { confirm, dialog } = useConfirm();

  /**
   * Load the first `count` pages and show them as the whole list.
   *
   * Reloading only the first page was wrong in a way that lost the user's
   * place: after clicking "Load more" and then deleting one file, the list
   * snapped back to 200 items and every file past that point vanished from the
   * screen — files nobody had touched, with no message saying anything but the
   * deleted one had changed. Deleting also shifts every later offset by one, so
   * re-fetching just the tail would skip a file instead. Rebuilding the pages
   * the person asked for is the only version that is right in both cases.
   */
  async function showPages(count: number, term = applied) {
    const all: MediaItem[] = [];
    for (let page = 0; page < count; page++) {
      const res = await cmsApi.listMedia<MediaItem>({
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        search: term || undefined,
      });
      setTotal(res.total);
      all.push(...res.items);
      if (res.items.length < PAGE_SIZE) {
        // The library ran out mid-way — this is the last page there is.
        setItems(all);
        setPages(page + 1);
        setHasMore(false);
        return;
      }
    }
    setItems(all);
    setPages(count);
    setHasMore(all.length >= count * PAGE_SIZE);
  }

  async function refresh() {
    await showPages(pages);
  }

  async function runSearch() {
    const term = search.trim();
    setApplied(term);
    setLoadingMore(true);
    setError(null);
    try {
      // Back to the first page: page 3 of one filter is not page 3 of another, and an
      // empty grid reads as "there are no such files" rather than "you are past the end".
      setPages(1);
      await showPages(1, term);
    } catch (err) {
      setError(err instanceof CmsApiError ? err.message : 'Could not search the library');
    } finally {
      setLoadingMore(false);
    }
  }

  async function loadMore() {
    setLoadingMore(true);
    setError(null);
    try {
      await showPages(pages + 1);
    } catch (err) {
      setError(err instanceof CmsApiError ? err.message : 'Could not load more files');
    } finally {
      setLoadingMore(false);
    }
  }

  /**
   * Upload a selection, and let one bad file be one bad file.
   *
   * A single try/catch around the loop, with `refresh()` inside it, did two
   * things wrong the moment the server refused anything. Every file *after* the
   * refused one was never sent — dropped without being named — and every file
   * *before* it had uploaded but stayed invisible, because the refresh that would
   * have shown it sat after the loop in the same `try` that just threw. The
   * editor saw one error about one file and no sign of the other two.
   *
   * The in-field picker already did this properly; this screen was the sibling
   * that had not caught up. Each file is its own attempt, failures are collected
   * and reported by name, and the grid refreshes either way so whatever did land
   * is on screen.
   */
  async function onFiles(files: FileList | null) {
    if (!files || !files.length) return;
    setUploading(true);
    setError(null);
    setNotice(null);
    const failures: string[] = [];
    const duplicates: string[] = [];
    for (const file of Array.from(files)) {
      try {
        const res = await cmsApi.uploadMedia<MediaItem & { duplicate?: boolean }>(file);
        if (res.data.duplicate) duplicates.push(file.name);
      } catch (err) {
        failures.push(`${file.name}: ${err instanceof CmsApiError ? err.message : 'upload failed'}`);
      }
    }
    try {
      await refresh();
    } catch {
      // The uploads are what matter; a failed refresh is a stale grid, not lost work.
    }
    setUploading(false);
    if (failures.length) setError(failures.join(' · '));
    setNotice(duplicateNotice(duplicates));
    if (fileRef.current) fileRef.current.value = '';
  }

  async function remove(uuid: string) {
    const ok = await confirm({
      title: 'Delete this file?',
      message: 'Any content still pointing at it will lose the image. This cannot be undone.',
    });
    if (!ok) return;
    await cmsApi.deleteMedia(uuid);
    await refresh();
  }

  async function copyUuid(uuid: string) {
    try {
      await navigator.clipboard.writeText(uuid);
      setCopied(uuid);
      setTimeout(() => setCopied(null), 1200);
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        {canWrite ? (
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-sm bg-warm-gold px-3.5 py-2 text-sm font-medium text-midnight-navy hover:bg-warm-gold-dark">
            <Icon name="upload" size={14} />
            {uploading ? 'Uploading…' : 'Upload files'}
            <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
          </label>
        ) : null}
        {canWrite ? (
          <InfoTip label="About uploads">
            PNG, JPEG, GIF, WebP, AVIF or PDF, up to 10 MB each. Pictures are converted to WebP, made to fit
            within 1600×1200 (never enlarged), and their hidden camera data, including GPS location, is
            removed. A file already in the library is reused, not stored twice.
          </InfoTip>
        ) : null}
        <input
          type="search"
          value={search}
          aria-label="Search files by name"
          placeholder="Search by file name…"
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void runSearch();
          }}
          className="w-full max-w-xs rounded-sm border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-warm-gold focus:outline-none focus:ring-1 focus:ring-warm-gold"
        />
        <button
          type="button"
          onClick={() => void runSearch()}
          className="rounded-sm border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-800 hover:bg-neutral-50"
        >
          Search
        </button>
        {applied ? (
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setApplied('');
              setPages(1);
              void showPages(1, '');
            }}
            className="text-sm text-neutral-600 underline hover:text-neutral-800"
          >
            Clear
          </button>
        ) : null}
        {total !== null ? (
          <span className="ml-auto shrink-0 text-sm text-neutral-600">
            {applied ? `${total} matching` : `${total} file${total === 1 ? '' : 's'}`}
          </span>
        ) : null}
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
      </div>

      {notice ? (
        <p role="status" className="text-sm text-neutral-600">
          {notice}
        </p>
      ) : null}

      {items.length ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {items.map((m) => (
            <div key={m.uuid} className="flex flex-col rounded-sm border border-neutral-200 bg-white p-2">
              <div className="mb-2 flex h-28 items-center justify-center overflow-hidden rounded-sm bg-neutral-50">
                {m.mime.startsWith('image/') ? (
                  /*
                    Clickable, because deciding whether this is the right image is the
                    whole reason someone is looking at a grid of thumbnails — and a 112px
                    thumbnail cannot answer that. Opens the file itself in a new tab
                    rather than a modal: it is the browser's own image viewer, with zoom
                    and "save as" already in it.
                  */
                  <a
                    href={m.url}
                    target="_blank"
                    rel="noreferrer"
                    /*
                      `aria-label`, not `title`: the filename is already a `title` on the
                      caption below, and repeating it here made "the element whose title is
                      this file" ambiguous — for a spec, and for anyone navigating by
                      accessible name. The link still says which file it opens.
                    */
                    aria-label={`Open ${m.originalName} full size`}
                    className="flex h-full w-full items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-gold"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={m.url} alt={m.originalName} className="max-h-28 max-w-full object-contain" />
                  </a>
                ) : (
                  <span className="text-xs text-neutral-600">{m.mime}</span>
                )}
              </div>
              <div className="truncate text-xs font-medium text-neutral-800" title={m.originalName}>
                {m.originalName}
              </div>
              <div className="text-[11px] text-neutral-600">
                {humanSize(m.size)}
                {m.width && m.height ? ` · ${m.width}×${m.height}` : ''}
              </div>
              <div className="mt-2 flex items-center justify-between">
                <button
                  onClick={() => copyUuid(m.uuid)}
                  className="inline-flex items-center gap-1 text-[11px] text-neutral-600 hover:text-neutral-900"
                >
                  <Icon name={copied === m.uuid ? 'check' : 'copy'} size={12} />
                  {copied === m.uuid ? 'copied' : 'uuid'}
                </button>
                {canWrite ? (
                  <button
                    onClick={() => remove(m.uuid)}
                    className="inline-flex items-center gap-1 text-[11px] text-red-700 hover:underline"
                  >
                    <Icon name="trash" size={12} /> delete
                  </button>
                ) : null}
              </div>
              {m.mime.startsWith('image/') ? (
                <MediaAltText
                  uuid={m.uuid}
                  altText={m.altText ?? null}
                  canWrite={canWrite}
                  onSaved={(altText) =>
                    setItems((all) => all.map((x) => (x.uuid === m.uuid ? { ...x, altText } : x)))
                  }
                />
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-sm border border-dashed border-neutral-300 px-3 py-12 text-center text-sm text-neutral-600">
          {applied
            ? `No files match “${applied}”.`
            : 'No media yet — upload a file to get started.'}
        </p>
      )}
      {hasMore ? (
        <div>
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="rounded-sm border border-neutral-300 bg-white px-3.5 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-60"
          >
            {loadingMore ? 'Loading…' : 'Load more files'}
          </button>
        </div>
      ) : null}
      {dialog}
    </div>
  );
}
