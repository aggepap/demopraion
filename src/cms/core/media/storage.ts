import 'server-only';

import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

/**
 * Binary storage behind a small interface so the backend can move from local
 * disk to S3-compatible object storage without touching the media service.
 * Files are keyed by the media uuid; the mime type lives in the DB row.
 */
export interface StorageAdapter {
  save(key: string, data: Buffer): Promise<void>;
  read(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

/** Local-disk storage. Directory from `CMS_UPLOAD_DIR`, default `.data/uploads`
 *  under the project root (persistent on a long-running Node server). */
class LocalDiskStorage implements StorageAdapter {
  private dir = process.env.CMS_UPLOAD_DIR || join(process.cwd(), '.data', 'uploads');

  /**
   * The on-disk path for a key.
   *
   * This used to be a bare `join(this.dir, key)` under the comment "key is a
   * uuid — no path separators, safe to join directly". That was true of every
   * caller by convention and enforced by none of them: `deleteMedia` passed a
   * URL path segment through with no format check and no row lookup, so the
   * comment was the only thing standing between a route param and `unlink()`.
   *
   * The callers validate now (`uuidParam`, and a row must exist), but the
   * invariant belongs here too — this is the function that builds the path, and
   * it is the last place that can still say no. Checking the *resolved* path
   * catches whatever spelling of `..` or absolute path a future caller invents,
   * rather than trying to enumerate them.
   */
  private path(key: string): string {
    const root = resolve(this.dir);
    const full = resolve(root, key);
    if (full !== root && !full.startsWith(root + sep)) {
      throw new Error('Media key resolves outside the upload directory.');
    }
    return full;
  }

  async save(key: string, data: Buffer): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.path(key), data);
  }

  read(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }

  async delete(key: string): Promise<void> {
    // Resolved OUTSIDE the try: `path()` throws on a key that escapes the upload
    // directory, and this catch exists to forgive a file that is already gone.
    // Inside, it would forgive the containment failure too — silently, which is
    // the one outcome worse than either.
    const target = this.path(key);
    try {
      await unlink(target);
    } catch {
      /* already gone */
    }
  }
}

let instance: StorageAdapter | null = null;

export function getStorage(): StorageAdapter {
  if (!instance) instance = new LocalDiskStorage();
  return instance;
}
