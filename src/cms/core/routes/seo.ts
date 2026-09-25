import 'server-only';

import { z } from 'zod';

import { PERMISSIONS, requireApiPerm } from '../../modules/auth';
import { logAudit } from '../audit';
import { createRoute } from '../api/handler';
import { idParam } from '../api/params';
import { created, noContent, ok } from '../api/respond';
import {
  createRedirect,
  delete404,
  deleteMeta,
  deleteRedirect,
  list404,
  listMeta,
  listRedirects,
  patchMeta,
  REDIRECT_KINDS,
  set404Ignored,
  updateRedirect,
} from '../seo/service';
import { redirectWouldLoop } from '../seo/match';
import { revalidateMeta, revalidateRedirects } from '../seo/resolve';
import { invalidInput, notFound } from '../errors';

/**
 * A URL that may be published — into `<link rel="canonical">`, `og:image`, or a
 * redirect's `Location`.
 *
 * These were bounded by length alone, so any string at all could be saved:
 * `javascript:…`, `data:…`, a bare word, a half-typed address. None of them is
 * ever a thing someone meant to enter, and each one silently breaks the page's
 * SEO identity or its social preview for as long as nobody notices — which,
 * being invisible in the admin UI, is a long time. Length is not validation.
 *
 * Both spellings that are actually useful are accepted: an absolute http(s)
 * URL, and a site-relative path starting with `/`. Everything else is rejected
 * at the point of entry, where the person can still fix it.
 *
 * Defined up here, above the redirect schemas, because a redirect `target` needs
 * exactly the same rule and had none: `proxy.ts` hands the stored value to
 * `NextResponse.redirect()` as-is, so anything at all could be published as a
 * `Location`. (Browsers refuse to follow a `javascript:` Location, so that half
 * is not an XSS — but an arbitrary scheme or off-site host is still not what an
 * admin-managed redirect list is for, and it was the one field of the three
 * without the check.)
 */
