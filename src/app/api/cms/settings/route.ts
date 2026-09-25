/**
 * Site settings read/update. Binds the site config to the core settings route
 * factories (permission-guarded: settings.read / settings.write).
 */
import config from '@/site.config';
import { settingsGetRoute, settingsUpdateRoute } from '@/cms/core/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = settingsGetRoute(config);
export const PATCH = settingsUpdateRoute(config);
