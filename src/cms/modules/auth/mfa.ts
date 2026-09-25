import 'server-only';

import { randomInt } from 'node:crypto';

import { and, desc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import QRCode from 'qrcode';

import {
  generateRecoveryCodes,
  normalizeRecoveryCode,
  padForHash,
} from '../../core/security/recovery-codes';
import { generateTotpSecret, otpauthUri, verifyTotp } from '../../core/security/totp';
import { decryptSecret, encryptSecret } from '../../core/tokens/crypto';
import { adapter, getDb, schema } from '../../db';
import { MFA_EMAIL_CODE_TTL_MINUTES, sendMfaCodeEmail } from './mfa-email';
import { hashPassword, verifyPassword } from './password';

/**
 * Everything that reads or writes a second factor.
 *
 * The pure parts live in `core/security/totp.ts` and
 * `core/security/recovery-codes.ts` and are unit-tested against the RFC's own
 * vectors; this file is deliberately the thin I/O side of that split, the same
 * way `booking/data.ts` sits opposite `booking/read.ts`.
 */

export type MfaMethod = 'totp' | 'email';

/** Purposes a mailed code can serve. A code proving a mailbox must not complete a sign-in. */
export type MfaCodePurpose = 'login' | 'enroll';

/** Digits in a mailed code — the same width as a TOTP code, so one input field serves both. */
const EMAIL_CODE_DIGITS = 6;

/**
 * Wrong guesses a single mailed code tolerates before it is burned.
 *
 * Five, against a space of a million, with a ten-minute life. The per-IP
 * limiter is the wrong tool for this: it counts requests from an address, and
 * the thing being rationed here is guesses against one specific code.
 */
const EMAIL_CODE_MAX_ATTEMPTS = 5;

/**
 * How many codes one account can be sent in the window below.
 *
 * A separate ceiling from the route's per-IP limit, because that limit reads
 * only `x-real-ip` and therefore does nothing about a flood aimed at a single
 * mailbox from many addresses. Being mail-bombed by your own admin panel is a
 * denial of service against the person who owns the account.
 */
const EMAIL_CODE_MAX_PER_WINDOW = 5;
const EMAIL_CODE_SEND_WINDOW_MS = 15 * 60 * 1000;

export interface MfaStatus {
  method: MfaMethod | null;
  enrolledAt: Date | null;
  /** Unused recovery codes left. Zero on an enrolled account is worth warning about. */
  recoveryCodesRemaining: number;
}

function isMfaMethod(value: string | null): value is MfaMethod {
  return value === 'totp' || value === 'email';
}

export async function getMfaStatus(userId: number): Promise<MfaStatus> {
  const db = getDb();
  const [user] = await db
    .select({ method: schema.adminUsers.mfaMethod, enrolledAt: schema.adminUsers.mfaEnrolledAt })
    .from(schema.adminUsers)
    .where(eq(schema.adminUsers.id, userId))
    .limit(1);

  const [count] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.adminRecoveryCodes)
    .where(
      and(
        eq(schema.adminRecoveryCodes.userId, userId),
        isNull(schema.adminRecoveryCodes.usedAt),
      ),
    );

  return {
    method: user && isMfaMethod(user.method) ? user.method : null,
    enrolledAt: user?.enrolledAt ?? null,
    recoveryCodesRemaining: Number(count?.n ?? 0),
  };
}

export interface TotpEnrollment {
  /** Base32, shown for manual entry when a camera is not an option. */
  secret: string;
  otpauthUri: string;
  /** `data:image/svg+xml;base64,…` — a data URI, never raw markup to inject. */
  qrSvgDataUri: string;
}

/**
 * Mint a TOTP secret and store it *pending*.
 *
 * Pending is `totp_secret_encrypted` set while `mfa_method` is still null: the
 * secret exists so the user can scan it, but nothing enforces it until they
 * have proved their app produces matching codes. An abandoned enrollment needs
 * no cleanup — the next attempt overwrites the column.
 */
export async function startTotpEnrollment(
  userId: number,
  account: string,
  issuer: string,
): Promise<TotpEnrollment> {
  const secret = generateTotpSecret();
  const uri = otpauthUri({ secret, account, issuer });

  await getDb()
    .update(schema.adminUsers)
    .set({ totpSecretEncrypted: encryptSecret(secret) })
    .where(eq(schema.adminUsers.id, userId));

  const svg = await QRCode.toString(uri, { type: 'svg', margin: 1 });
  return {
    secret,
    otpauthUri: uri,
    // A data URI rendered through `<img>`, not markup handed to
    // `dangerouslySetInnerHTML`: generated SVG is still SVG, and the admin is
    // the last DOM in this app that should be accepting any.
    qrSvgDataUri: `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`,
  };
}

function randomDigits(count: number): string {
  // `randomInt` per digit rather than one modulo of a large random: no bias,
  // and leading zeros survive, which `String(randomInt(0, 1e6))` would drop.
  let out = '';
  for (let i = 0; i < count; i++) out += String(randomInt(0, 10));
  return out;
}

export type IssueCodeResult = 'sent' | 'throttled' | 'no_recipient';

