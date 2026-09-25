/**
 * Navigation tables. Labels resolve through the `nav` / `footer` message
 * namespaces; hrefs are locale-free and go through next-intl's `Link`.
 */
export interface NavLeaf {
  /** Key in the `nav` message namespace. */
  labelKey: string;
  href: string;
}

export const NAV_ITEMS: ReadonlyArray<NavLeaf> = [
  { labelKey: 'home', href: '/' },
  { labelKey: 'blog', href: '/blog' },
  { labelKey: 'faq', href: '/faq' },
  { labelKey: 'cases', href: '/case-studies' },
  { labelKey: 'about', href: '/about' },
  { labelKey: 'contact', href: '/contact' },
];

const BOOKING_ITEM: NavLeaf = { labelKey: 'booking', href: '/booking' };
const SHOP_ITEM: NavLeaf = { labelKey: 'shop', href: '/shop' };

/** Which optional modules are switched on, as far as the nav is concerned. */
export interface NavFlags {
  commerce?: boolean;
  booking?: boolean;
}

/**
 * Header/mobile entries for the current module state. Module links go straight
 * after Home, in a fixed order, so switching a second module on never reorders
 * the first one's link.
 */
export function navItems(flags: NavFlags): ReadonlyArray<NavLeaf> {
  const extras: NavLeaf[] = [];
  if (flags.booking) extras.push(BOOKING_ITEM);
  if (flags.commerce) extras.push(SHOP_ITEM);
  return [NAV_ITEMS[0], ...extras, ...NAV_ITEMS.slice(1)];
}

export const LEGAL_LINKS: ReadonlyArray<NavLeaf> = [
  { labelKey: 'privacy', href: '/privacy' },
  { labelKey: 'terms', href: '/terms' },
  { labelKey: 'cookies', href: '/legal/cookies' },
];
