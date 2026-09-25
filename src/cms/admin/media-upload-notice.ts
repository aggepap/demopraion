/**
 * Telling the editor a file was already in the library.
 *
 * The upload endpoint answers a duplicate with the file that was already there
 * rather than storing the same bytes twice. Left unsaid, that is the confusing
 * kind of clever: they picked `logo-final-v2.png` and the grid shows `logo.png`,
 * with nothing to explain why their filename vanished.
 *
 * Both upload screens — the media library and the picker inside document forms
 * — say it the same way, from here, which is also what makes the wording
 * testable without driving a browser.
 */

/** One line naming the files that were already in the library, or null when
 *  every file was new. */
export function duplicateNotice(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) {
    return `${names[0]} was already in the library — the existing file was used.`;
  }
  return `${names.length} files were already in the library — the existing files were used: ${names.join(', ')}`;
}