/**
 * Create a one-time code, store its hash, and mail it.
 *
 * The mail is awaited and its failure propagates — see `mfa-email.ts` for why
 * this one send is not best-effort. The row is written first so a delivery
 * failure cannot leave a code the user received but the server never recorded.
 */
export async function issueEmailCode(
  userId: number,
  purpose: MfaCodePurpose,
): Promise<IssueCodeResult> {
  const db = getDb();
  const [user] = await db
    .select({
      email: schema.adminUsers.email,
      name: schema.adminUsers.name,
      locale: schema.adminUsers.locale,
    })
    .from(schema.adminUsers)
    .where(eq(schema.adminUsers.id, userId))
    .limit(1);
  if (!user) return 'no_recipient';

  const [recent] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.adminMfaCodes)
    .where(
      and(
        eq(schema.adminMfaCodes.userId, userId),
        eq(schema.adminMfaCodes.purpose, purpose),
        gt(schema.adminMfaCodes.createdAt, new Date(Date.now() - EMAIL_CODE_SEND_WINDOW_MS)),
      ),
    );
  if (Number(recent?.n ?? 0) >= EMAIL_CODE_MAX_PER_WINDOW) return 'throttled';

  const code = randomDigits(EMAIL_CODE_DIGITS);
  await db.insert(schema.adminMfaCodes).values({
    userId,
    codeHash: await hashPassword(padForHash(code)),
    purpose,
    expiresAt: new Date(Date.now() + MFA_EMAIL_CODE_TTL_MINUTES * 60 * 1000),
  });

  await sendMfaCodeEmail({ to: user.email, name: user.name, code, locale: user.locale });
  return 'sent';
}

