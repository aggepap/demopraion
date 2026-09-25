/**
 * The database dialect boundary.
 *
 * Core code uses Drizzle's query builder directly (its select/insert/update
 * API is the same across dialects), but routes the handful of operations that
 * genuinely differ between MariaDB and Postgres through this adapter. That
 * keeps dialect-specific SQL out of core logic, so adding a Postgres adapter
 * later is additive rather than a rewrite (see BACKEND_V2_PLAN.md).
 */
import type { AnyColumn, SQL } from 'drizzle-orm';

export type DialectKind = 'mysql' | 'pg';

export interface DbAdapter {
  readonly kind: DialectKind;

  /**
   * Extract the auto-increment primary key from a driver insert result.
   * MariaDB returns it in the ResultSetHeader; Postgres would use RETURNING.
   */
  insertId(result: unknown): number;

  /**
   * How many rows a driver UPDATE/DELETE result actually touched.
   *
   * Needed to tell "the row was changed" from "there was no such row" — an
   * update that matched nothing succeeds at the driver level, so without this
   * a handler cannot answer 404 and instead reports success for an id that
   * does not exist. MariaDB returns it in the ResultSetHeader; Postgres would
   * use `rowCount`.
   */
  affectedRows(result: unknown): number;

  /**
   * SQL fragment selecting a JSON scalar at `path` (dot notation, no leading
   * `$`) from a JSON column, unquoted. MariaDB: `JSON_UNQUOTE(JSON_EXTRACT(...))`;
   * Postgres would use `#>>`.
   */
  jsonScalar(column: AnyColumn, path: string): SQL<string | null>;
}
