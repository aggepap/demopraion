/**
 * Auth module public surface. Ported from v1 `src/admin/lib/auth/*` with the
 * three fixes flagged in BACKEND.md §13: login rate-limit (applied at the
 * route), fresh DB permission checks in guards, and a real read/write split.
 */
export { PERMISSIONS, ALL_PERMISSIONS, hasPerm, hasAnyPerm } from './permissions';
export type { PermissionKey } from './permissions';

export {
  signSession,
  verifySession,
  setSessionCookie,
  clearSessionCookie,
  readSessionCookie,
  SESSION_COOKIE_NAME,
} from './session';
export type { SessionClaims } from './session';

export { hashPassword, verifyPassword, MIN_PASSWORD_LENGTH } from './password';
export { loginWithPassword, issueSession, claimsForUser } from './login';
export type { LoginResult } from './login';

export {
  signMfaChallenge,
  verifyMfaChallenge,
  setMfaChallengeCookie,
  clearMfaChallengeCookie,
  readMfaChallengeCookie,
  MFA_CHALLENGE_COOKIE_NAME,
  MFA_CHALLENGE_TTL_SECONDS,
} from './mfa-challenge';
export type { MfaChallengeClaims, MfaChallengePurpose } from './mfa-challenge';

export {
  getMfaStatus,
  startTotpEnrollment,
  issueEmailCode,
  confirmEnrollment,
  verifySecondFactor,
  replaceRecoveryCodes,
  clearMfa,
} from './mfa';
export type { MfaMethod, MfaStatus } from './mfa';

export { getCurrentUser, loadUserPermissions } from './current-user';
export type { CurrentUser } from './current-user';

export {
  requireAuth,
  requirePerm,
  requireApiAuth,
  requireApiPerm,
} from './guards';
