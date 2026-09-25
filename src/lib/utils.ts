import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Conditionally compose Tailwind class strings, merging conflicts so the
 * later wins (e.g. cn('p-4', 'p-6') -> 'p-6').
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
