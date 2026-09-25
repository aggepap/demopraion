import 'server-only';

import { draftMode } from 'next/headers';

import type { DocumentRow } from '@/cms';
import { getDocumentPreview, getPublishedDocument } from '@/cms/core';
import type { Locale } from '@/lib/i18n/config';

/**
 * Resolve the document a public page should render: the published (or
 * scheduled-past) document normally, or the latest draft when Next.js Draft
 * Mode is enabled (turned on only via the auth-guarded preview route). Lets the
 * editorial pages preview unpublished content through their real render path.
 */
export async function resolveRenderDoc(
  type: string,
  slug: string,
  locale: Locale,
): Promise<DocumentRow | null> {
  const { isEnabled } = await draftMode();
  return isEnabled
    ? getDocumentPreview(type, slug, locale)
    : getPublishedDocument(type, slug, locale);
}
