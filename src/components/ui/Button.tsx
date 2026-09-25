import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef } from 'react';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ComponentRef } from 'react';

import { Link } from '@/lib/i18n/routing';
import { cn } from '@/lib/utils';

/**
 * Variant tokens shared by <Button> and <ButtonLink>.
 *
 * primary   — Warm Gold filled, dark text. The single most prominent CTA.
 * secondary — Outlined Midnight Navy, fills navy on hover.
 * ghost     — Inline gold-dark text link. No border, no background.
 *
 * No drop shadows. No rounded corners larger than rounded-sm. (specs/01)
 */
export const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 font-body font-medium tracking-wide rounded-sm',
    'transition-colors duration-200',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-gold focus-visible:ring-offset-2 focus-visible:ring-offset-soft-pearl',
    'disabled:opacity-50 disabled:pointer-events-none',
  ].join(' '),
  {
    variants: {
      variant: {
        primary: 'bg-warm-gold text-midnight-navy hover:bg-warm-gold-dark',
        secondary:
          'border border-midnight-navy text-midnight-navy hover:bg-midnight-navy hover:text-soft-pearl',
        ghost:
          'text-warm-gold-deep hover:underline underline-offset-4 px-0 py-0',
      },
      size: {
        sm: 'px-6 py-3 text-sm',
        md: 'px-8 py-4 text-base',
        lg: 'px-10 py-5 text-lg',
      },
      tone: {
        light: '',
        dark: 'focus-visible:ring-offset-midnight-navy',
      },
    },
    compoundVariants: [
      // Ghost ignores horizontal padding from size — it's a text link.
      { variant: 'ghost', size: 'sm', class: 'px-0 py-0' },
      { variant: 'ghost', size: 'md', class: 'px-0 py-0' },
      { variant: 'ghost', size: 'lg', class: 'px-0 py-0' },
    ],
    defaultVariants: {
      variant: 'primary',
      size: 'md',
      tone: 'light',
    },
  }
);

export type ButtonVariantProps = VariantProps<typeof buttonVariants>;

// ──────────────────────────────────────────────────────────────────────────
// <Button> — renders a <button> element with the variant classes applied.
// Used for triggers (form submits, menu toggles).
// ──────────────────────────────────────────────────────────────────────────

interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    ButtonVariantProps {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant, size, tone, className, type = 'button', ...rest }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size, tone }), className)}
      {...rest}
    />
  )
);
Button.displayName = 'Button';

// ──────────────────────────────────────────────────────────────────────────
// <ButtonLink> — renders the same styles around an <a> or next-intl <Link>.
// Used for CTAs that navigate (Discovery Call, See pricing, etc).
// ──────────────────────────────────────────────────────────────────────────

interface ButtonLinkProps
  extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>,
    ButtonVariantProps {
  href: string;
  /** When true, render a plain <a> with target=_blank rel=noopener (mailto/tel/https). */
  external?: boolean;
}

/**
 * Schemes a CTA link is allowed to use.
 *
 * A CTA's href is editorial content — `finalCta.primaryHref` is a plain text
 * field an editor types into — so it reaches this component as an arbitrary
 * string. React 19 already neutralises the worst case: it refuses to emit a
 * `javascript:` href and substitutes a throwing stub. That is a backstop, not a
 * policy, and it has two gaps worth closing here. It does not cover `data:`
 * (which browsers happen to block for top-level navigation, but that is their
 * choice, not ours), and when it does fire it produces a link whose href is a
 * React error message — an editor who mistypes gets a button that looks fine and
 * fails strangely, rather than a link that plainly goes nowhere.
 *
 * So the allow-list is stated rather than inherited: a site-relative path, an
 * in-page anchor, an absolute http(s) URL, or mailto:/tel: for contact CTAs.
 * Anything else is not a link this component will make.
 */
const SAFE_HREF = /^(?:https?:\/\/|mailto:|tel:|[/#?])/i;

/** The href to render, or `#` when the value is not a shape we will link to. */
export function safeHref(href: string): string {
  const trimmed = href.trim();
  if (trimmed === '') return '#';
  // Leading control characters are stripped by the HTML parser before the scheme
  // is read, so `\0j\tavascript:` would survive a naive prefix test.
  return SAFE_HREF.test(trimmed.replace(/[\u0000-\u001F\u007F]/g, '')) ? trimmed : '#';
}

export const ButtonLink = forwardRef<ComponentRef<'a'>, ButtonLinkProps>(
  ({ variant, size, tone, className, href, external, children, ...rest }, ref) => {
    const classes = cn(buttonVariants({ variant, size, tone }), className);
    const safe = safeHref(href);
    if (external) {
      return (
        <a
          ref={ref}
          href={safe}
          target={safe.startsWith('http') ? '_blank' : undefined}
          rel={safe.startsWith('http') ? 'noopener noreferrer' : undefined}
          className={classes}
          {...rest}
        >
          {children}
        </a>
      );
    }
    // next-intl Link doesn't accept a ref of its own — drop it for the locale-aware case.
    return (
      <Link href={safe} className={classes} {...rest}>
        {children}
      </Link>
    );
  }
);
ButtonLink.displayName = 'ButtonLink';
