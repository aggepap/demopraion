/**
 * The icon row — duration, group size, departure time and so on.
 *
 * Deliberately free-text, exactly as in the WordPress original: these are
 * whatever the operator wants to highlight, not a fixed schema. "Duration" has
 * no typed field anywhere in the model; it lives here.
 */
export interface QuickInfoItem {
  icon?: string;
  label: string;
  value: string;
  suffix?: string;
}

export function QuickInfoList({
  items,
  className = '',
  showLabels = false,
}: {
  items: QuickInfoItem[];
  className?: string;
  showLabels?: boolean;
}) {
  const usable = items.filter((i) => i.value || i.label);
  if (usable.length === 0) return null;

  return (
    <ul className={`flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600 ${className}`}>
      {usable.map((item, i) => (
        <li key={`${item.label}-${i}`} className="flex items-baseline gap-1">
          {showLabels && item.label ? <span className="font-medium">{item.label}:</span> : null}
          <span>
            {item.value}
            {item.suffix ? ` ${item.suffix}` : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}
