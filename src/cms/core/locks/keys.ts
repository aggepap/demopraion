/**
 * Lock keys — what "the same thing" means for each lockable resource.
 *
 * Pure and dependency-free on purpose: the same function has to produce the
 * same key on the server (which enforces the lock) and in the browser (which
 * subscribes to the room). A mismatch between the two would not fail loudly —
 * it would quietly hand two people two different locks on one document.
 */

/** The character set a key may use, and its storage width. Anything outside it
 *  is rejected rather than stored: keys are pasted into room names and into a
 *  `varchar(64)`, and a key that silently truncated would collide. */
const KEY_PATTERN = /^[A-Za-z0-9:_-]{1,64}$/;

export function isValidResourceKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

/**
 * The lock key for a document.
 *
 * One editor screen edits EVERY locale of a document — the language tabs in
 * `DocumentForm` are variants of one `translation_group_id`, and which row id
 * appears in the URL depends only on which language you happened to open. So
 * the group, not the row, is what gets locked.
 *
 * `translation_group_id` is nullable (rows predating it, and rows created
 * outside the form), hence the fallback. It uses the LOWEST variant id rather
 * than the id in the URL, because every variant must derive the identical key:
 * keying on "the id I opened" gave /admin/article/12 and /admin/article/13 two
 * separate locks on one document, and told both editors it was free.
 */
export function documentLockKey(doc: {
  translationGroupId: string | null;
  variantIds: readonly number[];
}): string {
  if (doc.translationGroupId) return doc.translationGroupId;
  return `row:${Math.min(...doc.variantIds)}`;
}

export function orderLockKey(id: number): string {
  return String(id);
}

export function reservationLockKey(id: number): string {
  return String(id);
}
