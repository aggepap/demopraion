'use client';

import { useState } from 'react';
import type { InputHTMLAttributes } from 'react';

import { cn } from './cn';
import { Icon } from './Icon';
import { TextInput } from './index';

/**
 * Password field with a reveal toggle.
 *
 * Sign-in, "add user" and "reset password" all asked for a password with no way
 * to check what had been typed — on a phone keyboard that is a guess followed by
 * a failed login. The toggle is a real button so it is reachable by keyboard,
 * and it is labelled by state rather than by icon alone.
 */
export function PasswordInput({
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [shown, setShown] = useState(false);
  return (
    <span className="relative block">
      <TextInput {...props} type={shown ? 'text' : 'password'} className={cn('pr-9', className)} />
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-label={shown ? 'Hide password' : 'Show password'}
        aria-pressed={shown}
        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-neutral-600 hover:text-neutral-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-gold"
      >
        <Icon name={shown ? 'eye-off' : 'eye'} size={15} />
      </button>
    </span>
  );
}
