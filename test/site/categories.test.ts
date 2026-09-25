import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildTermTree, presentTerm } from '@/lib/site/content';

const term = (id: number, slug: string, data: Record<string, unknown>) => ({ id, slug, data });

describe('presentTerm', () => {
  test('resolves the localized title and description for the locale', () => {
    const t = presentTerm(term(1, 'tips', { title: { el: 'Συμβουλές', en: 'Tips' }, description: { en: 'Short ones.' } }), 'en');
    assert.deepEqual(t, { id: 1, slug: 'tips', title: 'Tips', description: 'Short ones.', parentId: null });
  });

  test('falls back to another locale, then the slug, and never crashes on bad data', () => {
    assert.equal(presentTerm(term(1, 'tips', { title: { el: 'Συμβουλές' } }), 'en').title, 'Συμβουλές');
    assert.equal(presentTerm(term(1, 'tips', { title: 42 }), 'en').title, 'tips');
    assert.equal(presentTerm(term(1, 'tips', {}), 'en').description, '');
  });

  test('keeps a numeric parent id only', () => {
    assert.equal(presentTerm(term(2, 'child', { parent: 1 }), 'en').parentId, 1);
    assert.equal(presentTerm(term(2, 'child', { parent: '1' }), 'en').parentId, null);
  });
});

describe('buildTermTree', () => {
  const p = (id: number, title: string, parentId: number | null = null) => ({ id, slug: `s${id}`, title, description: '', parentId });

  test('nests children under their parent, both levels sorted by title', () => {
    const tree = buildTermTree([p(3, 'Zeta', 1), p(1, 'Beta'), p(2, 'Alpha'), p(4, 'Eta', 1)]);
    assert.deepEqual(
      tree.map((n) => [n.term.title, n.children.map((c) => c.term.title)]),
      [
        ['Alpha', []],
        ['Beta', ['Eta', 'Zeta']],
      ],
    );
  });

  test('a term whose parent is not listed (unpublished) shows at the top level', () => {
    const tree = buildTermTree([p(2, 'Orphan', 99)]);
    assert.equal(tree.length, 1);
    assert.equal(tree[0].term.title, 'Orphan');
  });

  test('a self-parent or a cycle cannot hide terms or recurse forever', () => {
    const tree = buildTermTree([p(1, 'Self', 1), p(2, 'A', 3), p(3, 'B', 2)]);
    const all = (nodes: typeof tree): string[] => nodes.flatMap((n) => [n.term.title, ...all(n.children)]);
    assert.deepEqual(all(tree).sort(), ['A', 'B', 'Self']);
  });

  test('an empty list is an empty tree', () => {
    assert.deepEqual(buildTermTree([]), []);
  });
});
