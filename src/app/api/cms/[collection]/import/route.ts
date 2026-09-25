/**
 * Markdown template download + import parsing. Site glue, like every other file
 * under `src/app/api/cms/**`.
 *
 * `import` is a STATIC segment, so `/api/cms/article/import` resolves here and
 * not to the sibling `[collection]/[id]` route — Next matches a literal segment
 * before a dynamic one. The two could not collide anyway: that route handles
 * GET/PATCH/DELETE on an id, and `idParam` would refuse "import".
 */
import config from '@/site.config';
import { importParseRoute, importTemplateRoute } from '@/cms/core/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = importTemplateRoute(config);
export const POST = importParseRoute(config);
