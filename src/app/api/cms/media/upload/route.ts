import { NextResponse, type NextRequest } from 'next/server';

import { isSameOrigin } from '@/cms/core/api/same-origin';
import { logAudit } from '@/cms/core/audit';
import { ALLOWED_MIME_LABEL, sniffMime } from '@/cms/core/media/mime';
import { MediaProcessingError } from '@/cms/core/media/normalize';
import { uploadMedia } from '@/cms/core/media/service';
import { checkRateLimit, getClientIp } from '@/cms/core/rate-limit';
import { PERMISSIONS, requireApiPerm } from '@/cms/modules/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

/** Slack for the multipart boundary, part headers and field names around the file. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/**
 * This route is hand-written rather than built with `createRoute()`, because
 * that factory parses the body as JSON and this one takes multipart. The cost
 * of that exception was silent: it was the only write endpoint with neither the
 * same-origin check nor a rate limit, on an operation that writes 10 MB to disk.
 * Both are applied explicitly below, in the same order `createRoute` applies
 * them, so this endpoint is no weaker than the rest of the write surface.
 */
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json(
      { ok: false, error: 'forbidden', message: 'Cross-origin request rejected.' },
      { status: 403 },
    );
  }

  const limit = checkRateLimit('cms-media-upload', getClientIp(req), { max: 60, windowMs: 60_000 });
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: 'rate_limited', message: 'Too many requests.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  const auth = await requireApiPerm(PERMISSIONS.mediaWrite);
  if (auth instanceof NextResponse) return auth;

  /*
   * Refuse an oversized body BEFORE `formData()` reads it.
   *
   * The 10 MB check below runs on `file.size`, which only exists once the whole
   * multipart body has been parsed into memory — so a 2 GB upload was fully
   * buffered and only then rejected, and the 60/min limiter caps requests, not
   * bytes. `content-length` is client-supplied and a liar can understate it, but
   * a liar still has to get past Next's own body handling, and honest clients
   * (every browser) are turned away for the cost of reading one header.
   *
   * The multipart envelope adds boundary and header bytes around the file, hence
   * the slack: the authoritative check on the file itself is still the one below.
   */
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BYTES + MULTIPART_OVERHEAD_BYTES) {
    return NextResponse.json(
      { ok: false, error: 'too_large', message: 'File too large (max 10 MB)' },
      { status: 413 },
    );
  }

  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: 'invalid_input', message: 'No file provided' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: 'too_large', message: 'File too large (max 10 MB)' }, { status: 413 });
  }
  const buffer = Buffer.from(await file.arrayBuffer());

  // The bytes decide the type, never the client-declared `file.type` — that
  // string is attacker-controlled and used to be replayed as the Content-Type
  // of the public file route (stored XSS via a scripted SVG).
  const mime = sniffMime(buffer);
  if (!mime) {
    return NextResponse.json(
      {
        ok: false,
        error: 'unsupported_media_type',
        message: `Unsupported file type. Allowed: ${ALLOWED_MIME_LABEL}.`,
      },
      { status: 415 },
    );
  }

  // Everything past the sniff is re-encoded as WebP (plus an AVIF companion for
  // still images) inside 1600x1200 before it is stored (`prepareUpload`). Bytes that carry the right magic number and
  // still will not decode — a truncated file, a polyglot, a decompression bomb
  // — are refused here rather than stored as an image nothing can open.
  let row: Awaited<ReturnType<typeof uploadMedia>>;
  try {
    row = await uploadMedia({ buffer, originalName: file.name, mime }, auth.userId);
  } catch (err) {
    if (!(err instanceof MediaProcessingError)) throw err;
    return NextResponse.json(
      {
        ok: false,
        error: 'unsupported_media_type',
        message: 'This file could not be processed as an image.',
      },
      { status: 415 },
    );
  }
  // Deleting media is audited; uploading was not, so a file appearing in the
  // library had no recorded author or time beyond the row itself. A duplicate
  // created nothing, so there is nothing to audit — an entry there would name a
  // file this upload did not produce and an author who did not upload it.
  if (!row.duplicate) {
    await logAudit({
      userId: auth.userId,
      action: 'media.upload',
      subjectType: 'media_file',
      // Without this the entry named no file — every upload looked identical in
      // the log and none could be traced to what it produced. The uuid is the
      // media table's real key, so it is what identifies the subject.
      subjectId: row.uuid,
      after: { uuid: row.uuid, originalName: row.originalName, mime: row.mime, size: row.size },
    });
  }
  // 201 says "created". A duplicate was not: the library already held these
  // bytes and the caller is being handed the file that was already there.
  return NextResponse.json({ ok: true, data: row }, { status: row.duplicate ? 200 : 201 });
}
