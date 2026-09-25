/**
 * The label/value table every form notification email is built from.
 *
 * This was private to `src/app/api/contact/route.ts`, which meant it could not
 * be tested — a Next route module may only export handlers — and could not be
 * reused. The questionnaire endpoint needs exactly the same two functions, and
 * a second copy of an HTML escaper is how one of them ends up subtly not
 * escaping, so it moved here instead of being duplicated.
 *
 * `escapeHtml` comes from `@/cms/core/email/format`, which documents itself as
 * pure — no mailer, no DB, no `server-only` — and is imported by its own path
 * rather than through the `@/cms/core` barrel, which would pull server-only
 * modules into anything that touches a row.
 */
import { escapeHtml } from '@/cms/core/email/format';

export type Row = [label: string, value: string];

/** Rows with nothing in them are dropped: optional fields reach here as '', and
 *  a notification should not carry a column of blanks. */
const filled = (rows: Row[]): Row[] => rows.filter(([, v]) => v && v.trim().length > 0);

export function rowsToHtml(rows: Row[]): string {
  const cells = filled(rows)
    .map(
      ([label, value]) =>
        `<tr>` +
        `<td style="padding:6px 12px;font-weight:600;vertical-align:top;white-space:nowrap;">${escapeHtml(label)}</td>` +
        `<td style="padding:6px 12px;white-space:pre-wrap;">${escapeHtml(value)}</td>` +
        `</tr>`
    )
    .join('');
  return `<table style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a1a;">${cells}</table>`;
}

export function rowsToText(rows: Row[]): string {
  return filled(rows)
    .map(([label, value]) => `${label}: ${value}`)
    .join('\n');
}
