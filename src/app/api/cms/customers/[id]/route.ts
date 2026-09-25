/** Admin: one customer account — read, disable/enable, re-send confirmation. */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { customerGetRoute, customerUpdateRoute } from '@/cms/modules/customers';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<Record<string, string>> };

const get = customerGetRoute();
const update = customerUpdateRoute({ defaultLocale: config.defaultLocale });
const off = () => NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
const enabled = () => isModuleEnabled(config, 'customers');

export async function GET(req: NextRequest, ctx: Ctx) {
  if (!(await enabled())) return off();
  return get(req, ctx);
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  if (!(await enabled())) return off();
  return update(req, ctx);
}
