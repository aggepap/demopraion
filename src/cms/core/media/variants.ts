/**
 * One media URL, two encodings.
 *
 * Every still image is stored as WebP under its uuid and, beside it, as AVIF
 * under `<uuid>.avif` (see `prepareUpload`). The public file route stays a
 * single URL and chooses between the two per request from `Accept`, so nothing
 * that already links to a file has to change: a browser that can decode AVIF
 * gets the smaller file, and everything else — an older browser, a product-feed
 * fetcher, a social crawler reading `og:image` — gets the WebP it always got.
 *
 * The row describes the WebP alone. The AVIF is an optional companion: older
 * uploads and animations have none, and the route falls back without asking the
 * database.
 */
import type { StorageAdapter } from './storage';

/** The storage key of a file's AVIF companion. A suffix on the uuid, so it sits
 *  in the same directory and passes the same containment check. */
export function avifKey(uuid: string): string {
  return `${uuid}.avif`;
}

/**
 * Does this `Accept` header ask for AVIF?
 *
 * Only an explicit `image/avif` with a non-zero q counts. Wildcards such as
 * `image/*` are what crawlers and feed fetchers send, and they mean "send something", not
 * "I can decode AVIF" — reading them as a yes would hand AVIF to exactly the
 * clients least likely to open it.
 */
export function acceptsAvif(accept: string | null | undefined): boolean {
  if (!accept) return false;
  return accept.split(',').some((part) => {
    const [type, ...params] = part.split(';').map((s) => s.trim().toLowerCase());
    if (type !== 'image/avif') return false;
    const q = params.find((p) => p.startsWith('q='));
    return q === undefined || Number(q.slice(2)) > 0;
  });
}

export interface ServedFile {
  body: Buffer;
  contentType: string;
  /** Whether the answer depended on `Accept`, and so must be sent with
   *  `Vary: Accept` or a shared cache could hand AVIF to a browser that
   *  cannot decode it. */
  negotiated: boolean;
}

/**
 * The bytes to answer a request for a stored file with.
 *
 * Only a WebP row can have an AVIF companion — that is what every image upload
 * becomes — so a PDF or a row predating conversion is read as stored and never
 * negotiated. A missing AVIF is not an error: older uploads and animations have
 * none, and the WebP is the answer for them.
 */
export async function readForAccept(
  storage: Pick<StorageAdapter, 'read'>,
  uuid: string,
  mime: string,
  accept: string | null,
): Promise<ServedFile> {
  if (mime !== 'image/webp') {
    return { body: await storage.read(uuid), contentType: mime, negotiated: false };
  }
  if (acceptsAvif(accept)) {
    try {
      return { body: await storage.read(avifKey(uuid)), contentType: 'image/avif', negotiated: true };
    } catch {
      /* no AVIF for this file — serve the WebP */
    }
  }
  return { body: await storage.read(uuid), contentType: mime, negotiated: true };
}
