/**
 * Shared admin UI primitives — a small, token-based kit (neutral base + warm-gold
 * accent, brand fonts, rounded-sm) that replaces the duplicated `inputClass`
 * strings, hand-rolled tables, and ad-hoc buttons across the admin. Built on
 * `cva` + `cn` (the same stack as `src/components/ui`).
 *
 * These are presentational DOM wrappers (server-safe); interactive pieces that
 * need state live in `./Section` and `./Drawer`.
 */
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef } from 'react';
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';

import { cn } from './cn';
import { InfoTip } from './InfoTip';

export { Icon, type IconName } from './Icon';
export { Section } from './Section';
export { Drawer } from './Drawer';
export { Tabs, TabList, tabDomIds, type TabDef, type TabListItem } from './Tabs';
export { Checkbox } from './Checkbox';
export { MfaCodeInput } from './MfaCodeInput';
export { CharCounter } from './CharCounter';
export { PasswordStrength } from './PasswordStrength';

// ── Button ──────────────────────────────────────────────────────────────────
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 rounded-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-gold focus-visible:ring-offset-1 disabled:opacity-50 disabled:pointer-events-none',
  {
    variants: {
      variant: {
        primary: 'bg-warm-gold text-midnight-navy hover:bg-warm-gold-dark',
        secondary: 'border border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50',
        ghost: 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900',
        danger: 'text-red-700 hover:bg-red-50',
      },
      size: {
        sm: 'px-2.5 py-1.5 text-xs',
        md: 'px-3.5 py-2 text-sm',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = 'button', ...props }, ref) => (
    <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = 'Button';

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        /*
         * `min-h-9 min-w-9` — a 36px target, up from about 26.
         *
         * Four of these sit in a row on a repeater item, with Remove immediately beside
         * Duplicate, and on a phone that was a narrow band of small adjacent targets
         * where the destructive one is a fingertip away from the harmless one. The icon
         * stays the same size; only the area you can hit grows.
         */
        'inline-flex min-h-9 min-w-9 items-center justify-center rounded-sm p-1.5 text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-gold disabled:opacity-40',
        className,
      )}
      {...props}
    />
  ),
);
IconButton.displayName = 'IconButton';

// ── Controls ────────────────────────────────────────────────────────────────
const controlBase =
  'w-full rounded-sm border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-warm-gold focus:outline-none focus:ring-1 focus:ring-warm-gold disabled:bg-neutral-50';

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} className={cn(controlBase, className)} {...props} />,
);
TextInput.displayName = 'TextInput';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => <textarea ref={ref} className={cn(controlBase, className)} {...props} />,
);
Textarea.displayName = 'Textarea';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => <select ref={ref} className={cn(controlBase, 'pr-8', className)} {...props} />,
);
Select.displayName = 'Select';

// ── Field wrapper ───────────────────────────────────────────────────────────
// Lives in its own client module: it needs `useId()` to associate the label
// with the control, which a server-safe component cannot call.
export { Field } from './Field';
export { InfoTip, FieldTip } from './InfoTip';

// ── Badge ───────────────────────────────────────────────────────────────────
const badgeVariants = cva('inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium', {
  variants: {
    tone: {
      neutral: 'bg-neutral-100 text-neutral-600',
      gold: 'bg-warm-gold/15 text-warm-gold-deep',
      green: 'bg-green-100 text-green-800',
      blue: 'bg-blue-100 text-blue-800',
      amber: 'bg-amber-100 text-amber-800',
      red: 'bg-red-100 text-red-700',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export function Badge({
  tone,
  className,
  children,
  ...rest
}: VariantProps<typeof badgeVariants> &
  HTMLAttributes<HTMLSpanElement> & { className?: string; children: ReactNode }) {
  // Passes the rest through so a badge that carries meaning (a document's status, say)
  // can be given an accessible name rather than being an anonymous coloured word.
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...rest}>
      {children}
    </span>
  );
}

// ── Table ───────────────────────────────────────────────────────────────────
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    // `tabIndex={0}`: on a narrow screen this box scrolls sideways, and a
    // region you can only reach by dragging is unreachable by keyboard. The
    // group role + label stop it being announced as an anonymous focus stop.
    <div
      tabIndex={0}
      role="group"
      aria-label="Table, scrollable"
      className={cn(
        'overflow-x-auto rounded-sm border border-neutral-200 bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-gold',
        className,
      )}
    >
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}
export function Thead({ children }: { children: ReactNode }) {
  return <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-600">{children}</thead>;
}
export function Tbody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-neutral-100">{children}</tbody>;
}
export function Th({
  children,
  className,
  colSpan,
  info,
}: {
  children?: ReactNode;
  className?: string;
  colSpan?: number;
  /** What the column means, behind an "i" beside the header. */
  info?: ReactNode;
}) {
  return (
    <th colSpan={colSpan} className={cn('px-3 py-2 font-medium', className)}>
      {info ? (
        <span className="inline-flex items-center gap-1">
          {children}
          <InfoTip>{info}</InfoTip>
        </span>
      ) : (
        children
      )}
    </th>
  );
}
export function Td({
  children,
  className,
  colSpan,
  title,
}: {
  children?: ReactNode;
  className?: string;
  colSpan?: number;
  /** Native tooltip — for detail that would be noise if always on screen. */
  title?: string;
}) {
  return (
    <td colSpan={colSpan} title={title} className={cn('px-3 py-2', className)}>
      {children}
    </td>
  );
}
