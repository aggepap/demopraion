import '../setup/react-global'; // must precede any component import

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { RichText } from '@/components/cms/RichText';

const doc = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Hello ' },
        { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
        { type: 'text', text: ' and ' },
        { type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: 'https://x.test' } }] },
      ],
    },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Heading' }] },
    {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] },
      ],
    },
  ],
};

describe('RichText (TipTap → HTML)', () => {
  const html = renderToStaticMarkup(<RichText value={doc} />);

  test('renders paragraphs, bold and links', () => {
    assert.match(html, /Hello/);
    assert.match(html, /<strong>bold<\/strong>/);
    assert.match(html, /<a[^>]+href="https:\/\/x\.test"[^>]*>link<\/a>/);
  });

  test('renders headings and lists', () => {
    assert.match(html, /<h2[^>]*>Heading<\/h2>/);
    assert.match(html, /<ul[^>]*>[\s\S]*<li>/);
  });

  test('returns nothing for empty / invalid input', () => {
    assert.equal(renderToStaticMarkup(<RichText value={null} />), '');
    assert.equal(renderToStaticMarkup(<RichText value={{ type: 'doc', content: [] }} />), '');
  });
});
