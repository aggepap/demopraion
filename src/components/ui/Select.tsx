import { forwardRef, useId } from 'react';
import type { SelectHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  label: string;
  options: ReadonlyArray<SelectOption>;
  /** Placeholder shown as the first disabled option (e.g. "Select…"). */
  placeholder?: string;
  hint?: string;
  error?: string;
}

const selectClasses = [
  'block w-full font-body text-base bg-white border border-border-soft text-text-primary',
  'rounded-sm px-4 py-3 pr-10',
  'transition-colors duration-200',
  'focus:outline-none focus:border-warm-gold-dark focus:ring-2 focus:ring-warm-gold/40',
  'disabled:opacity-50 disabled:cursor-not-allowed',
  'aria-[invalid=true]:border-red-700 aria-[invalid=true]:focus:ring-red-700/30',
  // Native chevron
  "appearance-none bg-no-repeat bg-[right_0.75rem_center] bg-[length:1rem]",
  "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%23B8862F'%3E%3Cpath fill-rule='evenodd' d='M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 011.08 1.04l-4.24 4.5a.75.75 0 01-1.08 0l-4.24-4.5a.75.75 0 01.02-1.06z' clip-rule='evenodd'/%3E%3C/svg%3E\")]",
].join(' ');

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, options, placeholder, hint, error, required, className, id, value, defaultValue, ...rest }, ref) => {
    const reactId = useId();
    const selectId = id ?? reactId;
    const errorId = `${selectId}-error`;

    return (
      <div className="flex flex-col gap-2">
        <label htmlFor={selectId} className="font-body text-sm font-medium text-text-primary">
          {label}
          {required && (
            <span className="text-warm-gold-deep ml-1" aria-hidden>
              *
            </span>
          )}
        </label>
        <select
          ref={ref}
          id={selectId}
          className={cn(selectClasses, className)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          required={required}
          // If no defaultValue/value provided and there's a placeholder, default to '' so
          // the placeholder option shows by default but is not a valid submission value.
          {...(value === undefined && defaultValue === undefined && placeholder ? { defaultValue: '' } : {})}
          {...(value !== undefined ? { value } : {})}
          {...(defaultValue !== undefined ? { defaultValue } : {})}
          {...rest}
        >
          {placeholder !== undefined && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {error && (
          <p id={errorId} role="alert" className="font-body text-xs text-red-700">
            {error}
          </p>
        )}
        {!error && hint && <p className="font-body text-xs text-text-muted">{hint}</p>}
      </div>
    );
  }
);
Select.displayName = 'Select';
