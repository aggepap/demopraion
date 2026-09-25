import 'server-only';

import { type NextRequest, NextResponse } from 'next/server';

import {
  MFA_CHALLENGE_COOKIE_NAME,
  verifyMfaChallenge,
  type MfaChallengeClaims,
  type MfaChallengePurpose,
} from '../../modules/auth/mfa-challenge';

/**
 * The guard for every endpoint reachable between the password step and the
 * session.
 *
 * Reads the cookie off the `NextRequest` rather than through `next/headers`,
 * for the same reason the rest of the factory takes the request explicitly: the
 * guard is then a function of its argument and can be driven end-to-end in a
 * unit test, which is where the interesting assertions about it live.
 *
 * `purpose` is checked here rather than in each handler because the two are not
 * interchangeable: an enrollment challenge belongs to somebody with NO second
 * factor yet, and if it satisfied the verify route then the policy that forced
 * them to enrol would be skippable by calling the other endpoint.
 */
export async function requireMfaChallenge(
  req: NextRequest,
  purpose: MfaChallengePurpose,
): Promise<MfaChallengeClaims | NextResponse> {
  const token = req.cookies.get(MFA_CHALLENGE_COOKIE_NAME)?.value ?? '';
  const claims = await verifyMfaChallenge(token);
  if (!claims || claims.purpose !== purpose) {
    // Same wording as any other unauthenticated request. "Your challenge
    // expired" and "you never had one" are not distinctions worth handing out.
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  return claims;
}
