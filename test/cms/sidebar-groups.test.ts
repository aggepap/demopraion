import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { groupSidebarItems, type CollectionSummary, type SidebarToolSummary } from '@/cms/admin/shared';

function collection(key: string, over: Partial<CollectionSummary> = {}): CollectionSummary {
  return { key, label: key, labelPlural: key, singleton: false, hidden: false, ...over };
}

const article = collection('article');
const product = collection('product', { module: 'commerce' });
const booking = collection('booking', { module: 'booking' });
const resource = collection('resource', { module: 'booking' });

const orders: SidebarToolSummary = { href: '/admin/orders', label: 'Orders', group: 'ecommerce' };
const reservations: SidebarToolSummary = { href: '/admin/reservations', label: 'Reservations', group: 'booking' };
const settings: SidebarToolSummary = { href: '/admin/settings', label: 'Settings' };

function sectionLabels(collections: CollectionSummary[], tools: SidebarToolSummary[] = []) {
  return groupSidebarItems(collections, tools).modules.map((s) => s.label);
}

describe('groupSidebarItems', () => {
  test('a collection with no module is editorial Content', () => {
    const { content } = groupSidebarItems([article]);
    assert.deepEqual(content.map((c) => c.key), ['article']);
  });

  /*
   * The bug this whole function exists to prevent: the grouping used to name
   * 'commerce' literally, so a booking collection fell through to Content and
   * sat next to Articles — wrong, but not wrong enough for anyone to report.
   */
  test('a booking collection does NOT fall through to Content', () => {
    const { content, modules } = groupSidebarItems([article, booking, resource]);
    assert.deepEqual(content.map((c) => c.key), ['article']);
    const bookingSection = modules.find((s) => s.label === 'Booking');
    assert.deepEqual(bookingSection?.items.map((c) => c.key), ['booking', 'resource']);
  });

  test('each module keeps its own section', () => {
    const { modules } = groupSidebarItems([article, product, booking], [orders, reservations]);
    assert.deepEqual(modules.map((s) => s.label), ['Ecommerce', 'Booking']);
    assert.deepEqual(modules[0].items.map((c) => c.key), ['product']);
    assert.deepEqual(modules[0].tools.map((t) => t.href), ['/admin/orders']);
    assert.deepEqual(modules[1].tools.map((t) => t.href), ['/admin/reservations']);
  });

  test('sections render in a fixed order regardless of input order', () => {
    assert.deepEqual(sectionLabels([booking, product]), ['Ecommerce', 'Booking']);
    assert.deepEqual(sectionLabels([product, booking]), ['Ecommerce', 'Booking']);
  });

  test('an empty module section is omitted entirely', () => {
    assert.deepEqual(sectionLabels([article]), []);
    assert.deepEqual(sectionLabels([article, product]), ['Ecommerce']);
  });

  test('a module section appears for its tools alone, with no collections', () => {
    const { modules } = groupSidebarItems([article], [reservations]);
    assert.deepEqual(modules.map((s) => s.label), ['Booking']);
    assert.equal(modules[0].items.length, 0);
  });

  test('ungrouped tools are System', () => {
    const { system } = groupSidebarItems([article], [orders, reservations, settings]);
    assert.deepEqual(system.map((t) => t.href), ['/admin/settings']);
  });

  test('a tool naming an unknown group stays reachable under System', () => {
    // Better a tool in the wrong section than a tool nobody can navigate to.
    const orphan: SidebarToolSummary = { href: '/admin/legacy', label: 'Legacy', group: 'newsletter' };
    const { system } = groupSidebarItems([article], [orphan]);
    assert.deepEqual(system.map((t) => t.href), ['/admin/legacy']);
  });

  test('hidden collections appear in no section at all', () => {
    const secret = collection('secret', { hidden: true, module: 'booking' });
    const { content, modules } = groupSidebarItems([article, secret]);
    assert.deepEqual(content.map((c) => c.key), ['article']);
    assert.deepEqual(modules, []);
  });

  test('the caller passing no tools is the same as passing none', () => {
    assert.deepEqual(groupSidebarItems([product]).modules[0].tools, []);
  });
});
