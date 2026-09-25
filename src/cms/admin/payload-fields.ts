/**
 * A stored `form_submissions.payload`, prepared for display.
 *
 * The submissions drawer printed the payload as `JSON.stringify(…, null, 2)`
 * inside a `<pre>`, which made a visitor's enquiry read as source code — quoted
 * keys, escaped Greek, and the message they actually wrote scrolling inside a
 * 16rem box.
 *
 * Ordering is the reason this is a module rather than a loop in the component.
 * `payload` is a MySQL `json` column, and MySQL stores object keys sorted by
 * length and then lexically — the order `/api/contact` wrote them in is gone
 * before anything reads the row back, so a brief returns as Name, Email, Phone,
 * Budget, Locale, Company, Message. A reading order has to be imposed here or
 * there is not one at all.
 *
 * Everything is a best-effort guess over untyped JSON, so the rules are stated
 * rather than inferred, and the fallback is always "show it as text". The one
 * hard rule is the last section: an `href` is only ever built from a shape this
 * module recognised, never from arbitrary payload text.
 */

export type PayloadFieldKind = 'text' | 'block' | 'email' | 'url' | 'tel' | 'list';

export interface PayloadField {
  /** The payload key, verbatim — stable for React's `key`. */
  key: string;
  /** What to show as the field name. */
  label: string;
  kind: PayloadFieldKind;
  /** The value, for every kind except `list`. */
  text?: string;
  /** The items, for `list`. */
  items?: string[];
  /** Only set for `email`, `url` and `tel` — see the note on `hrefFor`. */
  href?: string;
}

/**
 * Reading order for the labels the site's own forms produce.
 *
 * Identity first (who wrote in, how to reach them), then what they are, then
 * the qualifying answers, then provenance. Anything not listed keeps its own
 * relative order after these; free text is moved to the end regardless, because
 * it is the one field worth reading last and at full width.
 */
const KNOWN_ORDER = [
  'Name',
  'Email',
  'Phone',
  'Business',
  'Company',
  'Website',
  'Role / company',
  'Industry',
  'Company size',
  'Interested in',
  'Budget',
  'Scenario',
  'Page checked',
  'SEO score',
  'AEO score',
  'Wants human analysis',
  'Source',
  'Asked from',
  'How found us',
  'Newsletter opt-in',
  'Locale',

  /*
   * The ΔΕΘ kiosk questionnaire (`form_type: 'questionnaire'`), in the order the
   * exhibitor was asked. Without these the survey reads back in MySQL's own key
   * order — length, then lexically — which is the exact problem this list
   * exists to fix, and a five-question survey scrambled is unreadable.
   *
   * Kept in step with `src/content/questionnaire.ts` by hand: importing the
   * content module here would pull page copy into the admin bundle for the sake
   * of eleven strings.
   */
  'Επωνυμία επιχείρησης',
  'Ρόλος στην επιχείρηση',
  'Ρόλος στην επιχείρηση (Άλλο)',
  '1. Πηγές νέων πελατών',
  '1. Πηγές νέων πελατών (Άλλο)',
  '2. Ικανοποίηση από website / e-shop',
  '3. Ευρεσιμότητα σε Google και AI',
  '4. Μεγαλύτερο περιθώριο βελτίωσης',
  '4. Μεγαλύτερο περιθώριο βελτίωσης (Άλλο)',
  '5. Στόχοι για τον επόμενο χρόνο',
  '5. Στόχοι για τον επόμενο χρόνο (Άλλο)',
  'Email επικοινωνίας',
  'Συναίνεση αποστολής αποτελεσμάτων',
  '6. Τι μάθαμε από τη συζήτηση',
  '7. Εκτίμηση PRAION / πιθανή ευκαιρία',
];

/** Past this, a value is prose rather than a field, and gets its own block. */
const BLOCK_LENGTH = 120;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** An allow-list, not a deny-list: nothing but these two schemes becomes a link. */
const HTTP_URL = /^https?:\/\//i;
const PHONE_LABEL = /phone|mobile|tel\b|τηλ/i;
const PHONE_VALUE = /^[+(\d][\d\s()+.-]{5,}$/;

/**
 * `productSlug` → `Product slug`. A key that already contains a space, or that
 * starts with a capital, was written for a person to read (the contact route
 * keys its payload by the labels it puts in the notification email) and is left
 * exactly as it is — `SEO score` must not become `S E O score`.
 */
function humanize(key: string): string {
  if (key.includes(' ') || /^[A-Z]/.test(key)) return key;
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** The href for a value already classified as linkable. Never called otherwise. */
function hrefFor(kind: PayloadFieldKind, value: string): string | undefined {
  if (kind === 'email') return `mailto:${value}`;
  if (kind === 'url') return value;
  // Diallers choke on spaces and brackets; `+` is the one separator worth keeping.
  if (kind === 'tel') return `tel:${value.replace(/[^\d+]/g, '')}`;
  return undefined;
}

function classify(label: string, value: unknown): Omit<PayloadField, 'key' | 'label'> {
  if (value === null || value === undefined) return { kind: 'text', text: '—' };

  if (Array.isArray(value)) {
    const items = value.map((v) => (typeof v === 'string' ? v : JSON.stringify(v)));
    return items.length > 0 ? { kind: 'list', items } : { kind: 'text', text: '—' };
  }

  // An object nested in a payload has no shape this can guess at. JSON is ugly
  // but it is complete, which matters more than pretty on a record of an enquiry.
  if (typeof value === 'object') {
    return { kind: 'block', text: JSON.stringify(value, null, 2) };
  }

  if (typeof value === 'boolean') return { kind: 'text', text: value ? 'Yes' : 'No' };
  if (typeof value === 'number') return { kind: 'text', text: String(value) };

  const text = String(value).trim();
  if (text === '') return { kind: 'text', text: '—' };
  if (text.includes('\n') || text.length > BLOCK_LENGTH) return { kind: 'block', text };

  const kind: PayloadFieldKind = EMAIL.test(text)
    ? 'email'
    : HTTP_URL.test(text)
      ? 'url'
      : PHONE_LABEL.test(label) && PHONE_VALUE.test(text)
        ? 'tel'
        : 'text';

  return { kind, text, href: hrefFor(kind, text) };
}

/**
 * The payload as an ordered list of displayable fields.
 *
 * Every key survives — a field this does not understand is still shown, as
 * text. Silently dropping part of the record of an enquiry is the one outcome
 * worse than showing it as JSON.
 */
export function payloadFields(payload: Record<string, unknown>): PayloadField[] {
  const fields = Object.entries(payload).map(([key, value], index) => {
    const label = humanize(key);
    const known = KNOWN_ORDER.indexOf(label);
    return {
      field: { key, label, ...classify(label, value) } satisfies PayloadField,
      // Unlisted labels sort after every listed one, among themselves in the
      // order the row came back in.
      rank: known === -1 ? Number.MAX_SAFE_INTEGER : known,
      index,
    };
  });

  return fields
    .sort((a, b) => {
      // Prose last, whatever its label would otherwise have ranked.
      const aBlock = a.field.kind === 'block' ? 1 : 0;
      const bBlock = b.field.kind === 'block' ? 1 : 0;
      if (aBlock !== bBlock) return aBlock - bBlock;
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.index - b.index;
    })
    .map((entry) => entry.field);
}
