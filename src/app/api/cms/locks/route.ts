import { lockGatewayRoute } from '@/cms/core/locks/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = lockGatewayRoute();
