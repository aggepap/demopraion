import '../setup/react-global';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext, type AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { PathnameContext, SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';

import { ApiTokensManager } from '@/cms/admin/ApiTokensManager';
import { CookiesManager } from '@/cms/admin/CookiesManager';
import { CustomFieldsManager } from '@/cms/admin/CustomFieldsManager';
import { PermissionPicker } from '@/cms/admin/RolesManager';
import { ScriptsManager } from '@/cms/admin/ScriptsManager';
import { SubmissionsTable } from '@/cms/admin/SubmissionsTable';
import { EditUserPanel, UsersManager } from '@/cms/admin/UsersManager';
import { SeoManager, STATUS_CODE_HELP } from '@/cms/admin/SeoManager';
import { SettingField, SettingsForm } from '@/cms/admin/SettingsForm';
import { StructuredDataSettings } from '@/cms/admin/StructuredDataSettings';
import { SubscribersTable } from '@/cms/admin/SubscribersTable';
import { MODULE_LABELS, type SettingFieldDef } from '@/cms/core/settings/schema';
import { SCHEMA_CATEGORIES, parseSchemaPolicy } from '@/cms/core/structured-data/policy';
import { ALL_PERMISSIONS } from '@/cms/modules/auth/permissions';
import { permissionDescription, permissionLabel } from '@/cms/modules/auth/permission-labels';

/**
 * The "i" explanations on the settings and system screens.
 *
 * What is pinned is where each explanation lives: behind a tip, tied to its
 * control by `aria-describedby`, and never swallowed into a control's name —
 * while warnings about consequences stay printed on the page.
 */

const idsIn = (html: string, attr: string) =>
  [...html.matchAll(new RegExp(`${attr}="([^"]+)"`, 'g'))].flatMap((m) => m[1].split(' '));

function assertDescribedByResolves(html: string) {
  const ids = new Set(idsIn(html, 'id'));
  for (const id of idsIn(html, 'aria-describedby')) assert.ok(ids.has(id), `aria-describedby points at missing id "${id}"`);
}

/** HTML-escape the way React does for text, so plain strings can be searched for. */
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

const tooltips = (html: string) =>
  [...html.matchAll(/role="tooltip"[^>]*>([\s\S]*?)<\/span>/g)].map((m) => m[1]);

/** next/navigation hooks need the app router's contexts; this is the least of them. */
function withRouter(children: ReactNode, search = '') {
  const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} } as unknown as AppRouterInstance;
  return createElement(
    AppRouterContext.Provider,
    { value: router },
    createElement(
      PathnameContext.Provider,
      { value: '/admin/settings' },
      createElement(SearchParamsContext.Provider, { value: new URLSearchParams(search) }, children),
    ),
  );
}

describe('Roles → permission picker', () => {
  const html = renderToStaticMarkup(
    <PermissionPicker
      assignable={['*', ...ALL_PERMISSIONS]}
      selected={['cms.access']}
      onChange={() => {}}
      idPrefix="t"
    />,
  );

  test('every permission has its explanation behind an "i"', () => {
    for (const key of ALL_PERMISSIONS) {
      assert.ok(html.includes(esc(permissionDescription(key))), `${key} has no tip on the screen`);
    }
    assert.ok(html.includes(esc(permissionDescription('*'))), 'Full access has no tip');
  });

  test('each checkbox is described by its own tip', () => {
    assertDescribedByResolves(html);
    for (const key of ALL_PERMISSIONS) {
      const input = html.match(new RegExp(`<input[^>]*id="t-${key.replace(/\./g, '\\.')}"[^>]*>`));
      assert.ok(input, `${key} checkbox missing`);
      assert.match(input[0], /aria-describedby="[^"]+"/, `${key} checkbox is not described`);
    }
  });

  test('the tip stays out of the checkbox label, so the name is still just the label', () => {
    // `getByLabel('View content', { exact: true })` is how the roles QA spec ticks a box.
    const label = html.match(/<label[^>]*for="t-cms\.content\.read"[^>]*>([\s\S]*?)<\/label>/);
    assert.ok(label);
    assert.doesNotMatch(label[1], /role="tooltip"/);
    assert.match(label[1], new RegExp(esc(permissionLabel('cms.content.read'))));
  });

  test('no tip is a tab stop of its own', () => {
    assert.doesNotMatch(html, /<button/);
  });
});

