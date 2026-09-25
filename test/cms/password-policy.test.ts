/**
 * What counts as a strong enough password, and how strong a given one is.
 *
 * Both answers are needed in two places at once — the zod schema that refuses the
 * body and the form that draws the checklist and the meter — so they live in one
 * dependency-free module rather than being restated on each side and drifting.
 *
 * The rules use unicode classes rather than `[a-z]`/`[A-Z]`. This admin is Greek:
 * `Καλησπέρα` is nine letters with a capital at the front, and an ASCII-only test
 * calls it "no lowercase letter, no uppercase letter" and sends the author back to
 * type something worse.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_RULES,
  passwordProblems,
  passwordStrength,
} from '@/cms/modules/auth/password-policy';

const STRONG = 'Correct-Horse-Battery-9';

describe('passwordProblems', () => {
  test('a password meeting every rule has no problems', () => {
    assert.deepEqual(passwordProblems(STRONG), []);
  });

  test('names each missing piece, and only the missing ones', () => {
    assert.deepEqual(passwordProblems('alllowercase!!'), ['an uppercase letter', 'a number']);
    assert.deepEqual(passwordProblems('ALLUPPERCASE1!'), ['a lowercase letter']);
    assert.deepEqual(passwordProblems('NoSymbolsHere123'), ['a symbol']);
    assert.deepEqual(passwordProblems('Ab1!'), [`at least ${MIN_PASSWORD_LENGTH} characters`]);
  });

  test('refuses the passwords that get tried first, however they are dressed up', () => {
    // Every class rule passes here, which is exactly why the list is needed:
    // "Password1!" is not a strong password because it satisfies a checklist.
    for (const pw of ['Password1!', 'password', 'Qwerty123!', 'Welcome-2024']) {
      assert.ok(
        passwordProblems(pw).includes('not a common password'),
        `${pw} was accepted as uncommon`,
      );
    }
  });

  test('a Greek password is not told it has no letters', () => {
    assert.deepEqual(passwordProblems('Καλησπέρα-Αθήνα-2026!'), []);
  });

  test('counts characters, not UTF-16 units', () => {
    // '🔥' is two code units. Ten of them is not a ten-character password by any
    // reading a person would recognise, and `String.length` says twenty.
    assert.ok(passwordProblems('🔥🔥🔥🔥🔥').includes(`at least ${MIN_PASSWORD_LENGTH} characters`));
  });

  test('every rule carries the label the checklist renders', () => {
    for (const rule of PASSWORD_RULES) {
      assert.equal(typeof rule.label, 'string');
      assert.ok(rule.label.length > 0);
      assert.equal(rule.test(STRONG), true, `${rule.label} rejects a strong password`);
    }
  });
});

describe('passwordStrength', () => {
  test('an empty box scores nothing', () => {
    assert.equal(passwordStrength('').score, 0);
  });

  test('anything short of the policy cannot read above Weak', () => {
    for (const pw of ['Ab1!', 'alllowercase', 'SHORT1!']) {
      assert.ok(passwordStrength(pw).score <= 1, `${pw} scored ${passwordStrength(pw).score}`);
    }
  });

  test('a password attackers try first reads as the worst there is', () => {
    assert.equal(passwordStrength('Password1!').score, 0);
  });

  test('a long, varied password reads as strong', () => {
    assert.equal(passwordStrength(STRONG + '-and-longer!').score, 4);
  });

  test('length is rewarded, and each score has a word for it', () => {
    const short = passwordStrength('Abcdefgh1!');
    const long = passwordStrength('Abcdefgh1!-Abcdefgh1!');
    assert.ok(long.score > short.score, 'a much longer password scored no better');
    for (const pw of ['', 'Ab1!', 'Abcdefgh1!', STRONG, STRONG + '-and-longer!']) {
      const { score, label } = passwordStrength(pw);
      assert.ok(score >= 0 && score <= 4, `score ${score} out of range`);
      assert.equal(typeof label, 'string');
      assert.ok(label.length > 0);
    }
  });

  test('padding one character out to length does not make a password strong', () => {
    assert.ok(passwordStrength('aaaaaaaaaaaaaaaaaaaa').score <= 1);
  });
});
