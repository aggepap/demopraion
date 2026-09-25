import { CmsApiError } from './api-client';

/**
 * Turn a failed sign-in into the one sentence the form shows.
 *
 * Extracted from `LoginForm` so it can be tested: this suite has no DOM
 * harness, and the mapping is the part with a way to go wrong — a captcha
 * rejection reported as "invalid email or password" sends the user to retype a
 * password that was always correct.
 *
 * Everything unrecognised stays generic on purpose: the server answers a wrong
 * password and an unknown address identically, and a more specific message
 * here would undo that.
 */
export function loginErrorMessage(err: unknown): string {
  if (err instanceof CmsApiError) {
    if (err.code === 'captcha_failed') {
      return 'Captcha check failed. Please tick the box again and retry.';
    }
    if (err.status === 429) {
      return 'Too many attempts. Please wait and try again.';
    }
  }
  return 'Invalid email or password.';
}

/**
 * The same job for the second-factor step, and deliberately a separate
 * function.
 *
 * `loginErrorMessage` falls back to "Invalid email or password.", which is
 * correct there and actively wrong here: the password was accepted a moment
 * ago, and telling someone to retype it sends them back through the whole
 * sign-in for no reason. Every branch below avoids the word.
 */
export function mfaErrorMessage(err: unknown): string {
  if (err instanceof CmsApiError) {
    if (err.code === 'mfa_invalid') {
      return 'That code is not valid. Check the code and try again.';
    }
    if (err.status === 429) {
      return 'Too many attempts. Please wait and try again.';
    }
    if (err.status === 401 || err.status === 403) {
      // The ten-minute challenge is gone, not the code wrong. Saying "wrong
      // code" here leaves the user retrying a form whose cookie no longer
      // exists, with nothing on screen to suggest starting over.
      return 'This sign-in attempt has expired. Please sign in again.';
    }
    if (err.message) return err.message;
  }
  return 'Could not verify that code. Please try again.';
}
