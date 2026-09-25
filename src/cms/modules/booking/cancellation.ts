/**
 * An experience's cancellation terms, for the experience page and the emails.
 *
 * "Free cancellation up to (days before)" and "Cancellation policy" were saved
 * on the experience and shown nowhere. This reads them into one shape and turns
 * the policy's rich text into email-safe HTML.
 *
 * Pure — no `server-only`, no DB — so the page, the emails and the tests share it.
 * The terms are INFORMATION for the customer: nothing here enforces a refund.
 */
import { escapeHtml } from '../../core/email/format';

export interface CancellationTerms {
  /** Days before the booked date that cancelling is free. Null = never stated. */
  freeCancellationDays: number | null;
  /** The policy as the editor wrote it (rich-text JSON), or null when empty. */
  policy: unknown | null;
}

interface RichNode {
  type?: string;
  text?: string;
  content?: RichNode[];
  marks?: { type: string }[];
}

function isNode(value: unknown): value is RichNode {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Does this rich-text value contain any visible text? A blank editor does not. */
export function hasRichTextContent(value: unknown): boolean {
  if (!isNode(value)) return false;
  if (typeof value.text === 'string' && value.text.trim()) return true;
  return Array.isArray(value.content) && value.content.some(hasRichTextContent);
}

/** Read the two fields from an experience's `data`. */
export function readCancellationTerms(data: Record<string, unknown>): CancellationTerms {
  const raw = data.freeCancellationDays;
  const n = raw === '' || raw == null ? Number.NaN : Number(raw);
  return {
    freeCancellationDays: Number.isInteger(n) && n >= 0 ? n : null,
    policy: hasRichTextContent(data.cancellationPolicy) ? data.cancellationPolicy : null,
  };
}

/** True when the experience states anything about cancelling. */
export function hasCancellationTerms(terms: CancellationTerms): boolean {
  return terms.freeCancellationDays !== null || terms.policy !== null;
}

/** "Free cancellation up to 7 days before", in the customer's language. */
export function freeCancellationText(days: number, locale: string): string {
  if (locale === 'el') {
    return days === 0
      ? 'Δωρεάν ακύρωση έως την ημέρα της κράτησης'
      : `Δωρεάν ακύρωση έως ${days} ${days === 1 ? 'ημέρα' : 'ημέρες'} πριν`;
  }
  return days === 0
    ? 'Free cancellation up to the day of your booking'
    : `Free cancellation up to ${days} ${days === 1 ? 'day' : 'days'} before`;
}

const P_STYLE = 'margin:0 0 8px;font-family:system-ui,sans-serif;font-size:14px';

function inline(node: RichNode): string {
  if (node.type === 'hardBreak') return '<br>';
  if (typeof node.text === 'string') {
    // Only emphasis survives. A link mark's href is editor-typed and an email is
    // no place to re-validate schemes, so the words stay and the link does not.
    return (node.marks ?? []).reduce((html, mark) => {
      if (mark.type === 'bold') return `<strong>${html}</strong>`;
      if (mark.type === 'italic') return `<em>${html}</em>`;
      return html;
    }, escapeHtml(node.text));
  }
  return (node.content ?? []).map(inline).join('');
}

function block(node: RichNode): string {
  const children = node.content ?? [];
  switch (node.type) {
    case 'doc':
      return children.map(block).join('');
    case 'paragraph':
    case 'heading': {
      const html = children.map(inline).join('');
      return html.trim() ? `<p style="${P_STYLE}">${html}</p>` : '';
    }
    case 'bulletList':
    case 'orderedList': {
      const tag = node.type === 'bulletList' ? 'ul' : 'ol';
      return `<${tag} style="margin:0 0 8px;padding-left:20px;font-family:system-ui,sans-serif;font-size:14px">${children
        .map((item) => `<li style="margin:0 0 4px">${(item.content ?? []).map((c) => (c.type === 'paragraph' ? c.content?.map(inline).join('') ?? '' : block(c))).join('')}</li>`)
        .join('')}</${tag}>`;
    }
    case 'blockquote':
      return children.map(block).join('');
    default:
      // Unknown nodes keep their text rather than vanishing.
      return typeof node.text === 'string' ? `<p style="${P_STYLE}">${inline(node)}</p>` : children.map(block).join('');
  }
}

/** A TipTap document as email-safe HTML: text escaped, no links, no attributes from the document. */
export function richTextToEmailHtml(value: unknown): string {
  return isNode(value) ? block(value) : '';
}

/** The cancellation block appended to the confirmation emails, or '' when there is nothing to say. */
export function cancellationEmailHtml(terms: CancellationTerms, locale: string): string {
  if (!hasCancellationTerms(terms)) return '';
  const title = locale === 'el' ? 'Πολιτική ακύρωσης' : 'Cancellation policy';
  const free =
    terms.freeCancellationDays !== null
      ? `<p style="${P_STYLE}"><strong>${escapeHtml(freeCancellationText(terms.freeCancellationDays, locale))}</strong></p>`
      : '';
  return `<h4 style="font-family:system-ui,sans-serif;margin:16px 0 4px">${escapeHtml(title)}</h4>${free}${richTextToEmailHtml(terms.policy)}`;
}
