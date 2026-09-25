/**
 * Whether a popup may appear, and which one.
 *
 * Pure and dependency-free: the same rules run on the server (which picks the
 * candidates for a page) and in the browser (which knows what this visitor has
 * already seen). Two copies of "have they seen it" would be two chances to
 * annoy somebody.
 */

export type PopupTargetMode = 'all' | 'paths';

export interface PopupTarget {
  mode: PopupTargetMode;
  /** Exact paths, or a trailing `*` for a section: `/shop/*`. */
  paths: string[];
  /** Beats any match — a popup that must never appear at checkout. */
  exclude: string[];
}

export type PopupFrequency = { mode: 'always' } | { mode: 'once' } | { mode: 'days'; days: number };

export interface PopupRecord {
  id: number;
  slug: string;
  priority: number;
  startAt: Date | null;
  endAt: Date | null;
  target: PopupTarget;
  frequency: PopupFrequency;
}

/** Published and in date. */
export function isPopupActive(popup: PopupRecord, now: Date): boolean {
  const at = now.getTime();
  if (popup.startAt && at < popup.startAt.getTime()) return false;
  if (popup.endAt && at > popup.endAt.getTime()) return false;
  return true;
}

/**
 * Glob matching, never a regular expression.
 *
 * An administrator types these into a form. A regular expression from a form is
 * both a way to match nothing by accident and a way to hang the server on a
 * pathological pattern, so `*` is the only wildcard and everything else is
 * matched literally.
 */
function pathMatches(pattern: string, path: string): boolean {
  const clean = pattern.trim();
  if (!clean) return false;
  if (clean.endsWith('/*')) {
    const prefix = clean.slice(0, -2);
    return path === prefix || path.startsWith(`${prefix}/`);
  }
  if (clean.endsWith('*')) return path.startsWith(clean.slice(0, -1));
  return path === clean;
}

/**
 * The path targeting is judged on: the URL without its locale segment.
 *
 * An administrator writes `/shop`, meaning the shop in every language, while the
 * browser's path is `/en/shop` outside the main one (the runtime reads it from
 * `usePathname`, which keeps the prefix). Only a whole segment naming a
 * configured locale is removed — `/english` is left alone.
 */
export function popupPagePath(pathname: string, locales: readonly string[]): string {
  const segment = pathname.split('/')[1] ?? '';
  if (!locales.includes(segment)) return pathname;
  const rest = pathname.slice(segment.length + 1);
  return rest === '' ? '/' : rest;
}

/** Is this the right page? The query string is never part of the decision. */
export function matchesTarget(popup: PopupRecord, page: { path: string }): boolean {
  const path = page.path.split('?')[0].split('#')[0];
  if (popup.target.exclude.some((pattern) => pathMatches(pattern, path))) return false;
  if (popup.target.mode === 'all') return true;
  return popup.target.paths.some((pattern) => pathMatches(pattern, path));
}

/**
 * Has enough time passed since this visitor last saw it?
 *
 * `lastSeen` comes from the visitor's own browser storage, so a date in the
 * future is treated as "never seen" rather than as a reason to hide the popup
 * for ever.
 */
export function shouldShowAgain(
  frequency: PopupFrequency,
  lastSeen: Date | null,
  now: Date
): boolean {
  if (frequency.mode === 'always') return true;
  if (!lastSeen || lastSeen.getTime() > now.getTime()) return true;
  if (frequency.mode === 'once') return false;
  const days = Math.max(1, Math.floor(frequency.days));
  return now.getTime() - lastSeen.getTime() >= days * 86_400_000;
}

/**
 * One popup, or none.
 *
 * Only one is ever shown: two dialogs at once is not a campaign, it is a
 * broken page. Highest priority first, then the newest — a popup created to
 * replace another takes over without anybody having to renumber.
 */
export function choosePopup(
  popups: readonly PopupRecord[],
  page: { path: string },
  now: Date,
  isUnseen: (popup: PopupRecord) => boolean
): PopupRecord | null {
  const candidates = popups
    .filter((popup) => isPopupActive(popup, now) && matchesTarget(popup, page) && isUnseen(popup))
    .sort((a, b) => b.priority - a.priority || b.id - a.id);
  return candidates[0] ?? null;
}

/** How a stored popup document is read into a record. */
export function toPopupRecord(
  id: number,
  slug: string,
  data: Record<string, unknown>
): PopupRecord {
  const target = (data.target ?? {}) as Record<string, unknown>;
  const frequencyMode = data.frequencyMode;
  const days = Number(data.frequencyDays);

  return {
    id,
    slug,
    priority: Number.isFinite(Number(data.priority)) ? Number(data.priority) : 0,
    startAt: data.startAt ? new Date(String(data.startAt)) : null,
    endAt: data.endAt ? endOfDay(String(data.endAt)) : null,
    target: {
      mode: target.mode === 'paths' ? 'paths' : 'all',
      paths: toList(target.paths),
      exclude: toList(target.exclude),
    },
    frequency:
      frequencyMode === 'always'
        ? { mode: 'always' }
        : frequencyMode === 'once'
          ? { mode: 'once' }
          : { mode: 'days', days: Number.isFinite(days) && days > 0 ? days : 7 },
  };
}

/**
 * An end date is the last day the popup runs, so a bare `YYYY-MM-DD` means the
 * END of that day. Parsed as-is it is midnight at the start, and a campaign
 * "ending 10 March" was gone for all of 10 March. UTC, like the start date: the
 * module has no timezone of its own. A value with a time is taken literally.
 */
function endOfDay(value: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
    ? new Date(`${value.trim()}T23:59:59.999Z`)
    : new Date(value);
}

function toList(raw: unknown): string[] {
  if (Array.isArray(raw))
    return raw
      .map(String)
      .map((v) => v.trim())
      .filter(Boolean);
  if (typeof raw === 'string') {
    return raw
      .split(/[\n,]/)
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}
