import { cookieCategoryDeleteRoute, cookieCategoryUpdateRoute } from '@/cms/core/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PATCH = cookieCategoryUpdateRoute();
export const DELETE = cookieCategoryDeleteRoute();
