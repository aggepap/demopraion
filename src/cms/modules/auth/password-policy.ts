/**
 * What counts as an acceptable password, and how strong a given one is.
 *
 * Both answers are needed on both sides of the wire at once — the zod schemas that
 * refuse a body, and the form that draws the checklist and the meter — so they live
 * here, in one dependency-free module. Nothing in here imports bcrypt: `password.ts`
 * does, and a client component that pulled the rules in through it would ship the
 * hashing library to the browser for the sake of one number.
 *
 * The rules use unicode classes rather than `[a-z]`/`[A-Z]`. This admin is Greek:
 * `Καλησπέρα` is nine letters with a capital at the front, and an ASCII-only test
 * calls that "no lowercase letter, no uppercase letter" — sending the author off to
 * type something worse in order to satisfy the checker.
 */

/** The one password rule both sides need to state. */
export const MIN_PASSWORD_LENGTH = 10;

/**
 * Exact-match list of the passwords guessing tools start with, checked after the
 * dressing-up is stripped off. Classes alone cannot catch these: `Password1!` has a
 * capital, a digit and a symbol, and is among the first things anybody tries.
 */
const COMMON = new Set([
  'password', 'passwort', 'pass', 'welcome', 'qwerty', 'qwertyuiop', 'azerty', 'letmein',
  'admin', 'administrator', 'root', 'login', 'master', 'dragon', 'monkey', 'football',
  'baseball', 'iloveyou', 'princess', 'sunshine', 'shadow', 'superman', 'batman',
  'trustno', 'whatever', 'secret', 'changeme', 'default', 'test', 'testtest', 'abc',
  'abcabc', 'aaa', 'asdf', 'asdfgh', 'zxcvbn', 'qazwsx', 'google', 'facebook',
  'michael', 'jordan', 'hunter', 'freedom', 'ninja', 'pokemon', 'starwars', 'computer',
  'internet', 'samsung', 'apple', 'summer', 'winter', 'liverpool', 'olympiacos',
]);

/** Digits and symbols people substitute for letters, so `p@ssw0rd` is not a new password. */
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's' };

const strip = (value: string) => value.replace(/[^\p{L}\p{N}]/gu, '').replace(/^\p{Nd}+|\p{Nd}+$/gu, '');

/**
 * Two normalisations, either of which counting as a hit.
 *
 * Un-leeting everything would break the plain reading — `Password1!` becomes
 * `passwordii` once `1` and `!` are both read as `i`, and stops matching the very
 * entry it should hit — so the plain form is checked as well as the un-leeted one.
 */
function looksCommon(password: string): boolean {
  const lower = password.toLowerCase();
  const unleet = [...lower].map((ch) => LEET[ch] ?? ch).join('');
  return COMMON.has(strip(lower)) || COMMON.has(strip(unleet));
}

export interface PasswordRule {
  id: string;
  /** Reads as a checklist item on its own, and inside "Password needs …, …." */
  label: string;
  test: (password: string) => boolean;
}

export const PASSWORD_RULES: readonly PasswordRule[] = [
  {
    id: 'length',
    label: `at least ${MIN_PASSWORD_LENGTH} characters`,
    // Code points, not UTF-16 units: five fire emoji is not a ten-character password,
    // and `String.length` says it is.
    test: (pw) => [...pw].length >= MIN_PASSWORD_LENGTH,
  },
  { id: 'lower', label: 'a lowercase letter', test: (pw) => /\p{Ll}/u.test(pw) },
  { id: 'upper', label: 'an uppercase letter', test: (pw) => /\p{Lu}/u.test(pw) },
  { id: 'digit', label: 'a number', test: (pw) => /\p{Nd}/u.test(pw) },
  { id: 'symbol', label: 'a symbol', test: (pw) => /[^\p{L}\p{N}]/u.test(pw) },
  { id: 'common', label: 'not a common password', test: (pw) => !looksCommon(pw) },
];

/** The labels of the rules this password fails, in the order they are shown. */
export function passwordProblems(password: string): string[] {
  return PASSWORD_RULES.filter((rule) => !rule.test(password)).map((rule) => rule.label);
}

/** The same, as the one sentence the API and the form both say. `null` when it passes. */
export function passwordMessage(password: string): string | null {
  const missing = passwordProblems(password);
  return missing.length ? `Password needs ${missing.join(', ')}.` : null;
}

export type StrengthScore = 0 | 1 | 2 | 3 | 4;

const LABELS = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'] as const;

/**
 * A score for the meter — advice, not a gate. `passwordProblems` decides what is
 * allowed; this only says how much better than the floor a password is.
 *
 * Deliberately arithmetic rather than an entropy library: zxcvbn is ~800KB of
 * dictionaries for a hint under a text box. The two caps are what keep the number
 * honest — a password that fails the policy cannot read above "Weak", and one on the
 * common list reads as the worst there is, however long it looks.
 */
export function passwordStrength(password: string): { score: StrengthScore; label: string } {
  if (!password) return { score: 0, label: LABELS[0] };
  const length = [...password].length;
  const classes = [/\p{Ll}/u, /\p{Lu}/u, /\p{Nd}/u, /[^\p{L}\p{N}]/u].filter((re) => re.test(password)).length;

  let score = length >= 20 ? 3 : length >= 14 ? 2 : length >= MIN_PASSWORD_LENGTH ? 1 : 0;
  score += classes === 4 ? 2 : classes >= 3 ? 1 : 0;
  // `aaaa…` reaches any length you like without getting harder to guess.
  if (/(.)\1{2,}/u.test(password)) score -= 1;
  if (passwordProblems(password).length) score = Math.min(score, 1);
  if (looksCommon(password)) score = 0;

  const clamped = Math.max(0, Math.min(4, score)) as StrengthScore;
  return { score: clamped, label: LABELS[clamped] };
}
