/**
 * Translating between praion's vocabulary and Product Manager's.
 *
 * Pure functions with no database and no `server-only`, so every rule here is
 * unit-testable — which matters, because several of them are security controls
 * rather than conveniences (off-origin canonicals, the robots vocabulary, the
 * prototype-pollution guard).
 */
import type { CmsConfig, ResolvedCollection } from '../../config';
import { resolvePath } from '../../core/documents/service';
import { siteOrigin } from '../../core/paths';

export interface PermalinkRow {
  slug: string;
  locale: string;
  canonicalPath: string | null;
}

/**
 * The absolute public URL of a document.
 *
 * `canonical_path` first when it is set — it is the resolved public path and is
 * globally unique — otherwise derive it from the collection's route template via
 * the *same* `resolvePath` the document service uses on create.
 *
 * `resolvePath` rather than a hand-built `localePrefix()` URL, so a permalink
 * can never disagree with the canonical path the document was stored under.
 */
export function permalinkFor(
  config: CmsConfig,
  collection: ResolvedCollection,
  row: PermalinkRow,
): string | null {
  const path = row.canonicalPath ?? resolvePath(collection, row.slug, row.locale, config.defaultLocale);
  if (!path) return null;
  return `${siteOrigin()}${path}`;
}

/** An absolute URL for a site-relative path. */
export function absoluteUrl(path: string): string {
  return `${siteOrigin()}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * praion status → PM status.
 *
 * PM speaks only `publish` and `draft`. `scheduled` maps to `publish` because it
 * *will* be public and PM should be scoring it; `archived` maps to `draft`
 * because it is not.
 */
export function toPmStatus(status: string): 'publish' | 'draft' {
  return status === 'published' || status === 'scheduled' ? 'publish' : 'draft';
}

// ── robots ──────────────────────────────────────────────────────────────────

/**
 * The only four values praion can store, because `robots` is two booleans.
 *
 * A pass-through robots string is a one-request way to deindex an entire site,
 * so anything outside this vocabulary is refused rather than written. The
 * space-less spelling is accepted on input and normalised, because that is a
 * formatting difference rather than a different instruction.
 */
export const ROBOTS_VALUES = [
  'index, follow',
  'noindex, follow',
  'index, nofollow',
  'noindex, nofollow',
] as const;

export type RobotsValue = (typeof ROBOTS_VALUES)[number];

export interface RobotsFlags {
  noindex: boolean;
  nofollow: boolean;
}

/**
 * Parse a robots directive into the two flags praion stores.
 *
 * Returns null for anything it does not fully understand — including a value
 * carrying extra directives praion cannot honour (`noarchive`, `max-snippet:…`).
 * Accepting those would report a write that never reaches the page.
 */
export function parseRobots(value: unknown): RobotsFlags | null {
  if (typeof value !== 'string') return null;

  const tokens = value
    .toLowerCase()
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t !== '');
  if (tokens.length === 0 || tokens.length > 2) return null;

  let noindex: boolean | null = null;
  let nofollow: boolean | null = null;

  for (const token of tokens) {
    if (token === 'index' || token === 'noindex') {
      if (noindex !== null) return null; // said twice
      noindex = token === 'noindex';
    } else if (token === 'follow' || token === 'nofollow') {
      if (nofollow !== null) return null;
      nofollow = token === 'nofollow';
    } else {
      return null; // a directive we cannot store
    }
  }

  // A half-specified value takes the permissive default for the other half,
  // matching how the column defaults behave.
  return { noindex: noindex ?? false, nofollow: nofollow ?? false };
}

/** The two flags → the canonical spelling PM receives. */
export function formatRobots(flags: RobotsFlags): RobotsValue {
  return `${flags.noindex ? 'noindex' : 'index'}, ${
    flags.nofollow ? 'nofollow' : 'follow'
  }` as RobotsValue;
}

// ── same-origin URLs ────────────────────────────────────────────────────────

/**
 * Reduce an absolute URL on our own origin to a site-relative path.
 *
 * Returns null for anything off-origin. **This is a security control, not a
 * convenience.** A canonical tag tells search engines "the real address of this
 * page is X"; accepting an arbitrary external URL lets whoever holds the token
 * transfer the site's entire search authority to a domain they own, and nothing
 * on the rendered page looks wrong. The damage is invisible on the site and
 * shows up weeks later in rankings.
 *
 * A site-relative value is accepted as-is, but a protocol-relative `//host/x` is
 * refused: browsers read that as another origin.
 */
export function toSameOriginPath(value: string): string | null {
  const raw = value.trim();
  if (raw === '') return null;

  if (raw.startsWith('//')) return null;
  if (raw.startsWith('/')) return raw;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  const origin = siteOrigin();
  if (!origin) return null;

  let ours: URL;
  try {
    ours = new URL(origin);
  } catch {
    return null;
  }

  if (url.protocol !== ours.protocol || url.host.toLowerCase() !== ours.host.toLowerCase()) {
    return null;
  }
  return `${url.pathname}${url.search}`;
}

/** The media uuid in `…/api/cms/media/file/<uuid>`, when it is on our origin. */
export function mediaUuidFromUrl(value: string): string | null {
  const path = toSameOriginPath(value);
  if (!path) return null;
  const m = /^\/api\/cms\/media\/file\/([0-9a-fA-F-]{36})$/.exec(path);
  return m ? m[1].toLowerCase() : null;
}

// ── dot paths ───────────────────────────────────────────────────────────────

/**
 * Segments that must never appear in a write path.
 *
 * `set(obj, path, value)` with any of these is prototype pollution in a Node
 * process that serves every request. The paths come from site config today, but
 * the alt-text walker matches rows against values from the wire, so the guard is
 * cheap insurance against the one that does not.
 */
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

export function isSafePath(path: string): boolean {
  if (path === '') return false;
  return path.split('.').every((segment) => segment !== '' && !FORBIDDEN_SEGMENTS.has(segment));
}

/** Read a dot path out of a plain object. Returns undefined for anything missing. */
export function getAtPath(source: unknown, path: string): unknown {
  if (!isSafePath(path)) return undefined;
  let cursor: unknown = source;
  for (const segment of path.split('.')) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/**
 * Write a dot path into a copy of `source`, creating intermediate objects.
 *
 * Copy-on-write rather than mutation so a failed validation pass can simply
 * discard the result instead of having to undo it. Throws on an unsafe path —
 * refusing loudly, because a silently-skipped write is how a push reports
 * success while changing nothing.
 */
export function setAtPath(
  source: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  if (!isSafePath(path)) {
    throw new Error(`Refusing to write to unsafe path "${path}".`);
  }
  const segments = path.split('.');
  const root: Record<string, unknown> = { ...source };

  let cursor: Record<string, unknown> = root;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i];
    const next = cursor[segment];

    // Arrays must be copied as arrays. A repeater row is addressed as
    // `gallery.0.alt`, and rebuilding `gallery` as a plain object would turn the
    // list into `{0: …}` — which still reads back through `getAtPath` but is no
    // longer an array to the form, the validator or the renderer.
    if (Array.isArray(next)) {
      cursor[segment] = [...next];
    } else if (next !== null && typeof next === 'object') {
      cursor[segment] = { ...(next as Record<string, unknown>) };
    } else {
      // Nothing there yet. A numeric next segment means the caller is building a
      // list, so start one rather than an object.
      cursor[segment] = /^\d+$/.test(segments[i + 1]) ? [] : {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }

  cursor[segments[segments.length - 1]] = value;
  return root;
}

/**
 * Flatten a title that may be a group of parts.
 *
 * An accent headline is `{before, accent, after}`; a reader sees the parts joined
 * in field order, so that is what PM is told the name is. Mirrors
 * `deriveDocumentTitle`'s behaviour rather than reimplementing a different one.
 */
export function flattenTitle(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const parts = Object.values(value as Record<string, unknown>)
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
    .map((v) => v.trim());
  if (parts.length === 0) return null;
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** Is this title stored as a group of parts rather than one string? */
export function isGroupTitle(value: unknown): boolean {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
