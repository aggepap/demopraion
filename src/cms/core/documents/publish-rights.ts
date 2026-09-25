/**
 * When a write needs `cms.content.publish`, and what to say when it is refused.
 *
 * Putting content live and taking it down are the same privilege: `contentWrite`
 * alone may edit a published document's text, but not publish, schedule, archive
 * or turn it back into a draft. The refusal used to be a bare `forbidden`, which
 * the form showed as the whole error — the writer was not told what they had done
 * or what to do instead.
 *
 * Pure, so the rule and its wording are tested without a session.
 */
import { NextResponse } from 'next/server';

import { PERMISSIONS } from '../../modules/auth/permissions';
import { isLiveStatus } from './live-status';

export { isLiveStatus };

export const PUBLISH_DENIED_GOES_LIVE =
  'Your role cannot publish. Save it as a draft and ask someone with publishing rights to take it live.';

export const PUBLISH_DENIED_GOES_DARK =
  'This document is live. Your role can edit it, but only someone with publishing rights can archive it or turn it back into a draft.';

export const PUBLISH_DENIED_DELETE_LIVE =
  'This document is live. Only someone with publishing rights can delete it — ask them, or ask them to unpublish it first.';

/**
 * The message for a write that needs publish rights, or null when it needs none.
 *
 * Both the status and the editorial date fields can take a document live, so all
 * of them count. Taking a live document to a non-live status counts too.
 */
export function publishDenialMessage(
  input: { status?: string; publishedAt?: Date | null; scheduledFor?: Date | null },
  before?: { status?: string } | null,
): string | null {
  const goesDark = isLiveStatus(before?.status) && input.status !== undefined && !isLiveStatus(input.status);
  if (goesDark) return PUBLISH_DENIED_GOES_DARK;
  const goesLive =
    isLiveStatus(input.status) || input.publishedAt != null || input.scheduledFor != null;
  return goesLive ? PUBLISH_DENIED_GOES_LIVE : null;
}

/** The 403 for a refused publish: the usual shape, plus a sentence a person can act on. */
export function publishForbidden(message: string): NextResponse {
  return NextResponse.json(
    { ok: false, error: 'forbidden', missing: PERMISSIONS.contentPublish, message },
    { status: 403 },
  );
}
