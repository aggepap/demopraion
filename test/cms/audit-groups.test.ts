/**
 * The activity filter on the audit screen.
 *
 * The screen had one filter, "Subject", whose options were raw table names —
 * `admin_user`, `seo_redirect`, `form_submission`. That is the wrong axis AND
 * the wrong vocabulary: somebody opening this screen is asking "show me the
 * sign-ins", not "show me rows whose subject_type column is admin_user", and
 * the answer to the first question is spread across several subject types
 * (`email` for a failed login, `admin_user` for a password reset) while
 * `admin_user` also contains things that have nothing to do with signing in.
 *
 * So the primary filter is now by what HAPPENED, grouped into the handful of
 * categories a person actually thinks in.
 *
 * The test that matters most is the coverage one: every action the codebase can
 * write must land in a group, or it silently becomes invisible to every filter.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { execFileSync } from 'node:child_process';

import {
  AUDIT_ACTION_GROUPS,
  auditActionGroup,
  auditGroupFilter,
  matchesAuditGroup,
} from '@/cms/core/audit-groups';

describe('AUDIT_ACTION_GROUPS', () => {
  test('has a sign-in group covering login, logout and password resets', () => {
    // The group the user asked for by name.
    assert.equal(auditActionGroup('auth.login.success'), 'signin');
    assert.equal(auditActionGroup('auth.login.fail'), 'signin');
    assert.equal(auditActionGroup('auth.logout'), 'signin');
    assert.equal(auditActionGroup('auth.logout.idle'), 'signin');
    assert.equal(auditActionGroup('user.password.reset'), 'signin');
  });

  test('keeps two-factor events with the sign-in group', () => {
    // They answer the same question — "what happened to this person's access?"
    for (const a of ['auth.2fa.success', 'auth.2fa.fail', 'auth.2fa.enrolled', 'auth.2fa.bypass.success']) {
      assert.equal(auditActionGroup(a), 'signin', a);
    }
  });

  test('separates account administration from signing in', () => {
    // Creating a user and signing in as one are different questions.
    assert.equal(auditActionGroup('user.create'), 'users');
    assert.equal(auditActionGroup('user.delete'), 'users');
    assert.equal(auditActionGroup('role.update'), 'users');
  });

  test('a password reset is a sign-in event, not a user edit', () => {
    /*
     * The one deliberate exception to "user.* is administration". Somebody
     * asking to see password resets is asking a security question, and finding
     * them mixed in with "changed a display name" is exactly the confusion the
     * grouping exists to remove.
     */
    assert.equal(auditActionGroup('user.password.reset'), 'signin');
    assert.equal(auditActionGroup('user.update'), 'users');
  });

  test('every group has a label and at least one prefix', () => {
    for (const g of AUDIT_ACTION_GROUPS) {
      assert.ok(g.key.length > 0, 'key');
      assert.ok(g.label.length > 0, `label for ${g.key}`);
      assert.ok(g.prefixes.length > 0, `prefixes for ${g.key}`);
    }
    assert.equal(new Set(AUDIT_ACTION_GROUPS.map((g) => g.key)).size, AUDIT_ACTION_GROUPS.length);
  });

  test('an unknown action is not claimed by any group', () => {
    assert.equal(auditActionGroup('something.entirely.new'), null);
  });

  test('auditGroupFilter returns LIKE patterns to include and to exclude', () => {
    const f = auditGroupFilter('signin');
    assert.ok(f.include.length > 0);
    assert.ok([...f.include, ...f.exclude].every((x) => x.endsWith('%')), 'prefix patterns');
    assert.equal(auditGroupFilter('nope').include.length, 0);
  });

  test('the SQL filter and the in-memory grouping agree on EVERY action', () => {
    /*
     * The bug this locks down, found by querying the real endpoint: the filter
     * runs as `action LIKE 'user.%'` in SQL, which has no notion of the
     * "first match wins" ordering that `auditActionGroup` relies on. So
     * `user.password.reset` was correctly reported as a sign-in event by the
     * label logic and simultaneously returned by the *users* filter — the
     * screen and its own data disagreeing about where a row belongs.
     *
     * Later groups therefore have to exclude the prefixes earlier ones claimed,
     * and the only way to keep the two implementations honest is to assert they
     * classify identically.
     */
    const actions = [
      'auth.login.success',
      'auth.logout.idle',
      'auth.2fa.bypass.success',
      'user.password.reset',
      'user.create',
      'user.update',
      'user.delete',
      'role.update',
      'api_token.revoke',
      'document.update',
      'media.upload',
      'order.status',
      'booking.create',
      'settings.update',
      'seo.meta.upsert',
    ];

    for (const action of actions) {
      const expected = auditActionGroup(action);
      for (const g of AUDIT_ACTION_GROUPS) {
        assert.equal(
          matchesAuditGroup(action, g.key),
          expected === g.key,
          `${action} vs group ${g.key} (grouped as ${expected})`,
        );
      }
    }
  });

  test('a password reset is returned by the sign-in filter and NOT the users filter', () => {
    // The exact symptom, stated as its own case.
    assert.equal(matchesAuditGroup('user.password.reset', 'signin'), true);
    assert.equal(matchesAuditGroup('user.password.reset', 'users'), false);
    assert.equal(matchesAuditGroup('user.update', 'users'), true);
    assert.equal(matchesAuditGroup('user.update', 'signin'), false);
  });

  test('EVERY action this codebase writes belongs to a group', () => {
    /*
     * The coverage guard. An action with no group is invisible to every filter
     * on the screen — the row is in the table but no category shows it, which
     * is a worse failure than having no filter at all because it looks like
     * nothing happened.
     *
     * Read out of the source rather than from a hand-kept list, so adding a
     * `logAudit({ action: '…' })` anywhere fails this test until it is grouped.
     */
    const raw = execFileSync(
      'grep',
      ['-rhoE', "action: '[a-z0-9._]+'", 'src/cms', 'src/app'],
      { encoding: 'utf8' },
    );
    const actions = [
      ...new Set(
        raw
          .split('\n')
          .map((l) => l.replace(/^action: '/, '').replace(/'$/, '').trim())
          .filter((a) => a.includes('.')),
      ),
    ];
    assert.ok(actions.length > 30, `expected to find many actions, found ${actions.length}`);

    const ungrouped = actions.filter((a) => auditActionGroup(a) === null);
    assert.deepEqual(ungrouped, [], `these actions belong to no group: ${ungrouped.join(', ')}`);
  });
});
