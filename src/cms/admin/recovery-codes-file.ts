/**
 * The downloadable recovery-code file.
 *
 * Pure, and separate from the component, for the reason `login-error.ts` gives:
 * this suite has no DOM harness, and the file body is the part with a way to go
 * wrong.
 *
 * The design constraint worth stating: this file is opened cold, months later,
 * out of a Downloads folder, by someone who has just lost their phone and has
 * no memory of what it was. It therefore has to name itself and explain itself
 * — ten opaque strings under a filename like `download.txt` is indistinguishable
 * from junk, and gets deleted as junk.
 */

/** A filesystem-safe fragment of a site name, or `''` when there is nothing usable. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isoDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * The name the browser saves the file under.
 *
 * Slugified rather than interpolated raw: the value goes straight into a
 * `download` attribute, and a name carrying a path separator is at best ignored
 * by the browser and at worst a surprise about where the file lands. A name
 * that slugifies to nothing — a Greek site name has no ASCII at all — falls
 * back to a generic one that still says what the file is.
 */
export function recoveryCodesFilename(siteName: string | undefined, at: Date): string {
  const slug = slugify(siteName ?? '');
  return `${slug ? `${slug}-` : ''}recovery-codes-${isoDay(at)}.txt`;
}

export interface RecoveryCodesFileOptions {
  siteName?: string;
  generatedAt: Date;
}

/** The file body. Plain text — it has to open anywhere, including on a phone. */
export function recoveryCodesFileText(
  codes: readonly string[],
  { siteName, generatedAt }: RecoveryCodesFileOptions,
): string {
  const heading = siteName
    ? `${siteName} — two-factor recovery codes`
    : 'Two-factor recovery codes';

  return (
    [
      heading,
      `Generated ${isoDay(generatedAt)}`,
      '',
      'Each code can be used once, in place of your authenticator app or emailed',
      'code, to sign in to the admin.',
      '',
      'Keep this file private. Anyone holding one of these codes AND your password',
      'can sign in as you.',
      '',
      // Indented so the codes read as a block, but each line trims to exactly
      // the code — they get transcribed by hand from here.
      ...codes.map((code) => `  ${code}`),
    ].join('\n') + '\n'
  );
}
