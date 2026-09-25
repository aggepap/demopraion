import { cn } from './cn';

/**
 * A character count against a recommended range.
 *
 * Advice, not validation — see the note on `SeoCounter` in `core/seo/fields`.
 * The range for an SEO title is about where Google truncates, which is worth
 * telling an editor and not worth refusing a save over: plenty of perfectly
 * good pages have a 65-character title, and a hard rule would have made every
 * document written before the rule existed unsaveable.
 *
 * `role="status"` so the count is announced as it changes rather than being
 * information only a sighted user gets. `aria-live` is left at the polite
 * default: this must not interrupt typing.
 */
export function CharCounter({
  value,
  min,
  max,
  className,
}: {
  value: string;
  min?: number;
  max: number;
  className?: string;
}) {
  const n = value.length;
  // An empty field is not "too short" — it is simply not filled in yet, and
  // colouring it as a problem would light up every SEO tab on a new document.
  const short = n > 0 && min !== undefined && n < min;
  const long = n > max;
  const off = short || long;

  return (
    <span
      role="status"
      className={cn('text-xs tabular-nums', off ? 'text-amber-700' : 'text-neutral-500', className)}
    >
      {n}
      <span aria-hidden="true"> / </span>
      <span className="sr-only"> of </span>
      {max}
      {short ? ' — a little short' : null}
      {long ? ' — will be cut off' : null}
    </span>
  );
}
