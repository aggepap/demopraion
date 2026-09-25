import { cookieCatalogRoute, cookieCategoryCreateRoute } from '@/cms/core/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = cookieCatalogRoute();
export const POST = cookieCategoryCreateRoute();
