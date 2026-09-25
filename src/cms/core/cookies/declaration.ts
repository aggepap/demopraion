/**
 * Turning the stored catalogue into the declaration a visitor is actually shown.
 *
 * The stored catalogue is admin-managed, but analytics is switched on by a
 * setting — so the two could disagree, and did: an admin who pasted a GA4
 * measurement ID got a site that loaded Google Analytics while `/legal/cookies`
 * declared nothing and the banner offered no analytics toggle, because no
 * `analytics` category existed for `useCategoryConsent` to find. It fell back to
 * the blanket flag, and GA loaded for anyone who had accepted anything.
 *
 * So the declaration is derived, not just read: what the loader will load, the
 * policy says. Pure functions over plain data — no database, no cache — so the
 * two cached reads they compose can each invalidate on their own tag.
 */
import {
  ANALYTICS_CATEGORY_KEY,
  defaultCategory,
  GOOGLE_ANALYTICS_SERVICE,
  type DefaultCookieCategory,
} from './defaults';
import type { CookieCategory, CookieService } from '../../db/adapters/mysql/schema/cookies';

export interface CategoryWithServices extends CookieCategory {
  services: CookieService[];
}

/**
 * Ids for rows that exist in the declaration but not in the database.
 *
 * Negative so they can never collide with an autoincrement id, and distinct from
 * each other so `cookiePolicyVersion` and React keys stay unambiguous.
 */
export const SYNTHETIC_ANALYTICS_CATEGORY_ID = -1;
export const SYNTHETIC_GA_SERVICE_ID = -2;

/** Fixed, so a synthesized row does not change the policy version on every read. */
const SYNTHETIC_CREATED_AT = new Date(0);

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Whether the admin has already declared GA under this category.
 *
 * Matched on the name alone. `provider` is not a discriminator — "Google" also
 * covers Maps, Fonts and reCAPTCHA, and suppressing the analytics entry because
 * one of those was listed would put the policy back out of step with the loader.
 * A disabled row counts too: switching it off is a deliberate act, and silently
 * re-adding the same service under another id would overrule the admin.
 */
function alreadyDeclaresGa(services: readonly CookieService[]): boolean {
  return services.some((s) => {
    const name = normalizeName(s.name);
    return name.includes('google analytics') || name.includes('gtag') || name === 'ga4';
  });
}

function gaService(categoryId: number): CookieService {
  return {
    id: SYNTHETIC_GA_SERVICE_ID,
    categoryId,
    name: GOOGLE_ANALYTICS_SERVICE.name,
    provider: GOOGLE_ANALYTICS_SERVICE.provider,
    purpose: { ...GOOGLE_ANALYTICS_SERVICE.purpose },
    enabled: true,
    createdAt: SYNTHETIC_CREATED_AT,
  };
}

function syntheticAnalyticsCategory(definition: DefaultCookieCategory): CategoryWithServices {
  return {
    id: SYNTHETIC_ANALYTICS_CATEGORY_ID,
    key: definition.key,
    name: { ...definition.name },
    description: { ...definition.description },
    required: definition.required,
    sortOrder: definition.sortOrder,
    createdAt: SYNTHETIC_CREATED_AT,
    services: [gaService(SYNTHETIC_ANALYTICS_CATEGORY_ID)],
  };
}

/**
 * The stored catalogue plus Google Analytics, when a measurement ID resolves.
 *
 * Any non-empty ID counts, including a malformed one. The write boundary refuses
 * anything that is not a `G-` id, but `AnalyticsLoader` loads whatever it is
 * given — so a stricter reader here would re-create the exact failure this
 * function exists to prevent, GA running while the policy denies it.
 *
 * Returns the input untouched when there is nothing to add, and never mutates it.
 */
export function withAnalyticsDeclaration(
  catalog: CategoryWithServices[],
  gaId: unknown,
): CategoryWithServices[] {
  const id = typeof gaId === 'string' ? gaId.trim() : '';
  if (!id) return catalog;

  const existing = catalog.find((c) => c.key === ANALYTICS_CATEGORY_KEY);
  if (!existing) {
    // No category to refuse means GA is covered by the blanket flag. Declaring
    // one from the same definition the seeder uses makes it separately
    // refusable, and keeps a visitor's stored `analytics` decision meaningful.
    const definition = defaultCategory(ANALYTICS_CATEGORY_KEY);
    return definition ? [...catalog, syntheticAnalyticsCategory(definition)] : catalog;
  }

  if (alreadyDeclaresGa(existing.services)) return catalog;
  return catalog.map((c) =>
    c === existing ? { ...c, services: [...c.services, gaService(c.id)] } : c,
  );
}

/**
 * A stamp for the catalogue as the visitor was shown it.
 *
 * Consent is only meaningful against a specific declaration: "they accepted
 * analytics" means little if nobody can say which services were listed under
 * analytics at the time. Derived from the categories and their services rather
 * than stored, so it cannot drift from the thing it describes — and so turning
 * analytics on produces a different version from turning it off.
 */
export function cookiePolicyVersion(catalog: CategoryWithServices[]): string {
  const shape = catalog
    .map((c) => `${c.key}:${c.required ? 1 : 0}:${c.services.map((s) => s.id).sort().join('.')}`)
    .sort()
    .join('|');
  let hash = 0;
  for (let i = 0; i < shape.length; i += 1) hash = (hash * 31 + shape.charCodeAt(i)) | 0;
  return `v${(hash >>> 0).toString(36)}`;
}

export interface ConsentOptions {
  policyVersion: string;
  categories: {
    key: string;
    name: Record<string, string>;
    description: Record<string, string> | null;
    required: boolean;
    services: { name: string; provider: string | null; purpose: Record<string, string> | null }[];
  }[];
}

/** What the banner needs: the categories a visitor can decide about, the services
 *  named under each, and the stamp of this exact declaration. */
export function toConsentOptions(catalog: CategoryWithServices[]): ConsentOptions {
  return {
    policyVersion: cookiePolicyVersion(catalog),
    categories: catalog.map((c) => ({
      key: c.key,
      name: c.name,
      description: c.description ?? null,
      required: c.required,
      // Only services that are actually in use — a disabled one is not something
      // to ask a visitor to agree to.
      services: c.services
        .filter((svc) => svc.enabled)
        .map((svc) => ({ name: svc.name, provider: svc.provider, purpose: svc.purpose })),
    })),
  };
}
