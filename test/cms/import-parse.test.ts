import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { resolveCollection, f, type Field } from '@/cms/config';
import {
  extractHeadings,
  headingText,
  parseDocumentMarkdown,
  reservedFieldKeyCollisions,
  slugFromFilename,
} from '@/cms/core/import';

const LOCALES = ['el', 'en'];

/** A miniature collection exercising one field of most kinds. */
function collection(fields: Field[], extra: Record<string, unknown> = {}) {
  return resolveCollection({ key: 'thing', titlePath: 'headline', fields, ...extra });
}

const BODY_FIELD = f.mdx('bodyMdx', { allowedComponents: ['Pillars', 'Pillar'] });

const file = (front: string, body = 'Prose.\n'): string => `---\n${front}\n---\n\n${body}`;

async function parse(fields: Field[], source: string, filename?: string) {
  return parseDocumentMarkdown({ collection: collection(fields), source, filename, locales: LOCALES });
}

describe('field coercion', () => {
  test('text tolerates a number and says so, rather than failing the import', () => {
    // YAML turns an unquoted 2026 into a number; that is the file's syntax, not
    // the author asking for a type change.
    return parse([f.text('headline'), BODY_FIELD], file('headline: 2026')).then((r) => {
      assert.equal(r.errors.length, 0);
      assert.equal(r.document.data.headline, '2026');
      assert.match(r.warnings.map((w) => w.message).join(' '), /stored as text/);
    });
  });

  test('a block where text is expected is an error naming the field', async () => {
    const r = await parse([f.text('headline', { label: 'Title' }), BODY_FIELD], file('headline:\n  a: 1'));
    assert.equal(r.errors.length, 1);
    assert.equal(r.errors[0].path, 'headline');
    assert.match(r.errors[0].message, /Title.*must be text/);
  });

  test('numbers accept a numeric string and refuse anything else', async () => {
    const ok = await parse([f.number('n'), BODY_FIELD], file('n: "12"'));
    assert.equal(ok.document.data.n, 12);
    const bad = await parse([f.number('n'), BODY_FIELD], file('n: twelve'));
    assert.match(bad.errors[0].message, /must be a number/);
  });

  test('booleans accept true/false in both spellings', async () => {
    const r = await parse([f.boolean('b'), BODY_FIELD], file('b: "true"'));
    assert.equal(r.document.data.b, true);
  });

  test('a select names the values it does accept', async () => {
    const field = f.select('tags', { multiple: true, options: [{ value: 'a' }, { value: 'b' }] });
    const r = await parse([field, BODY_FIELD], file('tags: [a, nope]'));
    assert.equal(r.errors.length, 1);
    // Naming the vocabulary is the point: 25 tag values is not something an
    // author can be expected to recall from an "invalid value" message.
    assert.match(r.errors[0].message, /"nope".*Allowed: a, b/);
  });

  test('a single-value select refuses a list', async () => {
    const field = f.select('s', { options: [{ value: 'a' }, { value: 'b' }] });
    const r = await parse([field, BODY_FIELD], file('s: [a, b]'));
    assert.match(r.errors[0].message, /takes a single value/);
  });

  test('dates are read and normalised, nonsense is refused', async () => {
    const r = await parse([f.date('d'), BODY_FIELD], file('d: 2026-08-24'));
    assert.equal(r.document.data.d, '2026-08-24');
    const bad = await parse([f.date('d'), BODY_FIELD], file('d: someday'));
    assert.match(bad.errors[0].message, /is not a date/);
  });

  test('groups and repeaters nest, and paths point at the offending row', async () => {
    const fields = [
      f.group('g', [f.text('a'), f.text('b')]),
      f.repeater('rows', [f.text('label'), f.number('n')]),
      BODY_FIELD,
    ];
    const r = await parse(fields, file('g:\n  a: one\n  b: two\nrows:\n  - label: x\n    n: 1\n  - label: y\n    n: nope'));
    assert.deepEqual(r.document.data.g, { a: 'one', b: 'two' });
    assert.deepEqual((r.document.data.rows as unknown[])[0], { label: 'x', n: 1 });
    assert.equal(r.errors[0].path, 'rows.1.n');
  });

  test('an unknown key is refused by name, with the keys that do exist', async () => {
    // A silently dropped key is how a whole FAQ section goes missing.
    const r = await parse([f.text('headline'), BODY_FIELD], file('headline: x\nheadlien: y'));
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0].message, /no setting called "headlien"/);
    assert.match(r.errors[0].message, /Expected one of: headline/);
  });

  test('images and relations are refused with the reason, not silently dropped', async () => {
    const r = await parse([f.image('hero'), f.relation('author', { to: 'author' }), BODY_FIELD],
      file('hero: some-uuid\nauthor: 4'));
    assert.equal(r.errors.length, 2);
    assert.match(r.errors[0].message, /media library/);
    assert.match(r.errors[1].message, /chosen in the form/);
  });

  test('an explicit null is "left blank", not a value', async () => {
    const r = await parse([f.text('headline'), BODY_FIELD], file('headline:'));
    assert.equal(r.errors.length, 0);
    assert.equal('headline' in r.document.data, false);
  });
});

