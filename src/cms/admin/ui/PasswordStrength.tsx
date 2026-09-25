import { PASSWORD_RULES, passwordStrength } from '../../modules/auth/password-policy';

/**
 * The requirements, and how the typed password is doing against them.
 *
 * The checklist is rendered before anything is typed, and the meter only after:
 * rules stated up front save an attempt, whereas a meter reading "Very weak" over an
 * empty box is a red mark against someone who has done nothing yet.
 *
 * Every part of it is readable without colour. The bars are the quick glance; the
 * word beside them ("Fair") is the actual score, and each rule says "met"/"not met"
 * to a screen reader — a green tick that is only green is invisible to about one man
 * in twelve, and to anyone not looking at it.
 *
 * Server-safe: no state, no effects. `passwordStrength` is arithmetic on the string,
 * and the password never leaves the page.
 */
const TONE = ['bg-red-500', 'bg-red-500', 'bg-amber-500', 'bg-warm-gold', 'bg-green-600'] as const;

export function PasswordStrength({
  value,
  id,
  showRules = true,
}: {
  value: string;
  id?: string;
  /**
   * Off when the field is already printing the missing rules as its error. The two
   * say the same thing, and stacking them prints the same sentence twice in two
   * colours — so the field's error wins and only the meter stays.
   */
  showRules?: boolean;
}) {
  const { score, label } = passwordStrength(value);
  const unmet = PASSWORD_RULES.filter((rule) => !rule.test(value));
  return (
    <div id={id} className="mt-1.5 flex flex-col gap-1">
      {value ? (
        <div className="flex items-center gap-2">
          <div
            role="meter"
            aria-valuenow={score}
            aria-valuemin={0}
            aria-valuemax={4}
            aria-valuetext={`Password strength: ${label}`}
            className="flex h-1 flex-1 gap-0.5"
          >
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={`h-full flex-1 rounded-full ${i < score ? TONE[score] : 'bg-neutral-200'}`} />
            ))}
          </div>
          <span className="text-xs whitespace-nowrap text-neutral-700">{label}</span>
        </div>
      ) : null}
      {!showRules ? null : unmet.length === 0 && value ? (
        // Six ticks is a wall of confirmation for something already finished. The
        // meter says how good it is from here; the detail only helps while
        // something is still missing.
        <p className="text-xs text-neutral-700">
          <span aria-hidden="true">✓</span> Meets all the requirements
        </p>
      ) : (
        // Two even columns rather than a wrapping row: six items of six different
        // widths wrap into a ragged three-line block that reads as an error report.
        <ul className="grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-2">
          {PASSWORD_RULES.map((rule) => {
            const met = rule.test(value);
            return (
              <li key={rule.id} className={`text-xs ${met ? 'text-neutral-700' : 'text-neutral-600'}`}>
                <span aria-hidden="true">{met ? '✓' : '·'}</span> {rule.label}
                <span className="sr-only"> — {met ? 'met' : 'not met'}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
