import { pmPageGetRoute, pmPageWriteRoute } from '@/cms/modules/pm';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = pmPageGetRoute(config);
export const PATCH = pmPageWriteRoute(config);
