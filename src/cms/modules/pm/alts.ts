import 'server-only';

import type { CmsConfig } from '../../config';
import { logAudit } from '../../core/audit';
import { resolveCollectionWithCustomFields } from '../../core/fields/resolve';
import { getDocumentById, updateDocument } from '../../core/documents/service';
import { setMediaAltText } from '../../core/media/service';
import { revalidateDocument } from '../../core/read/revalidate';
import type { BridgePrincipal } from '../../core/tokens/guard';
import { galleryPaths } from './dto';
import { getAtPath, mediaUuidFromUrl, setAtPath } from './mapping';
import type { PmWriteResult } from './write';

/**
 * Writing image alt text.
 *
 * Praion keeps alt text in two reachable places and this writes either or both:
 *
 *   `document` — the `alt` field beside an image inside a gallery repeater. This
 *                is the one that renders today, with no template change.
 *   `library`  — `media_files.alt_text`, the per-asset default.
 *
 * ## The identifier has to match what the read handed out
 *
 * PM keys its pushes by whatever `images[].id` said, so read and write must
 * agree or every alt push silently misses. Three ways to name an image are
 * accepted, in order of preference: the media uuid, the `src` URL it was served
 * at, and the position in the same ordered list the read emitted.
 */

export interface AltEntry {
  media_id?: unknown;
  src?: unknown;
  index?: unknown;
  alt?: unknown;
}

export type AltScope = 'document' | 'library' | 'both';

export function parseScope(value: unknown): AltScope {
  return value === 'library' || value === 'both' ? value : 'document';
}

/** Resolve one entry to a media uuid, using the ordered list as the index base. */
function resolveUuid(entry: AltEntry, ordered: string[]): string | null {
  if (typeof entry.media_id === 'string' && entry.media_id !== '') return entry.media_id;

  if (typeof entry.src === 'string' && entry.src !== '') {
    const uuid = mediaUuidFromUrl(entry.src);
    if (uuid) return uuid;
    // A trailing uuid on any path, for a src that went through a CDN rewrite.
    const tail = /([0-9a-fA-F-]{36})(?:$|[?#])/.exec(entry.src);
    return tail ? tail[1].toLowerCase() : null;
  }

  if (typeof entry.index === 'number' && Number.isInteger(entry.index)) {
    return ordered[entry.index] ?? null;
  }
  return null;
}

/**
 * Apply alt text to one document's galleries and/or the media library.
 *
 * Errors are keyed by the entry's `media_id` when it had one and by its array
 * index otherwise, so PM can point at the row that failed rather than reporting
 * "some images did not update".
 */
export async function applyImageAlts(
  config: CmsConfig,
  documentId: number,
  entries: AltEntry[],
  scope: AltScope,
  principal: BridgePrincipal,
): Promise<PmWriteResult> {
  const result: PmWriteResult = { written: 0, errors: {}, skipped: [] };

  const row = await getDocumentById(documentId);
  if (!row) return { written: 0, errors: { _document: 'No such document.' }, skipped: [] };

  const base = config.collectionByKey.get(row.type);
  if (!base?.pmPageType) {
    return { written: 0, errors: { _document: 'That document is not exposed.' }, skipped: [] };
  }

  const collection = await resolveCollectionWithCustomFields(config, row.type, {
    relaxRequired: true,
    data: (row.data ?? {}) as Record<string, unknown>,
  });

  const galleries = galleryPaths(collection);
  let data = (row.data ?? {}) as Record<string, unknown>;

  // The same flattening order the read DTO used, so `index` means the same thing
  // on both sides.
  const ordered: { uuid: string; gallery: string; row: number }[] = [];
  for (const gallery of galleries) {
    const rows = getAtPath(data, gallery.path);
    if (!Array.isArray(rows)) continue;
    rows.forEach((item, i) => {
      if (!item || typeof item !== 'object') return;
      const uuid = (item as Record<string, unknown>)[gallery.imageKey];
      if (typeof uuid === 'string' && uuid !== '') {
        ordered.push({ uuid, gallery: gallery.path, row: i });
      }
    });
  }
  const orderedUuids = ordered.map((o) => o.uuid);

  const libraryWrites: { uuid: string; alt: string }[] = [];
  let documentChanged = false;

  entries.forEach((entry, position) => {
    const key = typeof entry.media_id === 'string' ? entry.media_id : String(position);
    const alt = typeof entry.alt === 'string' ? entry.alt : null;
    if (alt === null) {
      result.errors[key] = 'Missing alt text.';
      return;
    }

    const uuid = resolveUuid(entry, orderedUuids);
    if (!uuid) {
      result.errors[key] = 'No image matches that reference.';
      return;
    }

    if (scope === 'library' || scope === 'both') {
      libraryWrites.push({ uuid, alt });
    }

    if (scope === 'document' || scope === 'both') {
      const targets = ordered.filter((o) => o.uuid === uuid);
      if (targets.length === 0) {
        // Reported rather than accepted-and-dropped: a grouped-component or
        // variation thumbnail derives its alt from a title today and has no
        // stored field to write.
        if (scope === 'document') {
          result.errors[key] = 'That image is not in a gallery with an editable alt field.';
          return;
        }
      }
      for (const target of targets) {
        const gallery = galleries.find((g) => g.path === target.gallery)!;
        const path = `${target.gallery}.${target.row}.${gallery.altKey}`;
        if (getAtPath(data, path) === alt) {
          result.skipped.push(key);
          continue;
        }
        data = setAtPath(data, path, alt);
        documentChanged = true;
        result.written += 1;
      }
    } else if (scope === 'library') {
      result.written += 1;
    }
  });

  if (documentChanged) {
    // One update for the whole batch: each call appends a full-`data` version
    // snapshot, so per-image writes would multiply history by the gallery size.
    const updated = await updateDocument(config, row.id, { data }, principal.userId, { collection });
    revalidateDocument(updated);
  }

  for (const write of libraryWrites) {
    await setMediaAltText(write.uuid, write.alt);
  }

  if (result.written > 0) {
    await logAudit({
      userId: principal.userId,
      actorLabel: principal.actorLabel,
      action: 'pm.media.alt',
      subjectType: 'document',
      subjectId: row.id,
      after: { count: result.written, scope },
    });
  }

  return result;
}
