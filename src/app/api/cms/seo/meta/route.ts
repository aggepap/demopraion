import { metaListRoute, metaUpsertRoute } from '@/cms/core/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = metaListRoute();
export const POST = metaUpsertRoute();
