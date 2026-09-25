/**
 * Public checkout endpoint. Gated by the commerce module: when commerce is off
 * the route 404s (the storefront that calls it is also gated).
 */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { createCheckoutRoute } from '@/cms/modules/commerce';
import { attachCheckoutAccount, resolveCheckoutCustomerId } from '@/cms/modules/customers';
// Side effect: attaches Stripe and PayPal to the provider registry. Next builds
// one module graph per route bundle, so each route that resolves a provider
// must import this itself.
import '@/cms/core/payments/register';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handler = createCheckoutRoute({
  // Read per request, not at module load: the flag is a `site_settings` row an
  // admin can flip while the server is running.
  newsletterEnabled: () => isModuleEnabled(config, 'newsletter'),
  defaultLocale: config.defaultLocale,
  // Accounts are optional and read per request, like the newsletter flag above.
  resolveAccount: async () => {
    const enabled = await isModuleEnabled(config, 'customers');
    return { enabled, customerId: enabled ? await resolveCheckoutCustomerId() : null };
  },
  attachAccount: (args) => attachCheckoutAccount({ ...args, defaultLocale: config.defaultLocale }),
});

export async function POST(req: NextRequest) {
  if (!(await isModuleEnabled(config, 'commerce'))) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  return handler(req);
}
