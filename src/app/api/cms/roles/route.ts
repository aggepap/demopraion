import { roleCreateRoute, rolesListRoute } from '@/cms/core/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = rolesListRoute();
export const POST = roleCreateRoute();
