import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  BASE_PALETTE,
  BRAND_IDENTITY_KEY,
  BRAND_PALETTE_KEY,
  PALETTE_TOKENS,
  contrastRatio,
  paletteCss,
  parseBrandIdentity,
  parsePalette,
  resolveBrand,
} from '@/cms/core/brand/policy';
import { defineConfig } from '@/cms/config/config';
import { defineCollection } from '@/cms/config/collection';
import { f } from '@/cms/config/fields';
import { parseThemeColors, planBrandImport } from '@/cms/core/brand/import';
import { applyEmailBrand, emailColor } from '@/cms/core/email/brand';
import { EXTRA_MANAGED_KEYS } from '@/cms/core/settings/schema';
import { checkStructuredSetting } from '@/cms/core/settings/structured';

/**
 * Branding lives in the database, not in files a CMS update might touch.
 *
 * The site name, contact details, logo and every colour token are content the
 * owner edits in Admin → Settings → Branding. Code keeps only the defaults a
 * fresh or unreachable database falls back to, so an update of the core can
 * never repaint a live site.
 */

const UUID = '0b6f0d4e-6a1e-4c55-9d47-1f3b2a9c8e11';

const identity = (over: Record<string, unknown> = {}) => ({
  name: 'Acme',
  legalName: 'Acme Ltd',
  tagline: 'Things, well made',
  email: 'hello@acme.test',
  phone: '+30 210 000 0000',
  address: { street: '1 Main St', city: 'Athens', postcode: '10557', country: 'GR' },
  socials: { instagram: 'https://instagram.com/acme' },
  logoId: UUID,
  logoDarkId: null,
  faviconId: null,
  ogImageId: null,
  ...over,
});

const check = (key: string, value: unknown) => checkStructuredSetting(key, value)!;

describe('brand settings — write allowlist', () => {
  test('both brand keys may be written through the settings API', () => {
    assert.ok(EXTRA_MANAGED_KEYS.includes(BRAND_IDENTITY_KEY));
    assert.ok(EXTRA_MANAGED_KEYS.includes(BRAND_PALETTE_KEY));
  });
});

describe('brand settings — identity validation', () => {
  test('a well-formed identity is accepted', () => {
    const res = check(BRAND_IDENTITY_KEY, identity());
    assert.equal(res.ok, true);
  });

  test('an empty name is refused, naming the field', () => {
    const res = check(BRAND_IDENTITY_KEY, identity({ name: '  ' }));
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.message, /name/);
  });

  test('a malformed email is refused', () => {
    const res = check(BRAND_IDENTITY_KEY, identity({ email: 'not-an-email' }));
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.message, /email/);
  });

  test('an empty email is allowed — not every site publishes one', () => {
    assert.equal(check(BRAND_IDENTITY_KEY, identity({ email: '' })).ok, true);
  });

  test('a social link that is not http(s) is refused', () => {
    const res = check(BRAND_IDENTITY_KEY, identity({ socials: { x: 'javascript:alert(1)' } }));
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.message, /socials/);
  });

  test('a media reference that is not a UUID is refused', () => {
    const res = check(BRAND_IDENTITY_KEY, identity({ logoId: '../../etc/passwd' }));
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.message, /logoId/);
  });

  test('an unknown key is refused rather than stored', () => {
    assert.equal(check(BRAND_IDENTITY_KEY, identity({ isAdmin: true })).ok, false);
  });
});

describe('brand settings — palette validation', () => {
  test('a full palette is accepted and normalised to lowercase', () => {
    const upper = Object.fromEntries(Object.entries(BASE_PALETTE).map(([k, v]) => [k, v.toUpperCase()]));
    const res = check(BRAND_PALETTE_KEY, upper);
    assert.equal(res.ok, true);
    if (res.ok) assert.deepEqual(res.value, BASE_PALETTE);
  });

  test('a partial palette is accepted', () => {
    assert.equal(check(BRAND_PALETTE_KEY, { 'warm-gold': '#b8873b' }).ok, true);
  });

  test('a value that is not #rrggbb is refused, naming the token', () => {
    const res = check(BRAND_PALETTE_KEY, { 'warm-gold': 'red' });
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.message, /warm-gold/);
  });

  test('a value that tries to break out of the stylesheet is refused', () => {
    const res = check(BRAND_PALETTE_KEY, { 'warm-gold': '#fff}</style><script>alert(1)</script>' });
    assert.equal(res.ok, false);
  });

  test('a token the site has no utility for is refused', () => {
    assert.equal(check(BRAND_PALETTE_KEY, { 'hot-pink': '#ff00ff' }).ok, false);
  });
});

