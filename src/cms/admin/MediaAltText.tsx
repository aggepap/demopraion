'use client';

import { useId, useState } from 'react';

import { cmsApi, CmsApiError } from './api-client';
import { Field } from './ui';

/** The longest alt text the API accepts (`media_files.alt_text`). */
export const ALT_TEXT_MAX = 512;

export interface AltTextState {
  draft: string;
  saved: string;
  saving: boolean;
  error: string | null;
  /** The last save succeeded and nothing has been typed since. */
  justSaved: boolean;
}

/**
 * The line under the box, said in words. `null` when there is nothing to say:
 * the box matches what is stored and nobody has just saved it.
 *
 * Compared trimmed, because the server trims — a trailing space is not an
 * unsaved change.
 */
export function altTextStatus(s: AltTextState): string | null {
  if (s.saving) return 'Saving…';
  if (s.error) return `Not saved: ${s.error}`;
  if (s.draft.trim() !== s.saved.trim()) return 'Unsaved';
  if (s.justSaved) return 'Saved';
  return null;
}

/**
 * A media file's default alt text: what a screen reader says for the image
 * wherever it is used without alt text of its own.
 *
 * Editable with `cms.media.write`; everyone else sees the text (or that there
 * is none) and no control that the server would refuse.
 */
export function MediaAltText({
  uuid,
  altText,
  canWrite,
  onSaved,
}: {
  uuid: string;
  altText: string | null;
  canWrite: boolean;
  onSaved?: (altText: string | null) => void;
}) {
  const id = `alt-${useId().replace(/:/g, '')}`;
  const [state, setState] = useState<AltTextState>({
    draft: altText ?? '',
    saved: altText ?? '',
    saving: false,
    error: null,
    justSaved: false,
  });

  if (!canWrite) {
    return (
      <p className="mt-1 text-[11px] text-neutral-600">
        <span className="font-medium text-neutral-700">Alt text: </span>
        {altText ? altText : <span className="italic">No alt text</span>}
      </p>
    );
  }

  const status = altTextStatus(state);
  const unchanged = state.draft.trim() === state.saved.trim();

  async function save() {
    setState((s) => ({ ...s, saving: true, error: null, justSaved: false }));
    try {
      const sent = state.draft.trim();
      const res = await cmsApi.updateMedia(uuid, { altText: sent || null });
      const stored = res.data.altText;
      setState((s) => ({
        ...s,
        saving: false,
        saved: stored ?? '',
        // Anything typed while the request was in flight is kept, and shows as unsaved.
        draft: s.draft.trim() === sent ? (stored ?? '') : s.draft,
        justSaved: true,
      }));
      onSaved?.(stored);
    } catch (err) {
      const message = err instanceof CmsApiError ? err.message : 'Could not save the alt text';
      setState((s) => ({ ...s, saving: false, error: message }));
    }
  }

  return (
    <Field
      label="Alt text"
      htmlFor={id}
      className="mt-2 gap-1"
      description="Read aloud by screen readers and used by search engines. Applies wherever this image appears without alt text of its own."
    >
      {(control) => (
        <>
          <textarea
            {...control}
            rows={2}
            maxLength={ALT_TEXT_MAX}
            value={state.draft}
            placeholder="Describe the image for people who cannot see it"
            // The status line below is part of the description too: it says
            // whether what is in the box has been saved.
            aria-describedby={[control['aria-describedby'], `${id}-status`].filter(Boolean).join(' ')}
            onChange={(e) => {
              const draft = e.target.value;
              setState((s) => ({ ...s, draft, error: null, justSaved: false }));
            }}
            className="w-full resize-y rounded-sm border border-neutral-300 bg-white px-2 py-1 text-xs focus:border-warm-gold focus:outline-none focus:ring-1 focus:ring-warm-gold"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={state.saving || unchanged}
              className="rounded-sm border border-neutral-300 bg-white px-2 py-0.5 text-[11px] font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
            >
              Save alt text
            </button>
            <span
              id={`${id}-status`}
              role="status"
              className={`text-[11px] ${state.error ? 'text-red-700' : status === 'Unsaved' ? 'text-amber-700' : 'text-neutral-600'}`}
            >
              {status}
            </span>
          </div>
        </>
      )}
    </Field>
  );
}
