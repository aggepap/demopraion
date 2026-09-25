import '../setup/react-global';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { PasswordStrength } from '@/cms/admin/ui/PasswordStrength';
import { EditUserPanel, UsersManager } from '@/cms/admin/UsersManager';
import { PASSWORD_RULES } from '@/cms/modules/auth/password-policy';
import {
  ONE_ROLE_ONLY,
  ROLE_REQUIRED,
  createUserBody,
  newUserProblems,
  strongPasswordOrBlank,
  updateRoleIds,
} from '@/cms/core/users/schema';

/**
 * An account with no role is an account that cannot sign in.
 *
 * `verifyCredentials` returns `no_roles` when a user holds no roles, and the login
 * route answers every failure reason with the same generic sentence — so a
 * colleague created without a ticked box is told "Invalid email or password."
 * however carefully they type. Nothing on the users screen said the box mattered:
 * `roleIds` was optional on the way in, and the row simply showed "—" under Roles.
 *
 * The rule is enforced on the server, where it actually binds, and mirrored in the
 * form so the refusal arrives before the account exists rather than after.
 */

const VALID = {
  email: 'new@example.com',
  name: 'New Person',
  password: 'Correct-Horse-Battery-9',
  roleIds: [1],
};

describe('createUserBody', () => {
  test('accepts a body that names at least one role', () => {
    assert.equal(createUserBody.safeParse(VALID).success, true);
  });

  test('refuses a body with no roleIds at all', () => {
    const withoutRoles: Record<string, unknown> = { ...VALID };
    delete withoutRoles.roleIds;
    assert.equal(createUserBody.safeParse(withoutRoles).success, false);
  });

  test('refuses an empty roleIds array', () => {
    assert.equal(createUserBody.safeParse({ ...VALID, roleIds: [] }).success, false);
  });

  test('says why, rather than leaving the client with "Validation failed."', () => {
    const res = createUserBody.safeParse({ ...VALID, roleIds: [] });
    assert.equal(res.success, false);
    const message = res.success ? '' : res.error.issues[0].message;
    assert.equal(message, ROLE_REQUIRED);
    assert.match(message, /role/i);
  });

  test('refuses two roles — an account holds one', () => {
    // The screen offers a dropdown, but the screen is not the rule. Without this the
    // constraint lived only in the markup, and any other caller could grant a pair.
    const res = createUserBody.safeParse({ ...VALID, roleIds: [1, 2] });
    assert.equal(res.success, false);
    assert.equal(res.success ? '' : res.error.issues[0].message, ONE_ROLE_ONLY);
  });

  test('the update path may clear the roles, but may not set two', () => {
    // `[]` stays legal there: stripping an account's roles is how it is taken out of
    // service without deleting it, and the QA harness cleans up that way.
    assert.equal(updateRoleIds.safeParse([]).success, true);
    assert.equal(updateRoleIds.safeParse([3]).success, true);
    assert.equal(updateRoleIds.safeParse([3, 4]).success, false);
  });

  test('still enforces everything it enforced before', () => {
    assert.equal(createUserBody.safeParse({ ...VALID, email: 'not-an-email' }).success, false);
    assert.equal(createUserBody.safeParse({ ...VALID, name: '' }).success, false);
    assert.equal(createUserBody.safeParse({ ...VALID, password: 'short' }).success, false);
    assert.equal(createUserBody.safeParse({ ...VALID, roleIds: [0] }).success, false);
    assert.equal(createUserBody.safeParse({ ...VALID, roleIds: [1.5] }).success, false);
  });
});

describe('newUserProblems', () => {
  const draft = { name: 'New Person', email: 'new@example.com', password: 'Correct-Horse-Battery-9', roleIds: [1] };

  test('a complete draft has nothing to report', () => {
    assert.deepEqual(newUserProblems(draft), {});
  });

  test('speaks the server’s own words — it is the same schema', () => {
    assert.equal(newUserProblems({ ...draft, roleIds: [] }).roleIds, ROLE_REQUIRED);
    assert.equal(newUserProblems({ ...draft, roleIds: [1, 2] }).roleIds, ONE_ROLE_ONLY);
  });

  test('puts each complaint on the field that earned it', () => {
    assert.deepEqual(Object.keys(newUserProblems({ ...draft, name: '' })), ['name']);
    assert.deepEqual(Object.keys(newUserProblems({ ...draft, email: 'not-an-email' })), ['email']);
    assert.deepEqual(Object.keys(newUserProblems({ ...draft, password: 'weak' })), ['password']);
  });

  test('reports every bad field at once, not the first one', () => {
    // A form that reveals one problem per submit is a form submitted four times.
    const problems = newUserProblems({ name: ' ', email: '', password: '', roleIds: [] });
    assert.deepEqual(Object.keys(problems).sort(), ['email', 'name', 'password', 'roleIds']);
  });

  test('the password complaint names what is missing', () => {
    const message = newUserProblems({ ...draft, password: 'alllowercase!!' }).password ?? '';
    assert.match(message, /uppercase/i);
    assert.match(message, /number/i);
  });

  test('whitespace is not a name', () => {
    assert.ok(newUserProblems({ ...draft, name: '   ' }).name);
  });
});

