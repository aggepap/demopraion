import 'server-only';

import { getSetting } from '../settings';

/**
 * The lines of a textarea setting, cleaned up the way a person would expect.
 *
 * Two SEO settings were declared, shown on the Settings screen with a
 * description promising they were "appended to the generated robots.txt" and
 * sitemap — and then read by nobody at all. `robots.ts` built its rules from a
 * hardcoded list and `sitemap.ts` from the route list; neither ever called
 * `getSetting`, so a path an admin added was stored, echoed back on the next
 * load, and had no effect whatsoever (F-059, F-060). The revalidation comment in
 * the settings route even claimed to purge "public GA/robots/sitemap" readers
 * that did not exist.
 *
 * Blank lines and stray whitespace are dropped rather than emitted: a trailing
 * newline in a textarea is not a rule, and an empty `Disallow:` line means the
 * opposite of nothing — it allows everything.
 */
export async function settingLines(key: string): Promise<string[]> {
  const raw = await getSetting<string>(key);
  if (typeof raw !== 'string') return [];
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
