import { roleDeleteRoute, roleUpdateRoute } from '@/cms/core/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PATCH = roleUpdateRoute();
export const DELETE = roleDeleteRoute();
