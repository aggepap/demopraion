import '../setup/react-global';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { ScriptsManager, type SnippetRow } from '@/cms/admin/ScriptsManager';
import { DEFAULT_ROLES } from '@/cms/db/seeds/roles';
import { PERMISSIONS } from '@/cms/modules/auth/permissions';

/** Admin → Scripts: the list an administrator copies shortcodes from. */

const row = (over: Partial<SnippetRow>): SnippetRow => ({
  id: 1,
  slug: 'chat-widget',
  name: 'Chat widget',
  kind: 'inline',
  code: 'x()',
  src: null,
  lazy: false,
  consentCategory: null,
  enabled: true,
  notes: null,
  ...over,
});

const categories = [
  { key: 'analytics', name: 'Analytics' },
  { key: 'marketing', name: 'Marketing' },
];

const render = (rows: SnippetRow[]) =>
  renderToStaticMarkup(<ScriptsManager initial={rows} categories={categories} />);

describe('ScriptsManager', () => {
  test('an empty list says how to start', () => {
    assert.match(render([]), /No script snippets yet/);
  });

  test('each row offers the shortcode to copy', () => {
    assert.match(render([row({})]), /\[script name=&quot;chat-widget&quot;\]/);
  });

  test('says whether a snippet waits for consent, and for which category', () => {
    const html = render([row({}), row({ id: 2, slug: 'ga-extra', consentCategory: 'analytics' })]);
    assert.match(html, /Runs without consent/);
    assert.match(html, /After consent: Analytics/);
  });

  test('an external snippet names the host the security policy must allow', () => {
    const html = render([row({ kind: 'external', code: null, src: 'https://widget.example.com/a.js' })]);
    assert.match(html, /https:\/\/widget\.example\.com/);
    assert.match(html, /Content-Security-Policy/);
  });

  test('a disabled snippet is marked as such', () => {
    assert.match(render([row({ enabled: false })]), /Disabled/);
  });
});

describe('the scripts permission', () => {
  test('exists as its own key', () => {
    assert.equal(PERMISSIONS.scriptsManage, 'cms.scripts.manage');
  });

  test('is not given to editors by default — running JS on the site is not an editorial act', () => {
    const editor = DEFAULT_ROLES.find((role) => role.name === 'editor');
    assert.ok(editor);
    assert.equal(editor.permissions.includes(PERMISSIONS.scriptsManage), false);
  });
});
