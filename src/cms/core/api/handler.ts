/**
 * The one route factory. Every CMS API route is built with `createRoute`, so
 * the cross-cutting concerns live in exactly one place — replacing v1's ~15
 * files of copy-pasted parse/validate/audit/error boilerplate (BACKEND.md §13.11).
 *
 * Pipeline (in order):
 *   1. same-origin check (state-changing methods)
 *   2. captcha (optional) — its own limiter, then verification
 *   3. rate limit (optional)
 *   4. guard → auth context, or a short-circuit Response (401/403)
 *   5. validate query params (optional zod)
 *   6. validate JSON body (optional zod)
 *   7. run handler; wrap plain returns, pass Responses through
 *   8. map thrown ApiError / duplicate-key / unknown to the uniform error shape
 */
import { type NextRequest, NextResponse } from 'next/server';
import type { z } from 'zod';

import { ApiError, conflict, invalidInput, isDuplicateKeyError, isForeignKeyError } from '../errors';
import { checkRateLimit, clientIpLabel, getClientIp, type RateLimitConfig } from '../rate-limit';
import { CAPTCHA_HEADER, verifyCaptchaToken } from '../security/captcha';
import { isSameOrigin } from './same-origin';

export interface RouteContext<TInput, TQuery, TAuth> {
  req: NextRequest;
  /** Dynamic route params (already awaited). */
  params: Record<string, string>;
  /** Parsed & validated JSON body (`undefined` when no `input` schema). */
  input: TInput;
  /** Parsed & validated query params (`undefined` when no `query` schema). */
  query: TQuery;
  /** Value returned by `guard`, with any short-circuit `Response` type removed
   *  (the factory returns those before the handler runs). `undefined` when no guard. */
  auth: Exclude<TAuth, Response>;
  /** Client IP for logging/limiting. */
  ip: string;
}

export interface RouteConfig<TInput, TQuery, TAuth> {
  /** Enforce same-origin on state-changing methods. Default true. */
  sameOrigin?: boolean;
  /**
   * The route's own budget, consumed only by requests that get PAST the captcha
   * — so on a login it counts password guesses, not requests.
   */
  rateLimit?: {
    scope: string;
    /**
     * A request that proves who it is up front — a scheduler presenting the cron
     * secret — and so may be counted in one shared bucket when it carries no
     * `X-Real-IP`, instead of being refused as unidentifiable. A scheduler on the
     * same host calls `127.0.0.1` directly, past the proxy that sets the header,
     * and was answered 429 on every run in production. Anything that fails the
     * check is limited exactly as before, so a missing header is no way round it.
     */
    trustedWithoutIp?: (req: NextRequest) => boolean;
  } & RateLimitConfig;
  /**
   * Require a verified reCAPTCHA token in the `x-captcha-token` header.
   *
   * A header rather than a body field so the check can run before the body is
   * parsed — which keeps a single-use token out of the `input` schema, out of
   * the `issues` of a 422, and out of the audit row's `after` column.
   *
   * No-op unless BOTH reCAPTCHA keys are set; see `core/security/captcha.ts`.
   */
  captcha?: {
    /**
     * A SEPARATE, deliberately wide per-IP ceiling on the verification step.
     *
     * Two budgets, because two different things are being rationed. A failed
     * captcha must not spend `rateLimit` — a v2 token expires after about two
     * minutes, so a user who ticks the box, types slowly and retries would burn
     * their password attempts without ever having been allowed to try a
     * password. But verification is an outbound call to Google, so failing it
     * cannot be free either, or this endpoint becomes a way to spend our quota.
     * Wide enough that a person never meets it; narrow enough to bound a script.
     */
    rateLimit: { scope: string } & RateLimitConfig;
  };
  /** Return the auth context, or a `Response` to short-circuit (e.g. 401/403). */
  guard?: (req: NextRequest) => Promise<TAuth | Response> | TAuth | Response;
  input?: z.ZodType<TInput>;
  query?: z.ZodType<TQuery>;
  handler: (
    ctx: RouteContext<TInput, TQuery, TAuth>,
  ) => Promise<Response | unknown> | Response | unknown;
}

type NextRouteArgs = { params?: Promise<Record<string, string>> };

