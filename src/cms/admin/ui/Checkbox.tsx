'use client';

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';

import { cn } from './cn';
import { FieldTip } from './InfoTip';

/**
 * A labelled checkbox.
 *
 * The kit had no boolean control at all — every checkbox in the admin was a raw
 * `<input type="checkbox">` with whatever classes were nearest to hand, and the
 * label was a sibling rather than a wrapper, so the words next to the box were
 * not a hit target. Wrapping the input in the `<label>` makes the whole row
 * clickable and gives the control its accessible name without needing an id.
 *
 * `hint` is always-visible text, for what must not be missed (a warning, a
 * consequence). `info` is an explanation behind an "i", tied to the checkbox by
 * `aria-describedby` exactly like a `Field` description.
 */
export const Checkbox = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: ReactNode; hint?: ReactNode; info?: ReactNode }
>(({ label, hint, info, className, disabled, ...props }, ref) => {
  const infoId = `${useId()}-info`;
  const describedBy = [props['aria-describedby'], info ? infoId : null].filter(Boolean).join(' ') || undefined;
  const box = (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-2.5 py-1 text-sm text-neutral-800',
        disabled && 'cursor-not-allowed opacity-50',
        !info && className,
      )}
    >
      <input
        ref={ref}
        type="checkbox"
        disabled={disabled}
        className="mt-0.5 h-4 w-4 shrink-0 rounded-sm border-neutral-300 text-warm-gold accent-warm-gold focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-gold focus-visible:ring-offset-1"
        {...props}
        aria-describedby={describedBy}
      />
      <span className="flex flex-col gap-0.5">
        <span>{label}</span>
        {hint ? <span className="text-xs text-neutral-600">{hint}</span> : null}
      </span>
    </label>
  );
  if (!info) return box;
  // The tip sits beside the <label>, not inside it: text inside a label becomes
  // part of the checkbox's accessible name, so "Active" was announced as the
  // whole explanation. `aria-describedby` above still reads it, as a description.
  return (
    <div className={cn('group/field relative flex items-start gap-1', className)}>
      {box}
      <span className="pt-1.5">
        <FieldTip id={infoId}>{info}</FieldTip>
      </span>
    </div>
  );
});
Checkbox.displayName = 'Checkbox';