const publishableUrl = (label: string) =>
  z
    .string()
    .trim()
    .max(512)
    .refine(
      (v) =>
        v === '' ||
        // `//evil.com` starts with `/` and looks site-relative, but a browser
        // reads it as protocol-relative and resolves it to another host: as a
        // redirect `Location` that is an open redirect, and as a canonical it
        // hands the site's search authority to a domain someone else owns —
        // the exact transfer PM_BRIDGE_SPEC §13 calls out as MUST-not. Excluded
        // explicitly, because the `startsWith('/')` test alone accepts it.
        (v.startsWith('/') && !v.startsWith('//')) ||
        /^https?:\/\//i.test(v),
      { message: `${label} must be an absolute http(s) URL or a path starting with "/".` },
    )
    .refine((v) => {
      if (!/^https?:\/\//i.test(v)) return true;
      try {
        new URL(v);
        return true;
      } catch {
        return false;
      }
    }, { message: `${label} is not a valid URL.` });

// ── Redirects ─────────────────────────────────────────────────────────────
/** Compare paths the way the redirect lookup does: ignoring a trailing slash. */
const normalizePath = (p: string): string => p.trim().replace(/\/+$/, '') || '/';

/**
 * A redirect onto itself is a permanent loop: the browser follows it back to
 * the same path forever and the page becomes unreachable — and with a 301 the
 * loop is cached, so deleting the rule afterwards does not free the visitor.
 * Nothing rejected it, so it could be saved from the admin in one click.
 */
const SELF_LOOP =
  'This would create a redirect loop — following it comes back to where it started.';

const redirectFields = z.object({
  source: z.string().trim().min(1).max(512),
  // Same rule as `canonical`/`ogImage` — see `publishableUrl`. `.min(1)` stays:
  // a redirect to nowhere is not a redirect, whereas an empty canonical means
  // "unset", which is why the helper itself allows `''`.
  target: publishableUrl('Redirect target').pipe(z.string().min(1)),
  statusCode: z.coerce.number().int().refine((v) => [301, 302, 307, 308].includes(v)).optional(),
  kind: z.enum(REDIRECT_KINDS).optional(),
  active: z.boolean().optional(),
  notes: z.string().max(512).nullish(),
});

const redirectBody = redirectFields.refine(
  (r) => normalizePath(r.source) !== normalizePath(r.target),
  { message: SELF_LOOP, path: ['target'] },
);

// `.partial()` does not exist on a refined schema, so the patch shape is built
// from the plain object and re-refined. A patch may also change only ONE side,
// so the handler re-checks against the stored row — see `redirectUpdateRoute`.
const redirectPatchBody = redirectFields
  .partial()
  .refine(
    (r) => r.source === undefined || r.target === undefined
      || normalizePath(r.source) !== normalizePath(r.target),
    { message: SELF_LOOP, path: ['target'] },
  );


/**
 * Would saving `source -> target` create a redirect cycle?
 *
 * Blocking only a rule that points at itself was not enough: two rules,
 * `/a -> /b` and `/b -> /a`, are each individually fine and together send the
 * visitor bouncing forever. The resolver follows ONE hop per request, so a
 * multi-rule cycle never surfaces server-side — it only manifests in the
 * browser, as a page that will not load.
 *
 * So the chain is walked here, at write time, across the other active rules.
 * `excludeId` is the rule being edited, whose stored version must not be
 * counted against its own replacement.
 */
async function wouldLoop(source: string, target: string, excludeId?: number): Promise<boolean> {
  /*
   * Every active rule, not only the literal ones.
   *
   * This used to filter `kind === 'literal'`, which made the loop check blind to
   * exactly the rules most likely to form one: a wildcard `/docs/*` that swallows
   * a whole subtree can send a visitor straight back to a path a literal rule
   * bounces forward again, and neither rule looks wrong on its own. The check that
   * refuses a self-loop and a two-rule cycle (F-013, F-014) therefore passed
   * happily on a cycle built from mixed kinds (F-051).
   *
   * The walk itself is `redirectWouldLoop`, which asks the resolver's own question
   * — "does any active rule match this path?" — so the two cannot disagree.
   */
  const rules = (await listRedirects()).filter((r) => r.active !== false && r.id !== excludeId);
  return redirectWouldLoop(rules, source, target);
}

/**
 * The longest a stored regex may take on adversarial input before it is refused.
 *
 * A regex rule runs on every request, synchronously, on the thread that serves
 * everyone. A pattern with catastrophic backtracking — `(a+)+$` is the classic —
 * takes the whole site down, and it is as easy to write by accident as on purpose:
 * the author sees a rule that works on the path they tried it with (F-052).
 *
 * Detecting such a pattern by reading it is unreliable, so it is measured instead:
 * run it against inputs designed to make a backtracking pattern misbehave and
 * refuse it if it is slow. That catches the realistic case — an honest admin with
 * an unlucky pattern — and a deliberately crafted one still meets the input cap in
 * the resolver.
 */
const REGEX_PROBE_BUDGET_MS = 25;

/**
 * A quantifier applied to a group that already repeats — the shape behind almost
 * every accidental ReDoS: `(a+)+`, `(.*)*`, `([a-z]+){2,}`.
 *
 * This is checked by reading the pattern rather than by timing it, because timing
 * alone cannot see the problem. A stall only appears when the probe input actually
 * reaches the dangerous part of the pattern, and a rule realistically starts with a
 * literal path prefix (`^/docs/(a+)+$`): a generic probe fails at the first
 * character, returns instantly, and the pattern looks harmless. Measuring it was
 * the first version of this guard, and it passed the very pattern the spec files
 * as a server-stalling rule.
 *
 * The walk tracks, per open group, whether anything inside it repeats, and refuses
 * as soon as a repeating group is itself quantified. Escapes and character classes
 * are skipped so `\+` and `[+*]` are the literal characters they are, and `(?:…)`
 * counts as a group like any other since backtracking does not care about capture.
 */
function nestedQuantifier(source: string): boolean {
  const quantifierAt = (i: number): boolean =>
    source[i] === '*' || source[i] === '+' || (source[i] === '{' && /^\{\d+(,\d*)?\}/.test(source.slice(i)));

  // One frame per open group: does its body contain a repetition?
  const stack: boolean[] = [];
  let topLevelRepeats = false;
  let inClass = false;

  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    if (c === '\\') {
      i += 1;
      continue;
    }
    if (inClass) {
      if (c === ']') inClass = false;
      continue;
    }
    if (c === '[') {
      inClass = true;
      continue;
    }
    if (c === '(') {
      stack.push(false);
      continue;
    }
    if (c === ')') {
      const bodyRepeats = stack.pop() ?? false;
      // Is this group itself quantified? `?` alone cannot blow up, `*`/`+`/`{n,}` can.
      let j = i + 1;
      if (source[j] === '?' && !quantifierAt(j + 1)) j += 1; // a lone `?` — harmless
      if (bodyRepeats && quantifierAt(j)) return true;
      const groupRepeats = bodyRepeats || quantifierAt(j);
      if (stack.length) stack[stack.length - 1] = stack[stack.length - 1] || groupRepeats;
      else topLevelRepeats = topLevelRepeats || groupRepeats;
      continue;
    }
    if (quantifierAt(i)) {
      if (stack.length) stack[stack.length - 1] = true;
      else topLevelRepeats = true;
    }
  }
  void topLevelRepeats;
  return false;
}

