import 'server-only';

import { randomUUID } from 'node:crypto';

import { count, desc, eq, like } from 'drizzle-orm';

import { adapter, getDb, schema } from '../../db';
import { likeTerm } from '../db/like';
import type { MediaFile } from '../../db/adapters/mysql/schema/media';
import { prepareUpload, type UploadBytes } from './normalize';
import { getStorage } from './storage';
import { avifKey } from './variants';

export type MediaUploadInput = UploadBytes;

/** The public URL a stored media file is served at. */
export function mediaUrl(uuid: string): string {
  return `/api/cms/media/file/${uuid}`;
}

/** Largest page the endpoint will serve, and what it serves when unasked. */
export const MEDIA_PAGE_MAX = 500;
export const MEDIA_PAGE_DEFAULT = 200;

/**
 * The page size actually served for a requested `limit`. The route reports it as
 * `pageSize`, so both must come from here — they disagreed (500 vs 200) when no
 * limit was sent.
 */
export function mediaPageLimit(limit: number | undefined): number {
  return Math.min(MEDIA_PAGE_MAX, Math.max(1, Math.floor(limit ?? MEDIA_PAGE_DEFAULT)));
}

/**
 * One page of media files, newest first.
 *
 * This used to select the entire table on every call, and it is called every
 * time the media library opens and every time a picker is opened inside a
 * document form. Each row carries a serve URL, so a library that grows to a few
 * thousand uploads turns an ordinary edit screen into a multi-megabyte response
 * — slowly, invisibly, and long after anyone would connect the two. Every other
 * list in this codebase is bounded; this one was the exception.
 *
 * The shape is still a plain array, so callers page by asking for the next
 * offset when a full page comes back.
 */
export async function listMedia(
  opts: { limit?: number; offset?: number; search?: string } = {},
): Promise<Array<MediaFile & { url: string }>> {
  const limit = mediaPageLimit(opts.limit);
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const term = opts.search?.trim();
  const rows = await getDb()
    .select()
    .from(schema.mediaFiles)
    .where(term ? like(schema.mediaFiles.originalName, likeTerm(term)) : undefined)
    .orderBy(desc(schema.mediaFiles.createdAt))
    .limit(limit)
    .offset(offset);
  return rows.map((r) => ({ ...r, url: mediaUrl(r.uuid) }));
}

/**
 * How many files there are, so the screen can say.
 *
 * Every other list in the admin states its size; the media grid did not, and had no
 * search either — the only way to a particular file among hundreds was to scroll and
 * press "Load more" until it appeared, with no idea how far there was to go.
 */
export async function countMedia(search?: string): Promise<number> {
  const term = search?.trim();
  const [row] = await getDb()
    .select({ total: count() })
    .from(schema.mediaFiles)
    .where(term ? like(schema.mediaFiles.originalName, likeTerm(term)) : undefined);
  return Number(row?.total ?? 0);
}

/**
 * The file with these exact stored bytes, if the library already has it.
 *
 * `media_files.hash` has carried a sha256 and an index since the beginning with
 * nothing that read either. It is the digest of the bytes as stored — after
 * `prepareUpload` — which is what makes it useful here: the same original
 * re-encodes identically, so uploading it twice lands on the same digest
 * whatever the two files were called.
 */
export async function findMediaByHash(hash: string): Promise<MediaFile | null> {
  const [row] = await getDb().select().from(schema.mediaFiles).where(eq(schema.mediaFiles.hash, hash)).limit(1);
  return row ?? null;
}

export async function getMedia(uuid: string): Promise<MediaFile | null> {
  const [row] = await getDb().select().from(schema.mediaFiles).where(eq(schema.mediaFiles.uuid, uuid)).limit(1);
  return row ?? null;
}

/**
 * Store an upload.
 *
 * The bytes that land on disk are not the bytes that were uploaded: every image
 * is re-encoded as WebP inside a fixed box first (`prepareUpload`), and the row
 * — size, hash, dimensions, extension — describes what was stored, not what was
 * sent. A still image's AVIF companion is written beside it under
 * `avifKey(uuid)`; the row does not mention it (see `./variants`). This is the
 * only place uploads are written, which is what makes that conversion the
 * default in every upload place in the admin rather than a thing each screen
 * has to remember.
 *
 * A file the library already holds is handed back instead of stored again, with
 * `duplicate: true` so the caller can say so. The existing row is returned
 * untouched — its name and its alt text are someone's work, and a second upload
 * of the same bytes is not a reason to overwrite either. Detection is
 * best-effort by design: there is no unique constraint on the column, so two
 * identical uploads racing each other both store, which costs a duplicate row
 * and nothing else.
 *
 * Throws `MediaProcessingError` when the image cannot be decoded; the route
 * answers 415. Nothing is written in that case.
 */
export async function uploadMedia(
  input: MediaUploadInput,
  uploadedBy: number | null,
): Promise<MediaFile & { url: string; duplicate: boolean }> {
  const file = await prepareUpload(input);

  const existing = await findMediaByHash(file.hash);
  if (existing) return { ...existing, url: mediaUrl(existing.uuid), duplicate: true };

  const uuid = randomUUID();
  await getStorage().save(uuid, file.buffer);
  if (file.avif) await getStorage().save(avifKey(uuid), file.avif);
  await getDb().insert(schema.mediaFiles).values({
    uuid,
    originalName: file.originalName,
    mime: file.mime,
    size: file.size,
    width: file.width,
    height: file.height,
    hash: file.hash,
    uploadedBy,
  });

  const row = (await getMedia(uuid))!;
  return { ...row, url: mediaUrl(uuid), duplicate: false };
}

/**
 * Set a media file's default alt text.
 *
 * `media_files.alt_text` has existed in the schema since the beginning with
 * nothing that could write it — no API, no screen. The PM bridge needs to write
 * it, and a column only a machine can edit is worse than a column that does not
 * exist: an editor would see alt text on the site with no way to correct it.
 *
 * Returns false when there is no such file, so a caller can answer 404 rather
 * than reporting a write that hit nothing.
 */
export async function setMediaAltText(uuid: string, altText: string | null): Promise<boolean> {
  const res = await getDb()
    .update(schema.mediaFiles)
    .set({ altText: altText && altText.trim() !== '' ? altText.trim() : null })
    .where(eq(schema.mediaFiles.uuid, uuid));
  return adapter.affectedRows(res) > 0;
}

/**
 * Remove a media file — the row and its bytes.
 *
 * Resolves the row FIRST, and does nothing at all when there isn't one. This
 * used to hand its argument straight to `getStorage().delete()`, which reaches
 * `unlink(join(uploadDir, key))`: an argument that is not a real uuid never got
 * the chance to be refused, because the only thing that could refuse it was a
 * database lookup that happened afterwards. The sibling GET route has always
 * resolved the row first; this now matches it.
 *
 * Returns false when there is no such file, so the route can answer 404 rather
 * than reporting a delete that hit nothing.
 */
export async function deleteMedia(uuid: string): Promise<boolean> {
  const row = await getMedia(uuid);
  if (!row) return false;
  await getStorage().delete(row.uuid);
  // Absent for PDFs, animations and older uploads; `delete` forgives that.
  await getStorage().delete(avifKey(row.uuid));
  await getDb().delete(schema.mediaFiles).where(eq(schema.mediaFiles.uuid, row.uuid));
  return true;
}
