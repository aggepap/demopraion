import { userCreateRoute, usersListRoute } from '@/cms/core/routes';
import config from '@/site.config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = usersListRoute();
export const POST = userCreateRoute({ defaultLocale: config.defaultLocale });
