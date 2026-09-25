/**
 * Typed API errors with a single, consistent wire shape.
 *
 * Handlers throw `ApiError` (or one of the helpers); the route factory
 * (`core/api/handler.ts`) catches it and renders `{ ok: false, error, … }`.
 * Nothing else in the codebase should hand-roll an error response.
 */

export type ApiErrorCode =
  | 'bad_request'
  | 'invalid_json'
  | 'invalid_input'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'captcha_failed'
  | 'mfa_invalid'
  | 'server_error';

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  bad_request: 400,
  invalid_json: 400,
  invalid_input: 422,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  // Its own code rather than a bare 400: the sign-in form has to tell "prove
  // you're human again" apart from "wrong password", and the two arrive down
  // the same failed submit.
  captcha_failed: 400,
  // Its own code for the same reason `captcha_failed` has one: the second
  // factor arrives down a different submit from the password, and "that code is
  // wrong" must not reach the user as "your password is wrong". It is a 401
  // because the request genuinely is unauthenticated — the password step alone
  // never was a sign-in.
  mfa_invalid: 401,
  server_error: 500,
};

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  /** Optional structured detail (e.g. zod `flatten()` output). */
  readonly issues?: unknown;
  /** Optional response headers (e.g. `Retry-After` on 429). */
  readonly headers?: Record<string, string>;

  constructor(
    code: ApiErrorCode,
    message?: string,
    opts?: { issues?: unknown; headers?: Record<string, string> },
  ) {
    super(message ?? code);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.issues = opts?.issues;
    this.headers = opts?.headers;
  }
}

export const badRequest = (msg?: string) => new ApiError('bad_request', msg);
export const invalidInput = (issues?: unknown, msg?: string) =>
  new ApiError('invalid_input', msg ?? 'Validation failed.', { issues });
export const unauthorized = (msg?: string) => new ApiError('unauthorized', msg);
export const forbidden = (msg?: string) => new ApiError('forbidden', msg);
export const notFound = (msg?: string) => new ApiError('not_found', msg);
export const conflict = (msg?: string) => new ApiError('conflict', msg ?? 'Already exists.');

/**
 * MariaDB unique-violation → 409. Recognises the driver's duplicate-entry error.
 *
 * The chain matters: drizzle-orm wraps the mysql2 error in its own
 * `DrizzleQueryError`, whose own `code`/`errno` are undefined and whose message
 * is the failed SQL — not "Duplicate entry". Only `cause` carries the real
 * `ER_DUP_ENTRY`/1062. Checking the top level alone turned every duplicate slug
 * into a raw 500 instead of a 409.
 */
export function isDuplicateKeyError(err: unknown): boolean {
  for (let e = err, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    const c = e as { code?: string; errno?: number; message?: string };
    if (
      c.code === 'ER_DUP_ENTRY' ||
      c.errno === 1062 ||
      (typeof c.message === 'string' && c.message.includes('Duplicate entry'))
    ) {
      return true;
    }
  }
  return false;
}

/**
 * MariaDB foreign-key violation → 422 rather than a bare 500.
 *
 * Referencing a row that has just been deleted in another tab is an ordinary
 * race in a multi-user admin, not a server fault: adding a cookie service to a
 * category someone else removed, or relating a document to one that is gone.
 * It surfaced as "Internal error", which tells the user nothing and looks like
 * the app broke. Walks `cause` for the same reason the duplicate check does.
 */
export function isForeignKeyError(err: unknown): boolean {
  for (let e = err, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    const c = e as { code?: string; errno?: number; message?: string };
    if (
      c.code === 'ER_NO_REFERENCED_ROW' ||
      c.code === 'ER_NO_REFERENCED_ROW_2' ||
      c.code === 'ER_ROW_IS_REFERENCED' ||
      c.code === 'ER_ROW_IS_REFERENCED_2' ||
      c.errno === 1451 ||
      c.errno === 1452 ||
      (typeof c.message === 'string' && /foreign key constraint/i.test(c.message))
    ) {
      return true;
    }
  }
  return false;
}
