/**
 * Server-side image helpers for images the CMS fetches itself (a Google
 * reviewer's avatar), as opposed to images an administrator uploads.
 *
 * Such images are stored and served locally, so the visitor's browser never
 * contacts the third party before consent, and re-encoded as WebP — which also
 * means whatever the remote sent is decoded by sharp and rebuilt from pixels,
 * never stored as received.
 */
import sharp from 'sharp';

import { checkRemoteImageUrl } from './remote-url';

export interface ToWebpOptions {
  maxWidth: number;
  quality?: number;
}

/** Decode, shrink to at most `maxWidth` (never enlarge), and encode as WebP.
 *  Rejects anything sharp cannot decode as a raster image. */
export async function toWebp(input: Buffer, opts: ToWebpOptions): Promise<Buffer> {
  const image = sharp(input, { failOn: 'error', limitInputPixels: 40_000_000 });
  const meta = await image.metadata();
  if (!meta.format || meta.format === 'svg') {
    throw new Error('Not a raster image.');
  }
  return image
    .rotate()
    .resize({ width: opts.maxWidth, withoutEnlargement: true })
    .webp({ quality: opts.quality ?? 80 })
    .toBuffer();
}

export interface FetchRemoteImageOptions {
  allowHosts: readonly string[];
  maxBytes: number;
  timeoutMs: number;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Fetch an image from an allowlisted host. Redirects are not followed (a
 * redirect is how an allowed host hands the request to an internal one), the
 * body is capped while it streams, and the response must say it is an image.
 */
export async function fetchRemoteImage(
  rawUrl: string,
  opts: FetchRemoteImageOptions
): Promise<Buffer> {
  const check = checkRemoteImageUrl(rawUrl, opts.allowHosts);
  if (!check.ok) throw new Error(`Refusing to fetch image: ${check.reason}.`);

  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(check.url.toString(), {
    redirect: 'manual',
    signal: AbortSignal.timeout(opts.timeoutMs),
    headers: { accept: 'image/*' },
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Image fetch failed with status ${res.status}.`);
  }
  const type = (res.headers.get('content-type') ?? '').toLowerCase();
  if (!type.startsWith('image/') || type.startsWith('image/svg')) {
    throw new Error('Remote response is not a raster image.');
  }
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > opts.maxBytes) {
    throw new Error('Remote image is too large.');
  }
  if (!res.body) throw new Error('Remote image has no body.');

  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > opts.maxBytes) {
      await reader.cancel();
      throw new Error('Remote image is too large.');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
