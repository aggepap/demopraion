/**
 * Slugs — one implementation, because a slug that is computed in two places
 * eventually differs in two places.
 *
 * Greek is transliterated rather than stripped. A naive ASCII slug turns
 * "Μύκονος" into the empty string, and anything deriving a key from a label —
 * a booking facet, an anchor, a cookie group — would then collapse every Greek
 * name onto the same empty key. On a site whose default locale IS Greek, that
 * is not an edge case.
 */

/**
 * Unaccented Greek → Latin, per the everyday transliteration Greek sites use
 * (ISO 843's transcription rather than its reversible transliteration): the
 * point is a readable URL, not a round trip back to Greek.
 *
 * Accents never reach this map — `slugify` runs NFKD and strips the combining
 * marks first, so `ύ` has already become `υ`.
 */
const GREEK_TO_LATIN: Record<string, string> = {
  α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 'th', ι: 'i',
  κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x', ο: 'o', π: 'p', ρ: 'r', σ: 's',
  ς: 's', τ: 't', υ: 'y', φ: 'f', χ: 'ch', ψ: 'ps', ω: 'o',
};

/** Digraphs, applied before the per-letter map — "ου" is "ou", not "oy". */
const GREEK_DIGRAPHS: Array<[RegExp, string]> = [
  [/ου/g, 'ou'],
  [/αυ/g, 'av'],
  [/ευ/g, 'ev'],
  [/γγ/g, 'ng'],
  [/γχ/g, 'nch'],
];

export const SLUG_MAX_LENGTH = 96;

/**
 * A lowercase, hyphenated, ASCII-only key derived from a label.
 *
 * Returns `''` when the input has nothing sluggable in it. Callers must decide
 * what an empty slug means — an empty string is never a usable key, and
 * silently substituting one would merge unrelated things.
 */
export function slugify(input: unknown): string {
  if (typeof input !== 'string') return '';
  let s = input.toLowerCase().trim().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  for (const [pattern, replacement] of GREEK_DIGRAPHS) s = s.replace(pattern, replacement);
  s = s.replace(/[Ͱ-Ͽἀ-῿]/g, (ch) => GREEK_TO_LATIN[ch] ?? '');
  return s
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, '');
}

/**
 * The slug for a possibly-localized label.
 *
 * Locale keys are sorted before picking, so the answer does not depend on the
 * order the JSON happens to be stored in: the same row yields the same key on
 * every page, in every language, on every request. Without that, a filter URL
 * would stop matching when the visitor switched language.
 */
export function slugifyLocalized(value: unknown): string {
  if (typeof value === 'string') return slugify(value);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const map = value as Record<string, unknown>;
    for (const key of Object.keys(map).sort()) {
      const slug = slugify(map[key]);
      if (slug) return slug;
    }
  }
  return '';
}
