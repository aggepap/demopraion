/**
 * The break-glass second-factor bypass.
 *
 * ## What this is, stated plainly
 *
 * A single, static, shared code held in the environment that stands in for any
 * administrator's second factor. It is the most dangerous mechanism in this
 * feature and the comments below are the reasoning that keeps it bounded rather
 * than decoration.
 *
 * It is NOT a way past authentication: it is only reachable once the password
 * step has already produced a `cms_mfa` challenge, so an attacker needs a valid
 * password *and* this code. In power it is roughly the network-reachable
 * equivalent of the `db:reset-mfa` CLI — which is precisely why it is throttled
 * far harder than anything else here.
 *
 * ## Off by default, and off when misconfigured
 *
 * Unset means the feature does not exist. A value that is not exactly six
 * digits ALSO means the feature does not exist, rather than meaning a shorter
 * bypass: `ADMIN_MFA_BYPASS_CODE=12` is a typo in an env file, not consent to
 * install a two-digit door. Failing closed on a malformed value is the whole
 * reason the shape is validated at read time instead of at compare time.
 *
 * Pure and free of `server-only` so the judgement is unit-testable, the same
 * split `security/captcha.ts` uses.
 */
import { timingSafeEquals } from '../tokens/crypto';

/** Digits in the bypass code. Fixed, so a shorter configured value is a misconfiguration. */
export const MFA_BYPASS_CODE_LENGTH = 6;

const SHAPE = new RegExp(`^\\d{${MFA_BYPASS_CODE_LENGTH}}$`);

/** Module-level so a misconfigured deploy warns once, not once per attempt. */
let malformedWarned = false;

/**
 * The configured code, or `null` when the feature is off.
 *
 * `null` covers three cases that must behave identically: unset, blank, and
 * malformed. Collapsing them here means no caller can accidentally treat "set
 * but wrong" as "set".
 */
export function readBypassCode(): string | null {
  const raw = process.env.ADMIN_MFA_BYPASS_CODE?.trim();
  if (!raw) return null;
  if (!SHAPE.test(raw)) {
    if (!malformedWarned) {
      malformedWarned = true;
      // The value itself is never logged — this is a credential, and a server
      // log is exactly where a credential should not end up.
      console.warn(
        `[cms/auth] ADMIN_MFA_BYPASS_CODE is set but is not exactly ${MFA_BYPASS_CODE_LENGTH} digits. ` +
          'The two-factor bypass is DISABLED until it is corrected.',
      );
    }
    return null;
  }
  return raw;
}

/** Whether the bypass is actually in force. Used to decide if the UI offers it at all. */
export function bypassCodeConfigured(): boolean {
  return readBypassCode() !== null;
}

export type BypassResult = { ok: true } | { ok: false; reason: 'disabled' | 'mismatch' };

/**
 * Judge one attempt. `configured` comes from `readBypassCode`, so a `null` here
 * already means unset-or-malformed and must refuse everything — including an
 * empty submission, which is the one input an empty configured value would
 * otherwise have matched.
 *
 * `timingSafeEquals` rather than `===`: six digits is a small enough space that
 * a timing oracle is a genuine shortcut through it, and it is the codebase's
 * one constant-time comparator.
 */
export function interpretBypassAttempt(configured: string | null, submitted: string): BypassResult {
  if (configured === null) return { ok: false, reason: 'disabled' };
  return timingSafeEquals(submitted.trim(), configured) ? { ok: true } : { ok: false, reason: 'mismatch' };
}
