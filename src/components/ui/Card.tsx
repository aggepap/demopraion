import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

/**
 * Card variants per specs/01_design_system.md.
 *
 * light    — White on Soft Pearl pages. Border, no shadow.
 * dark     — Midnight Navy block. Used inside dark hero sections.
 * featured — Bone Cream surface with gold accent border. For "Most chosen" tier.
 */
const cardVariants = cva(
  ['p-8 rounded-sm relative'],
  {
    variants: {
      variant: {
        light: 'bg-white border border-border-soft text-text-primary',
        dark: 'bg-midnight-navy text-soft-pearl',
        featured:
          'bg-bone-cream border border-warm-gold-dark/30 text-text-primary',
      },
      hover: {
        none: '',
        lift: 'transition-transform duration-200 hover:-translate-y-0.5',
      },
    },
    defaultVariants: {
      variant: 'light',
      hover: 'none',
    },
  }
);

export interface CardProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

export function Card({ variant, hover, className, ...rest }: CardProps) {
  return <div className={cn(cardVariants({ variant, hover }), className)} {...rest} />;
}
