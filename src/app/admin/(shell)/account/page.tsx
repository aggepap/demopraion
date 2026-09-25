import config from '@/site.config';
import { getBrand } from '@/cms/core/brand';
import { AccountSecurity } from '@/cms/admin';
import { adminHref } from '@/cms/admin/admin-path';
import { getAdminPath } from '@/cms/core/paths';
import { graphMailConfigured } from '@/cms/core/email';
import { mfaRequiredBySetting } from '@/cms/core/routes';
import { getMfaStatus, requireAuth } from '@/cms/modules/auth';

export const dynamic = 'force-dynamic';

/**
 * The one admin page that is NOT permission-gated beyond being signed in.
 *
 * Every other screen under `(shell)` sits behind a `cms.<area>.<verb>` check,
 * which is right for content and configuration and wrong here: two-factor
 * authentication is a property of the account, and putting it behind
 * `cms.users.manage` would leave most editors on the site unable to protect
 * their own login.
 */
export default async function AccountPage() {
  const user = await requireAuth(adminHref(getAdminPath(), 'account'));
  const { name: siteName } = await getBrand(config.brand);
  const [status, required] = await Promise.all([
    getMfaStatus(user.userId),
    mfaRequiredBySetting(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-xl font-semibold text-neutral-900">Your account</h1>
        <p className="mt-1 text-sm text-neutral-600">
          {user.name} · {user.email}
        </p>
      </div>
      <AccountSecurity
        emailAvailable={graphMailConfigured()}
        siteName={siteName}
        initial={{
          method: status.method,
          // Serialised for the client boundary — a Date does not survive it.
          enrolledAt: status.enrolledAt ? status.enrolledAt.toISOString() : null,
          recoveryCodesRemaining: status.recoveryCodesRemaining,
          required,
        }}
      />
    </div>
  );
}
