/**
 * The preview reducer. Its whole job is ordering, so that is what this covers:
 * Server Actions cannot be aborted, so a reply for text the author has already
 * moved past really does arrive, and really must lose.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  INITIAL_PREVIEW,
  isMdxPreviewField,
  previewKey,
  previewReducer,
  type PreviewState,
} from '@/cms/admin/fields/mdx/preview-state';
import { f } from '@/cms/config';

const KEY = previewKey('# hi', 'el');

/** A pane showing a successfully rendered body. */
const rendered = (): PreviewState =>
  previewReducer(previewReducer(INITIAL_PREVIEW, { type: 'request', seq: 1 }), {
    type: 'reply',
    seq: 1,
    key: KEY,
    result: { status: 'ok', node: 'FIRST' },
  });

describe('preview reducer', () => {
  test('a reply renders and records the key it came from', () => {
    const state = rendered();
    assert.equal(state.node, 'FIRST');
    assert.equal(state.phase, 'ready');
    assert.equal(state.renderedKey, KEY);
  });

  test('a stale reply is dropped', () => {
    let state = rendered();
    state = previewReducer(state, { type: 'request', seq: 2 });
    state = previewReducer(state, {
      type: 'reply',
      seq: 1,
      key: previewKey('stale', 'el'),
      result: { status: 'ok', node: 'STALE' },
    });
    assert.equal(state.node, 'FIRST');
    assert.equal(state.phase, 'pending');
    assert.equal(state.renderedKey, KEY);
  });

  test('a stale failure is dropped too', () => {
    let state = rendered();
    state = previewReducer(state, { type: 'request', seq: 2 });
    state = previewReducer(state, { type: 'failed', seq: 1, message: 'boom' });
    assert.deepEqual(state.messages, []);
  });

  test('an invalid body keeps the last good tree on screen', () => {
    let state = rendered();
    state = previewReducer(state, { type: 'request', seq: 2 });
    state = previewReducer(state, {
      type: 'reply',
      seq: 2,
      key: previewKey('<Pill', 'el'),
      result: { status: 'invalid', messages: ['<Pill> is not an allowed component.'] },
    });
    assert.equal(state.node, 'FIRST', 'the pane must not blank mid-keystroke');
    assert.equal(state.phase, 'invalid');
    assert.deepEqual(state.messages, ['<Pill> is not an allowed component.']);
    // The key does NOT advance, so fixing the typo re-requests rather than
    // short-circuiting against a body that never rendered.
    assert.equal(state.renderedKey, KEY);
  });

  test('an empty body clears the tree', () => {
    let state = rendered();
    state = previewReducer(state, { type: 'request', seq: 2 });
    state = previewReducer(state, {
      type: 'reply',
      seq: 2,
      key: previewKey('', 'el'),
      result: { status: 'empty' },
    });
    assert.equal(state.node, null);
    assert.equal(state.phase, 'ready');
  });

  test('reset drops the tree but keeps the sequence, so in-flight replies still lose', () => {
    let state = rendered();
    state = previewReducer(state, { type: 'request', seq: 2 });
    state = previewReducer(state, { type: 'reset' });
    assert.equal(state.node, null);
    assert.equal(state.renderedKey, null);
    assert.equal(state.seq, 2);
    // The EL reply already in flight must not paint under the EN tab.
    state = previewReducer(state, {
      type: 'reply',
      seq: 1,
      key: KEY,
      result: { status: 'ok', node: 'EL' },
    });
    assert.equal(state.node, null);
  });

  test('denied and throttled surface without destroying the tree', () => {
    for (const result of [{ status: 'denied' }, { status: 'throttled' }] as const) {
      let state = rendered();
      state = previewReducer(state, { type: 'request', seq: 2 });
      state = previewReducer(state, { type: 'reply', seq: 2, key: KEY, result });
      assert.equal(state.node, 'FIRST');
      assert.equal(state.phase, 'error');
      assert.equal(state.messages.length, 1);
    }
  });
});

describe('isMdxPreviewField', () => {
  test('only an f.mdx field with an allow-list opts in', () => {
    assert.equal(isMdxPreviewField(f.mdx('bodyMdx', { allowedComponents: ['Pillars'] })), true);
    // The guard is a no-op without a list, so the editor must not imply one.
    assert.equal(isMdxPreviewField(f.mdx('bodyMdx')), false);
    assert.equal(isMdxPreviewField(f.code('schema', { language: 'json' })), false);
    assert.equal(isMdxPreviewField(f.textarea('summary')), false);
  });
});
