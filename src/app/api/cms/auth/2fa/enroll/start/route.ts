import { mfaEnrollStartRoute } from '@/cms/core/routes';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = mfaEnrollStartRoute(config);
