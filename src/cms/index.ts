/**
 * Public entry point for the CMS core — the surface site code imports from.
 *
 * When `src/cms` is extracted into a standalone package (BACKEND_V2_PLAN.md
 * Phase 5), this file becomes the package's `main`. Site code must import only
 * from here (or the documented sub-paths `@/cms/config`, `@/cms/core`), never
 * from internal modules.
 */
export * from './config';
export {
  createRoute,
  ok,
  created,
  noContent,
  paginated,
  ApiError,
  badRequest,
  invalidInput,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  checkRateLimit,
  getClientIp,
  sendGraphMail,
  logAudit,
  extractRequestMeta,
} from './core';
export type {
  RouteConfig,
  RouteContext,
  PageMeta,
  ApiErrorCode,
  RateLimitConfig,
  RateLimitResult,
  GraphMail,
  AuditEntry,
} from './core';

export { getDb, adapter, schema } from './db';
export type { Db, DbAdapter, DialectKind, DocumentRow, NewDocumentRow, DocumentStatus } from './db';
