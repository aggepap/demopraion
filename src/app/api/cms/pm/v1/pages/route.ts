import { pmPagesListRoute } from '@/cms/modules/pm';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = pmPagesListRoute(config);
