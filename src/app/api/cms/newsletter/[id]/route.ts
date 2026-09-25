/**
 * One subscriber: PATCH unsubscribes or resubscribes, DELETE erases.
 *
 * Two verbs because they are two different acts. Unsubscribing keeps the row —
 * the timestamp is the record that they asked — while DELETE is the erasure
 * request and loses the consent record with the address.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { subscriberDeleteRoute, subscriberUpdateRoute } from '@/cms/modules/newsletter';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const update = subscriberUpdateRoute();
const remove = subscriberDeleteRoute();

type Args = { params: Promise<Record<string, string>> };

async function enabled() {
  return isModuleEnabled(config, 'newsletter');
}

const notFound = () => NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });

export async function PATCH(req: NextRequest, ctx: Args) {
  if (!(await enabled())) return notFound();
  return update(req, ctx);
}

export async function DELETE(req: NextRequest, ctx: Args) {
  if (!(await enabled())) return notFound();
  return remove(req, ctx);
}
