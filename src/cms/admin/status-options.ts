/**
 * Which statuses the document form offers, and the line explaining the rest.
 *
 * Mirrors the server rule in `core/documents/publish-rights.ts`: without
 * `cms.content.publish` a writer may not put a document live, and may not take a
 * live one down either. The form used to enforce only the first half, so a writer
 * could pick "archived" on a published page and was then refused with a bare
 * "forbidden".
 *
 * Options are disabled rather than removed: a writer opening a published
 * document must still see that it IS published — see the note in `DocumentForm`.
 */
import { isLiveStatus } from '../core/documents/live-status';

const NON_LIVE = new Set(['draft', 'archived']);

export function statusOptionDisabled(
  option: string,
  ctx: {
    canPublish: boolean;
    /** The status currently chosen in the form. */
    current: string;
    /** The status stored in the database; null for a document not saved yet. */
    saved: string | null;
  },
): boolean {
  if (ctx.canPublish || option === ctx.current) return false;
  // Taking a live document down needs the same right as putting it up.
  if (isLiveStatus(ctx.saved)) return true;
  return !NON_LIVE.has(option);
}

/** The description under the Status field, or undefined for someone who may publish. */
export function statusHint(ctx: { canPublish: boolean; saved: string | null }): string | undefined {
  if (ctx.canPublish) return undefined;
  if (isLiveStatus(ctx.saved)) {
    return 'Your role can write and edit, but not publish. This document is live, so only someone with publishing rights can archive it or turn it back into a draft. Your edits still save.';
  }
  return 'Your role can write and edit, but not publish. Someone with publishing rights takes it live.';
}

/**
 * What each status does, behind the "i" beside the Status field — for everyone,
 * not only writers: "archived" and "scheduled" are not self-evident to an owner.
 * Each language of a document carries its own status (the field says which).
 */
export const STATUS_HELP =
  'Draft: saved, but not on the site. Published: live now. Scheduled: goes live by itself at the “Publish at” time. Archived: taken off the site but kept, so it can be brought back.';
