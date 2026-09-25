import { submissionGetRoute, submissionUpdateRoute } from '@/cms/core/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = submissionGetRoute();
export const PATCH = submissionUpdateRoute();