describe('brand read layer — identity', () => {
  const defaults = { name: 'From code', email: 'code@acme.test', tagline: 'Code tagline' };

  test('with nothing stored, the code defaults are used', () => {
    const got = parseBrandIdentity(null, defaults);
    assert.equal(got.name, 'From code');
    assert.equal(got.email, 'code@acme.test');
    assert.equal(got.logoId, null);
    assert.deepEqual(got.socials, {});
  });

  test('stored values win over the code defaults', () => {
    const got = parseBrandIdentity(identity({ tagline: '' }), defaults);
    assert.equal(got.name, 'Acme');
    assert.equal(got.tagline, '', 'a cleared field stays cleared');
  });

  test('a stored value that no longer validates falls back to the defaults', () => {
    const got = parseBrandIdentity({ name: 42 }, defaults);
    assert.equal(got.name, 'From code');
  });

  test('with no defaults and nothing stored, the name is still a string', () => {
    assert.equal(typeof parseBrandIdentity(undefined).name, 'string');
  });
});

describe('brand read layer — palette', () => {
  test('stored tokens are laid over the base palette', () => {
    const got = parsePalette({ 'warm-gold': '#b8873b' });
    assert.equal(got['warm-gold'], '#b8873b');
    assert.equal(got['midnight-navy'], BASE_PALETTE['midnight-navy']);
  });

  test('invalid stored entries are dropped instead of reaching a stylesheet', () => {
    const got = parsePalette({ 'warm-gold': 'url(x)', nope: '#000000' });
    assert.equal(got['warm-gold'], BASE_PALETTE['warm-gold']);
    assert.equal((got as Record<string, string>).nope, undefined);
  });

  test('every token the stylesheet defines is in the palette', () => {
    assert.deepEqual(Object.keys(BASE_PALETTE).sort(), PALETTE_TOKENS.map((t) => t.key).sort());
  });
});

describe('brand read layer — palette CSS', () => {
  test('nothing stored emits nothing, so the stylesheet keeps its own values', () => {
    assert.equal(paletteCss(null), '');
    assert.equal(paletteCss({}), '');
  });

  test('stored tokens become CSS variables on :root', () => {
    assert.equal(paletteCss({ 'warm-gold': '#B8873B' }), ':root{--color-warm-gold:#b8873b;}');
  });

  test('only known tokens with valid values are emitted', () => {
    const css = paletteCss({ 'warm-gold': '#fff}</style>', nope: '#000000', error: '#b91c1c' });
    assert.equal(css, ':root{--color-error:#b91c1c;}');
  });
});

describe('brand read layer — resolved brand', () => {
  test('media references become public file URLs', () => {
    const brand = resolveBrand(parseBrandIdentity(identity()), parsePalette(null));
    assert.equal(brand.logoUrl, `/api/cms/media/file/${UUID}`);
    assert.equal(brand.logoDarkUrl, null);
    assert.equal(brand.faviconUrl, null);
  });

  test('the phone link is derived from the phone number', () => {
    const brand = resolveBrand(parseBrandIdentity(identity()), parsePalette(null));
    assert.equal(brand.phoneHref, '+302100000000');
  });
});

describe('contrast', () => {
  test('black on white is the maximum 21:1', () => {
    assert.equal(Math.round(contrastRatio('#000000', '#ffffff')), 21);
  });

  test('the base palette text passes AA on the page background', () => {
    assert.ok(contrastRatio(BASE_PALETTE['text-primary'], BASE_PALETTE['soft-pearl']) >= 4.5);
    assert.ok(contrastRatio(BASE_PALETTE['warm-gold-deep'], BASE_PALETTE['soft-pearl']) >= 4.5);
  });
});

