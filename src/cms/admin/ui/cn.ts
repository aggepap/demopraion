import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Tailwind class composer, merging conflicts so the later wins. Core-local copy
 * (the CMS core boundary forbids importing the site's `@/lib/utils`); depends
 * only on the framework packages `clsx` + `tailwind-merge`.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
