import { NextResponse } from 'next/server';

import { isAllowedMime } from '@/cms/core/media/mime';
import { getMedia } from '@/cms/core/media/service';
import { getStorage } from '@/cms/core/media/storage';
import { readForAccept } from '@/cms/core/media/variants';

export const runtime = 'nodejs';

/**
 * Public: serve a media file's bytes.
 *
 * An image is served as AVIF to a browser whose `Accept` asks for it and as
 * WebP otherwise, from the same URL (`readForAccept`).
 */
export async function GET(req: Request, { params }: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await params;
  const row = await getMedia(uuid);
  if (!row) return new NextResponse('Not found', { status: 404 });
  try {
    const file = await readForAccept(getStorage(), row.uuid, row.mime, req.headers.get('accept'));
    // Uploads are type-checked on the way in, but rows predating that check (or
    // written by any other path) must not be able to pick their own
    // Content-Type here: an unexpected type is served as an opaque download
    // rather than something the browser will render — and never sniffed.
    const safe = isAllowedMime(row.mime);
    return new NextResponse(new Uint8Array(file.body), {
      headers: {
        'Content-Type': safe ? file.contentType : 'application/octet-stream',
        // The same URL answers with different bytes per `Accept`; without this a
        // shared cache would hand one browser's AVIF to another that cannot
        // decode it.
        ...(file.negotiated ? { Vary: 'Accept' } : {}),
        'X-Content-Type-Options': 'nosniff',
        ...(safe ? {} : { 'Content-Disposition': 'attachment' }),
        // Everything served from here is inert bytes, so say so on the response
        // itself rather than relying on the allow-list alone. PDF is on that
        // list and is rendered inline by every browser's built-in viewer, which
        // executes the JavaScript a PDF is allowed to carry — in this site's
        // own origin, where an authenticated admin's session lives. `sandbox`
        // strips that document of script, forms, popups and same-origin
        // identity; `default-src 'none'` stops it fetching anything. Neither
        // affects an image.
        //
        // `frame-ancestors 'none'` keeps an uploaded file from being framed by
        // another site and dressed up as part of it — an upload endpoint is an
        // easy way to get attacker-chosen bytes onto a trusted domain.
        'Content-Security-Policy': "default-src 'none'; sandbox; frame-ancestors 'none'",
        'X-Frame-Options': 'DENY',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }
}