async function consumeEmailCode(
  userId: number,
  purpose: MfaCodePurpose,
  code: string,
): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.adminMfaCodes)
    .where(
      and(
        eq(schema.adminMfaCodes.userId, userId),
        eq(schema.adminMfaCodes.purpose, purpose),
        isNull(schema.adminMfaCodes.consumedAt),
        gt(schema.adminMfaCodes.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(schema.adminMfaCodes.createdAt))
    .limit(EMAIL_CODE_MAX_PER_WINDOW);

  for (const row of rows) {
    if (row.attempts >= EMAIL_CODE_MAX_ATTEMPTS) continue;
    if (await verifyPassword(padForHash(code), row.codeHash)) {
      /*
       * The `consumed_at IS NULL` in the WHERE is what makes this single-use,
       * not the SELECT above. Two requests carrying the same code can both pass
       * that read before either write lands — a bcrypt comparison is ~250ms of
       * window — and both would then be told they were right. Letting the
       * database decide the winner means exactly one UPDATE touches a row.
       */
      const res = await db
        .update(schema.adminMfaCodes)
        .set({ consumedAt: new Date() })
        .where(and(eq(schema.adminMfaCodes.id, row.id), isNull(schema.adminMfaCodes.consumedAt)));
      return adapter.affectedRows(res) > 0;
    }
    const attempts = row.attempts + 1;
    await db
      .update(schema.adminMfaCodes)
      .set({
        attempts,
        // Burned once the budget is gone, rather than left alive until it
        // expires — an exhausted code that still exists is still guessable.
        consumedAt: attempts >= EMAIL_CODE_MAX_ATTEMPTS ? new Date() : null,
      })
      .where(eq(schema.adminMfaCodes.id, row.id));
  }
  return false;
}

async function consumeRecoveryCode(userId: number, code: string): Promise<boolean> {
  const normalized = normalizeRecoveryCode(code);
  if (normalized.length === 0) return false;

  const db = getDb();
  const rows = await db
    .select()
    .from(schema.adminRecoveryCodes)
    .where(
      and(
        eq(schema.adminRecoveryCodes.userId, userId),
        isNull(schema.adminRecoveryCodes.usedAt),
      ),
    );

  for (const row of rows) {
    if (await verifyPassword(padForHash(normalized), row.codeHash)) {
      // `used_at IS NULL` in the WHERE, for the reason spelled out in
      // `consumeEmailCode`: the read cannot be the thing that enforces
      // single-use when a bcrypt comparison sits between it and the write.
      const res = await db
        .update(schema.adminRecoveryCodes)
        .set({ usedAt: new Date() })
        .where(
          and(eq(schema.adminRecoveryCodes.id, row.id), isNull(schema.adminRecoveryCodes.usedAt)),
        );
      return adapter.affectedRows(res) > 0;
    }
  }
  return false;
}

export type SecondFactorResult =
  | { ok: true; via: MfaMethod | 'recovery' }
  | { ok: false };

/**
 * Check a submitted second factor against everything this account can present.
 *
 * The enrolled method is tried first and recovery codes second, always — a
 * recovery code has to work regardless of which method is enrolled, because the
 * situation it exists for is precisely "the enrolled method is unavailable".
 */
export async function verifySecondFactor(
  userId: number,
  code: string,
): Promise<SecondFactorResult> {
  const db = getDb();
  const [user] = await db
    .select({
      method: schema.adminUsers.mfaMethod,
      secret: schema.adminUsers.totpSecretEncrypted,
      lastStep: schema.adminUsers.totpLastStep,
    })
    .from(schema.adminUsers)
    .where(eq(schema.adminUsers.id, userId))
    .limit(1);
  if (!user) return { ok: false };

  if (user.method === 'totp' && user.secret) {
    let secret: string;
    try {
      secret = decryptSecret(user.secret);
    } catch (err) {
      // A tampered or key-rotated column. Fail closed and say so in the log —
      // the remedy (reset this user's 2FA) is nothing like "wrong code".
      console.error('[auth/mfa] could not decrypt TOTP secret', { userId }, err);
      secret = '';
    }
    const result = verifyTotp(secret, code, Date.now(), { lastStep: user.lastStep });
    if (result.ok) {
      /*
       * The replay guard lives in this WHERE clause, not in `verifyTotp`.
       *
       * Two sign-ins racing with the same code both read the old `lastStep`,
       * both pass the check, and both would be admitted — which is precisely
       * the replay the column exists to stop. Requiring the stored step to
       * still be behind the one being claimed makes the database arbitrate, and
       * exactly one of the two writes lands.
       */
      const res = await db
        .update(schema.adminUsers)
        .set({ totpLastStep: result.step })
        .where(
          and(
            eq(schema.adminUsers.id, userId),
            or(
              isNull(schema.adminUsers.totpLastStep),
              lt(schema.adminUsers.totpLastStep, result.step),
            ),
          ),
        );
      if (adapter.affectedRows(res) > 0) return { ok: true, via: 'totp' };
      // Lost the race: another request spent this step first.
      return { ok: false };
    }
  }

  if (user.method === 'email' && (await consumeEmailCode(userId, 'login', code))) {
    return { ok: true, via: 'email' };
  }

  if (await consumeRecoveryCode(userId, code)) return { ok: true, via: 'recovery' };

  return { ok: false };
}

/**
 * Replace every recovery code with a fresh batch, returning the plaintext once.
 *
 * All-or-nothing on purpose: leaving the old codes alive alongside new ones
 * would mean a user who regenerates because they think a sheet was seen has not
 * actually revoked anything.
 */
export async function replaceRecoveryCodes(userId: number): Promise<string[]> {
  const db = getDb();
  const codes = generateRecoveryCodes();
  const hashes = await Promise.all(
    codes.map(async (code) => ({
      userId,
      codeHash: await hashPassword(padForHash(normalizeRecoveryCode(code))),
    })),
  );

  await db.delete(schema.adminRecoveryCodes).where(eq(schema.adminRecoveryCodes.userId, userId));
  await db.insert(schema.adminRecoveryCodes).values(hashes);
  return codes;
}

export type ConfirmResult = { ok: true; recoveryCodes: string[] } | { ok: false };

/** Finish an enrollment: prove the factor works, then switch it on. */
export async function confirmEnrollment(
  userId: number,
  method: MfaMethod,
  code: string,
): Promise<ConfirmResult> {
  const db = getDb();

  if (method === 'totp') {
    const [user] = await db
      .select({ secret: schema.adminUsers.totpSecretEncrypted })
      .from(schema.adminUsers)
      .where(eq(schema.adminUsers.id, userId))
      .limit(1);
    if (!user?.secret) return { ok: false };

    let secret: string;
    try {
      secret = decryptSecret(user.secret);
    } catch {
      return { ok: false };
    }
    const result = verifyTotp(secret, code, Date.now());
    if (!result.ok) return { ok: false };

    await db
      .update(schema.adminUsers)
      .set({
        mfaMethod: 'totp',
        mfaEnrolledAt: new Date(),
        // Seeded here, not left null: the code that proved enrollment is the
        // first one spent, and it must not also be usable to sign in.
        totpLastStep: result.step,
      })
      .where(eq(schema.adminUsers.id, userId));
  } else {
    if (!(await consumeEmailCode(userId, 'enroll', code))) return { ok: false };
    await db
      .update(schema.adminUsers)
      .set({ mfaMethod: 'email', mfaEnrolledAt: new Date(), totpSecretEncrypted: null })
      .where(eq(schema.adminUsers.id, userId));
  }

  return { ok: true, recoveryCodes: await replaceRecoveryCodes(userId) };
}

/**
 * Clear every trace of a second factor for one account.
 *
 * Used by self-service disable and by an administrator resetting somebody who
 * has lost both their phone and their codes. The pending secret goes too —
 * leaving it would let a half-finished enrollment be confirmed later by whoever
 * still has the QR code on screen.
 */
export async function clearMfa(userId: number): Promise<void> {
  const db = getDb();
  await db
    .update(schema.adminUsers)
    .set({
      mfaMethod: null,
      totpSecretEncrypted: null,
      mfaEnrolledAt: null,
      totpLastStep: null,
    })
    .where(eq(schema.adminUsers.id, userId));
  await db.delete(schema.adminRecoveryCodes).where(eq(schema.adminRecoveryCodes.userId, userId));
  await db.delete(schema.adminMfaCodes).where(eq(schema.adminMfaCodes.userId, userId));
}
