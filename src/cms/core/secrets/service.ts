import 'server-only';

import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { PERMISSIONS, requireApiPerm } from '../../modules/auth';
import { getDb, schema } from '../../db';
import { createRoute } from '../api/handler';
import { ok } from '../api/respond';
import { logAudit } from '../audit';
import { badRequest } from '../errors';
import { decryptSecret, encryptSecret } from '../tokens/crypto';
import {
  isValidSecretKey,
  secretHint,
  summariseSecrets,
  type SecretKeyDef,
  type SecretSummary,
} from './policy';

/** Longest value accepted; OAuth refresh tokens are well under this. */
export const MAX_SECRET_LENGTH = 2048;

/** Store (or replace) a secret. The caller has already checked the key is declared. */
export async function setSecret(
  key: string,
  plaintext: string,
  userId: number | null
): Promise<void> {
  if (!isValidSecretKey(key)) throw new Error(`Invalid secret key: ${key}`);
  const value = plaintext.trim();
  const row = {
    ciphertext: encryptSecret(value),
    hint: secretHint(value),
    updatedBy: userId,
  };
  await getDb()
    .insert(schema.integrationSecrets)
    .values({ key, ...row })
    .onDuplicateKeyUpdate({ set: row });
}

/** Server-side read. `null` when unset. Throws if the row cannot be decrypted. */
export async function getSecret(key: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ ciphertext: schema.integrationSecrets.ciphertext })
    .from(schema.integrationSecrets)
    .where(eq(schema.integrationSecrets.key, key))
    .limit(1);
  return row ? decryptSecret(row.ciphertext) : null;
}

export async function deleteSecret(key: string): Promise<void> {
  await getDb().delete(schema.integrationSecrets).where(eq(schema.integrationSecrets.key, key));
}

export async function listSecretSummaries(defs: readonly SecretKeyDef[]): Promise<SecretSummary[]> {
  if (defs.length === 0) return [];
  const rows = await getDb()
    .select({
      key: schema.integrationSecrets.key,
      hint: schema.integrationSecrets.hint,
      updatedAt: schema.integrationSecrets.updatedAt,
    })
    .from(schema.integrationSecrets)
    .where(
      inArray(
        schema.integrationSecrets.key,
        defs.map((d) => d.key)
      )
    );
  return summariseSecrets(defs, rows);
}

const writeBody = z
  .object({
    key: z.string().min(1).max(128),
    /** A value to store, or `null` to clear. */
    value: z.string().trim().min(1).max(MAX_SECRET_LENGTH).nullable(),
  })
  .strict();

/**
 * Admin routes over the declared keys. GET lists summaries; POST stores or
 * clears one. Neither ever returns a value, and the audit row records only
 * which key changed.
 */
export function secretsRoutes(opts: { defs: () => readonly SecretKeyDef[] }) {
  const declared = (key: string) => opts.defs().some((d) => d.key === key);
  return {
    GET: createRoute({
      guard: () => requireApiPerm(PERMISSIONS.settingsRead),
      handler: async () => ok(await listSecretSummaries(opts.defs())),
    }),
    POST: createRoute({
      rateLimit: { scope: 'cms-secrets', max: 20, windowMs: 60_000 },
      guard: () => requireApiPerm(PERMISSIONS.settingsWrite),
      input: writeBody,
      handler: async ({ input, auth }) => {
        if (!declared(input.key)) throw badRequest('Unknown integration setting.');
        const subject = { userId: auth.userId, subjectType: 'secret', subjectId: input.key };
        if (input.value === null) {
          await deleteSecret(input.key);
          await logAudit({ ...subject, action: 'secret.clear' });
        } else {
          await setSecret(input.key, input.value, auth.userId);
          await logAudit({ ...subject, action: 'secret.set' });
        }
        return ok(await listSecretSummaries(opts.defs()));
      },
    }),
  };
}
