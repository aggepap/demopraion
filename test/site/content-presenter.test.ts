import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { presentEntry } from '@/lib/site/content';

const doc = (data: Record<string, unknown>) => ({ slug: 's', data, publishedAt: null });

describe('presentEntry', () => {
  test('an article shows its title and excerpt', () => {
    const e = presentEntry('article', doc({ title: 'T', excerpt: 'E', cover: 'uuid', body: { type: 'doc' } }));
    assert.equal(e.title, 'T');
    assert.equal(e.summary, 'E');
    assert.equal(e.image, 'uuid');
    assert.equal(e.faq, undefined);
  });

  test('an answer is titled by its question and carries FAQ data', () => {
    const e = presentEntry('answer', doc({ question: 'Q?', shortAnswer: 'A.' }));
    assert.equal(e.title, 'Q?');
    assert.deepEqual(e.faq, { question: 'Q?', answer: 'A.' });
  });

  test('an answer without a short answer offers no FAQ block', () => {
    assert.equal(presentEntry('answer', doc({ question: 'Q?' })).faq, undefined);
  });

  test('a case study shows its industry above the title', () => {
    const e = presentEntry('scenario', doc({ title: 'T', industry: 'Retail', summary: 'S' }));
    assert.equal(e.eyebrow, 'Retail');
    assert.equal(e.summary, 'S');
  });

  test('missing or mistyped fields become empty, never a crash', () => {
    const e = presentEntry('article', doc({ title: 42 }));
    assert.equal(e.title, '');
    assert.equal(e.summary, '');
    assert.equal(e.image, undefined);
    assert.equal(e.publishedAt, null);
  });
});
