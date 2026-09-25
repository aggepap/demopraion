import { redirectCreateRoute, redirectsListRoute } from '@/cms/core/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = redirectsListRoute();
export const POST = redirectCreateRoute();
