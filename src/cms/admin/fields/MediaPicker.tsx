'use client';

import { useEffect, useRef, useState } from 'react';

import { cmsApi } from '../api-client';
import { duplicateNotice } from '../media-upload-notice';
import { Button, Icon } from '../ui';
import { useDialog } from '../ui/use-dialog';

interface MediaItem {
  uuid: string;
  originalName: string;
  mime: string;
  url: string;
  altText?: string | null;
}

/** Image field control: thumbnail of the current selection + browse/upload,
 *  storing the media UUID (the shape the zod validator expects). */
export function MediaPicker({
  value,
  onChange,
}: {
  value: string;
  /** `undefined` clears the field: `JSON.stringify` drops the key entirely,
   *  which is the shape the schema accepts for "no image". */
  onChange: (uuid: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const previewUrl = value ? `/api/cms/media/file/${value}` : null;

  return (
    <div>
      {value ? (
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl!} alt="" className="h-16 w-16 rounded-sm border border-neutral-200 object-cover" />
          <span className="truncate font-mono text-xs text-neutral-400">{value}</span>
          <div className="ml-auto flex gap-1">
            <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
              Change
            </Button>
            {/* `undefined`, not `''`: the key is then absent from the request
                rather than present-and-empty, which the field schema refused. */}
            <Button variant="ghost" size="sm" onClick={() => onChange(undefined)}>
              Clear
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          <Icon name="image" size={14} /> Choose image…
        </Button>
      )}
      {open ? (
        <MediaPickerModal
          onClose={() => setOpen(false)}
          onSelect={(uuid) => {
            onChange(uuid);
            setOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * One file in the picker. The alt text is shown under the name, because it is
 * what a screen reader will say for the image wherever it is placed — choosing
 * between two similar photos is also choosing between their descriptions. It
 * is edited on the Media screen, not here.
 */
export function MediaPickerTile({ item: m, onSelect }: { item: MediaItem; onSelect: (uuid: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(m.uuid)}
      className="group flex flex-col rounded-sm border border-neutral-200 p-1.5 text-left hover:border-warm-gold"
      title={m.originalName}
    >
      <div className="flex h-20 items-center justify-center overflow-hidden rounded-sm bg-neutral-50">
        {m.mime.startsWith('image/') ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={m.url} alt={m.altText || m.originalName} className="max-h-20 max-w-full object-contain" />
        ) : (
          <span className="text-[10px] text-neutral-600">{m.mime}</span>
        )}
      </div>
      <span className="mt-1 truncate text-[11px] text-neutral-600">{m.originalName}</span>
      {m.mime.startsWith('image/') ? (
        <span className="truncate text-[10px] text-neutral-600">
          {m.altText ? `Alt: ${m.altText}` : <span className="italic">No alt text</span>}
        </span>
      ) : null}
    </button>
  );
}

function MediaPickerModal({ onClose, onSelect }: { onClose: () => void; onSelect: (uuid: string) => void }) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Files the server already had — the upload worked, it just stored nothing. */
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Escape closes it, focus starts inside it and returns to the trigger on
  // close. This was a plain `<div>` overlay: no dialog role, no keyboard way
  // out, and focus left behind on the form underneath. The modal mechanics now
  // come from the shared hook rather than being hand-rolled per dialog.
  const panelRef = useRef<HTMLDivElement>(null);
  useDialog({ open: true, onClose, panelRef, initialFocusRef: closeRef });

  useEffect(() => {
    let active = true;
    // Newest first and bounded — the picker only ever needs the recent end of
    // the library, and the endpoint no longer returns the whole table.
    cmsApi
      .listMedia<MediaItem>({ limit: 200 })
      .then((res) => {
        if (active) setItems(res.items);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reloadKey]);

  /**
   * Upload, and say so when it does not work.
   *
   * There was no `catch` here: the server refuses anything outside its
   * allow-list and anything over 10 MB, and that refusal became an unhandled
   * promise rejection — the picker simply stopped, with the reason sitting in a
   * console nobody has open. Each file is reported by name, because "upload
   * failed" is useless when three were selected, and the ones that did upload
   * are still shown by refreshing the grid either way.
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
        failures.push(`${file.name}: ${err instanceof Error ? err.message : 'upload failed'}`);
      }
    }
    setReloadKey((k) => k + 1);
    setUploading(false);
    if (failures.length) setError(failures.join(' · '));
    setNotice(duplicateNotice(duplicates));
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="media-picker-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div onClick={onClose} aria-hidden="true" className="absolute inset-0 bg-black/40" />
      <div
        ref={panelRef}
        className="relative flex max-h-[80vh] w-full max-w-3xl flex-col rounded-sm bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
          <h2 id="media-picker-title" className="font-display text-base font-semibold">
            Media library
          </h2>
          <div className="flex items-center gap-2">
            <label className="cursor-pointer rounded-sm border border-neutral-300 bg-white px-2.5 py-1.5 text-xs hover:bg-neutral-50">
              {uploading ? 'Uploading…' : 'Upload'}
              <input
                ref={fileRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => onFiles(e.target.files)}
              />
            </label>
            <button
              ref={closeRef}
              onClick={onClose}
              aria-label="Close"
              className="rounded-sm p-1.5 text-neutral-400 hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-gold"
            >
              <Icon name="x" />
            </button>
          </div>
        </div>
        {error ? (
          <p role="alert" className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="border-b border-neutral-200 bg-neutral-50 px-4 py-2 text-xs text-neutral-600">
            {notice}
          </p>
        ) : null}
        <div className="overflow-y-auto p-4">
          {loading ? (
            <p className="py-10 text-center text-sm text-neutral-400">Loading…</p>
          ) : items.length ? (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
              {items.map((m) => (
                <MediaPickerTile key={m.uuid} item={m} onSelect={onSelect} />
              ))}
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-neutral-400">
              No media yet — upload a file to get started.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
