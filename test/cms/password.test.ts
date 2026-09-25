import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from '@/cms/modules/auth/password';

describe('password hashing', () => {
  test('rejects passwords below the minimum length', async () => {
    await assert.rejects(hashPassword('short'), /at least 10 characters/);
    assert.equal(MIN_PASSWORD_LENGTH, 10);
  });

  test('hash + verify round-trips; wrong password fails', async () => {
    const pw = 'correct-horse-battery';
    const hash = await hashPassword(pw);
    assert.notEqual(hash, pw);
    assert.equal(await verifyPassword(pw, hash), true);
    assert.equal(await verifyPassword('wrong-password-xx', hash), false);
  });

  test('empty inputs and malformed hashes return false', async () => {
    assert.equal(await verifyPassword('', 'whatever'), false);
    assert.equal(await verifyPassword('something', ''), false);
    assert.equal(await verifyPassword('something', 'not-a-bcrypt-hash'), false);
  });
});
