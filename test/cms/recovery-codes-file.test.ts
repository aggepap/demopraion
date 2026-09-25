/**
 * The downloadable recovery-code file.
 *
 * This is the one artefact of the whole 2FA feature that has to still make
 * sense to someone months later, opened cold out of a Downloads folder with no
 * memory of what it was. A file called `download.txt` containing ten opaque
 * strings is indistinguishable from junk — and the moment it IS needed is the
 * moment its owner has lost their phone and is least able to work it out.
 *
 * So the two things asserted here are that the file names itself and that it
 * says what it is, alongside the obvious one: that every code actually survives
 * into it.
 *
 * Extracted from the component for the same reason `login-error.ts` was: this
 * suite has no DOM harness, and the file body is the part with a way to go
 * wrong.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  recoveryCodesFileText,
  recoveryCodesFilename,
} from '@/cms/admin/recovery-codes-file';

const CODES = ['2CSP-Q79D', 'GPMW-PMAS', 'C62A-YG6M', 'K9QG-EYCA'];
const AT = new Date('2026-08-27T10:30:00Z');

describe('recoveryCodesFilename', () => {
  test('names the site and the day it was generated', () => {
    assert.equal(recoveryCodesFilename('Praion', AT), 'praion-recovery-codes-2026-08-27.txt');
  });

  test('slugifies a site name with spaces and punctuation', () => {
    assert.equal(
      recoveryCodesFilename('A/B: Co & Sons', AT),
      'a-b-co-sons-recovery-codes-2026-08-27.txt',
    );
  });

  test('falls back when the site name slugifies to nothing', () => {
    // A Greek site name has no ASCII to slugify. The file must still be named
    // something, and something that says what it is.
    for (const name of ['', '   ', 'Πράιον', '!!!']) {
      assert.equal(recoveryCodesFilename(name, AT), 'recovery-codes-2026-08-27.txt', name);
    }
  });

  test('never produces a path separator or a leading dot', () => {
    // The value goes straight into a `download` attribute. A name containing a
    // separator is at best ignored and at worst a surprise about where it lands.
    for (const name of ['../../etc', 'a/b\\c', '...']) {
      const out = recoveryCodesFilename(name, AT);
      assert.ok(!/[/\\]/.test(out), out);
      assert.ok(!out.startsWith('.'), out);
    }
  });
});

describe('recoveryCodesFileText', () => {
  const text = recoveryCodesFileText(CODES, { siteName: 'Praion', generatedAt: AT });

  test('contains every code, one per line', () => {
    for (const code of CODES) {
      assert.ok(text.includes(code), `missing ${code}`);
      assert.match(text, new RegExp(`^\\s*${code}\\s*$`, 'm'), `${code} should be on its own line`);
    }
  });

  test('says which site and when, so the file identifies itself', () => {
    assert.match(text, /Praion/);
    assert.match(text, /2026-08-27/);
  });

  test('says the codes are single-use', () => {
    assert.match(text, /once/i);
  });

  test('warns that the file is a credential', () => {
    // Someone who does not realise this will put it in a shared drive.
    assert.match(text, /password/i);
  });

  test('ends with a newline', () => {
    // A file that does not is a file that concatenates badly and looks
    // truncated in half the editors that open it.
    assert.ok(text.endsWith('\n'));
  });

  test('works without a site name', () => {
    const plain = recoveryCodesFileText(CODES, { generatedAt: AT });
    for (const code of CODES) assert.ok(plain.includes(code));
    assert.match(plain, /2026-08-27/);
  });

  test('does not mangle a code by wrapping or indenting it away', () => {
    // The codes are transcribed by hand from this file; every line must be the
    // code and nothing else once trimmed.
    const lines = text.split('\n').map((l) => l.trim());
    assert.equal(CODES.filter((c) => lines.includes(c)).length, CODES.length);
  });
});
