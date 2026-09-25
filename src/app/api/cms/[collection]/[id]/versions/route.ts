import config from '@/site.config';
import { collectionVersionsRoute } from '@/cms/core/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = collectionVersionsRoute(config);
