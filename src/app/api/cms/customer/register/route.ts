/**
 * Create a shop account. Answers the same whether or not the address is taken.
 * Gated by the `customers` module: 404 everywhere when it is off.
 */
import { NextResponse, type NextRequest } from 'next/server';

import { isModuleEnabled } from '@/cms/core';
import { customerRegisterRoute } from '@/cms/modules/customers';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handler = customerRegisterRoute({ defaultLocale: config.defaultLocale });
const off = () => NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
const enabled = () => isModuleEnabled(config, 'customers');

export async function POST(req: NextRequest) {
  if (!(await enabled())) return off();
  return handler(req);
}