/**
 * Probe inputs built from the pattern's own leading literal text.
 *
 * A rule is normally anchored to a path prefix, so a probe that ignores the prefix
 * never gets far enough into the pattern to be slow. Reusing the pattern's literal
 * head means the probe reaches the interesting part.
 */
function probesFor(source: string): string[] {
  let head = '';
  for (let i = source.startsWith('^') ? 1 : 0; i < source.length; i += 1) {
    const c = source[i];
    if (c === '\\') {
      head += source[i + 1] ?? '';
      i += 1;
      continue;
    }
    if ('([{*+?.|)$'.includes(c)) break;
    head += c;
  }
  const tails = ['a'.repeat(30), `${'a'.repeat(30)}!`, 'a/'.repeat(20), `${'-'.repeat(40)}x`];
  return [...tails.map((t) => `${head}${t}`), ...tails.map((t) => `/${t}`)];
}

function regexIsSafe(source: string): { ok: true } | { ok: false; message: string } {
  let re: RegExp;
  try {
    re = new RegExp(source);
  } catch (err) {
    return { ok: false, message: `That is not a valid regular expression: ${(err as Error).message}` };
  }
  const advice =
    'A pattern like this can take seconds to match some paths, and while it does the ' +
    'whole site stops answering — matching runs on every request. Avoid a repeat ' +
    'inside a repeat, such as (a+)+ or (.*)*: write (a+) or [a-z]+ instead.';

  if (nestedQuantifier(source)) return { ok: false, message: advice };

  const started = Date.now();
  for (const probe of probesFor(source)) {
    try {
      re.test(probe);
    } catch {
      /* a throw is not a performance problem */
    }
    if (Date.now() - started > REGEX_PROBE_BUDGET_MS) return { ok: false, message: advice };
  }
  return { ok: true };
}

/**
 * Reject a rule whose kind does not match the shape of its source.
 *
 * A `wildcard` source without a `/*` suffix used to fall through to an exact
 * comparison, so it behaved as a plain literal while the admin had deliberately
 * chosen wildcard and believed a subtree was covered (F-053). Guessing which they
 * meant is what produced the confusion, so it is refused with the shape spelled
 * out instead.
 */
/**
 * The source as it will actually be compared at request time.
 *
 * This app runs `trailingSlash: false`, so Next strips a trailing slash before the
 * proxy sees the request: a rule stored as `/foo/` could never fire, and the 308
 * the admin saw was Next's own normalisation rather than their rule — which made a
 * dead rule look like a working one (F-055). Storing the form that can match means
 * the rule fires on the very next hop instead of never.
 */
function storableSource(source: string): string {
  return normalizePath(source);
}

function checkKindShape(kind: string | undefined, source: string): string | null {
  if (kind === 'wildcard' && !normalizePath(source).endsWith('/*') && !source.trim().endsWith('/*')) {
    return 'A wildcard source has to end with "/*" — for example "/docs/*" to catch everything under /docs.';
  }
  if (kind === 'regex') {
    const safe = regexIsSafe(source);
    if (!safe.ok) return safe.message;
  }
  return null;
}

export function redirectsListRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.seoRead),
    handler: async () => ok(await listRedirects()),
  });
}

export function redirectCreateRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.seoWrite),
    input: redirectBody,
    handler: async ({ input, auth }) => {
      const shape = checkKindShape(input.kind, input.source);
      if (shape) throw invalidInput({ fieldErrors: { source: [shape] } }, shape);
      input.source = storableSource(input.source);
      if (await wouldLoop(input.source, input.target)) {
        throw invalidInput({ fieldErrors: { target: [SELF_LOOP] } }, SELF_LOOP);
      }
      const row = await createRedirect(input, auth.userId);
      revalidateRedirects();
      await logAudit({ userId: auth.userId, action: 'redirect.create', subjectType: 'seo_redirect', subjectId: row.id, after: row });
      return created(row);
    },
  });
}

