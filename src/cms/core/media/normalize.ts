/**
 * What every upload becomes before it is stored.
 *
 * An editor uploads whatever their phone or their designer handed them: a 6 MB
 * 4032x3024 JPEG with the GPS coordinates of the office in its EXIF, a PNG
 * screenshot four times larger than any slot it will ever sit in. Those bytes
 * used to be stored exactly as received and served to every visitor, so page
 * weight was decided by whoever last dragged a file into the media library.
 *
 * So the bytes are re-made here instead, once, at the single point every upload
 * passes through (`uploadMedia`): decoded, turned the right way up, fitted
 * inside {@link UPLOAD_MAX_WIDTH}x{@link UPLOAD_MAX_HEIGHT} without ever being
 * enlarged, and re-encoded as WebP — plus, for a still image, an AVIF of the
 * same pixels that the file route serves to browsers asking for it
 * (`./variants`). No screen opts in and none can opt out —
 * the media library, the picker behind every `f.image()` field, the brand logo
 * and favicon, product galleries, variation images and the SEO social image all
 * reach this function through the one upload route.
 *
 * Two things fall out of doing it here rather than per screen. The stored file
 * is always something sharp itself produced, never the bytes a client sent — the
 * same property the remote-image path relies on — and EXIF (including location)
 * is gone, because sharp only carries metadata across when asked to.
 */
import { createHash } from 'node:crypto';

import sharp from 'sharp';

import type { AllowedMime } from './mime';

/** The box an uploaded image is fitted inside. Ratio is preserved, so only one
 *  of the two is reached; a portrait is capped by the height, a landscape by the
 *  width, and an image already inside the box is left at its own size. */
export const UPLOAD_MAX_WIDTH = 1600;
export const UPLOAD_MAX_HEIGHT = 1200;

/** WebP quality. 82 is the knee of the curve for photographs: visually matched
 *  to the source at roughly a third of a JPEG's bytes. */
export const UPLOAD_WEBP_QUALITY = 82;

/** AVIF quality. AVIF's scale runs lower than WebP's for the same look; 55 is
 *  about where it matches the WebP above, at roughly two thirds of its bytes. */
export const UPLOAD_AVIF_QUALITY = 55;

/** AVIF encoder effort (0-9). sharp's default of 4 spent ~6 s on a 12 MP photo
 *  for a file under 10% smaller than effort 2 produces in ~0.7 s — and the
 *  editor waits on this inside the upload request. */
export const UPLOAD_AVIF_EFFORT = 2;

/**
 * Refuse to decode more than this many pixels.
 *
 * The route caps the upload at 10 MB, which says nothing about what those bytes
 * expand to: a 1.2 MB PNG can declare 7000x6000 and cost gigabytes of memory to
 * decode. The remote-fetch path has always had this guard; admin uploads did not.
 */
export const UPLOAD_MAX_PIXELS = 40_000_000;

/** `media_files.original_name` is a varchar(255). */
const MAX_NAME_CHARS = 255;

const WEBP_EXT = '.webp';

/** Raised when bytes that passed the magic-byte sniff still cannot be decoded —
 *  a truncated file, a polyglot, or a decompression bomb. The route turns this
 *  into a 415 rather than storing something no renderer can open. */
export class MediaProcessingError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'MediaProcessingError';
  }
}

export interface UploadBytes {
  buffer: Buffer;
  originalName: string;
  mime: AllowedMime;
}

/** Everything the media row and the storage adapter need, all of it describing
 *  the bytes that are actually stored. */
export interface PreparedUpload {
  buffer: Buffer;
  /** The same image as AVIF, stored beside `buffer` and served to browsers that
   *  accept it. Null for a PDF, an animation (sharp cannot write animated AVIF,
   *  and a still one would silently drop the frames), and whenever the AVIF came
   *  out no smaller than the WebP. Size and hash describe `buffer` only. */
  avif: Buffer | null;
  originalName: string;
  mime: AllowedMime;
  width: number | null;
  height: number | null;
  size: number;
  hash: string;
}

/**
 * Cut a name to a character budget without splitting a character in half.
 *
 * `String.slice` counts UTF-16 code units, so a plain `slice(0, 255)` can land
 * between the two halves of a surrogate pair — an emoji or many CJK characters —
 * and store a lone surrogate: a filename the database accepts and no renderer
 * can display. Iterating the string yields whole code points.
 */
export function truncateChars(name: string, max: number): string {
  const chars = [...name];
  return chars.length <= max ? name : chars.slice(0, max).join('');
}