describe('SEO → redirects and overrides', () => {
  const html = renderToStaticMarkup(<SeoManager redirects={[]} notFounds={[]} metas={[]} />);

  test('every status code is explained in plain words', () => {
    for (const code of [301, 302, 307, 308] as const) {
      assert.ok(STATUS_CODE_HELP[code].help.length > 20);
      assert.ok(html.includes(esc(STATUS_CODE_HELP[code].help)), `${code} not explained on screen`);
    }
    assert.match(html, /301 — permanent/);
  });

  test('the table headers carry tips as buttons', () => {
    assert.match(html, /Hits[\s\S]*?<button[^>]*aria-label="About hits"/);
    assert.match(html, /aria-label="About the 404 monitor"/);
  });

  test('the override fields are labelled and explained', () => {
    for (const label of ['Robots', 'Canonical URL', 'OG image URL', 'Path', 'Language']) {
      assert.match(html, new RegExp(`<label[^>]*for="[^"]+"[^>]*>${label}<`), `${label} has no label`);
    }
    assert.ok(tooltips(html).some((t) => /noindex/.test(t)), 'Robots is not explained');
    assertDescribedByResolves(html);
  });

  test('the regex warning stays visible, not behind a tip', () => {
    assert.match(html, /<p id="redirect-kind-hint"/);
  });
});

describe('Settings', () => {
  test('a boolean setting puts its explanation behind an "i"', () => {
    const def: SettingFieldDef = {
      key: 'x.flag',
      label: 'Show prices with VAT',
      type: 'boolean',
      group: 'General',
      description: 'Adds VAT to every price the shop shows.',
    };
    const html = renderToStaticMarkup(<SettingField def={def} value="on" onChange={() => {}} />);
    assert.match(html, /role="tooltip"[^>]*>Adds VAT to every price the shop shows\.</);
    assertDescribedByResolves(html);
  });

  const form = (search: string, flags: Record<string, boolean>) =>
    renderToStaticMarkup(
      withRouter(
        <SettingsForm
          settings={{}}
          moduleFlags={flags}
          localeSettings={{ supported: ['el', 'en'], main: 'el', editing: ['el', 'en'], public: ['el'] }}
        />,
        search,
      ),
    );

  test('a module explains itself behind an "i", while what switching it off does stays visible', () => {
    const html = form('tab=Modules', { newsletter: true, pm: false });
    for (const name of ['newsletter', 'pm']) {
      const m = MODULE_LABELS[name];
      assert.ok(m.description && m.offNote);
      assert.ok(tooltips(html).some((t) => t.includes(esc(m.description!))), `${name} description not in a tip`);
      assert.ok(html.includes(esc(m.offNote!)), `${name} consequence not on screen`);
      assert.ok(!tooltips(html).some((t) => t.includes(esc(m.offNote!))), `${name} consequence hidden in a tip`);
    }
    assertDescribedByResolves(html);
  });

  test('Editing and Public each explain themselves', () => {
    const html = form('tab=Languages', {});
    assert.ok(tooltips(html).some((t) => /editor/i.test(t)), 'Editing is not explained');
    assert.ok(tooltips(html).some((t) => /language picker/i.test(t)), 'Public is not explained');
    assertDescribedByResolves(html);
  });
});

describe('Structured data', () => {
  const html = renderToStaticMarkup(
    <StructuredDataSettings
      initial={parseSchemaPolicy({ business: { type: 'TravelAgency' } })}
      categories={SCHEMA_CATEGORIES.filter((c) => c.key === 'articles')}
      brandHasAddress
    />,
  );

  test('the chosen business type is explained in plain words', () => {
    assert.ok(tooltips(html).some((t) => /tour|travel/i.test(t)), 'TravelAgency not explained');
  });

  test('the FAQ and part checkboxes explain what they add', () => {
    assert.ok(tooltips(html).some((t) => /SEO panel/.test(t)), 'the FAQ checkbox is not explained');
    assert.ok(tooltips(html).some((t) => /voice/i.test(t)), 'Speakable is not explained');
    assertDescribedByResolves(html);
  });
});

describe('Newsletter subscribers', () => {
  test('Placement and the actions are explained', () => {
    const html = renderToStaticMarkup(
      <SubscribersTable
        initial={[
          {
            id: 1,
            email: 'a@example.com',
            status: 'active',
            source: 'footer',
            locale: 'el',
            subscribedAt: '2026-01-01T00:00:00Z',
            unsubscribedAt: null,
            consentText: 'Yes please',
          } as never,
        ]}
        counts={{ all: 1, active: 1, unsubscribed: 0 }}
        canWrite
      />,
    );
    assert.match(html, /aria-label="More information"[\s\S]*?role="tooltip"[^>]*>[^<]*footer/);
    assert.ok(tooltips(html).some((t) => /Unsubscribe/.test(t) && /[Dd]elete/.test(t)), 'unsubscribe vs delete not explained');
  });
});

