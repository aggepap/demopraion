import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { addThinSpaceBeforeQuestionPunctuation } from '@/lib/text-utils';
import { cn } from '@/lib/utils';

const THIN = String.fromCharCode(0x2009); // thin space the source inserts

describe('addThinSpaceBeforeQuestionPunctuation', () => {
  test('inserts a thin space before ? and Greek ;', () => {
    assert.equal(addThinSpaceBeforeQuestionPunctuation('What is AEO?'), `What is AEO${THIN}?`);
    assert.equal(addThinSpaceBeforeQuestionPunctuation('Τι είναι το AEO;'), `Τι είναι το AEO${THIN};`);
  });

  test('is idempotent and leaves punctuation-free text untouched', () => {
    const once = addThinSpaceBeforeQuestionPunctuation('What is AEO?');
    assert.equal(addThinSpaceBeforeQuestionPunctuation(once), once);
    assert.equal(addThinSpaceBeforeQuestionPunctuation('Already spaced ?'), 'Already spaced ?');
    assert.equal(addThinSpaceBeforeQuestionPunctuation('No punctuation here'), 'No punctuation here');
  });
});

describe('cn (tailwind-merge)', () => {
  test('later conflicting classes win; falsy values drop', () => {
    assert.equal(cn('p-4', 'p-6'), 'p-6');
    assert.equal(cn('text-sm', false && 'x', 'font-bold'), 'text-sm font-bold');
    assert.equal(cn('p-2', undefined, null), 'p-2');
  });
});