/**
 * Swap a name's extension for `.webp`, keeping room for it inside the column.
 *
 * Truncating first and appending after is deliberate: a 300-character name cut
 * to 255 and *then* given its extension would lose the `.webp` that says what
 * the file now is. A leading dot is a hidden file, not an extension.
 */
function webpName(originalName: string): string {
  const name = originalName.trim() === '' ? 'image' : originalName;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return `${truncateChars(stem, MAX_NAME_CHARS - WEBP_EXT.length)}${WEBP_EXT}`;
}

interface EncodedImage {
  buffer: Buffer;
  avif: Buffer | null;
  width: number;
  height: number;
}

/**
 * Decode, fit inside the box, re-encode as WebP.
 *
 * The source is probed first for its page count, because an animated GIF or
 * WebP decoded as a still image loses every frame but the first — an editor's
 * animation would arrive as a motionless picture with nothing to say why. When
 * there are frames, all of them are resized and kept, and the reported height is
 * one frame's (`pageHeight`), not the frames stacked into one tall strip.
 *
 * `rotate()` with no argument means "apply the EXIF orientation": without it a
 * photograph taken sideways stays sideways once the EXIF is dropped. It is not
 * applied to animations, which carry no orientation tag.
 *
 * Deliberately not `toWebp()` from `./image`, which looks similar: that one
 * serves the remote-fetch path (a reviewer's avatar), caps a single dimension
 * at a thumbnail width and flattens frames, because an avatar that animates in
 * a review list is a bug. This one is the upload policy.
 */
async function toUploadWebp(input: Buffer): Promise<EncodedImage> {
  const decode = { failOn: 'error' as const, limitInputPixels: UPLOAD_MAX_PIXELS };

  const probe = await sharp(input, decode).metadata();
  if (!probe.format || probe.format === 'svg') {
    throw new MediaProcessingError('Not a raster image.');
  }
  const animated = (probe.pages ?? 1) > 1;

  const pipeline = sharp(input, { ...decode, animated });
  const fitted = (animated ? pipeline : pipeline.rotate()).resize({
    width: UPLOAD_MAX_WIDTH,
    height: UPLOAD_MAX_HEIGHT,
    fit: 'inside',
    withoutEnlargement: true,
  });
  // Both encodings branch off the one decoded, rotated, resized image, so they
  // hold the same pixels and the row's width/height describe either.
  const [{ data, info }, avif] = await Promise.all([
    fitted.clone().webp({ quality: UPLOAD_WEBP_QUALITY }).toBuffer({ resolveWithObject: true }),
    animated ? Promise.resolve(null) : fitted.clone().avif({ quality: UPLOAD_AVIF_QUALITY, effort: UPLOAD_AVIF_EFFORT }).toBuffer(),
  ]);

  return {
    buffer: data,
    avif: avif && avif.length < data.length ? avif : null,
    width: info.width,
    height: info.pageHeight ?? info.height,
  };
}

function prepared(
  buffer: Buffer,
  avif: Buffer | null,
  originalName: string,
  mime: AllowedMime,
  width: number | null,
  height: number | null,
): PreparedUpload {
  return {
    buffer,
    avif,
    originalName,
    mime,
    width,
    height,
    size: buffer.length,
    hash: createHash('sha256').update(buffer).digest('hex'),
  };
}

/**
 * Turn accepted upload bytes into the row and the file that get stored.
 *
 * `mime` is the sniffed type, never the client-declared one. A PDF is passed
 * through untouched — there is nothing to resize and re-encoding it would be a
 * different feature — and everything else on the allow-list is a raster image,
 * so it goes through the box.
 */
export async function prepareUpload(input: UploadBytes): Promise<PreparedUpload> {
  if (input.mime === 'application/pdf') {
    return prepared(input.buffer, null, truncateChars(input.originalName, MAX_NAME_CHARS), input.mime, null, null);
  }

  let image: EncodedImage;
  try {
    image = await toUploadWebp(input.buffer);
  } catch (err) {
    if (err instanceof MediaProcessingError) throw err;
    // sharp's own failures — a truncated file, an unsupported variant of a
    // format, the pixel limit — all mean the same thing to a caller: these bytes
    // are not an image we can store. The detail stays in `cause`, out of the
    // response, because it quotes the file.
    throw new MediaProcessingError('The image could not be processed.', { cause: err });
  }

  return prepared(image.buffer, image.avif, webpName(input.originalName), 'image/webp', image.width, image.height);
}
