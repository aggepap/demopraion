/**
 * How a stored redirect rule is compared against an arriving request.
 *
 * Its own module, and pure, for two reasons. It is the single answer to "what does this
 * rule catch" — the resolver asks it at request time and the write path asks it to detect
 * a loop, and two different answers to that question is exactly how F-051 happened. And it
 * is the part worth testing directly: three rules were permanently inert because of the
 * comparison alone (F-053, F-054, F-055), which a browser test can only observe through a
 * whole request.
 */

/**
 * One comparable form for a path, so a stored rule and an arriving request are
 * judged on the same thing.
 *
 * Two rules were permanently inert without it. A source containing non-ASCII
 * characters never fired, because a browser sends them percent-encoded and
 * `nextUrl.pathname` hands them over that way, while the admin stored the
 * characters themselves (F-054). And a source written with a trailing slash never
 * fired either: this app runs `trailingSlash: false`, so Next has already stripped
 * it before the proxy sees the request — the visible 308 to the unslashed form is
 * Next's own doing, which made the rule look like it worked while it sat dead
 * (F-055).
 *
 * Decoding can throw on a malformed escape; a path that cannot be decoded is
 * compared as it arrived, which is still better than refusing to match anything.
 */
function comparablePath(p: string): string {
  let out = p.trim();
  try {
    out = decodeURIComponent(out);
  } catch {
    /* keep the raw form */
  }
  // Trailing slash, except for the root itself.
  return out.length > 1 ? out.replace(/\/+$/, '') : out;
}

/**
 * The longest input a stored regex is allowed to see.
 *
 * A regex rule is authored by an admin and runs on every request, synchronously,
 * on the same thread that serves everyone. Catastrophic backtracking needs a long
 * subject to bite, so capping the subject bounds the damage even for a pattern
 * that slipped past the checks at write time. Real paths are far shorter than
 * this; anything longer is not going to match a sensible rule anyway.
 */
const MAX_REGEX_PATH = 256;

/** Exported so the write path's loop check asks the same question this does —
 *  two different notions of "what does this rule catch" is how F-051 happened. */
export function redirectMatches(source: string, kind: string, path: string): boolean {
  const src = comparablePath(source);
  const p = comparablePath(path);

  if (kind === 'literal') return src === p;
  if (kind === 'wildcard') {
    if (src.endsWith('/*')) return p === src.slice(0, -2) || p.startsWith(src.slice(0, -1));
    // A rule the admin marked as a wildcard but wrote without `/*` used to fall
    // back to an exact comparison, silently behaving as a literal. The write path
    // refuses that shape now; an older stored row is treated as the prefix the
    // author plainly meant.
    return p === src || p.startsWith(`${src}/`);
  }
  if (kind === 'regex') {
    if (p.length > MAX_REGEX_PATH) return false;
    try {
      return new RegExp(source).test(p);
    } catch {
      return false;
    }
  }
  return false;
}

/** The minimum of a stored rule the loop walk needs. */
export interface RedirectRuleLike {
  source: string;
  kind: string;
  target: string;
}

/** Compare paths the way the write path always has: trimmed, trailing slash ignored. */
const loopPath = (p: string): string => p.trim().replace(/\/+$/, '') || '/';

/**
 * Would adding `source -> target` next to `rules` send a visitor round in a circle?
 *
 * Pure so every writer asks the same question: the admin's redirect routes, and the
 * rules the CMS writes on its own when a post is unpublished. `rules` must already be
 * the ACTIVE rules, minus the one being replaced. The walk is bounded: a chain longer
 * than that is a configuration problem of its own, and counts as a loop.
 */
export function redirectWouldLoop(rules: ReadonlyArray<RedirectRuleLike>, source: string, target: string): boolean {
  const src = loopPath(source);
  if (loopPath(target) === src) return true;

  // The rule under consideration is not stored yet, so the walk would not find it.
  // Without this a chain that closes only *through* the new rule looks fine.
  const all = [...rules, { source, kind: 'literal', target }];
  const nextHopFor = (path: string): string | undefined => {
    const hit = all.find((r) => redirectMatches(r.source, r.kind, path));
    return hit ? loopPath(hit.target) : undefined;
  };

  let hop = loopPath(target);
  const seen = new Set<string>([src]);
  for (let i = 0; i < 20; i++) {
    if (seen.has(hop)) return true;
    seen.add(hop);
    const next = nextHopFor(hop);
    if (next === undefined) return false;
    hop = next;
  }
  return true;
}
