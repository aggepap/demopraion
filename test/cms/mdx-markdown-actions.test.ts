/**
 * The toolbar transforms. These are pure so they can be tested without a DOM;
 * the editor only applies what they return.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  applyAction,
  applyEditToString,
  applyLink,
  continueList,
  type MdAction,
  type Sel,
} from '@/cms/admin/fields/mdx/markdown-actions';

/** `|` marks a caret, `[…]` a selection. Returns the resulting string, with
 *  the new selection marked the same way — so a case reads as before → after. */
function run(action: MdAction, marked: string): string {
  const sel = parse(marked);
  const edit = applyAction(action, sel);
  return mark(applyEditToString(sel.value, edit), edit.selStart, edit.selEnd);
}

function parse(marked: string): Sel {
  if (marked.includes('[')) {
    const start = marked.indexOf('[');
    const end = marked.indexOf(']') - 1;
    return { value: marked.replace('[', '').replace(']', ''), start, end };
  }
  return { value: marked.replace('|', ''), start: marked.indexOf('|'), end: marked.indexOf('|') };
}

function mark(value: string, start: number, end: number): string {
  if (start === end) return `${value.slice(0, start)}|${value.slice(start)}`;
  return `${value.slice(0, start)}[${value.slice(start, end)}]${value.slice(end)}`;
}

describe('markdown actions', () => {
  test('bold wraps a selection and unwraps it again', () => {
    // The selection stays on the words, not the markers, so the author can
    // keep typing over what they just emphasised.
    assert.equal(run('bold', 'make [this] bold'), 'make **[this]** bold');
    // The selection after wrapping is the text, not the markers — so pressing
    // the button twice must return to the original.
    assert.equal(run('bold', 'make **[this]** bold'), 'make [this] bold');
    assert.equal(run('bold', 'make [**this**] bold'), 'make [this] bold');
  });

  test('bold on an empty selection leaves the caret between the markers', () => {
    assert.equal(run('bold', 'type | here'), 'type **|** here');
  });

  test('italic does not mistake bold markers for its own', () => {
    assert.equal(run('italic', '[word]'), '*[word]*');
  });

  test('h2 replaces any existing heading level and toggles off', () => {
    assert.equal(run('h2', '### Deep|'), '[## Deep]');  // converts, does not clear
    assert.equal(run('h2', '## Already|'), '[Already]');
    assert.equal(run('h2', 'Plain|'), '[## Plain]');
  });

  test('bullet applies across every selected line and skips blanks', () => {
    assert.equal(run('bullet', '[one\n\ntwo]'), '[- one\n\n- two]');
  });

  test('bullet toggles off only when every line is already a bullet', () => {
    assert.equal(run('bullet', '[- one\n- two]'), '[one\ntwo]');
    // One unmarked line means "the author wants a list", not "undo".
    assert.equal(run('bullet', '[- one\ntwo]'), '[- one\n- two]');
  });

  test('ordered renumbers sequentially and converts bullets', () => {
    assert.equal(run('ordered', '[- a\n- b\n- c]'), '[1. a\n2. b\n3. c]');
  });

  test('list prefixes preserve indentation inside a component scaffold', () => {
    // The selection covers whole lines, so it starts at column 0.
    assert.equal(run('bullet', '    [one\n    two]'), '[    - one\n    - two]');
  });

  test('inline code stays inline; a multi-line selection becomes a fence', () => {
    assert.equal(run('code', '[npm test]'), '`[npm test]`');
    assert.equal(run('code', '[a\nb]'), '```\n[a\nb]\n```');
  });

  test('quote toggles', () => {
    assert.equal(run('quote', '[said]'), '[> said]');
    assert.equal(run('quote', '[> said]'), '[said]');
  });

  test('indent and outdent shift by one level', () => {
    assert.equal(run('indent', '[a\nb]'), '[  a\n  b]');
    assert.equal(run('outdent', '[  a\n  b]'), '[a\nb]');
    assert.equal(run('outdent', '[a]'), '[a]');
  });

  test('a link reuses the selection as its label', () => {
    const sel = parse('see [pricing] now');
    const edit = applyLink(sel, 'pricing', '/pricing');
    assert.equal(applyEditToString(sel.value, edit), 'see [pricing](/pricing) now');
  });

  describe('Enter continuation', () => {
    const after = (marked: string): string | null => {
      const sel = parse(marked);
      const edit = continueList(sel);
      return edit === null ? null : applyEditToString(sel.value, edit);
    };

    test('continues bullets, quotes and numbers', () => {
      assert.equal(after('- one|'), '- one\n- ');
      assert.equal(after('> quoted|'), '> quoted\n> ');
      assert.equal(after('2. two|'), '2. two\n3. ');
    });

    test('keeps indentation, so a list inside a <Pillar> stays put', () => {
      assert.equal(after('    - one|'), '    - one\n    - ');
    });

    test('an empty marker ends the list instead of continuing forever', () => {
      assert.equal(after('- one\n- |'), '- one\n');
    });

    test('plain prose is left alone', () => {
      assert.equal(after('just text|'), null);
      // A selection is a replacement, not a continuation.
      assert.equal(after('- [one]'), null);
    });
  });
});
