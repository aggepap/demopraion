/**
 * Canonical success-response shapes. Every handler returns one of these (or a
 * plain object, which the factory wraps), so clients see a uniform envelope:
 *   single:    { ok: true, data }
 *   list:      { ok: true, items, page, pageSize, total }
 * Errors use the mirror shape `{ ok: false, error, … }` from `core/errors`.
 */
import { NextResponse } from 'next/server';

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ ok: true, data }, { status });
}

export function created<T>(data: T): NextResponse {
  return ok(data, 201);
}

export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
}

/** Paginated list — always includes `total` so clients know if more pages exist
 *  (fixing v1's total-less lists, BACKEND.md §13.10). */
export function paginated<T>(items: T[], meta: PageMeta): NextResponse {
  return NextResponse.json({
    ok: true,
    items,
    page: meta.page,
    pageSize: meta.pageSize,
    total: meta.total,
    pageCount: Math.max(1, Math.ceil(meta.total / Math.max(1, meta.pageSize))),
  });
}
