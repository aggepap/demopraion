/**
 * What `POST /api/cms/users` accepts. Plain data (no `server-only`) so the admin
 * form can refuse the same body the API refuses — the pattern `core/settings/schema.ts`
 * already uses.
 *
 * The rule worth naming here is the role one. `roleIds` used to be optional, so an
 * account could be created with no role at all — and `verifyCredentials` answers
 * `no_roles` for exactly that account, which the login route reports with the same
 * generic sentence it uses for a wrong password. The result was a colleague who had
 * been "added" and could never sign in, with nothing anywhere saying why. An account
 * that can reach nothing is not a half-finished account; it is a broken one, so the
 * role is required at creation rather than left to be noticed later.
 *
 * Roles stay optional on *update* — see `updateBody` in `routes/users.ts`. That path
 * is how an existing account's roles are changed, and clearing them there is a
 * deliberate act on an account that already exists.
 */
import { z } from 'zod';

import { passwordMessage } from '../../modules/auth/password-policy';

/** Said by the API and by the form, so the reason does not change between them. */
export const ROLE_REQUIRED = 'Select a role.';

/**
 * An account holds one role, and this is where that is true rather than in the
 * markup of one screen. The dropdown can only produce one, but the dropdown is not
 * the rule — any other caller could have granted a pair, and "editor, superadmin"
 * on a row is a combination nobody chose and nobody can tell was a mistake.
 */
export const ONE_ROLE_ONLY = 'One role per account.';

const roleId = z.number().int().positive();

/** Exactly one, on the way in. */
const createRoleIds = z
  .array(roleId, { error: ROLE_REQUIRED })
  .min(1, ROLE_REQUIRED)
  .max(1, ONE_ROLE_ONLY);

/**
 * One or none, on the way through.
 *
 * `[]` stays legal here and nowhere else: stripping an account's roles is how it is
 * taken out of service without being deleted, and the QA harness cleans up that way.
 * The Edit panel still refuses to send it — an account with no role cannot sign in.
 */
export const updateRoleIds = z.array(roleId).max(1, ONE_ROLE_ONLY);

/**
 * The complexity rule as a schema. Every message is one the form can print verbatim
 * under the field — zod's own ("Too small: expected string to have >=10 characters")
 * is a sentence about a schema, not about the thing the person just typed.
 */
export const strongPassword = z.string().max(200, 'Password is too long.').superRefine((value, ctx) => {
  const message = passwordMessage(value);
  if (message) ctx.addIssue({ code: 'custom', message });
});

/** The Edit panel's reset field, where blank means "keep the current password". */
export const strongPasswordOrBlank = z.string().max(200, 'Password is too long.').superRefine((value, ctx) => {
  if (value === '') return;
  const message = passwordMessage(value);
  if (message) ctx.addIssue({ code: 'custom', message });
});

/**
 * How every admin account's email is stored and looked up: trimmed and lowercased.
 *
 * Sign-in (`verifyCredentials`) and the `db:seed-admin` CLI already normalised;
 * creation did not, so `Ann@Example.com` was stored as typed and only found at
 * sign-in because MySQL's collation happens to be case-insensitive.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const createUserBody = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Enter an email address.')
    .email('Enter a valid email address.')
    .max(255, 'Email is too long.')
    .transform(normalizeEmail),
  name: z.string().trim().min(1, 'Enter a name.').max(191, 'Name is too long.'),
  password: strongPassword,
  locale: z.string().max(8).optional(),
  // `error` covers the omitted/wrong-type case as well as `min(1)`'s empty one:
  // both arrive at the client as the sentence above rather than "Validation failed."
  roleIds: createRoleIds,
});

export type CreateUserBody = z.infer<typeof createUserBody>;

export interface NewUserDraft {
  name: string;
  email: string;
  password: string;
  roleIds: number[];
}

const FIELDS = ['name', 'email', 'password', 'roleIds'] as const;

export type NewUserProblems = Partial<Record<(typeof FIELDS)[number], string>>;

/**
 * Every complaint the form has about a draft, one per field.
 *
 * Runs the same schema the route runs rather than restating the rules in a second
 * dialect — which is why the message under the field and the message in the 422 are
 * necessarily the same sentence. All four fields are reported at once: a form that
 * reveals one problem per attempt is a form submitted four times.
 */
export function newUserProblems(draft: NewUserDraft): NewUserProblems {
  const result = createUserBody.safeParse(draft);
  if (result.success) return {};
  const problems: NewUserProblems = {};
  for (const issue of result.error.issues) {
    const field = FIELDS.find((f) => f === issue.path[0]);
    // First message per field. A field with two things wrong with it still gets one
    // line — the second is unreadable before the first is fixed anyway.
    if (field && problems[field] === undefined) problems[field] = issue.message;
  }
  return problems;
}
