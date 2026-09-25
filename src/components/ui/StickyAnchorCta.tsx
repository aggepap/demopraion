'use client';

import { useEffect, useState } from 'react';

import { useConsent } from '@/components/layout/CookieBanner';

interface StickyAnchorCtaProps {
  /** Element id on the same page to scroll to, and to watch. */
  anchorId: string;
  label: string;
}

/**
 * Floating prompt that scrolls to something on the same page, and gets out of
 * the way while that thing is already on screen.
 *
 * Two earlier versions were wrong in opposite directions. The first tried to
 * be clever: appear after the first viewport, then latch itself off for good
 * once the form had been seen — so it vanished after one glance and never came
 * back however far you scrolled. The second overcorrected into always-on,
 * which meant it sat over the very form it was pointing at, offering to take
 * you somewhere you already were.
 *
 * What it does now has no memory and no timers: it watches the target and is
 * visible exactly when the target is not. Scroll the form off the top and it
 * appears; scroll back and it withdraws. Nothing latches, so there is no state
 * to get stuck in.
 *
 * While hidden it is not merely transparent — `pointer-events-none`,
 * `aria-hidden` and `tabIndex={-1}` together keep it out of the way of a mouse,
 * a screen reader and the tab order alike. A fade that is still clickable is a
 * trap.
 *
 * It also lifts above the cookie banner (`fixed inset-x-0 bottom-0 z-50`) until
 * consent has been answered, rather than hiding under it.
 *
 * Kept to a single line, and a plain anchor: no dialog, no overlay, nothing
 * that can trap focus.
 */
export function StickyAnchorCta({ anchorId, label }: StickyAnchorCtaProps) {
  const consent = useConsent();

  // Hidden until proven otherwise: on a page whose target sits in the hero,
  // the first paint should not flash a button that is about to withdraw.
  const [targetVisible, setTargetVisible] = useState(true);

  useEffect(() => {
    const target = document.getElementById(anchorId);

    // No target on the page — an anchor to nothing helps nobody. The initial
    // state already hides it, so there is nothing to do and, deliberately,
    // nothing to set: this effect only ever changes state from the observer's
    // callback, which is what subscribing to an external system should look
    // like.
    if (!target) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => setTargetVisible(entry.isIntersecting),
      {
        // A sliver counts. Waiting for the whole form — which is taller than
        // some viewports — would mean the prompt never withdrew on a phone.
        threshold: 0,
        // Withdraw slightly before the form reaches the edge, so the two are
        // never both fighting for the same corner mid-scroll.
        rootMargin: '-80px 0px -80px 0px',
      }
    );

    observer.observe(target);

    return () => observer.disconnect();
  }, [anchorId]);

  // 'loading' counts as up: during the pre-hydration snapshot we do not yet
  // know whether the banner is about to appear, and starting high then
  // dropping is less jarring than starting under the banner and jumping.
  const bannerUp = consent === 'undecided' || consent === 'loading';

  return (
    <a
      href={`#${anchorId}`}
      aria-hidden={targetVisible || undefined}
      tabIndex={targetVisible ? -1 : undefined}
      className={`fixed right-5 z-40 inline-flex items-center gap-2 rounded-sm bg-midnight-navy text-soft-pearl font-body text-sm font-medium tracking-wide px-5 py-3 shadow-lg transition-all duration-300 hover:bg-midnight-navy/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-gold focus-visible:ring-offset-2 focus-visible:ring-offset-soft-pearl motion-reduce:transition-none ${
        bannerUp ? 'bottom-44 sm:bottom-36' : 'bottom-5'
      } ${
        targetVisible
          ? 'opacity-0 translate-y-2 pointer-events-none'
          : 'opacity-100 translate-y-0'
      }`}
    >
      {label}
      <span aria-hidden="true">&#8593;</span>
    </a>
  );
}
