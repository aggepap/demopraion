import { notFoundDeleteRoute, notFoundUpdateRoute } from '@/cms/core/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PATCH = notFoundUpdateRoute();
export const DELETE = notFoundDeleteRoute();
