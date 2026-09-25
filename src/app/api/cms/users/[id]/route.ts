import { userDeleteRoute, userUpdateRoute } from '@/cms/core/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PATCH = userUpdateRoute();
export const DELETE = userDeleteRoute();
