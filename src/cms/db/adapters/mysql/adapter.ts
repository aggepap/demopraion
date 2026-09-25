/**
 * MariaDB implementation of the `DbAdapter` dialect boundary.
 */
import { type AnyColumn, sql, type SQL } from 'drizzle-orm';

import type { DbAdapter } from '../../adapter';

export const mysqlAdapter: DbAdapter = {
  kind: 'mysql',

  insertId(result: unknown): number {
    // Drizzle's mysql2 `.insert()` resolves to `[ResultSetHeader, FieldPacket[]]`
    // in some call shapes and a bare header-like object in others. Handle both.
    const header = Array.isArray(result) ? result[0] : result;
    const id = (header as { insertId?: number } | undefined)?.insertId;
    if (typeof id !== 'number' || Number.isNaN(id)) {
      throw new Error('mysqlAdapter.insertId: no insertId on the driver result.');
    }
    return id;
  },

  affectedRows(result: unknown): number {
    // Same two result shapes as `insertId`. `affectedRows` counts rows MATCHED
    // by the WHERE clause, which is what "did this id exist" asks — unlike
    // `changedRows`, which would report 0 for an update that set a column to
    // the value it already had.
    const header = Array.isArray(result) ? result[0] : result;
    const n = (header as { affectedRows?: number } | undefined)?.affectedRows;
    return typeof n === 'number' && !Number.isNaN(n) ? n : 0;
  },

  jsonScalar(column: AnyColumn, path: string): SQL<string | null> {
    return sql<string | null>`json_unquote(json_extract(${column}, ${'$.' + path}))`;
  },
};
