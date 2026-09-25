import { scriptDeleteRoute, scriptUpdateRoute } from '@/cms/core/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PATCH = scriptUpdateRoute();
export const DELETE = scriptDeleteRoute();
