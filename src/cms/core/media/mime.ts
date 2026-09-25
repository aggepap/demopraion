/**
 * Upload type policy.
 *
 * The browser-supplied `File.type` is an attacker-controlled string: it is
 * whatever the client put in the multipart part, and it was previously stored
 * verbatim and replayed as the `Content-Type` of the public file route. That
 * turned the media library into a same-origin HTML/SVG host — an `editor` (who
 * holds `cms.media.write` but is not a superadmin) could upload a scripted SVG
 * and run script in an authenticated admin's origin.
 *
 * So the declared type is never trusted. The bytes decide.
 */

/** Types we are willing to accept AND to serve inline. */
export const ALLOWED_UPLOAD_MIME = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'application/pdf',
] as const;

export type AllowedMime = (typeof ALLOWED_UPLOAD_MIME)[number];

const ALLOWED = new Set<string>(ALLOWED_UPLOAD_MIME);

/** Is this stored type one we are willing to hand back with its own Content-Type? */
export function isAllowedMime(mime: string | null | undefined): mime is AllowedMime {
  return !!mime && ALLOWED.has(mime);
}

const startsWith = (buf: Buffer, bytes: number[], at = 0): boolean =>
  buf.length >= at + bytes.length && bytes.every((b, i) => buf[at + i] === b);

const ascii = (buf: Buffer, text: string, at = 0): boolean =>
  buf.length >= at + text.length && buf.subarray(at, at + text.length).toString('latin1') === text;

/**
 * Identify a buffer by its magic bytes.
 *
 * Returns null for anything not on the allow-list — including SVG, which is a
 * plain-text XML document and therefore has no magic number to key on. That is
 * deliberate: SVG is the exact format that makes this class of bug exploitable,
 * and sanitizing it correctly is a much larger commitment than refusing it.
 */
export function sniffMime(buf: Buffer): AllowedMime | null {
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (ascii(buf, 'GIF87a') || ascii(buf, 'GIF89a')) return 'image/gif';
  if (ascii(buf, 'RIFF') && ascii(buf, 'WEBP', 8)) return 'image/webp';
  // ISO-BMFF: `....ftyp<brand>`; AVIF still images use the `avif` major brand.
  if (ascii(buf, 'ftyp', 4) && (ascii(buf, 'avif', 8) || ascii(buf, 'avis', 8))) return 'image/avif';
  if (ascii(buf, '%PDF-')) return 'application/pdf';
  return null;
}

/** Human-readable list for error messages. */
export const ALLOWED_MIME_LABEL = ALLOWED_UPLOAD_MIME.join(', ');
