import { redirect } from 'next/navigation';

import { PRAION_TAB } from '@/cms/admin';
import { adminHref } from '@/cms/admin/admin-path';
import { getAdminPath } from '@/cms/core/paths';

/**
 * The screen this route used to render now lives at Settings → Connect to
 * Praion.ai. The path stays as a redirect rather than a 404: it was the
 * documented place to import Product Manager's credential, so links to it are
 * out in the world and in people's history.
 *
 * No permission check here — the settings page runs its own, and refusing
 * before the redirect would only mean two different 403s for the same screen.
 */
export default function ApiTokensPage(): never {
  redirect(adminHref(getAdminPath(), `settings?tab=${encodeURIComponent(PRAION_TAB)}`));
}
