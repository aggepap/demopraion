import { redirectDeleteRoute, redirectUpdateRoute } from '@/cms/core/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PATCH = redirectUpdateRoute();
export const DELETE = redirectDeleteRoute();
