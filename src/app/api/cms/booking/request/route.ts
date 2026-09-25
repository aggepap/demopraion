/**
 * Public booking request. Both modes enter here: request mode creates an
 * enquiry that holds no date, instant mode takes the date on the spot.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { bookingRequestRoute } from '@/cms/modules/booking';
// Side effect: attaches Stripe and PayPal to the provider registry — this route
// resolves one to decide whether an instant booking awaits payment.
import '@/cms/core/payments/register';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handler = bookingRequestRoute({ defaultLocale: config.defaultLocale });

export async function POST(req: NextRequest) {
  if (!(await isModuleEnabled(config, 'booking'))) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  return handler(req);
}
