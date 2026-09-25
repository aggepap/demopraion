'use client';

import { createContext, useContext, type ReactNode } from 'react';

/**
 * Whether the `newsletter` module is on, carried to the controls that offer it.
 *
 * The flag lives in `site_settings` and is resolved by `isModuleEnabled`, which
 * is server-only. The four places that offer a signup are spread across the
 * tree — the footer band in the layout, the sidebar card inside three different
 * page layouts, the brief form's checkbox, and checkout's marketing tick — so
 * threading a prop to each meant editing every page and layout between them,
 * and forgetting one meant a control that quietly kept collecting.
 *
 * Resolved once in `app/[locale]/layout.tsx`, alongside the commerce and
 * booking flags that layout already reads, and provided the way `CartProvider`
 * and `CompareProvider` are.
 *
 * This is presentation. The enforcement is server-side and independent: the
 * signup endpoint answers 404 while the module is off, and the checkout route
 * drops a claimed opt-in before it reaches the order. Hiding a checkbox is not
 * a control, and neither of those depends on this.
 */
const NewsletterEnabledContext = createContext(true);

export function NewsletterProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  return (
    <NewsletterEnabledContext.Provider value={enabled}>{children}</NewsletterEnabledContext.Provider>
  );
}

/**
 * Defaults to `true` with no provider above.
 *
 * The provider sits in the single root layout every public page renders
 * through, so in the running site there is always one. The default is for a
 * component rendered on its own — a test, an isolated preview — which should
 * look like it does on the site rather than silently render nothing.
 */
export function useNewsletterEnabled(): boolean {
  return useContext(NewsletterEnabledContext);
}
