/**
 * Active database binding for the CMS core.
 *
 * Today this resolves to the MariaDB adapter unconditionally. When a Postgres
 * adapter is added, this module becomes the single branch point (on an env
 * var / build flag) — nothing else in core references a concrete dialect.
 */
import { mysqlAdapter } from './adapters/mysql/adapter';
import { getMysqlDb, schema } from './adapters/mysql/client';
import type { DbAdapter } from './adapter';

/** The Drizzle database instance (pooled, lazily created). */
export function getDb() {
  return getMysqlDb();
}

/** The dialect adapter for operations that differ across databases. */
export const adapter: DbAdapter = mysqlAdapter;

/** The full schema object (all tables + relations). */
export { schema };

export type { DbAdapter, DialectKind } from './adapter';
export type {
  DocumentRow,
  NewDocumentRow,
  DocumentStatus,
} from './adapters/mysql/schema/documents';
export type Db = ReturnType<typeof getDb>;
