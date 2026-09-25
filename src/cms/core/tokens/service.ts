import 'server-only';

import { desc, eq } from 'drizzle-orm';

import { adapter, getDb, schema } from '../../db';
import type { CmsApiToken } from '../../db/adapters/mysql/schema/api-tokens';
import { conflict } from '../errors';
import { decryptSecret, encryptSecret } from './crypto';

/**
 * Storage and lifecycle for imported API credentials.
 *
 * There is deliberately **no create-with-generation function here, and no
 * function that returns a secret**. Product Manager mints the credential; praion
 * imports it. Because praion never has a secret to display, it never has to be
 * careful about displaying one — the §13.2 rule that the plaintext must not
 * appear in a list response, a log line or an audit row is satisfied by
 * construction rather than by discipline.
 */

/** The safe projection: everything an admin screen needs, and nothing secret. */
export interface ApiTokenSummary {
  id: number;
  name: string;
  keyId: string;
  scopes: string[];
  lastUsedAt: Date | null;
  lastUsedIp: string | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export const API_TOKEN_SCOPES = ['pm:read', 'pm:write', 'pm:payload', 'pm:media'] as const;
export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number] | 'pm:*';

function toSummary(row: CmsApiToken): ApiTokenSummary {
  return {
    id: row.id,
    name: row.name,
    keyId: row.keyId,
    scopes: Array.isArray(row.scopes) ? row.scopes : [],
    lastUsedAt: row.lastUsedAt ?? null,
    lastUsedIp: row.lastUsedIp ?? null,
    expiresAt: row.expiresAt ?? null,
    revokedAt: row.revokedAt ?? null,
    createdAt: row.createdAt,
  };
}

export async function listApiTokens(): Promise<ApiTokenSummary[]> {
  const rows = await getDb()
    .select()
    .from(schema.cmsApiTokens)
    .orderBy(desc(schema.cmsApiTokens.createdAt));
  return rows.map(toSummary);
}

export interface ImportApiTokenInput {
  name: string;
  keyId: string;
  secret: string;
  scopes: string[];
  expiresAt?: Date | null;
}

/**
 * Store an imported credential.
 *
 * A duplicate `key_id` is refused rather than overwritten: a repeated paste is
 * far more likely to be a mistake than a deliberate re-key, and silently
 * replacing a working credential is a self-inflicted outage that would show up
 * as PM losing access for no visible reason.
 */
export async function importApiToken(
  input: ImportApiTokenInput,
  actorId: number | null,
): Promise<ApiTokenSummary> {
  const db = getDb();

  const [existing] = await db
    .select({ id: schema.cmsApiTokens.id })
    .from(schema.cmsApiTokens)
    .where(eq(schema.cmsApiTokens.keyId, input.keyId))
    .limit(1);
  if (existing) {
    throw conflict(
      'That key is already connected to this site. Revoke the existing one first, or ' +
        'generate a new key in Product Manager.',
    );
  }

  const res = await db.insert(schema.cmsApiTokens).values({
    name: input.name,
    keyId: input.keyId,
    secretEncrypted: encryptSecret(input.secret),
    scopes: input.scopes,
    expiresAt: input.expiresAt ?? null,
    createdBy: actorId,
  });

  const id = adapter.insertId(res);
  const [row] = await db
    .select()
    .from(schema.cmsApiTokens)
    .where(eq(schema.cmsApiTokens.id, id))
    .limit(1);
  return toSummary(row);
}

/** Revocation is a timestamp, not a delete — the audit trail must keep the row. */
export async function revokeApiToken(id: number): Promise<boolean> {
  const res = await getDb()
    .update(schema.cmsApiTokens)
    .set({ revokedAt: new Date() })
    .where(eq(schema.cmsApiTokens.id, id));
  return adapter.affectedRows(res) > 0;
}

export interface ActiveToken {
  id: number;
  name: string;
  keyId: string;
  secret: string;
  scopes: string[];
}

/**
 * Look a credential up for signature verification.
 *
 * Returns null for unknown, revoked and expired alike — the caller answers 401
 * for all of them with one body, so distinguishing here would only invite the
 * distinction to leak into the response.
 *
 * Revocation is checked on **every** request, never cached, so revoking is
 * immediate rather than eventually consistent.
 */
export async function findActiveToken(keyId: string): Promise<ActiveToken | null> {
  const [row] = await getDb()
    .select()
    .from(schema.cmsApiTokens)
    .where(eq(schema.cmsApiTokens.keyId, keyId))
    .limit(1);

  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;

  let secret: string;
  try {
    secret = decryptSecret(row.secretEncrypted);
  } catch (err) {
    // A row we cannot decrypt is a configuration fault (rotated or missing
    // CMS_TOKEN_ENCRYPTION_KEY), not a bad caller. Say so in the log, where the
    // operator will look, and still refuse the request.
    console.error('[cms/tokens] cannot decrypt stored secret for key id', keyId, err);
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    keyId: row.keyId,
    secret,
    scopes: Array.isArray(row.scopes) ? row.scopes : [],
  };
}

/**
 * `last_used_at` bookkeeping, throttled to at most one UPDATE a minute per token.
 *
 * Same discipline as `bumpRedirectHit`: without the throttle every read request
 * would also be a write, which turns a read-only sync of a few hundred pages
 * into a few hundred pointless UPDATEs. Fire-and-forget, errors swallowed —
 * failing to record telemetry must never fail the request it describes.
 */
const lastTouched = new Map<number, number>();
const TOUCH_INTERVAL_MS = 60_000;

export function touchApiToken(tokenId: number, ip: string | null): void {
  const now = Date.now();
  const previous = lastTouched.get(tokenId);
  if (previous !== undefined && now - previous < TOUCH_INTERVAL_MS) return;
  lastTouched.set(tokenId, now);

  void getDb()
    .update(schema.cmsApiTokens)
    .set({ lastUsedAt: new Date(now), lastUsedIp: ip })
    .where(eq(schema.cmsApiTokens.id, tokenId))
    .catch((err: unknown) => {
      console.error('[cms/tokens] failed to record last_used_at', err);
    });
}
