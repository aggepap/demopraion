import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { defaultLocale } from '@/lib/i18n/config';
import { localePath, SITE_URL } from '@/lib/seo/schemas';
import { articlesByAuthor, authorPersonSchema, authorProfileNodes, presentAuthorDoc } from '@/lib/site/authors';

/**
 * Author profiles: the `author` collection at `/authors/{slug}`, the page that
 * `Person.url` points at, so search and answer engines resolve a byline to a
 * person. Everything here reads the CMS document only, and must survive whatever
 * half-filled profile an editor saved.
 */

const doc = (data: Record<string, unknown>, slug = 'ann-lee') => ({ slug, data });

describe('presentAuthorDoc', () => {
  test('maps the profile fields, and the photo to its media URL', () => {
    const view = presentAuthorDoc(
      doc({ name: 'Ann Lee', jobTitle: 'Editor', summary: 'Writes about food.', avatar: 'uuid-1', bio: { type: 'doc' } }),
    );
    assert.equal(view.slug, 'ann-lee');
    assert.equal(view.name, 'Ann Lee');
    assert.equal(view.jobTitle, 'Editor');
    assert.equal(view.summary, 'Writes about food.');
    assert.equal(view.avatarUrl, '/api/cms/media/file/uuid-1');
    assert.deepEqual(view.bio, { type: 'doc' });
  });

  test('a half-filled profile never throws: missing text is empty, lists are empty', () => {
    const view = presentAuthorDoc(doc({ name: 42, profiles: 'nope', experience: null }));
    assert.equal(view.name, '');
    assert.equal(view.jobTitle, undefined);
    assert.equal(view.avatarUrl, undefined);
    assert.deepEqual(view.profiles, []);
    assert.deepEqual(view.experience, []);
    assert.deepEqual(view.knowsAbout, []);
  });

  test('keeps only absolute http(s) profile links, LinkedIn first, without duplicates', () => {
    const view = presentAuthorDoc(
      doc({
        linkedinUrl: 'https://www.linkedin.com/in/ann',
        profiles: [
          { url: 'javascript:alert(1)' },
          { url: '/relative/page' },
          { url: 'https://github.com/ann' },
          { url: 'https://www.linkedin.com/in/ann' },
        ],
      }),
    );
    assert.deepEqual(view.profiles, ['https://www.linkedin.com/in/ann', 'https://github.com/ann']);
  });

  test('drops experience and expertise rows that have no name', () => {
    const view = presentAuthorDoc(
      doc({
        experience: [{ name: 'Acme', url: 'ftp://acme', role: 'Chef' }, { role: 'Nameless' }],
        knowsAbout: [{ name: 'Baking', sameAs: 'https://en.wikipedia.org/wiki/Baking' }, { sameAs: 'https://x.test' }],
      }),
    );
    assert.deepEqual(view.experience, [{ name: 'Acme', url: undefined, role: 'Chef', period: undefined }]);
    assert.deepEqual(view.knowsAbout, [{ name: 'Baking', sameAs: 'https://en.wikipedia.org/wiki/Baking' }]);
  });
});

describe('authorPersonSchema', () => {
  test('is a Person with a stable @id and the profile page as its url', () => {
    const person = authorPersonSchema(presentAuthorDoc(doc({ name: 'Ann Lee', jobTitle: 'Editor' })), defaultLocale);
    assert.equal(person['@type'], 'Person');
    assert.equal(person['@id'], `${SITE_URL}/#person-ann-lee`);
    assert.equal(person.url, `${SITE_URL}${localePath(defaultLocale, '/authors/ann-lee')}`);
    assert.equal(person.jobTitle, 'Editor');
  });

  test('names other profiles in sameAs only when there are some', () => {
    const withProfiles = authorPersonSchema(
      presentAuthorDoc(doc({ name: 'Ann', linkedinUrl: 'https://www.linkedin.com/in/ann' })),
      defaultLocale,
    );
    assert.deepEqual(withProfiles.sameAs, ['https://www.linkedin.com/in/ann']);
    const without = authorPersonSchema(presentAuthorDoc(doc({ name: 'Ann' })), defaultLocale);
    assert.equal('sameAs' in without, false);
  });
});

describe('authorProfileNodes', () => {
  test('a ProfilePage about the Person, and breadcrumbs ending at the author', () => {
    const [page, crumbs] = authorProfileNodes(presentAuthorDoc(doc({ name: 'Ann Lee' })), defaultLocale, 'Home');
    assert.equal(page['@type'], 'ProfilePage');
    assert.equal((page.mainEntity as Record<string, unknown>)['@type'], 'Person');
    assert.equal(crumbs['@type'], 'BreadcrumbList');
    const items = crumbs.itemListElement as { name: string }[];
    assert.deepEqual(
      items.map((i) => i.name),
      ['Home', 'Ann Lee'],
    );
  });
});

describe('articlesByAuthor', () => {
  const article = (slug: string, author: unknown) => ({ slug, data: { title: slug, author } });

  test('keeps the articles whose author is one of this author’s documents, in any language', () => {
    const articles = [article('a', 11), article('b', 12), article('c', 99)];
    // 11 and 12: the author's Greek and English documents.
    assert.deepEqual(
      articlesByAuthor(articles, new Set([11, 12])).map((a) => a.slug),
      ['a', 'b'],
    );
  });

  test('ignores articles with no author, or an author value that is not a document id', () => {
    const articles = [article('none', undefined), article('text', 'eleven'), article('obj', { id: 11 })];
    assert.deepEqual(articlesByAuthor(articles, new Set([11])), []);
  });
});
