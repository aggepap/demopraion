/**
 * Single-document read / update / delete.
 */
import config from '@/site.config';
import {
  collectionDeleteRoute,
  collectionGetRoute,
  collectionUpdateRoute,
} from '@/cms/core/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = collectionGetRoute(config);
export const PATCH = collectionUpdateRoute(config);
export const DELETE = collectionDeleteRoute(config);