describe('the password strength meter', () => {
  const render = (value: string) => renderToStaticMarkup(<PasswordStrength value={value} id="pw" />);

  test('shows no meter for an empty box, only the requirements', () => {
    const html = render('');
    assert.doesNotMatch(html, /role="meter"/, 'a meter reading zero before anything is typed reads as a failure');
    assert.match(html, /at least 10 characters/i, 'the rules are stated before they are broken');
  });

  test('reports the score to assistive tech, not only as colour', () => {
    const html = render('Correct-Horse-Battery-9-and-longer!');
    const meter = html.match(/<div[^>]*role="meter"[^>]*>/)?.[0] ?? '';
    assert.match(meter, /aria-valuenow="4"/);
    assert.match(meter, /aria-valuemin="0"/);
    assert.match(meter, /aria-valuemax="4"/);
    assert.match(meter, /aria-valuetext="[^"]*Strong/i);
    assert.match(html, /Strong/, 'the score is not readable without the colour bars');
  });

  test('collapses to a single line once every requirement is met', () => {
    // Six green ticks is a wall of confirmation for something already finished.
    // The meter carries the score from there; the detail is only useful while
    // something is still missing.
    const html = render('Correct-Horse-Battery-9');
    assert.doesNotMatch(html, /at least 10 characters/i);
    assert.match(html, /meets (all )?the requirements/i);
  });

  test('can drop the rules for a field that is already listing them in its error', () => {
    // "Password needs a lowercase letter, an uppercase letter, a symbol." above a
    // checklist of the same three items is the same sentence twice, in two colours.
    const html = renderToStaticMarkup(<PasswordStrength value="1234567890" showRules={false} />);
    assert.doesNotMatch(html, /at least 10 characters/i);
    assert.match(html, /role="meter"/, 'the score went with the rules');
  });

  test('marks each requirement met or unmet in text, not by colour alone', () => {
    const html = render('alllowercase!!');
    assert.match(html, /an uppercase letter/i);
    // Every rule reports its state to a screen reader, whichever way it went.
    assert.ok((html.match(/\b(met|not met)\b/g) ?? []).length >= PASSWORD_RULES.length);
  });
});

const ROLES = [
  { id: 1, name: 'editor', permissionsCount: 4 },
  { id: 2, name: 'superadmin', permissionsCount: 1 },
];

const render = (roles: typeof ROLES, assignableRoleIds?: number[]) =>
  renderToStaticMarkup(
    <UsersManager initial={{ users: [], roles, ...(assignableRoleIds ? { assignableRoleIds } : {}) }} />,
  );

