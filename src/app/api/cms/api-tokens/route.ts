import { apiTokenImportRoute, apiTokenListRoute } from '@/cms/core/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = apiTokenListRoute();
export const POST = apiTokenImportRoute();
