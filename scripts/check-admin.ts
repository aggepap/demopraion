/**
 * Diagnose why an admin sign-in is refused.
 *
 *   npx tsx --tsconfig ./tsconfig.seed.json scripts/check-admin.ts <email> [password]
 *
 * Answers, in order, the four things that produce "Invalid email or password"
 * and are indistinguishable from the login screen:
 *
 *   1. Which database am I even looking at? (three ports, three DBs here — a
 *      password reset against praion_cms cannot log you into praion_qa)
 *   2. Does the row exist, under exactly that address?
 *   3. Is it disabled, or role-less? Both are refused, and the screen says the
 *      same thing it says for a wrong password — deliberately, so an attacker
 *      learns nothing, which also means you learn nothing.
 *   4. Does the password actually match the stored hash?
 *
 * Read-only: it changes nothing. The password argument is optional; pass it to
 * test the hash, and prefix the command with a space to keep it out of your
 * shell history.
 */
import '../src/cms/db/adapters/mysql/load-env';

import bcrypt from 'bcryptjs';
import { and, desc, eq, gt } from 'drizzle-orm';

import { getMysqlDb } from '../src/cms/db/adapters/mysql/client';
import { adminRoles, adminUserRoles, adminUsers, auditLogs } from '../src/cms/db/adapters/mysql/schema';

const ACCOUNT_LOCKOUT_MAX_FAILURES = 10;
const ACCOUNT_LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

async function main(): Promise<void> {
  const [emailArg, password] = process.argv.slice(2);
  if (!emailArg) {
    console.error('Usage: npx tsx --tsconfig ./tsconfig.seed.json scripts/check-admin.ts <email> [password]');
    process.exit(1);
  }
  const email = emailArg.trim().toLowerCase();

  const target = process.env.DATABASE_URL
    ? process.env.DATABASE_URL.replace(/:[^:@/]*@/, ':***@')
    : `${process.env.DB_USER}@${process.env.DB_HOST}:${process.env.DB_PORT ?? 3306}/${process.env.DB_NAME}`;
  console.log(`Database : ${target}`);
  console.log(`Looking for: ${email}\n`);

  const db = getMysqlDb();
  const [user] = await db.select().from(adminUsers).where(eq(adminUsers.email, email)).limit(1);

  if (!user) {
    console.log('✗ No admin_users row with that email.');
    const all = await db.select({ id: adminUsers.id, email: adminUsers.email }).from(adminUsers);
    console.log(
      all.length
        ? `  This database has ${all.length} admin user(s): ${all.map((u) => u.email).join(', ')}`
        : '  This database has no admin users at all — is it the one your app is using?',
    );
    process.exit(0);
  }

  console.log(`✓ Found user id=${user.id} name=${JSON.stringify(user.name)}`);

  if (user.disabledAt) {
    console.log(`✗ DISABLED since ${user.disabledAt.toISOString()} — sign-in is refused with the generic message.`);
  } else {
    console.log('✓ Not disabled');
  }

  const roles = await db
    .select({ name: adminRoles.name })
    .from(adminUserRoles)
    .innerJoin(adminRoles, eq(adminRoles.id, adminUserRoles.roleId))
    .where(eq(adminUserRoles.userId, user.id));

  if (roles.length === 0) {
    console.log('✗ NO ROLES — login returns `no_roles`, shown as the same generic message.');
  } else {
    console.log(`✓ Roles: ${roles.map((r) => r.name).join(', ')}`);
  }

  if (password) {
    const matches = await bcrypt.compare(password, user.passwordHash);
    console.log(matches ? '✓ Password MATCHES the stored hash' : '✗ Password does NOT match the stored hash');
  } else {
    console.log(`· Password not tested (hash ${user.passwordHash.slice(0, 4)}…, ${user.passwordHash.length} chars)`);
  }

  const since = new Date(Date.now() - ACCOUNT_LOCKOUT_WINDOW_MS);
  const failures = await db
    .select({ at: auditLogs.createdAt })
    .from(auditLogs)
    .where(and(eq(auditLogs.action, 'auth.login.fail'), eq(auditLogs.subjectId, email), gt(auditLogs.createdAt, since)))
    .orderBy(desc(auditLogs.createdAt));

  if (failures.length >= ACCOUNT_LOCKOUT_MAX_FAILURES) {
    console.log(
      `✗ LOCKED OUT: ${failures.length} failures in the last 15 minutes (limit ${ACCOUNT_LOCKOUT_MAX_FAILURES}).`,
    );
    console.log('  Even the correct password is refused until the window passes. Wait 15 minutes and retry.');
  } else {
    console.log(`✓ ${failures.length}/${ACCOUNT_LOCKOUT_MAX_FAILURES} recent login failures — not locked out`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('\nCould not reach the database:\n', err instanceof Error ? err.message : err);
  console.error('\nIf this says "Access denied", the app cannot read this database either — fix the credentials in .env.local first.');
  process.exit(1);
});
