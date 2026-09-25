/**
 * How a praion page is named on the wire.
 *
 * Every catalogue item carries `remote_type` (PM's page-type vocabulary) and
 * `remote_id` (`doc:42`, or `archive_home` for a virtual archive). PM stores
 * both and sends them back on a push.
 *
 * ## Locale is deliberately absent
 *
 * Not because multilingual is out of scope forever — because `doc:42@en` can
 * then be added later without invalidating every `doc:42` PM has already stored.
 * An identity format is the one thing that is expensive to change after the fact.
 *
 * Pure functions, no database, no `server-only`.
 */
import { isPmArchiveType, type PmArchiveType } from '../../config/pm-types';

export type PmRef =
  | { kind: 'document'; id: number }
  | { kind: 'archive'; type: PmArchiveType };

/** `doc:42`. */
export function encodeRemoteId(row: { id: number }): string {
  return `doc:${row.id}`;
}

export class PmRefError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PmRefError';
  }
}

/**
 * Turn PM's `{type}/{ref}` pair into something we can resolve.
 *
 * Accepts `doc:42`, a bare `42`, and `archive_*`. PM extracts the tail after `:`
 * when it pushes, so both spellings genuinely arrive — and a bare number is what
 * `pushProduct()` sends, which addresses products by id rather than by type.
 *
 * **The `type` is advisory.** It is used only to recognise an archive; a
 * document ref resolves on the id, and the caller then asserts the resolved
 * document's collection actually declares that page type. That assertion is what
 * lets four collections safely share `wp_post`, and what stops a stale PM record
 * from writing an article's title onto a product.
 */
export function decodeRef(type: string, ref: string): PmRef {
  const trimmed = ref.trim();

  if (isPmArchiveType(trimmed)) {
    return { kind: 'archive', type: trimmed };
  }
  // PM addresses an archive by type with the type repeated as the ref, but a
  // caller that sends only the type is unambiguous too.
  if (isPmArchiveType(type) && (trimmed === '' || trimmed === type)) {
    return { kind: 'archive', type };
  }

  const tail = trimmed.startsWith('doc:') ? trimmed.slice(4) : trimmed;
  if (!/^\d+$/.test(tail)) {
    throw new PmRefError(`"${ref}" is not a document reference.`);
  }
  const id = Number(tail);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new PmRefError(`"${ref}" is not a document reference.`);
  }
  return { kind: 'document', id };
}

/** The `remote_id` for whatever a ref points at. */
export function encodeRef(ref: PmRef): string {
  return ref.kind === 'archive' ? ref.type : `doc:${ref.id}`;
}
