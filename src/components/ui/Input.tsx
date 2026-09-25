import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

const fieldClasses = [
  'block w-full font-body text-base bg-white border border-border-soft text-text-primary',
  'rounded-sm px-4 py-3',
  'placeholder:text-text-light',
  'transition-colors duration-200',
  'focus:outline-none focus:border-warm-gold-dark focus:ring-2 focus:ring-warm-gold/40',
  'disabled:opacity-50 disabled:cursor-not-allowed',
  'aria-[invalid=true]:border-red-700 aria-[invalid=true]:focus:ring-red-700/30',
].join(' ');

interface FieldShellProps {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  htmlFor: string;
  errorId: string;
  children: React.ReactNode;
}

function FieldShell({ label, hint, error, required, htmlFor, errorId, children }: FieldShellProps) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={htmlFor} className="font-body text-sm font-medium text-text-primary">
        {label}
        {required && <span className="text-warm-gold-deep ml-1" aria-hidden>*</span>}
      </label>
      {children}
      {error && (
        <p id={errorId} role="alert" className="font-body text-xs text-red-700">
          {error}
        </p>
      )}
      {!error && hint && <p className="font-body text-xs text-text-muted">{hint}</p>}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// <Input>
// ──────────────────────────────────────────────────────────────────────────

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, hint, error, required, className, id, ...rest }, ref) => {
    const reactId = useId();
    const inputId = id ?? reactId;
    const errorId = `${inputId}-error`;
    return (
      <FieldShell
        label={label}
        hint={hint}
        error={error}
        required={required}
        htmlFor={inputId}
        errorId={errorId}
      >
        <input
          ref={ref}
          id={inputId}
          className={cn(fieldClasses, className)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          required={required}
          {...rest}
        />
      </FieldShell>
    );
  }
);
Input.displayName = 'Input';

// ──────────────────────────────────────────────────────────────────────────
// <Textarea>
// ──────────────────────────────────────────────────────────────────────────

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: string;
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, hint, error, required, className, id, rows = 5, ...rest }, ref) => {
    const reactId = useId();
    const inputId = id ?? reactId;
    const errorId = `${inputId}-error`;
    return (
      <FieldShell
        label={label}
        hint={hint}
        error={error}
        required={required}
        htmlFor={inputId}
        errorId={errorId}
      >
        <textarea
          ref={ref}
          id={inputId}
          rows={rows}
          className={cn(fieldClasses, 'resize-y min-h-32', className)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          required={required}
          {...rest}
        />
      </FieldShell>
    );
  }
);
Textarea.displayName = 'Textarea';
