'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';

import { cn } from './cn';

/**
 * The field a one-time code is typed into.
 *
 * Its own component because the attributes below are the difference between a
 * code that autofills and one that has to be transcribed digit by digit off a
 * notification. `autoComplete="one-time-code"` is what iOS and Android read to
 * offer the code from the SMS/mail they just received; `inputMode="numeric"`
 * brings up the number pad instead of a full keyboard.
 *
 * Deliberately NOT a set of six separate boxes. Those look neat and break
 * paste, screen readers and every password manager — a single labelled input is
 * the accessible shape, and the letter-spacing gives it the same legibility.
 *
 * `maxLength` is not set: a recovery code (`XXXX-XXXX`) goes through this same
 * field, and capping it at six characters would make the recovery path
 * untypable.
 */
export const MfaCodeInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      autoCapitalize="characters"
      spellCheck={false}
      className={cn(
        'w-full rounded-sm border border-neutral-300 bg-white px-3 py-2 text-center font-mono text-lg tracking-[0.4em]',
        'focus:border-warm-gold focus:outline-none focus:ring-2 focus:ring-warm-gold/30',
        className,
      )}
      {...props}
    />
  ),
);
MfaCodeInput.displayName = 'MfaCodeInput';
