import { getAdminPath } from '@/cms/core/paths';
import { getCurrentUser } from '@/cms/modules/auth';
import { adminAccessFor, adminEditHref, type EditableDocument } from '@/lib/admin-bar';

import { RegisterEditTarget } from './AdminBar';

/**
 * Names the document this page shows, for the admin bar's Edit link.
 *
 * Checks the session itself rather than trusting the bar to be absent: for a
 * visitor it renders nothing, so neither the admin path (which `ADMIN_PATH`
 * may deliberately obscure) nor document ids reach the public HTML.
 */
export async function AdminEditTarget({ doc }: { doc: EditableDocument }) {
  const adminPath = getAdminPath();
  if (!adminAccessFor(await getCurrentUser(), adminPath)?.canEdit) return null;
  return <RegisterEditTarget href={adminEditHref(adminPath, doc)} />;
}
