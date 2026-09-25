import '../setup/react-global';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';

import { ButtonLink, safeHref } from '@/components/ui/Button';
import { defaultLocale } from '@/lib/i18n/config';

/**
 * A CTA href is editorial content, so this is the boundary between what an
 * editor typed and what ends up in the DOM.
 *
 * React 19 refuses to emit a `javascript:` href on its own — verified, and
 * asserted below so the day that changes is a failing test rather than a live
 * hole. It is a backstop and not the policy: it does nothing for other schemes,
 * and when it fires it leaves a link whose href is a React error message.
 */
describe('safeHref', () => {
  const GOOD = [
    '/contact',
    '/en/approach',
    '#faq',
    '?page=2',
    'https://example.com',
    'HTTPS://EXAMPLE.COM',
    'mailto:a@b.gr',
    'tel:+302101234567',
  ];
  for (const good of GOOD) {
    test(`keeps ${good}`, () => assert.equal(safeHref(good), good));
  }

  const BAD = [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    // The HTML parser strips control characters before reading the scheme, so a
    // prefix test on the raw string would be fooled by these.
    ' javascript:alert(1)',
    'ja\tvascript:alert(1)',
    'java\nscript:alert(1)',
  ];
  for (const bad of BAD) {
    test(`refuses ${JSON.stringify(bad)}`, () => assert.equal(safeHref(bad), '#'));
  }

  test('an empty or blank href becomes #, never an empty attribute', () => {
    // An empty href resolves to the current page, so a "cleared" CTA would
    // silently reload the page rather than do nothing.
    assert.equal(safeHref(''), '#');
    assert.equal(safeHref('   '), '#');
  });
});

describe('ButtonLink renders no dangerous scheme', () => {
  // Rendered in the site's main language, which is the unprefixed one.
  const render = (href: string, external?: boolean) =>
    renderToStaticMarkup(
      <NextIntlClientProvider locale={defaultLocale} messages={{}}>
        <ButtonLink href={href} external={external} variant="primary" size="md">
          Click
        </ButtonLink>
      </NextIntlClientProvider>,
    );

  for (const external of [false, true]) {
    const name = external ? 'external <a>' : 'next-intl <Link>';

    test(`${name} branch defuses javascript:`, () => {
      const html = render('javascript:alert(1)', external || undefined);
      assert.ok(!html.includes('alert(1)'), 'the payload must not reach the DOM');
      assert.match(html, /href="#"/);
    });

    test(`${name} branch defuses data:`, () => {
      // React does NOT block this one — `safeHref` is the only thing that does.
      const html = render('data:text/html,<script>alert(1)</script>', external || undefined);
      assert.ok(!html.includes('data:text/html'), 'the data: URL must not reach the DOM');
      assert.match(html, /href="#"/);
    });
  }

  test('a normal path still links', () => {
    assert.match(render('/contact'), /href="\/contact"/);
  });

  test('an external http link keeps target/rel, a defused one does not', () => {
    assert.match(render('https://example.com', true), /target="_blank"/);
    assert.ok(!render('javascript:alert(1)', true).includes('target="_blank"'));
  });
});
