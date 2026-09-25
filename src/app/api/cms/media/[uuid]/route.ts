import { mediaDeleteRoute, mediaUpdateRoute } from '@/cms/core/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PATCH = mediaUpdateRoute();
export const DELETE = mediaDeleteRoute();
