import { cookieScanRoute } from '@/cms/core/routes';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = cookieScanRoute(config);
