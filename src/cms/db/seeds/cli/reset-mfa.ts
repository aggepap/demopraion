/**
 * Clear one account's second factor from a shell.
 *
 *   npm run db:reset-mfa -- <email>
 *
 * ## Why this exists
 *
 * With `security.require2fa` on and a single superadmin who has lost both their
 * authenticator and their recovery codes, there is no route back in: the admin
 * reset lives behind `cms.users.manage`, and the only holder of it is the
 * person who is locked out. The alternative to this script is hand-writing an
 * UPDATE during an outage, against a schema whose column names nobody
 * remembers under pressure.
 *
 * It requires shell access to the server, which is a strictly higher bar than
 * anything it can undo — whoever has it can already rewrite the password hash.
 */
import '../../adapters/mysql/load-env';

import { eq } from 'drizzle-orm';

import { getMysqlDb } from '../../adapters/mysql/client';
import { adminMfaCodes, adminRecoveryCodes, adminUsers } from '../../adapters/mysql/schema';

async function main(): Promise<void> {
  const [email] = process.argv.slice(2);

  if (!email) {
    console.error('Usage: npm run db:reset-mfa -- <email>');
    process.exit(1);
  }

  const db = getMysqlDb();
  const normalizedEmail = email.trim().toLowerCase();

  const [user] = await db
    .select({ id: adminUsers.id, name: adminUsers.name, method: adminUsers.mfaMethod })
    .from(adminUsers)
    .where(eq(adminUsers.email, normalizedEmail))
    .limit(1);

  if (!user) {
    console.error(`No admin account with the email ${normalizedEmail}.`);
    process.exit(1);
  }
  if (!user.method) {
    console.log(`${normalizedEmail} has no second factor set up. Nothing to do.`);
    process.exit(0);
  }

  await db
    .update(adminUsers)
    .set({ mfaMethod: null, totpSecretEncrypted: null, mfaEnrolledAt: null, totpLastStep: null })
    .where(eq(adminUsers.id, user.id));
  await db.delete(adminRecoveryCodes).where(eq(adminRecoveryCodes.userId, user.id));
  await db.delete(adminMfaCodes).where(eq(adminMfaCodes.userId, user.id));

  console.log(
    `Cleared two-factor authentication for ${user.name} <${normalizedEmail}> (was: ${user.method}).`,
  );
  // Said out loud because the operator has to act on it: if the site requires
  // 2FA, this account is not "password only" now — it is "enrol on next
  // sign-in", which is a different thing to expect at the login screen.
  console.log('They will be asked to set it up again the next time they sign in.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
