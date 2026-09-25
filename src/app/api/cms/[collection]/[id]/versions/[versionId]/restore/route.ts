import config from '@/site.config';
import { collectionRestoreRoute } from '@/cms/core/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = collectionRestoreRoute(config);
