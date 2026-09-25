import { scriptCreateRoute, scriptListRoute } from '@/cms/core/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = scriptListRoute();
export const POST = scriptCreateRoute();
