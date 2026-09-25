'use server';

import { NextResponse } from 'next/server';

import type { MdxPreviewResult, RenderMdxPreview } from '@/cms/admin';
import { checkRateLimit } from '@/cms/core/rate-limit';
import { PERMISSIONS, requireApiPerm } from '@/cms/modules/auth';
import { renderMdxPreview } from '@/lib/cms/mdx-preview';

/** Larger than any real body; a cheap ceiling on what the compiler is handed. */
const MAX_SOURCE = 512 * 1024;

/**
 * The live-preview endpoint for the admin's MDX body editor.
 *
 * A Server Action rather than a route handler, because the preview tree is
 * *React*, not HTML: `MdxRuntime` is an async server component and `<FAQ>`
 * reaches a `'use client'` `<Accordion>`. The RSC serializer is the only
 * renderer in the stack that handles both — `react-dom/server` throws on import
 * under the `react-server` condition, so `renderToStaticMarkup` in a route
 * handler was never an option. It also means no HTML string crosses the wire,
 * so the pane needs no `dangerouslySetInnerHTML`.
 */
export const previewMdxAction: RenderMdxPreview = async (
  source: string,
  locale: string,
): Promise<MdxPreviewResult> => {
  // A Server Action is a public POST endpoint like any other. `requireApiPerm`
  // re-reads permissions from the DB rather than trusting the JWT snapshot, so
  // a revoked editor loses the preview immediately — matching every /api/cms
  // route rather than being the one door that lags a role change.
  const auth = await requireApiPerm(PERMISSIONS.contentRead);
  if (auth instanceof NextResponse) return { status: 'denied' };

  if (typeof source !== 'string' || source.length > MAX_SOURCE) {
    return { status: 'invalid', messages: ['This body is too large to preview.'] };
  }

  /*
   * Rate limited even though it is authenticated and read-only, which is not
   * this codebase's default (see `src/cms/core/rate-limit.ts`). This one earns
   * it: unlike every other read, it *compiles and executes* caller-influenced
   * source in the server process — the whole reason `mdx-guard.ts` exists. A
   * stolen session or a looping tab should not be a free acorn-parse primitive
   * on a single-VPS deploy. 120/min is ~10x what a 500ms debounce can produce,
   * so it never touches a human.
   *
   * Bucketed by user, not IP: `getClientIp` returns 'unknown' in dev, which
   * would put every developer in one bucket.
   */
  const limit = checkRateLimit('cms-mdx-preview', String(auth.userId), {
    max: 120,
    windowMs: 60_000,
  });
  if (!limit.allowed) return { status: 'throttled' };

  return renderMdxPreview(source, locale);
};