describe('brand import — reading the existing stylesheet', () => {
  const css = `@import 'tailwindcss';
@theme {
  /* Ink */
  --color-midnight-navy: #1B2430;
  --color-warm-gold: #b8873b;
  --color-something-else: #123456;
  --font-display: var(--font-inter), system-ui;
}
body { --color-warm-gold: #000000; }`;

  test('the colour tokens are read from the @theme block only', () => {
    assert.deepEqual(parseThemeColors(css), { 'midnight-navy': '#1b2430', 'warm-gold': '#b8873b' });
  });

  test('a stylesheet with no @theme block yields nothing', () => {
    assert.deepEqual(parseThemeColors('body{}'), {});
  });
});

describe('brand import — only what is missing', () => {
  const brandFile = {
    name: 'Acme',
    legalName: 'Acme Ltd',
    tagline: '',
    email: 'hello@acme.test',
    phone: '',
    address: { street: '', city: '', postcode: '', country: '' },
    socials: {},
  };

  test('an empty database gets both keys', () => {
    const plan = planBrandImport({
      storedIdentity: null,
      storedPalette: null,
      brandFile,
      themeColors: { 'warm-gold': '#b8873b' },
    });
    assert.equal(plan.identity?.name, 'Acme');
    assert.deepEqual(plan.palette, { ...BASE_PALETTE, 'warm-gold': '#b8873b' });
  });

  test('keys already edited in the admin are never overwritten', () => {
    const plan = planBrandImport({
      storedIdentity: identity(),
      storedPalette: { 'warm-gold': '#000000' },
      brandFile,
      themeColors: { 'warm-gold': '#b8873b' },
    });
    assert.equal(plan.identity, undefined);
    assert.equal(plan.palette, undefined);
  });

  test('what it plans to write passes the same validation as an admin save', () => {
    const plan = planBrandImport({ storedIdentity: null, storedPalette: null, brandFile, themeColors: {} });
    assert.equal(check(BRAND_IDENTITY_KEY, plan.identity).ok, true);
    assert.equal(check(BRAND_PALETTE_KEY, plan.palette).ok, true);
  });
});

describe('email branding', () => {
  const palette = { ...BASE_PALETTE, 'midnight-navy': '#1b2430' };

  test('colour placeholders are replaced with the brand palette', () => {
    const html = `<a style="background:${emailColor('midnight-navy')}">Go</a>`;
    assert.equal(applyEmailBrand(html, { name: 'Acme', logoUrl: null, palette }), '<a style="background:#1b2430">Go</a>');
  });

  test('with no logo the body is otherwise untouched', () => {
    const html = '<p>Hello</p>';
    assert.equal(applyEmailBrand(html, { name: 'Acme', logoUrl: null, palette }), html);
  });

  test('a logo is placed at the top, with the brand name as its alt text', () => {
    const out = applyEmailBrand('<p>Hello</p>', { name: 'Acme', logoUrl: 'https://acme.test/logo.png', palette });
    assert.match(out, /^<div[^>]*><img src="https:\/\/acme\.test\/logo\.png" alt="Acme"/);
    assert.ok(out.endsWith('<p>Hello</p>'));
  });

  test('in a full document the logo goes inside the body', () => {
    const out = applyEmailBrand('<!doctype html><html><body style="x"><p>Hi</p></body></html>', {
      name: 'Acme',
      logoUrl: 'https://acme.test/logo.png',
      palette,
    });
    assert.match(out, /<body style="x"><div[^>]*><img /);
  });

  test('the brand name is escaped in the logo alt text', () => {
    const out = applyEmailBrand('<p>x</p>', { name: '"><script>', logoUrl: 'https://acme.test/l.png', palette });
    assert.ok(!out.includes('<script>'));
  });
});

describe('brand defaults in the CMS config', () => {
  const base = {
    locales: ['en'],
    defaultLocale: 'en',
    collections: [defineCollection({ key: 'page', label: 'Page', fields: [f.text('title')] })],
  };

  test('the code defaults travel with the config, so the core never imports a site file', () => {
    const config = defineConfig({ ...base, name: 'Acme', brand: { tagline: 'Well made', email: 'a@acme.test' } });
    assert.equal(config.brand.name, 'Acme');
    assert.equal(config.brand.tagline, 'Well made');
  });

  test('a config with no brand still names the site', () => {
    assert.equal(defineConfig({ ...base, name: 'Acme' }).brand.name, 'Acme');
  });
});