describe('the new-user form', () => {
  test('offers no submit at all when no role exists yet, and says why', () => {
    // Ticking a box is impossible here, so an enabled button could only ever
    // produce a 422. The sentence is what makes the disabled button readable.
    const html = render([]);
    assert.match(html, /create a role/i, 'an empty role list gives the admin nothing to act on');
    const button = html.match(/<button[^>]*type="submit"[^>]*>/)?.[0] ?? '';
    assert.match(button, /disabled/, 'submit is offered with no role available to attach');
  });

  test('does the same when roles exist but none are this admin’s to assign', () => {
    // Every box is disabled by the existing authority gate, so the required
    // answer cannot be given — the same dead end, and it needs its own sentence
    // because "create a role first" would be wrong advice here.
    const html = render(ROLES, []);
    assert.match(html, /yours to assign/i);
    assert.doesNotMatch(html, /create a role/i, 'told to create a role they may not be able to assign either');
    const button = html.match(/<button[^>]*type="submit"[^>]*>/)?.[0] ?? '';
    assert.match(button, /disabled/, 'submit is offered when nothing can be ticked');
  });

  test('labels every control, rather than leaving a placeholder to do it', () => {
    // The form used to be four placeholders and an `aria-label`. A placeholder is
    // gone the moment you type into it, which is precisely when an error message
    // arrives and the field needs to still say what it is.
    const html = render(ROLES);
    for (const label of ['Name', 'Email', 'Password', 'Role']) {
      const forId = html.match(new RegExp(`<label[^>]*for="([^"]+)"[^>]*>${label}`))?.[1];
      assert.ok(forId, `no <label> points at the ${label} control`);
      assert.match(html, new RegExp(`id="${forId}"`), `${label}'s label points at nothing`);
    }
  });

  test('states the password rules before anything is typed', () => {
    const html = render(ROLES);
    assert.match(html, /at least 10 characters/i);
    assert.match(html, /a symbol/i);
  });

  test('marks the required fields as required', () => {
    const html = render(ROLES);
    assert.ok((html.match(/\(required\)/g) ?? []).length >= 4, 'not every required field says so');
  });

  test('offers the roles as one choice, not a set of boxes', () => {
    // An account holds one role. Checkboxes said otherwise, and invited a
    // combination nobody meant to grant.
    const html = render(ROLES);
    assert.match(html, /<select/);
    assert.doesNotMatch(html, /type="checkbox"/, 'the role checkboxes are still there');
    assert.equal((html.match(/<option/g) ?? []).length, 3, 'expected a placeholder plus the two roles');
    assert.match(html, /<option value=""[^>]*>\s*(Choose|Select)/i, 'no empty option — a role is preselected');
  });

  test('a role above your authority is listed, but cannot be chosen', () => {
    const html = render(ROLES, [1]);
    const superadmin = (html.match(/<option[^>]*>[^<]*/g) ?? []).find((o) => o.includes('superadmin')) ?? '';
    assert.match(superadmin, /disabled/, 'an unassignable role is selectable');
    assert.match(superadmin, /above your authority/i, 'nothing says why it cannot be picked');
  });


});

describe('the Edit panel’s reset-password field', () => {
  test('blank means "keep the current password", and is allowed', () => {
    assert.equal(strongPasswordOrBlank.safeParse('').success, true);
  });

  test('but a password typed there meets the same policy as a new account’s', () => {
    // Otherwise the rule is a formality: anybody who can create an account can
    // reset one, and the weak password just goes in through the other door.
    const res = strongPasswordOrBlank.safeParse('password');
    assert.equal(res.success, false);
    assert.match(res.success ? '' : res.error.issues[0].message, /Password needs/);
    assert.equal(strongPasswordOrBlank.safeParse('Correct-Horse-Battery-9').success, true);
  });

  test('does not nag with a checklist over a box meant to be left empty', () => {
    const html = renderPanel([1], ['editor']);
    assert.doesNotMatch(html, /at least 10 characters/i, 'the rules are pushed at someone not setting a password');
    assert.match(html, /leave blank to keep/i);
  });
});

const renderPanel = (roleIds: number[], roleNames: string[]) =>
  renderToStaticMarkup(
    <EditUserPanel
      user={{
        id: 3,
        email: 'someone@example.com',
        name: 'Someone',
        locale: 'el',
        disabled: false,
        mfaEnabled: false,
        lastLoginAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        roleIds,
        roleNames,
      }}
      roles={ROLES}
      assignable={undefined}
      onClose={() => {}}
      onSave={async () => null}
    />,
  );

describe('the Edit panel’s role', () => {
  test('opens on the role the account already holds', () => {
    const html = renderPanel([2], ['superadmin']);
    assert.match(html, /<select/);
    assert.doesNotMatch(html, /type="checkbox"/);
    // React renders the selection on the <select>, not as `selected` on the option.
    assert.match(html, /<select[^>]*value="2"|<option value="2"[^>]*selected/);
  });

  test('says what saving would take away from an account holding two', () => {
    // The table is many-to-many and some accounts predate this screen. A dropdown
    // that shows one of two roles and quietly drops the other on save is a silent
    // revocation of somebody's access.
    const html = renderPanel([1, 2], ['editor', 'superadmin']);
    assert.match(html, /superadmin/, 'the role about to be dropped is not named');
    assert.match(html, /remove|replace|lose/i, 'nothing warns that the second role goes');
  });

  test('an account with one role gets no such warning', () => {
    assert.doesNotMatch(renderPanel([1], ['editor']), /will (also )?(be )?(removed|replaced)/i);
  });
});
