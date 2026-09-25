/**
 * Public unsubscribe endpoint for the abandoned-cart reminder. GET shows a
 * confirmation, POST records it — see `@/cms/modules/commerce/unsubscribe`.
 *
 * NOT gated on the commerce module, unlike its siblings in this directory. A
 * reminder already in someone's inbox must keep working even if commerce is
 * switched off later; answering 404 to an unsubscribe request because a feature
 * flag changed is the one outcome this endpoint cannot have.
 */
import { type NextRequest } from 'next/server';

import { unsubscribeConfirmRoute, unsubscribeSubmitRoute } from '@/cms/modules/commerce';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const confirm = unsubscribeConfirmRoute();
const submit = unsubscribeSubmitRoute();

export async function GET(req: NextRequest) {
  return confirm(req);
}

export async function POST(req: NextRequest) {
  return submit(req);
}