export function redirectUpdateRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.seoWrite),
    input: redirectPatchBody,
    handler: async ({ params, input, auth }) => {
      const id = idParam(params.id);
      // Changing one side only: compare against what is stored, or a PATCH
      // carrying just `target` could still point the rule at its own source.
      if (input.source !== undefined || input.target !== undefined) {
        const current = (await listRedirects()).find((r) => r.id === id);
        if (!current) throw notFound('Redirect not found.');
        const nextSource = input.source ?? current.source;
        const nextTarget = input.target ?? current.target;
        // A patch may change only the kind, or only the source — either can turn a
        // sound rule into a misleading or a dangerous one, so the final shape is what
        // gets checked.
        const nextKind = input.kind ?? current.kind;
        const shape = checkKindShape(nextKind, nextSource);
        if (shape) throw invalidInput({ fieldErrors: { source: [shape] } }, shape);
        if (input.source !== undefined) input.source = storableSource(input.source);
        if (await wouldLoop(nextSource, nextTarget, id)) {
          throw invalidInput({ fieldErrors: { target: [SELF_LOOP] } }, SELF_LOOP);
        }
      }
      await updateRedirect(id, input);
      revalidateRedirects();
      await logAudit({ userId: auth.userId, action: 'redirect.update', subjectType: 'seo_redirect', subjectId: id, after: input });
      return ok({ ok: true });
    },
  });
}

export function redirectDeleteRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.seoWrite),
    handler: async ({ params, auth }) => {
      const id = idParam(params.id);
      await deleteRedirect(id);
      revalidateRedirects();
      await logAudit({ userId: auth.userId, action: 'redirect.delete', subjectType: 'seo_redirect', subjectId: id });
      return noContent();
    },
  });
}

// ── 404 monitor ───────────────────────────────────────────────────────────
export function notFoundListRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.seoRead),
    handler: async () => ok(await list404()),
  });
}

const notFoundPatch = z.object({ ignored: z.boolean().optional() });

export function notFoundUpdateRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.seoWrite),
    input: notFoundPatch,
    handler: async ({ params, input, auth }) => {
      const id = idParam(params.id);
      // An empty patch changes nothing, so it records nothing. The audit log is
      // only useful if an entry in it means something happened; a caller could
      // otherwise fill it with `seo.404.update` rows that touched no row at all.
      if (input.ignored === undefined) return ok({ ok: true });
      await set404Ignored(id, input.ignored);
      await logAudit({
        userId: auth.userId,
        action: 'seo.404.update',
        subjectType: 'seo_not_found',
        subjectId: id,
        after: input,
      });
      return ok({ ok: true });
    },
  });
}

export function notFoundDeleteRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.seoWrite),
    handler: async ({ params, auth }) => {
      const id = idParam(params.id);
      await delete404(id);
      await logAudit({
        userId: auth.userId,
        action: 'seo.404.delete',
        subjectType: 'seo_not_found',
        subjectId: id,
      });
      return noContent();
    },
  });
}

// ── Per-path meta overrides ─────────────────────────────────────────────────

const metaBody = z.object({
  path: z.string().trim().min(1).max(255),
  locale: z.string().trim().max(8),
  title: z.string().max(255).nullish(),
  description: z.string().max(320).nullish(),
  robots: z.string().max(64).nullish(),
  canonical: publishableUrl('Canonical URL').nullish(),
  ogTitle: z.string().max(255).nullish(),
  ogDescription: z.string().max(320).nullish(),
  ogImage: publishableUrl('Social image URL').nullish(),
});

export function metaListRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.seoRead),
    handler: async () => ok(await listMeta()),
  });
}

export function metaUpsertRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.seoWrite),
    input: metaBody,
    handler: async ({ input, auth }) => {
      // A merge, not a whole-row write: the form does not manage og:title /
      // og:description, which the PM bridge writes onto the same row, and a
      // `upsertMeta` here nulled them on every admin save. Fields the form sends
      // (null included) are written; fields it omits are left alone.
      await patchMeta(input, auth.userId);
      revalidateMeta();
      await logAudit({
        userId: auth.userId,
        action: 'seo.meta.upsert',
        subjectType: 'seo_meta',
        after: input,
      });
      return ok({ ok: true });
    },
  });
}

export function metaDeleteRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.seoWrite),
    handler: async ({ params, auth }) => {
      const id = idParam(params.id);
      await deleteMeta(id);
      revalidateMeta();
      await logAudit({
        userId: auth.userId,
        action: 'seo.meta.delete',
        subjectType: 'seo_meta',
        subjectId: id,
      });
      return noContent();
    },
  });
}
