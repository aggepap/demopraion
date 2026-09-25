/**
 * Default cookie-catalogue seed.
 *
 * A fresh install had an empty `cookie_categories` table and nothing to fill it:
 * the banner offered no categories, `/legal/cookies` rendered no declaration,
 * and the only route to one was an admin knowing to go and type it. This puts a
 * defensible starting point in place.
 *
 * Non-destructive, like `seedRoles` for every role but `superadmin` (which the
 * code re-syncs to `*`); this table is copy that an admin edits, so a category whose key already
 * exists is left exactly as it is — a seeder that updated in place would revert
 * their wording on the next deploy, silently.
 */
import { DEFAULT_COOKIE_CATEGORIES, type DefaultCookieCategory } from '../../core/cookies/defaults';
import { adapter } from '../index';
import { getMysqlDb } from '../adapters/mysql/client';
import { cookieCategories, cookieServices } from '../adapters/mysql/schema';

/** The defaults not yet present, matched on the exact key (the unique column). */
export function pendingCategories(existingKeys: readonly string[]): DefaultCookieCategory[] {
  const have = new Set(existingKeys);
  return DEFAULT_COOKIE_CATEGORIES.filter((c) => !have.has(c.key));
}

export interface CookieSeedResult {
  created: number;
  skipped: number;
  services: number;
}

export async function seedCookieCatalog(
  db: ReturnType<typeof getMysqlDb> = getMysqlDb(),
): Promise<CookieSeedResult> {
  const existing = await db.select({ key: cookieCategories.key }).from(cookieCategories);
  const pending = pendingCategories(existing.map((r) => r.key));

  let services = 0;
  for (const category of pending) {
    const res = await db.insert(cookieCategories).values({
      key: category.key,
      name: category.name,
      description: category.description,
      required: category.required,
      sortOrder: category.sortOrder,
    });
    const categoryId = adapter.insertId(res);
    // Only alongside a category this run created: attaching them to a category
    // that was already there would add rows an admin had chosen to remove.
    for (const service of category.services) {
      await db.insert(cookieServices).values({
        categoryId,
        name: service.name,
        provider: service.provider,
        purpose: service.purpose,
        enabled: true,
      });
      services += 1;
    }
  }

  return {
    created: pending.length,
    skipped: DEFAULT_COOKIE_CATEGORIES.length - pending.length,
    services,
  };
}
