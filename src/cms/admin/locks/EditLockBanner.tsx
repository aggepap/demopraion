'use client';

import { useEffect, useState } from 'react';

import { Button, InfoTip } from '../ui';
import { useConfirm } from '../ui/ConfirmDialog';
import type { EditLock } from './use-edit-lock';
import { relativeSince } from './since';

/**
 * Says who has the document, and offers to take it.
 *
 * Four states, deliberately weighted differently:
 *  - `theirs` — amber, prominent, with the take-over button. Something is
 *    actually stopping you.
 *  - `mine-elsewhere` — quiet. Two tabs are one person; this is information,
 *    not an obstacle, and a red banner for "you are editing this" is noise.
 *  - `unavailable` — quietest of all. Nothing is wrong with the document; the
 *    live status simply is not known, and the editor still works.
 *  - `unlocked` / `mine` — nothing at all.
 */
export function EditLockBanner({
  lock,
  /** Offers to copy unsaved work out before it becomes unreachable. */
  onCopyUnsaved,
}: {
  lock: EditLock;
  onCopyUnsaved?: () => void;
}) {
  const { confirm, dialog } = useConfirm();
  const [copied, setCopied] = useState(false);
  // Re-render once a minute so "4 minutes ago" does not sit there saying "1".
  const [, tick] = useState(0);
  useEffect(() => {
    if (lock.phase !== 'theirs') return;
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [lock.phase]);

  if (lock.phase === 'unavailable') {
    return (
      <p className="rounded-sm border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
        Live editing status is unavailable, so this page cannot tell you if someone else has this
        open. You can still edit and save as normal.
      </p>
    );
  }

  if (lock.phase === 'mine-elsewhere') {
    return (
      <p className="rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        You have this open in another tab. Whichever tab you save last wins.
      </p>
    );
  }

  if (lock.phase !== 'theirs' || !lock.holder) return null;

  // Bound once so the confirm dialog does not need a non-null assertion.
  const holder = lock.holder;
  const started = relativeSince(holder.since);

  return (
    <>
      <div
        role="status"
        className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-amber-300 bg-amber-50 p-4"
      >
        <div className="min-w-0">
          <p className="text-sm font-semibold text-amber-900">
            {holder.userName} is editing this{started ? ` — started ${started}` : ''}.
          </p>
          <p className="mt-0.5 text-xs text-amber-900">
            The fields are locked so you cannot overwrite their work. Taking over will lock them
            out instead.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onCopyUnsaved ? (
            <span className="inline-flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  onCopyUnsaved();
                  setCopied(true);
                }}
              >
                {copied ? 'Copied' : 'Copy my unsaved changes'}
              </Button>
              <InfoTip label="About copying unsaved changes">
                Puts what you typed but did not save on the clipboard, for every language, as plain text.
                Paste it somewhere safe; you cannot save it here while the page is locked.
              </InfoTip>
            </span>
          ) : null}
          <Button
            type="button"
            onClick={() => {
              void confirm({
                title: `Take over from ${holder.userName}?`,
                message: `They are editing this right now. Taking over locks them out, and anything they have typed and not saved stays on their screen but can no longer be saved.`,
                confirmLabel: 'Take over',
                destructive: false,
              }).then((yes) => {
                if (yes) lock.takeOver();
              });
            }}
          >
            Take over editing
          </Button>
        </div>
      </div>
      {dialog}
    </>
  );
}
