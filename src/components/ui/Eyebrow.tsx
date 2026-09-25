import { cn } from '@/lib/utils';
import type { HTMLAttributes } from 'react';

interface EyebrowProps extends HTMLAttributes<HTMLSpanElement> {
  /** 'gold-dark' for light backgrounds (default), 'gold' for dark backgrounds. */
  color?: 'gold' | 'gold-dark';
}

/**
 * Small uppercase tracked label that appears above headings.
 * Brand pattern — see specs/01_design_system.md "Eyebrow tags".
 *
 * The default `gold-dark` variant renders 12px uppercase text on light
 * surfaces (soft-pearl, bone-cream, white). At that size WCAG AA needs
 * 4.5:1 contrast — `warm-gold-dark` (#B8862F on #F5F5F2 = 2.96:1) fails;
 * `warm-gold-deep` (#8B6420 on #F5F5F2 = 4.85:1) passes. The naming
 * stays `gold-dark` for API stability — only the rendered token changes.
 *
 * The `gold` variant (warm-gold #D4A35C) is intended for dark backgrounds
 * (navy) where contrast is 8.94:1 — no change needed.
 */
export function Eyebrow({ color = 'gold-dark', className, children, ...rest }: EyebrowProps) {
  return (
    <span
      className={cn(
        'block font-body text-xs font-medium uppercase tracking-wider-2',
        color === 'gold-dark' ? 'text-warm-gold-deep' : 'text-warm-gold',
        className
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