export function createRoute<TInput = undefined, TQuery = undefined, TAuth = undefined>(
  config: RouteConfig<TInput, TQuery, TAuth>,
) {
  return async function route(req: NextRequest, ctx?: NextRouteArgs): Promise<Response> {
    try {
      const method = req.method.toUpperCase();
      const isWrite = method !== 'GET' && method !== 'HEAD';

      if (isWrite && (config.sameOrigin ?? true) && !isSameOrigin(req)) {
        throw new ApiError('forbidden', 'Cross-origin request rejected.');
      }

      // Two different questions: `getClientIp` may say "I cannot tell", which the
      // limiter must act on, while the handler only wants something to write down.
      const ip = clientIpLabel(req);

      if (config.captcha) {
        const gate = config.captcha.rateLimit;
        const r = checkRateLimit(gate.scope, getClientIp(req), gate);
        if (!r.allowed) {
          throw new ApiError('rate_limited', 'Too many requests.', {
            headers: { 'Retry-After': String(r.retryAfterSeconds) },
          });
        }
        const result = await verifyCaptchaToken(req.headers.get(CAPTCHA_HEADER));
        if (!result.ok) {
          // The reason is for us, not the caller: naming it would tell a script
          // whether its token was stale, forged or simply absent.
          console.warn('[cms/api] captcha rejected', { reason: result.reason });
          throw new ApiError('captcha_failed', 'Captcha check failed. Please try again.');
        }
      }

      // AFTER the captcha, so a rejected one costs nothing here.
      if (config.rateLimit) {
        const clientIp =
          getClientIp(req) ?? (config.rateLimit.trustedWithoutIp?.(req) ? 'trusted-without-ip' : null);
        const r = checkRateLimit(config.rateLimit.scope, clientIp, config.rateLimit);
        if (!r.allowed) {
          throw new ApiError('rate_limited', 'Too many requests.', {
            headers: { 'Retry-After': String(r.retryAfterSeconds) },
          });
        }
      }

      let auth = undefined as Exclude<TAuth, Response>;
      if (config.guard) {
        const g = await config.guard(req);
        if (g instanceof Response) return g;
        auth = g as Exclude<TAuth, Response>;
      }

      const params = ctx?.params ? await ctx.params : {};

      let query = undefined as TQuery;
      if (config.query) {
        const raw = Object.fromEntries(new URL(req.url).searchParams);
        const parsed = config.query.safeParse(raw);
        if (!parsed.success) throw invalidInput(parsed.error.flatten());
        query = parsed.data;
      }

      let input = undefined as TInput;
      if (config.input) {
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          throw new ApiError('invalid_json', 'Request body is not valid JSON.');
        }
        const parsed = config.input.safeParse(body);
        if (!parsed.success) throw invalidInput(parsed.error.flatten());
        input = parsed.data;
      }

      const result = await config.handler({ req, params, input, query, auth, ip });
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (err) {
      return renderError(err);
    }
  };
}

function renderError(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json(
      {
        ok: false,
        error: err.code,
        message: err.message,
        ...(err.issues !== undefined ? { issues: err.issues } : {}),
      },
      { status: err.status, headers: err.headers },
    );
  }
  if (isForeignKeyError(err)) {
    const e = new ApiError(
      'invalid_input',
      'Something this refers to no longer exists — it may have been deleted. Reload and try again.',
    );
    return NextResponse.json({ ok: false, error: e.code, message: e.message }, { status: e.status });
  }

  if (isDuplicateKeyError(err)) {
    /*
     * Generic to the caller, specific in the log.
     *
     * The response says "Already exists." and names no key, which is right — the
     * key names are internal and a 409 that enumerates them is an enumeration
     * oracle. But nothing recorded WHICH constraint fired either, so a conflict
     * was undiagnosable from both ends at once: the caller could not tell what it
     * collided with and neither could anyone reading the server. Two QA specs
     * failed on `{"error":"conflict","message":"Already exists."}` with no way to
     * find out what was duplicated. The driver's own error carries the constraint
     * name; logging it costs nothing and leaves the response unchanged.
     */
    console.error('[cms/api] duplicate key', err);
    const e = conflict();
    return NextResponse.json({ ok: false, error: e.code, message: e.message }, { status: e.status });
  }
  console.error('[cms/api] unhandled error', err);
  return NextResponse.json(
    { ok: false, error: 'server_error', message: 'Internal error.' },
    { status: 500 },
  );
}
