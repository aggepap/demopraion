import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createUserBody, normalizeEmail } from '@/cms/core/users/schema';

/**
 * Sign-in looks accounts up by the trimmed, lowercased email. An account stored
 * as `Ann@Example.com` is only found by that lookup because MySQL's collation is
 * case-insensitive — on any other dialect it could never sign in. So the address
 * is normalised on the way in, the same way the lookup normalises it.
 */
describe('admin account emails', () => {
  test('normalizeEmail trims and lowercases', () => {
    assert.equal(normalizeEmail('  Ann.Lee@Example.COM '), 'ann.lee@example.com');
  });

  test('createUserBody stores the normalised form', () => {
    const parsed = createUserBody.parse({
      email: '  Ann.Lee@Example.COM ',
      name: 'Ann',
      password: 'Correct-Horse-Battery-9',
      roleIds: [1],
    });
    assert.equal(parsed.email, 'ann.lee@example.com');
  });
});
