/**
 * Scheduled → published, once the publish time has passed.
 *
 * The public read already treats a `scheduled` document whose `scheduledFor` has
 * passed as live (`read/visibility.ts`), so visitors saw it on time. The stored
 * status never moved, though: the admin list and the form went on calling a page
 * "scheduled" weeks after it went up, and an editor had no way to tell a page
 * that is live from one that is still waiting.
 *
 * This rewrites the status to `published` (see `scheduledPublisher` for why with
 * one conditional UPDATE) and writes one audit row per document, attributed to
 * the scheduler. It runs from two places:
 *
 * - the `content-publish-scheduled` cron job, for sites with a scheduler;
 * - the admin's own list and edit screens, before they read, so the status is
 *   right whenever someone looks — with or without a cron.
 *
 * The published date becomes the moment the document was scheduled for, not the
 * moment it was noticed, unless the editor had already set one (a backdate).
 */
import { and, eq, lte } from 'drizzle-orm';

import { adapter, getDb, schema } from '../../db';
import { logAudit, type AuditEntry } from '../audit';
import { revalidateDocument } from '../read/revalidate';

/** Stored as the audit row's actor, as the cron runner writes `cron`. */
export const SCHEDULER_ACTOR = 'scheduler';

/** One run never promotes more than this; the next run takes the rest. */
const BATCH_LIMIT = 200;

export interface ScheduledDocument {
  id: number;
  type: string;
  locale: string;
  slug: string;
  status: string;
  publishedAt: Date | null;
  scheduledFor: Date | null;
  /** For cache invalidation of the public page; absent when unknown. */
  canonicalPath?: string | null;
}

export interface PublishPatch {
  status: 'published';
  publishedAt: Date;
}

export interface PublishScheduledDeps {
  /** Scheduled documents whose time is at or before `now`, optionally of one collection. */
  listDue: (now: Date, type?: string) => Promise<ScheduledDocument[]>;
  /** `false` when the document changed since it was listed and was left alone. */
  publish: (doc: ScheduledDocument, patch: PublishPatch) => Promise<boolean>;
  audit: (entry: AuditEntry) => Promise<void>;
  revalidate?: (doc: ScheduledDocument) => void;
}

export interface PublishScheduledResult {
  published: number;
  failed: number;
}

export async function publishDueScheduled(
  deps: PublishScheduledDeps,
  opts: { now?: Date; type?: string } = {},
): Promise<PublishScheduledResult> {
  const now = opts.now ?? new Date();
  const due = await deps.listDue(now, opts.type);
  let published = 0;
  let failed = 0;
  for (const doc of due) {
    if (doc.status !== 'scheduled' || !doc.scheduledFor || doc.scheduledFor > now) continue;
    const patch: PublishPatch = {
      status: 'published',
      publishedAt: doc.publishedAt ?? doc.scheduledFor,
    };
    try {
      if (!(await deps.publish(doc, patch))) continue;
    } catch (err) {
      // One failed write (a database error) must not stop
      // the rest; it stays scheduled — and still live — and is retried next run.
      console.error('[cms] could not publish scheduled document', { id: doc.id }, err);
      failed += 1;
      continue;
    }
    published += 1;
    deps.revalidate?.(doc);
    await deps.audit({
      userId: null,
      actorLabel: SCHEDULER_ACTOR,
      action: 'document.publish_scheduled',
      subjectType: doc.type,
      subjectId: doc.id,
      before: { status: doc.status, scheduledFor: doc.scheduledFor },
      after: { status: patch.status, publishedAt: patch.publishedAt },
    });
  }
  return { published, failed };
}

/** The real collaborators: the documents table and the audit log. */
export function scheduledPublisher(): PublishScheduledDeps {
  return {
    listDue: (now, type) =>
      getDb()
        .select({
          id: schema.documents.id,
          type: schema.documents.type,
          locale: schema.documents.locale,
          slug: schema.documents.slug,
          status: schema.documents.status,
          publishedAt: schema.documents.publishedAt,
          scheduledFor: schema.documents.scheduledFor,
          canonicalPath: schema.documents.canonicalPath,
        })
        .from(schema.documents)
        .where(
          and(
            eq(schema.documents.status, 'scheduled'),
            lte(schema.documents.scheduledFor, now),
            type ? eq(schema.documents.type, type) : undefined,
          ),
        )
        .limit(BATCH_LIMIT),
    publish: async (doc, patch) => {
      if (!doc.scheduledFor) return false;
      /*
       * One conditional UPDATE of the status and the date, not the full update path.
       *
       * Conditional, because the list is a snapshot: an editor who moved the
       * document back to draft, or re-dated it, a moment ago must not be
       * overridden — the WHERE makes that check and the write one statement.
       *
       * Not `updateDocument`, because that appends a version, and the version
       * count is the editor's concurrency token: whoever had the page open when it
       * went live would have their next save refused as "changed by another
       * editor". Nothing an editor wrote changes here — content, relations and
       * redirects are exactly as they were (live before, live after) — and the
       * audit log records the change instead.
       */
      const res = await getDb()
        .update(schema.documents)
        .set({ status: patch.status, publishedAt: patch.publishedAt })
        .where(
          and(
            eq(schema.documents.id, doc.id),
            eq(schema.documents.status, 'scheduled'),
            eq(schema.documents.scheduledFor, doc.scheduledFor),
          ),
        );
      return adapter.affectedRows(res) > 0;
    },
    audit: logAudit,
    revalidate: (doc) => revalidateDocument({ ...doc, canonicalPath: doc.canonicalPath ?? null }),
  };
}

/**
 * Promote what is due, for a screen about to show statuses. Never throws: a
 * failure here must not stop the admin from rendering the list it was asked for.
 */
export async function promoteDueScheduled(type?: string): Promise<void> {
  try {
    await publishDueScheduled(scheduledPublisher(), { type });
  } catch (err) {
    console.error('[cms] scheduled publishing check failed', err);
  }
}
