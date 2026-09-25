import { NotFoundContent } from '@/components/site/NotFoundContent';

/**
 * In-locale not-found boundary, for `notFound()` thrown by dynamic routes.
 * Unmatched URLs go through `[...rest]`, which redirects to `/page-not-found`
 * (same content) because Next does not attach this boundary to a catch-all.
 */
export default function LocaleNotFound() {
  return <NotFoundContent />;
}
