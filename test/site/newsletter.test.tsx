import '../setup/react-global';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';

import { NewsletterProvider } from '@/components/layout/NewsletterProvider';
import { HomeNewsletter } from '@/components/site/HomeNewsletter';
import { showFooterNewsletter } from '@/lib/site/newsletter-placement';

import en from '../../messages/en.json';

/**
 * The newsletter signup has one place per page: a prominent section on the home
 * page, and the footer band everywhere else. Both follow the newsletter module —
 * switched off in Admin → Settings → Modules, neither renders.
 */

const render = (enabled: boolean) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={en}>
      <NewsletterProvider enabled={enabled}>
        <HomeNewsletter />
      </NewsletterProvider>
    </NextIntlClientProvider>,
  );

describe('home page newsletter section', () => {
  test('renders nothing at all while the module is off — no empty section is left behind', () => {
    assert.equal(render(false), '');
  });

  test('asks for an email address under the home headline while the module is on', () => {
    const html = render(true);
    assert.ok(html.includes('<section'), 'expected its own section on the page');
    assert.ok(html.includes(en.home.newsletter.headline), 'expected the home headline');
    assert.match(html, /type="email"/);
  });

  test('the home page includes it', () => {
    const home = readFileSync(join(process.cwd(), 'src/app/[locale]/page.tsx'), 'utf8');
    assert.match(home, /<HomeNewsletter\s*\/>/);
  });
});

describe('footer newsletter placement', () => {
  test('the footer band steps aside on the home page, which has its own section', () => {
    assert.equal(showFooterNewsletter('/'), false);
  });

  test('every other page keeps the footer band', () => {
    for (const path of ['/about', '/contact', '/shop/sample-product', '/blog']) {
      assert.equal(showFooterNewsletter(path), true, path);
    }
  });
});
