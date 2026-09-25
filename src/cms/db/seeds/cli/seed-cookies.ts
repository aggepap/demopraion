/** Seed the default cookie catalogue. `npm run db:seed-cookies` */
import '../../adapters/mysql/load-env';

import { seedCookieCatalog } from '../cookies';

async function main(): Promise<void> {
  const result = await seedCookieCatalog();
  console.log(
    `Cookie catalogue seeded (created ${result.created}, skipped ${result.skipped}, services ${result.services}).`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
