import '../setup/react-global';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext, type AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { PathnameContext, SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';

import { DocumentForm } from '@/cms/admin/DocumentForm';
import { nextTabIndex, TabList, Tabs } from '@/cms/admin/ui/Tabs';
import { resolveCollection } from '@/cms/config/collection';
import { f } from '@/cms/config/fields';

function withRouter(children: ReactNode, search = '') {
  const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} } as unknown as AppRouterInstance;
  return createElement(
    AppRouterContext.Provider,
    { value: router },
    createElement(
      PathnameContext.Provider,
      { value: '/admin/article/new' },
      createElement(SearchParamsContext.Provider, { value: new URLSearchParams(search) }, children),
    ),
  );
}

const attr = (tag: string, name: string) => new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
const tabsIn = (html: string): string[] => html.match(/<button[^>]*role="tab"[^>]*>/g) ?? [];

describe('tab keyboard pattern', () => {
  test('arrows wrap, Home and End jump, other keys are ignored', () => {
    assert.equal(nextTabIndex('ArrowRight', 0, 3), 1);
    assert.equal(nextTabIndex('ArrowRight', 2, 3), 0);
    assert.equal(nextTabIndex('ArrowLeft', 0, 3), 2);
    assert.equal(nextTabIndex('Home', 2, 3), 0);
    assert.equal(nextTabIndex('End', 0, 3), 2);
    assert.equal(nextTabIndex('Enter', 1, 3), -1);
    assert.equal(nextTabIndex('ArrowRight', 0, 0), -1);
  });

  test('TabList: one tab stop, each tab names the panel it controls', () => {
    const html = renderToStaticMarkup(
      <TabList
        label="Things"
        idPrefix="p"
        activeId="b"
        onSelect={() => {}}
        tabs={[{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C', controls: 'shared' }]}
      />,
    );
    const tabs = tabsIn(html);
    assert.equal(tabs.length, 3);
    assert.deepEqual(tabs.map((t) => attr(t, 'tabindex')), ['-1', '0', '-1']);
    assert.deepEqual(tabs.map((t) => attr(t, 'aria-controls')), ['p-panel-a', 'p-panel-b', 'shared']);
    assert.deepEqual(tabs.map((t) => attr(t, 'id')), ['p-tab-a', 'p-tab-b', 'p-tab-c']);
  });

  test('Tabs still wires every tab to a panel that exists', () => {
    const html = renderToStaticMarkup(
      <Tabs label="S" tabs={[{ id: 'x', label: 'X', content: 'one' }, { id: 'y', label: 'Y', content: 'two' }]} />,
    );
    for (const tab of tabsIn(html)) {
      const panel = attr(tab, 'aria-controls');
      assert.ok(panel && html.includes(`id="${panel}"`), `no panel ${panel}`);
    }
  });
});

/**
 * The document form's language strip was hand-rolled with the roles but not
 * the pattern: every tab was a tab stop, arrow keys did nothing and no tab said
 * which panel it controlled. It now uses the shared `TabList`.
 */
describe('document form: language tabs', () => {
  const collection = resolveCollection({ key: 'article', label: 'Article', fields: [f.text('title')] });
  const html = renderToStaticMarkup(
    withRouter(
      <DocumentForm adminPath="admin" collection={collection} locales={['el', 'en']} defaultLocale="el" />,
    ),
  );

  test('one tab stop, the rest reached with the arrow keys', () => {
    const tabs = tabsIn(html);
    assert.equal(tabs.length, 2);
    assert.deepEqual(tabs.map((t) => attr(t, 'tabindex')), ['0', '-1']);
  });

  test('every tab controls the form panel, which is labelled by the selected tab', () => {
    const tabs = tabsIn(html);
    const panelId = attr(tabs[0], 'aria-controls');
    assert.ok(panelId);
    assert.equal(attr(tabs[1], 'aria-controls'), panelId);
    const panel = new RegExp(`<div[^>]*id="${panelId}"[^>]*>`).exec(html)?.[0] ?? '';
    assert.match(panel, /role="tabpanel"/);
    assert.equal(attr(panel, 'aria-labelledby'), attr(tabs[0], 'id'));
  });
});
