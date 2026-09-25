/**
 * Seed default roles. `npm run db:seed-roles`
 *
 * Creates missing default roles and re-syncs `superadmin` to `*`; an existing
 * `editor` is left as configured (see `seeds/roles.ts`).
 */
import '../../adapters/mysql/load-env';

import { seedRoles } from '../roles';

async function main(): Promise<void> {
  const result = await seedRoles();
  console.log(
    `Roles seeded (created ${result.created}, updated ${result.updated}, left as configured ${result.kept}).`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
