/**
 * Create the first superadmin (or add another). Ported from v1.
 *
 *   npm run db:seed-admin -- <email> <password> [name] [--locale <code>]
 *
 * Seeds roles first (idempotent), hashes the password, creates the user, and
 * grants the `superadmin` role. `--locale` is the language of the admin's
 * sign-in code emails (default: the column's database default).
 */
import '../../adapters/mysql/load-env';

import { eq } from 'drizzle-orm';

import { hashPassword } from '../../../modules/auth/password';
import { passwordMessage } from '../../../modules/auth/password-policy';
import { getMysqlDb } from '../../adapters/mysql/client';
import { adminRoles, adminUserRoles, adminUsers } from '../../adapters/mysql/schema';
import { parseAdminArgs, superadminGrant, type AdminArgs } from '../admin-args';
import { seedRoles } from '../roles';

async function main(): Promise<void> {
  let args: AdminArgs;
  try {
    args = parseAdminArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  const { email, password, name, locale } = args;

  // The same policy the admin screen enforces. This command creates the account with
  // every permission there is, so exempting it would leave the policy with a door
  // next to it — and the strongest account behind the weakest password.
  const weak = passwordMessage(password);
  if (weak) {
    console.error(weak);
    process.exit(1);
  }

  const db = getMysqlDb();

  const roles = await seedRoles(db);
  console.log(
    `Roles seeded (created ${roles.created}, updated ${roles.updated}, left as configured ${roles.kept}).`,
  );

  const [superadmin] = await db
    .select({ id: adminRoles.id })
    .from(adminRoles)
    .where(eq(adminRoles.name, 'superadmin'))
    .limit(1);
  if (!superadmin) throw new Error('superadmin role missing after seed.');

  const normalizedEmail = email.trim().toLowerCase();
  const passwordHash = await hashPassword(password);

  const [existing] = await db
    .select({ id: adminUsers.id })
    .from(adminUsers)
    .where(eq(adminUsers.email, normalizedEmail))
    .limit(1);

  let userId: number;
  if (existing) {
    await db
      .update(adminUsers)
      .set({ passwordHash, disabledAt: null, ...(locale ? { locale } : {}) })
      .where(eq(adminUsers.id, existing.id));
    userId = existing.id;
    console.log(`Updated existing user ${normalizedEmail} (id ${userId}).`);
  } else {
    const result = await db
      .insert(adminUsers)
      .values({ email: normalizedEmail, name: name ?? normalizedEmail, passwordHash, ...(locale ? { locale } : {}) });
    userId = Array.isArray(result) ? result[0].insertId : (result as { insertId: number }).insertId;
    console.log(`Created user ${normalizedEmail} (id ${userId}).`);
  }

  // Leave the account holding exactly `superadmin` — including an existing
  // account that held another role, which used to be left as it was.
  const current = await db
    .select({ roleId: adminUserRoles.roleId })
    .from(adminUserRoles)
    .where(eq(adminUserRoles.userId, userId));
  const grant = superadminGrant(
    current.map((r) => r.roleId),
    superadmin.id,
  );
  if (grant === 'replace') {
    await db.delete(adminUserRoles).where(eq(adminUserRoles.userId, userId));
  }
  if (grant !== 'none') {
    await db.insert(adminUserRoles).values({ userId, roleId: superadmin.id });
    console.log(grant === 'replace' ? 'Replaced the previous role with superadmin.' : 'Granted superadmin role.');
  }

  console.log('\nDone. You can now sign in to the admin.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
