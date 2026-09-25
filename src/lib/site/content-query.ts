/**
 * Searching and paging a content listing — /blog, /faq, /case-studies.
 *
 * Every listing used to render one ungrouped wall of everything published,
 * which the read layer quietly cut off at 200 rows: post 201 existed, sat in the
 * sitemap, and could not be reached from the site at all.
 *
 * Filter state lives in the URL rather than in component state, so a filtered
 * view can be linked, bookmarked and shared, and survives a refresh — the same
 * shape the shop and booking listings already use. Every value is validated
 * here, once, so no page has to defend itself against a hand-edited query
 * string.
 *
 * Pure and server-safe: the pages, the toolbar and the tests share it.
 */
import type { ContentEntry } from './content';

/**
 * Entries per page. Twelve divides by both 2 and 3, so the last row of the
 * `sm:grid-cols-2 lg:grid-cols-3` grid is never left ragged.
 */
export const CONTENT_PAGE_SIZE = 12;

/** Longest search term worth honouring; the rest is noise or an attack. */
const MAX_QUERY_CHARS = 100;

export type RawSearchParams = Record<string, string | string[] | undefined>;

export interface ParsedContentParams {
  q: string;
  /** A category slug, or '' for "everything". Resolved against the taxonomy by
   *  the page, which then reads that term's posts. */
  category: string;
  page: number;
}

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}

/**
 * A single slug, e.g. `?category=how-to`.
 *
 * Anything that is not a slug is dropped rather than passed on: this value
 * becomes a document lookup, and the place to say no is the place that reads it.
 */
function slug(value: string | string[] | undefined): string {
  const raw = one(value).toLowerCase();
  return raw.length > 0 && raw.length <= 191 && /^[a-z0-9-]+$/.test(raw) ? raw : '';
}

export function parseContentParams(params: RawSearchParams): ParsedContentParams {
  const pageRaw = Number(one(params.page));
  return {
    q: one(params.q).slice(0, MAX_QUERY_CHARS),
    category: slug(params.category),
    page: Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1,
  };
}

/** True when the visitor narrowed the list — drives the "clear" affordance.
 *  Being on page 4 is not narrowing: there is nothing to clear. */
export function hasActiveContentFilters(parsed: ParsedContentParams): boolean {
  return parsed.q.length > 0 || parsed.category.length > 0;
}

/**
 * Fold case and strip accents before comparing.
 *
 * On a Greek-first site an editor titles a post `Καλοκαίρι` and a visitor types
 * `καλοκαιρι`, because that is what a phone keyboard offers. Decomposing to NFD
 * and dropping the combining marks makes those the same string — and does the
 * same favour for `Ünal` or `café` in the English copy.
 */
function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

export interface ContentQueryResult {
  items: ContentEntry[];
  /** Matches before paging — what the result count and the pager are built on. */
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

/**
 * Narrow a listing by search term and cut it into pages.
 *
 * The category is deliberately *not* applied here: filtering by category is a
 * relation query the read layer already does well (`listPublishedByRelation`),
 * so the page picks its source list and this function takes it from there.
 * Doing it in memory instead would mean loading every post's categories to
 * filter on them — one query per entry, for a result the database can give in
 * one.
 */
export function applyContentQuery(
  entries: readonly ContentEntry[],
  parsed: ParsedContentParams,
): ContentQueryResult {
  const term = fold(parsed.q);
  const matches =
    term === ''
      ? entries
      : entries.filter((e) => fold(`${e.title} ${e.summary ?? ''} ${e.eyebrow ?? ''}`).includes(term));

  // One page, even when empty: "page 1 of 0" is not a thing anyone should read.
  const pageCount = Math.max(1, Math.ceil(matches.length / CONTENT_PAGE_SIZE));
  const page = Math.min(parsed.page, pageCount);
  const start = (page - 1) * CONTENT_PAGE_SIZE;

  return {
    // `parsed.page` is kept for the pager, but the slice uses the clamped page
    // so a hand-typed ?page=900 shows the last page rather than a blank screen.
    items: matches.slice(start, start + CONTENT_PAGE_SIZE),
    total: matches.length,
    page,
    pageSize: CONTENT_PAGE_SIZE,
    pageCount,
  };
}