describe('Cookies', () => {
  const html = renderToStaticMarkup(
    <CookiesManager
      initial={[
        {
          id: 1,
          key: 'analytics',
          name: { el: 'Στατιστικά' },
          description: null,
          required: false,
          sortOrder: 0,
          services: [],
        },
      ]}
    />,
  );

  test('the key and the required switch are explained', () => {
    assert.ok(tooltips(html).some((t) => /analytics/.test(t) && /key/i.test(t)), 'Key is not explained');
    assert.ok(tooltips(html).some((t) => /cannot (switch|turn) (it )?off/i.test(t)), 'Required is not explained');
  });

  test('provider and purpose are explained where a service is added', () => {
    assert.ok(tooltips(html).some((t) => /company/i.test(t)), 'Provider is not explained');
    assert.ok(tooltips(html).some((t) => /banner/i.test(t) && /why/i.test(t)), 'Purpose is not explained');
  });

  test('the scanner says what it looks at', () => {
    assert.ok(tooltips(html).some((t) => /does not (visit|crawl)/i.test(t)), 'the scan is not explained');
  });

  test('deleting a category still warns in the open', () => {
    assert.doesNotMatch(tooltips(html).join(' '), /cannot be undone/);
  });
});

describe('Scripts list', () => {
  test('the row labels are explained', () => {
    const html = renderToStaticMarkup(
      <ScriptsManager
        initial={[
          {
            id: 1,
            slug: 'chat',
            name: 'Chat',
            kind: 'inline',
            code: 'x()',
            src: null,
            lazy: false,
            consentCategory: null,
            enabled: true,
            notes: null,
          },
        ]}
        categories={[]}
      />,
    );
    assert.ok(tooltips(html).some((t) => /Inline/.test(t) && /External/.test(t)), 'badges not explained');
  });
});

describe('Users', () => {
  const html = renderToStaticMarkup(
    <UsersManager
      initial={{
        users: [
          {
            id: 2,
            email: 'a@example.com',
            name: 'A',
            locale: 'el',
            disabled: false,
            mfaEnabled: true,
            lastLoginAt: null,
            roleIds: [1],
            roleNames: ['editor'],
          },
        ],
        roles: [{ id: 1, name: 'editor', permissionsCount: 3 }],
      } as never}
      currentUserId={1}
    />,
  );

  test('role, last login and status are explained', () => {
    assert.ok(tooltips(html).some((t) => /Roles screen/.test(t)), 'Role is not explained');
    assert.ok(tooltips(html).some((t) => /signed in/i.test(t)), 'Last login is not explained');
    assert.ok(tooltips(html).some((t) => /disabled/i.test(t) && /Click/.test(t)), 'Status is not explained');
    assertDescribedByResolves(html);
  });

  test('the reset password field says no email is sent', () => {
    const panel = renderToStaticMarkup(
      <EditUserPanel
        user={{ id: 2, email: 'a@example.com', name: 'A', locale: 'el', disabled: false, mfaEnabled: false, lastLoginAt: null, roleIds: [1], roleNames: ['editor'] } as never}
        roles={[{ id: 1, name: 'editor', permissionsCount: 3 }]}
        assignable={undefined}
        onClose={() => {}}
        onSave={async () => null}
      />,
    );
    assert.ok(tooltips(panel).some((t) => /no email/i.test(t)), 'Reset password is not explained');
  });
});

describe('Custom fields', () => {
  test('Unit and Whole numbers only are explained', () => {
    const html = renderToStaticMarkup(
      <CustomFieldsManager
        collectionKey="product"
        initial={{ product: { groups: [], fields: [{ id: 'a', key: '', kind: 'number', label: {} }] } }}
        locales={['el', 'en']}
        reservedKeys={[]}
        collectionKeys={['product']}
        categories={[]}
      />,
    );
    assert.ok(tooltips(html).some((t) => /not added to the value/i.test(t)), 'Unit is not explained');
    assert.ok(tooltips(html).some((t) => /decimal/i.test(t)), 'Whole numbers only is not explained');
    // The yes/no toggles are named by their Field label, not left dangling.
    assert.match(html, /<input[^>]*type="checkbox"[^>]*id="[^"]+-control"/);
    assertDescribedByResolves(html);
  });
});

describe('Submissions', () => {
  test('statuses and source are explained', () => {
    const html = renderToStaticMarkup(
      withRouter(<SubmissionsTable initial={{ items: [], total: 0, page: 1, pageSize: 25, types: [] } as never} />),
    );
    assert.ok(tooltips(html).some((t) => /spam/.test(t) && /handled/.test(t)), 'statuses not explained');
    assert.ok(tooltips(html).some((t) => /page/i.test(t) && /sent/i.test(t)), 'Source not explained');
  });
});

describe('API tokens', () => {
  test('each permission explains itself behind an "i"', () => {
    const html = renderToStaticMarkup(<ApiTokensManager initial={[]} />);
    assert.ok(tooltips(html).some((t) => /List and fetch pages and products\./.test(t)));
    assertDescribedByResolves(html);
  });
});
