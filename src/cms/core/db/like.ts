/**
 * A search term turned into a `LIKE` pattern that means what the user typed.
 *
 * `%` and `_` are wildcards to SQL: a search for `user_id` matched `userXid` and a
 * search for `50%` matched anything starting with `50`. Three call sites already
 * escaped them by hand and a fourth (the audit log) did not, so the same search box
 * behaved differently depending on which screen it was on (F-066). One function, so
 * a fifth cannot get it wrong.
 *
 * The backslash is MySQL/MariaDB's default `LIKE` escape character, which is why no
 * `ESCAPE` clause is needed — and why the backslash itself must be escaped first, or
 * a term ending in one would escape the closing `%` the pattern adds.
 */
export function likeTerm(search: string): string {
  return `%${search.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}