describe('document settings', () => {
  test('reserved keys go to the row, field keys go to data', async () => {
    const r = await parse([f.text('headline'), BODY_FIELD],
      file('slug: my-post\nlocale: en\nstatus: draft\nmetaTitle: T\nmetaDescription: D\npublishedAt: 2026-08-24\nheadline: H'));
    assert.equal(r.document.slug, 'my-post');
    assert.equal(r.document.locale, 'en');
    assert.equal(r.document.metaTitle, 'T');
    assert.equal(r.document.publishedAt, '2026-08-24');
    assert.deepEqual(r.document.data.headline, 'H');
  });

  test('keys that exist under another name say so', async () => {
    const r = await parse([f.text('headline'), BODY_FIELD], file('canonicalPath: /x\ntranslationGroup: abc'));
    const messages = r.errors.map((e) => e.message).join(' ');
    assert.match(messages, /derived from the slug/);
    assert.match(messages, /other language tab/);
  });

  test('an unknown locale is refused and the real ones are listed', async () => {
    const r = await parse([BODY_FIELD], file('locale: fr'));
    assert.match(r.errors[0].message, /"fr".*el, en/);
    assert.equal(r.document.locale, null);
  });

  test('an unknown status is refused', async () => {
    const r = await parse([BODY_FIELD], file('status: live'));
    assert.match(r.errors[0].message, /draft, published, scheduled, archived/);
  });

  test('scheduled without a date is refused, as it is on write', async () => {
    const r = await parse([BODY_FIELD], file('status: scheduled'));
    assert.match(r.errors.map((e) => e.message).join(' '), /scheduled document needs a publish date/);
  });

  test('a collection with a field named like a document setting is refused outright', () => {
    // Nothing could tell the two meanings apart, so the ambiguity is refused
    // rather than resolved by whichever branch happens to run first.
    assert.deepEqual(reservedFieldKeyCollisions([f.text('slug'), f.text('ok')]), ['slug']);
  });
});

