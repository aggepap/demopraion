import { Suspense } from 'react';

import config from '@/site.config';
import { getBrand } from '@/cms/core/brand';
import { LoginForm } from '@/cms/admin';
import { getAdminPath } from '@/cms/core/paths';
import { captchaSiteKey } from '@/cms/core/security/captcha';
import { graphMailConfigured } from '@/cms/core/email';

export default async function AdminLoginPage() {
  const { name: siteName } = await getBrand(config.brand);
  return (
    <Suspense>
      {/* `ADMIN_PATH` is not a NEXT_PUBLIC var, so the segment has to be
          resolved here and handed down — the client cannot read it. The
          reCAPTCHA site key rides down the same way: it is browser-safe, but
          reading it here instead of prefixing it `NEXT_PUBLIC_` keeps it out of
          every other client bundle on the site. Whether emailed codes are on
          offer is resolved here for the same reason — the client has no way to
          know, and offering a method that cannot be delivered turns the next
          sign-in into a lockout. */}
      <LoginForm
        siteName={siteName}
        adminPath={getAdminPath()}
        captchaSiteKey={captchaSiteKey()}
        emailCodesAvailable={graphMailConfigured()}
      />
    </Suspense>
  );
}
