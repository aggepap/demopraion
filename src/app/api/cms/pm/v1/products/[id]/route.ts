import { pmProductGetRoute, pmProductWriteRoute } from '@/cms/modules/pm';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = pmProductGetRoute(config);
export const PATCH = pmProductWriteRoute(config);
