/**
 * One reservation: read it, or move it through the status machine.
 *
 * The PATCH is where an operator's "accept" can be refused — that transition
 * claims the date under a lock, so the second acceptance of two competing
 * enquiries for one exclusive date comes back 409 rather than overbooking.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { reservationGetRoute, reservationUpdateRoute } from '@/cms/modules/booking';
// Side effect: attaches the gateways to the provider registry. Accepting a
// request issues a payment link through the configured one, and the drawer
// reads which one that is — without this every gateway resolves to manual.
import '@/cms/core/payments/register';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params?: Promise<Record<string, string>> };

const get = reservationGetRoute();
const patch = reservationUpdateRoute({ defaultLocale: config.defaultLocale });

const notFoundRes = () => NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });

export async function GET(req: NextRequest, ctx: Ctx) {
  if (!(await isModuleEnabled(config, 'booking'))) return notFoundRes();
  return get(req, ctx);
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  if (!(await isModuleEnabled(config, 'booking'))) return notFoundRes();
  return patch(req, ctx);
}
