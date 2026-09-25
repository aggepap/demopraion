/**
 * Drizzle Kit config for the CMS (MariaDB adapter).
 *
 * `load-env` runs first so the standalone CLI sees `.env.local`. `generate`
 * needs only the schema; `migrate`/`push` need a reachable DB via the URL.
 */
import './src/cms/db/adapters/mysql/load-env';

import { defineConfig } from 'drizzle-kit';

/**
 * Discrete connection fields (not a URL). drizzle-kit's URL parser resolves
 * `127.0.0.1` to a socket `localhost` connection, which MariaDB authenticates
 * as a *different* account (`user@localhost`) than the TCP `user@'%'` grant the
 * app uses — causing access-denied even when the app connects fine. Passing an
 * explicit `host` forces the TCP path so migrate/push match the app.
 */
function dbCredentials() {
  if (process.env.DATABASE_URL) {
    const u = new URL(process.env.DATABASE_URL);
    return {
      host: u.hostname || '127.0.0.1',
      port: u.port ? Number(u.port) : 3306,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, ''),
    };
  }
  return {
    host: process.env.DB_HOST?.trim() || '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER?.trim() || 'placeholder',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME?.trim() || 'placeholder',
  };
}

export default defineConfig({
  dialect: 'mysql',
  schema: './src/cms/db/adapters/mysql/schema/index.ts',
  out: './src/cms/db/adapters/mysql/migrations',
  casing: 'snake_case',
  strict: true,
  verbose: true,
  dbCredentials: dbCredentials(),
});
