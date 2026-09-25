import '../setup/react-global';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { Drawer } from '@/cms/admin/ui/Drawer';

/**
 * The shared admin slide-over — Import .md, term management, the booking day
 * and reservation panels.
 *
 * It was built as two bare `<div>`s with a click handler. Nothing announced it
 * as a dialog, Escape did not close it, and focus never entered it: Tab walked
 * the page *behind* the backdrop, which is the worst version of the failure
 * because the drawer covers that page visually. It looked correct to a mouse,
 * which is how it survived while `use-dialog.ts` was written next door to fix
 * exactly this in six other components.
 *
 * This suite has no DOM, so what is pinned here is the markup contract that
 * makes the behaviour reachable and announceable — the role, the modal flag and
 * the accessible name. Escape, the focus trap and focus restore come from
 * `useDialog`, shared with nine other dialogs; the browser-level proof lives in
 * `qa/specs/cms/cms-admin-drawer-is-an-accessible-dialog.spec.ts`.
 */
const render = (props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    <Drawer title="Import a .md file" onClose={() => {}} {...props}>
      <button type="button">Choose file</button>
    </Drawer>,
  );

describe('Drawer', () => {
  test('announces itself as a modal dialog', () => {
    const html = render();
    assert.match(html, /role="dialog"/, 'no dialog role — screen readers get no boundary');
    assert.match(html, /aria-modal="true"/, 'not marked modal');
  });

  test('the dialog role sits on the panel, not the backdrop', () => {
    // A role on the full-screen backdrop would claim the whole viewport as the
    // dialog and swallow the page behind it into the same node.
    const html = render();
    const panel = html.indexOf('bg-white');
    const role = html.indexOf('role="dialog"');
    assert.ok(role !== -1 && panel !== -1);
    assert.ok(
      html.lastIndexOf('<div', panel) === html.lastIndexOf('<div', role),
      'role="dialog" is not on the white panel element',
    );
  });

  test('the backdrop is hidden from assistive tech', () => {
    // It is a click target for the mouse only; the close button is the
    // keyboard and screen-reader route out.
    assert.match(render(), /aria-hidden="true"/);
  });

  test('the accessible name is the visible title', () => {
    const html = render();
    const labelledBy = /aria-labelledby="([^"]+)"/.exec(html);
    assert.ok(labelledBy, 'dialog has no accessible name');
    const id = labelledBy[1];
    const heading = new RegExp(`<h2[^>]*id="${id}"[^>]*>([^<]*)</h2>`).exec(html);
    assert.ok(heading, `aria-labelledby="${id}" points at no heading`);
    assert.equal(heading[1], 'Import a .md file');
  });

  test('two drawers do not collide on one id', () => {
    // Ids come from useId rather than a literal, because the reservations table
    // can mount a drawer per row.
    const html = renderToStaticMarkup(
      <div>
        <Drawer title="One" onClose={() => {}}>
          <span>a</span>
        </Drawer>
        <Drawer title="Two" onClose={() => {}}>
          <span>b</span>
        </Drawer>
      </div>,
    );
    const ids = [...html.matchAll(/aria-labelledby="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(ids.length, 2);
    assert.notEqual(ids[0], ids[1], 'both drawers claim the same title id');
  });

  test('the close button keeps its label', () => {
    assert.match(render(), /aria-label="Close"/);
  });

  test('children render inside the panel', () => {
    assert.match(render(), /Choose file/);
  });
});
