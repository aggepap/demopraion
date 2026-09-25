/**
 * Apply pending migrations using the app's own pooled mysql2 connection
 * (the same one the runtime uses) rather than the `drizzle-kit migrate` CLI.
 *
 * drizzle-kit's CLI connects via the localhost socket regardless of the
 * configured host, which MariaDB authenticates as a different account than the
 * TCP `user@'%'` grant the app uses — so its migrate/push fail even when the
 * app connects fine. Going through `getMysqlDb()` sidesteps that entirely.
 *
 * `drizzle-kit generate` (schema → SQL, no DB) is unaffected and still used.
 */
import './adapters/mysql/load-env';

import { migrate } from 'drizzle-orm/mysql2/migrator';

import { getMysqlDb } from './adapters/mysql/client';

async function main(): Promise<void> {
  await migrate(getMysqlDb(), {
    migrationsFolder: './src/cms/db/adapters/mysql/migrations',
  });
  console.log('✓ migrations applied');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
