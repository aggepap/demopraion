import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createSubmission, markSubmissionDelivered, markSubmissionUndelivered } from '@/cms/core';
import { sendGraphMail } from '@/cms/core/email';
import { checkRateLimit, getClientIp } from '@/cms/core/rate-limit';
import { siteBrand } from '@/lib/brand';
import { contactSubmissionRecord } from '@/lib/contact-submission';
import { type Row, rowsToHtml, rowsToText } from '@/lib/email/rows';
import { isAllowedPublicOrigin } from '@/lib/public-origin';
import { SITE_URL } from '@/lib/seo/schemas';

// @azure/identity needs the Node.js runtime (not Edge).
export const runtime = 'nodejs';

/**
 * The contact form endpoint (`kind: 'contact'`, see ContactForm.tsx).
 *
 * Validates again server-side (the public endpoint must not trust the client),
 * stores the enquiry in `form_submissions` FIRST — so a failed email never loses
 * it — then emails it via Microsoft Graph. `_hp` is the honeypot: non-empty
 * means a bot, answered with a 200 and dropped.
 *
 * To add a second form, add a schema to the union below, a kind to
 * `ContactFormKind` in src/lib/contact-submission.ts, and a case to the switch.
 */
const contactSchema = z.object({
  kind: z.literal('contact'),
  locale: z.enum(['el', 'en']).optional(),
  _hp: z.string().optional(),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  /** Length-capped only: numbers arrive in every format. */
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  message: z.string().trim().min(1).max(4000),
});

const payloadSchema = z.discriminatedUnion('kind', [contactSchema]);

/** Hard cap on the body, checked before parsing. */
const MAX_BODY_BYTES = 16 * 1024;

/** Per-IP ceiling: generous for a person, useless for a flood. */
const RATE_LIMIT = { max: 5, windowMs: 60 * 1000 } as const;

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: 'too_large' }, { status: 413 });
  }

  // Same-origin belt (production only) plus a JSON content-type requirement.
  if (!isAllowedPublicOrigin(request.headers.get('origin'), SITE_URL, process.env.NODE_ENV === 'production')) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });
  }

  const limit = checkRateLimit('contact', getClientIp(request), RATE_LIMIT);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: 'rate_limited' },
      {
        status: 429,
        headers: {
          'Retry-After': String(limit.retryAfterSeconds),
          'X-RateLimit-Limit': String(RATE_LIMIT.max),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.ceil(limit.resetAt / 1000)),
        },
      },
    );
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'invalid_payload' }, { status: 400 });
  }
  const data = parsed.data;

  if (data._hp && data._hp.length > 0) {
    return NextResponse.json({ ok: true });
  }

  const localeTag = data.locale ? data.locale.toUpperCase() : '—';
  let subject: string;
  let rows: Row[];
  switch (data.kind) {
    case 'contact':
      subject = `New enquiry — ${data.name}`;
      rows = [
        ['Name', data.name],
        ['Email', data.email],
        ['Phone', data.phone ?? ''],
        ['Message', data.message],
        ['Locale', localeTag],
      ];
      break;
  }

  // Store first; a storage failure is logged and the email still goes out.
  let submissionId: number | null = null;
  try {
    submissionId = await createSubmission(
      contactSubmissionRecord({
        kind: data.kind,
        email: data.email,
        locale: data.locale,
        payload: Object.fromEntries(rows.filter(([, value]) => value !== '')),
        headers: request.headers,
      }),
    );
  } catch (err) {
    console.error('[api/contact] could not store the submission', err);
  }

  try {
    // The core sender, like every other mail: it applies the email branding.
    // The Reply-To label says the address came from a form, not a known contact
    // — a guard against a submitter putting a partner's mailbox in `email`.
    const { name: brandName } = await siteBrand();
    await sendGraphMail({
      subject,
      html: rowsToHtml(rows),
      text: rowsToText(rows),
      replyTo: data.email,
      replyToName: data.name,
      replyToSuffix: `(via ${brandName} contact form)`,
    });
    if (submissionId !== null) await markSubmissionDelivered(submissionId).catch(() => {});
  } catch (err) {
    // The enquiry is stored (and marked undelivered in the admin); the client
    // still learns the send failed.
    console.error('[api/contact] send failed', err);
    if (submissionId !== null) await markSubmissionUndelivered(submissionId, err).catch(() => {});
    return NextResponse.json({ ok: false, error: 'send_failed' }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
