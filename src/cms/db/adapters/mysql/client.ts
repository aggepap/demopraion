/**
 * Pooled Drizzle client for MariaDB. Ported from v1 `src/admin/db/client.ts`.
 *
 * Intentionally NOT `import 'server-only'`: this module is shared by both Next
 * route handlers AND the standalone CLIs (drizzle seeds under `tsx`, where
 * `server-only` can't resolve). The server-only surface is guarded at the
 * `src/cms/core/*` and `src/cms/modules/*` layer; a stray client-component
 * import of `getDb` still fails the build via `mysql2`.
 */
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import mysql, { type Pool } from 'mysql2/promise';

import * as schema from './schema';
import { composeDbUrl } from './url';

export type MysqlDb = MySql2Database<typeof schema>;

declare global {
  var __cmsMysqlPool: Pool | undefined;
  var __cmsMysqlDb: MysqlDb | undefined;
}

function ensureUrl(): string {
  const result = composeDbUrl();
  if (!result.url) {
    throw new Error(
      'Database connection is not configured. Set either DATABASE_URL or ' +
        'DB_HOST + DB_USER + DB_NAME (+ optional DB_PASSWORD / DB_PORT).',
    );
  }
  return result.url;
}

function getPool(): Pool {
  if (globalThis.__cmsMysqlPool) return globalThis.__cmsMysqlPool;
  const pool = mysql.createPool({
    uri: ensureUrl(),
    connectionLimit: 10,
    waitForConnections: true,
    namedPlaceholders: false,
    dateStrings: false,
    multipleStatements: false,
  });
  globalThis.__cmsMysqlPool = pool;
  return pool;
}

export function getMysqlDb(): MysqlDb {
  if (globalThis.__cmsMysqlDb) return globalThis.__cmsMysqlDb;
  const db = drizzle(getPool(), { schema, mode: 'default' });
  globalThis.__cmsMysqlDb = db;
  return db;
}

export { schema };
