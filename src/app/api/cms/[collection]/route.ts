/**
 * Collection list + create. Site glue: binds the site config to the core's
 * generic collection route factories. The `[collection]` segment selects which
 * content type; the factories validate it against the config.
 */
import config from '@/site.config';
import { collectionCreateRoute, collectionListRoute } from '@/cms/core/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = collectionListRoute(config);
export const POST = collectionCreateRoute(config);
