'use client';

import { useId, useState, type ReactNode } from 'react';

import { cn } from './cn';
import { Icon } from './Icon';
import { InfoTip } from './InfoTip';

/**
 * A titled, optionally-collapsible content card — the building block for
 * grouping form fields and tool content into clearly separated sections.
 */
export function Section({
  title,
  description,
  info,
  defaultOpen = true,
  collapsible = true,
  right,
  children,
  className,
}: {
  title: ReactNode;
  /** Always-visible text at the top of the card — keep it for what must be read. */
  description?: ReactNode;
  /** An explanation behind an "i" beside the title. */
  info?: ReactNode;
  defaultOpen?: boolean;
  collapsible?: boolean;
  /** Content aligned to the right of the header (badges, actions). */
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const titleId = useId();

  // `defaultOpen` decides the initial state, but it also has to be able to
  // *reveal* a section later. Choosing status "scheduled" makes the Publishing
  // section's only required field appear inside it — and with the open state
  // fixed at mount time, that field, and the message naming it, materialised
  // inside a collapsed card. The editor saw a rejected save and no reason why.
  //
  // Opening only: a section the user has deliberately opened is never snapped
  // shut because a prop went back to false. Adjusting state during render is
  // React's own answer here; an effect would render the collapsed card first.
  const [wasDefaultOpen, setWasDefaultOpen] = useState(defaultOpen);
  if (defaultOpen !== wasDefaultOpen) {
    setWasDefaultOpen(defaultOpen);
    if (defaultOpen) setOpen(true);
  }

  return (
    /*
     * `aria-labelledby`, or this is not a landmark at all.
     *
     * A bare <section> maps to `role="generic"`, not `role="region"` — the region
     * role is only granted when the element has an accessible name. Every card in
     * the admin is one of these, so with no name none of them were exposed as
     * landmarks and region navigation reached nothing: a screen-reader user had no
     * way to jump between "Content", "Publishing", "SEO & AEO" and had to walk the
     * whole form. The header already renders the title, so pointing at it costs a
     * generated id and names every section correctly.
     */
    <section
      aria-labelledby={title ? titleId : undefined}
      className={cn('rounded-sm border border-neutral-200 bg-white', className)}
    >
      <header className="flex items-center justify-between gap-3 border-b border-neutral-100 px-4 py-3">
        <button
          type="button"
          onClick={() => collapsible && setOpen((o) => !o)}
          disabled={!collapsible}
          // `py-1.5` gets the hit area to the 24px minimum. These headers are
          // the main way anyone navigates a long form on a phone, and they were
          // ~20px tall.
          className={cn('flex items-center gap-2 py-1.5 text-left', collapsible && 'cursor-pointer')}
        >
          {collapsible ? (
            <Icon name={open ? 'chevron-down' : 'chevron-right'} size={16} className="text-neutral-400" />
          ) : null}
          <span id={titleId} className="font-display text-sm font-semibold text-neutral-900">
            {title}
          </span>
        </button>
        {/* Beside the collapse button, never inside it: a button in a button
            is invalid, and the tap would fold the card instead. */}
        {info ? <InfoTip className="mr-auto -ml-1">{info}</InfoTip> : null}
        {right ? <div className="flex items-center gap-2">{right}</div> : null}
      </header>
      {open ? (
        <div className="flex flex-col gap-4 p-4">
          {description ? <p className="text-xs text-neutral-600">{description}</p> : null}
          {children}
        </div>
      ) : null}
    </section>
  );
}
