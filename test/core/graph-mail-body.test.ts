/**
 * Which body a Graph message carries.
 *
 * Graph's `sendMail` takes one body. Both senders always sent `html` and dropped
 * `text` on the floor, so a text-only mail went out empty. HTML wins when there
 * is any; otherwise the text goes as `Text`.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

import { graphMailBody } from '@/cms/core/email/format';

describe('graphMailBody', () => {
  test('HTML when there is HTML', () => {
    assert.deepEqual(graphMailBody({ html: '<p>Hi</p>', text: 'Hi' }), { contentType: 'HTML', content: '<p>Hi</p>' });
  });

  test('the text, as Text, when there is no HTML', () => {
    assert.deepEqual(graphMailBody({ html: '', text: 'Hi' }), { contentType: 'Text', content: 'Hi' });
    assert.deepEqual(graphMailBody({ text: 'Hi' }), { contentType: 'Text', content: 'Hi' });
  });

  test('neither is an error, not an empty email', () => {
    assert.throws(() => graphMailBody({ html: '', text: '' }));
  });
});

describe('wiring', () => {
  test('the core sender builds its body with it', () => {
    const src = readFileSync('src/cms/core/email/graph.ts', 'utf8');
    assert.match(src, /graphMailBody\(/);
  });

  test('/api/contact sends through the core sender, so it gets the brand', () => {
    const src = readFileSync('src/app/api/contact/route.ts', 'utf8');
    assert.match(src, /import \{ sendGraphMail \} from '@\/cms\/core\/email'/);
  });
});
