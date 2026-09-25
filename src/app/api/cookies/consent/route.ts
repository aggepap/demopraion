/**
 * The public consent endpoint: what the visitor is being asked, and what they said.
 *
 * `GET` returns the categories a visitor can decide about — the admin-managed
 * catalogue that the banner previously never fetched, which is why the Cookies screen
 * governed nothing at all (F-065).
 *
 * `POST` records the decision. It used to live only in the visitor's own
 * `localStorage`: enough to make the site behave correctly for them, and no kind of
 * record — consent has to be demonstrable afterwards, and a value in someone else's
 * browser demonstrates nothing.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { getConsentOptions, recordConsent } from '@/cms/core';
import { checkRateLimit, getClientIp } from '@/cms/core/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Generous: a person may legitimately change their mind a few times in a session. */
const RATE_LIMIT = { max: 20, windowMs: 60 * 1000 } as const;

/**
 * Hard cap on the request body, matching `/api/contact`.
 *
 * A consent payload is a short ref, one enum and a handful of booleans — under
 * 1 KB in the worst realistic case. The rate limit bounds how MANY requests one
 * source may send, not how large each one is, so without this an unauthenticated
 * caller could hand `request.json()` an arbitrarily large body twenty times a
 * minute and make the server parse all of it. 8 KB is far more than the shape
 * needs and small enough that the parser never sees anything worth worrying about.
 */
const MAX_BODY_BYTES = 8 * 1024;

export async function GET() {
  try {
    return NextResponse.json({ ok: true, data: await getConsentOptions() });
  } catch {
    /*
     * Never break the page over this. A banner that cannot reach the catalogue falls
     * back to accept-all / reject-all, which is what it did before this existed —
     * degraded, but not a site with no cookie banner at all.
     */
    return NextResponse.json({ ok: true, data: { policyVersion: null, categories: [] } });
  }
}

export async function POST(request: NextRequest) {
  // Cheap pre-parse guard, before anything reads the stream. `content-length` is
  // client-supplied and a liar can understate it, but honest clients — which is
  // every browser — are turned away for the cost of reading one header.
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: 'too_large' }, { status: 413 });
  }

  const limit = checkRateLimit('cookie-consent', getClientIp(request), RATE_LIMIT);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const input = body as {
    visitorRef?: unknown;
    decision?: unknown;
    categories?: unknown;
    policyVersion?: unknown;
    locale?: unknown;
  };

  if (typeof input.visitorRef !== 'string' || input.visitorRef.length < 8) {
    return NextResponse.json({ ok: false, error: 'invalid_payload' }, { status: 400 });
  }
  if (input.decision !== 'accepted' && input.decision !== 'rejected' && input.decision !== 'custom') {
    return NextResponse.json({ ok: false, error: 'invalid_payload' }, { status: 400 });
  }
  if (input.categories === null || typeof input.categories !== 'object' || Array.isArray(input.categories)) {
    return NextResponse.json({ ok: false, error: 'invalid_payload' }, { status: 400 });
  }

  /*
   * Only the categories that exist, and only as booleans. The body comes from a
   * browser and this row is meant to be evidence — storing whatever was posted would
   * make it evidence of nothing.
   */
  const { categories: offered } = await getConsentOptions();
  const known = new Map(offered.map((c) => [c.key, c]));
  const posted = input.categories as Record<string, unknown>;
  const categories: Record<string, boolean> = {};
  for (const [key, category] of known) {
    // A required category is not a choice, and must not be recorded as one.
    categories[key] = category.required ? true : posted[key] === true;
  }

  try {
    await recordConsent({
      visitorRef: input.visitorRef,
      decision: input.decision,
      categories,
      policyVersion: typeof input.policyVersion === 'string' ? input.policyVersion : null,
      locale: typeof input.locale === 'string' ? input.locale : null,
      ua: request.headers.get('user-agent'),
    });
  } catch (err) {
    /*
     * The visitor's own choice already applies — it is stored client-side before this
     * call. A failure here loses the record, not the behaviour, so it is logged and
     * the visitor is not shown an error about something they cannot act on.
     */
    console.error('[api/cookies/consent] could not record the decision', err);
    return NextResponse.json({ ok: false, error: 'not_recorded' }, { status: 202 });
  }

  return NextResponse.json({ ok: true, data: { categories } });
}