describe('derivations', () => {
  test('the slug comes from the file name when the file does not say', async () => {
    const r = await parse([BODY_FIELD], file('locale: el'), 'my-first-post.el.md');
    assert.equal(r.document.slug, 'my-first-post');
    assert.match(r.warnings.map((w) => w.message).join(' '), /taken from the file name/);
  });

  test('the language comes from the file name suffix', async () => {
    const r = await parse([BODY_FIELD], file('slug: x'), 'x.en.md');
    assert.equal(r.document.locale, 'en');
  });

  test('a suffix that is not a site locale stays part of the slug', () => {
    assert.deepEqual(slugFromFilename('report.v2.md', LOCALES), { slug: 'report-v2', locale: null });
    assert.deepEqual(slugFromFilename('report.el.md', LOCALES), { slug: 'report', locale: 'el' });
  });

  test('a Greek title becomes a readable slug rather than an empty one', async () => {
    const r = await parse([f.text('headline'), BODY_FIELD], file('headline: Μύκονος και ΑΕΟ'));
    assert.equal(r.document.slug, 'mykonos-kai-aeo');
  });

  test('an empty slug: is the template placeholder, not a mistake', async () => {
    const r = await parse([f.text('headline'), BODY_FIELD], file('slug: ""\nheadline: Hello there'));
    assert.equal(r.errors.length, 0);
    assert.equal(r.document.slug, 'hello-there');
  });

  test('a slug that was typed but yields nothing IS a mistake', async () => {
    const r = await parse([BODY_FIELD], file('slug: "!!!"'));
    assert.match(r.errors[0].message, /nothing usable/);
  });

  test('the contents list is derived from the body H2s, with matching anchors', async () => {
    const toc = f.repeater('toc', [f.text('label'), f.text('id')]);
    const r = await parse([toc, BODY_FIELD], file('slug: x', '## Why it matters\n\nA.\n\n## What to do **next**\n\nB.\n'));
    assert.deepEqual(r.document.data.toc, [
      { label: 'Why it matters', id: 'why-it-matters' },
      { label: 'What to do next', id: 'what-to-do-next' },
    ]);
  });

  test('a contents list written by hand is left alone', async () => {
    const toc = f.repeater('toc', [f.text('label'), f.text('id')]);
    const r = await parse([toc, BODY_FIELD], file('toc:\n  - label: Mine\n    id: mine', '## Ignored\n'));
    assert.deepEqual(r.document.data.toc, [{ label: 'Mine', id: 'mine' }]);
  });

  test('an empty contents list means "work it out for me"', async () => {
    // The generated template ships it commented out; an author who uncomments it
    // and leaves it empty is asking for the default, not for no contents box.
    const toc = f.repeater('toc', [f.text('label'), f.text('id')]);
    const r = await parse([toc, BODY_FIELD], file('toc: []', '## One\n'));
    assert.deepEqual(r.document.data.toc, [{ label: 'One', id: 'one' }]);
  });

  test('headings inside a code fence are code, not headings', () => {
    assert.deepEqual(extractHeadings('## Real\n\n```\n## Fake\n```\n\n## Also real\n'), ['Real', 'Also real']);
  });

  test('heading text is stripped to what the page actually renders', () => {
    // The ids must match `src/mdx-components.tsx`, which slugs the flattened
    // TEXT of the heading — so the markup has to come off first.
    assert.equal(headingText('Why **this** matters'), 'Why this matters');
    assert.equal(headingText('Use `npm run dev`'), 'Use npm run dev');
    assert.equal(headingText('See [the docs](https://x.com)'), 'See the docs');
    assert.equal(headingText('A <em>styled</em> word'), 'A styled word');
  });
});

describe('the body', () => {
  test('everything below the closing --- becomes the MDX field', async () => {
    const r = await parse([BODY_FIELD], file('slug: x', '## Heading\n\nProse.\n'));
    assert.equal(r.document.data.bodyMdx, '## Heading\n\nProse.\n');
  });

  test('a leading H1 is removed, in full, with a warning', async () => {
    // An H1 in the body is unstyled, has no anchor, and duplicates the real
    // headline — the same reason the editor offers no H1 button.
    const r = await parse([BODY_FIELD], file('slug: x', '# My Title Here\n\n## Section\n'));
    assert.equal(r.document.data.bodyMdx, '## Section\n');
    assert.match(r.warnings.map((w) => w.message).join(' '), /My Title Here/);
  });

  test('an H2 at the top is left alone', async () => {
    const r = await parse([BODY_FIELD], file('slug: x', '## Section\n\nProse.\n'));
    assert.equal(r.document.data.bodyMdx, '## Section\n\nProse.\n');
  });

  test('a body the MDX guard refuses is reported against the body field', async () => {
    const r = await parse([BODY_FIELD], file('slug: x', '<script>alert(1)</script>\n'));
    assert.equal(r.errors.some((e) => e.path === 'bodyMdx'), true);
  });

  test('an HTML comment is reported — MDX has no such thing', async () => {
    const r = await parse([BODY_FIELD], file('slug: x', '<!-- note -->\n\n## A\n'));
    assert.equal(r.errors.some((e) => e.path === 'bodyMdx'), true);
  });

  test('a collection with no markdown body refuses the text', async () => {
    const r = await parse([f.text('headline')], file('headline: x', 'Prose that has nowhere to go.\n'));
    assert.match(r.errors.map((e) => e.message).join(' '), /no markdown body/);
  });
});

describe('required fields', () => {
  test('a missing required field is a warning, not an error — drafts may be incomplete', async () => {
    const r = await parse([f.text('headline', { required: true }), BODY_FIELD], file('slug: x'));
    assert.equal(r.errors.length, 0);
    assert.match(r.warnings.map((w) => w.message).join(' '), /before this can be published/);
  });

  test('a file with no settings block still imports its body', async () => {
    const r = await parseDocumentMarkdown({
      collection: collection([BODY_FIELD]),
      source: '## Just a body\n',
      locales: LOCALES,
    });
    assert.equal(r.errors.length, 0);
    assert.equal(r.document.data.bodyMdx, '## Just a body\n');
    assert.match(r.warnings.map((w) => w.message).join(' '), /no settings block/);
  });
});
