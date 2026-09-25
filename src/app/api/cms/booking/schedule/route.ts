/**
 * The availability calendar's data. Gated by the booking module (404 when off)
 * and by `scheduleRead`/`scheduleWrite` via the route factories' guards.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { scheduleReadRoute, scheduleWriteRoute } from '@/cms/modules/booking';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const read = scheduleReadRoute({ defaultLocale: config.defaultLocale });
const write = scheduleWriteRoute();

async function guardModule(): Promise<NextResponse | null> {
  if (await isModuleEnabled(config, 'booking')) return null;
  return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
}

export async function GET(req: NextRequest) {
  return (await guardModule()) ?? read(req);
}

export async function PUT(req: NextRequest) {
  return (await guardModule()) ?? write(req);
}
