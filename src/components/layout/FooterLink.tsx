'use client';

import type { ComponentProps, MouseEvent } from 'react';

import { Link, usePathname } from '@/lib/i18n/routing';
import { samePageScrollTarget } from '@/lib/same-page-scroll';

type FooterLinkProps = Omit<ComponentProps<typeof Link>, 'href'> & { href: string };

/**
 * The footer's in-site link.
 *
 * A plain `Link`, except when it points at the page already on screen: the
 * router ignores a navigation that does not change the URL, so without this
 * a reader who clicks "Pricing" at the bottom of /pricing sees nothing happen.
 * Here that click scrolls to the top, or to the link's anchor.
 *
 * The footer itself stays a server component; only the links hydrate.
 */
export function FooterLink({ href, onClick, ...rest }: FooterLinkProps) {
  const pathname = usePathname();

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    // Leave new-tab / new-window clicks and anything already handled alone.
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const target = samePageScrollTarget(href, pathname);
    if (!target) return;

    if (target.kind === 'top') {
      window.scrollTo({ top: 0 });
    } else {
      document.getElementById(target.id)?.scrollIntoView();
    }
  }

  return <Link href={href} onClick={handleClick} {...rest} />;
}
