/**
 * How long a cached CMS read stays valid.
 *
 * `false` — never by the clock. Every one of these caches is tagged, and every
 * write path calls `revalidateTag` for the tags it touches (`read/revalidate.ts`,
 * `routes/settings.ts`, `seo/resolve.ts`, `cookies/service.ts`), so an admin edit
 * still shows up immediately. The timer added nothing on top of that: it could
 * only ever refresh data that was already correct.
 *
 * What it did add was an outage. These reads run inside `[locale]/layout.tsx`,
 * which wraps every page, so a 300-second entry gave *every* statically rendered
 * page a 300-second stale time. When it expired, Next tried to regenerate the
 * route in the background; the regeneration failed, the cache entry was dropped,
 * and every request afterwards found nothing to serve — `NoFallbackError`, a 500
 * on `/pricing`, `/contact`, `/approach`, `/legal/*`, and the framework's bare
 * 404 shell on `/`. The site came back with each deploy and broke again about
 * five minutes later, once for every time this timer fired.
 *
 * The pages that stayed up throughout were the `force-dynamic` ones (`/insights`
 * and the shop/booking routes): never in the static cache, so never regenerated,
 * so never broken.
 *
 * Tag invalidation runs in a request context and does not depend on background
 * regeneration, which is why it keeps working where the timer did not.
 */
export const CMS_CACHE_REVALIDATE = false as const;
