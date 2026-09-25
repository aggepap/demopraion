import '../setup/react-global';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { Checkbox } from '@/cms/admin/ui/Checkbox';
import { Field } from '@/cms/admin/ui/Field';
import { InfoTip } from '@/cms/admin/ui/InfoTip';
import { Section } from '@/cms/admin/ui/Section';
import { Th } from '@/cms/admin/ui';

/**
 * The "i" that explains an option.
 *
 * Two shapes, on purpose. Next to a labelled control the icon stays out of the
 * tab order: the control already carries the text through `aria-describedby`, and
 * a focusable icon beside every field added dozens of tab stops and made label
 * lookups match twice. Where there is no control to hang the text on — a column
 * header, a section title, a badge — the tip is its own button, or keyboard and
 * screen-reader users could never reach it.
 *
 * No DOM here: what is pinned is the markup contract. Hover, tap and Escape are
 * exercised in `qa/specs/cms/admin-info-tip.spec.ts`.
 */
const idsIn = (html: string, attr: string) =>
  [...html.matchAll(new RegExp(`${attr}="([^"]+)"`, 'g'))].flatMap((m) => m[1].split(' '));

function assertDescribedByResolves(html: string) {
  const described = idsIn(html, 'aria-describedby');
  assert.ok(described.length > 0, 'nothing is described');
  const ids = new Set(idsIn(html, 'id'));
  for (const id of described) assert.ok(ids.has(id), `aria-describedby points at missing id "${id}"`);
}

describe('InfoTip (standalone)', () => {
  const html = renderToStaticMarkup(<InfoTip>Money taken, minus refunds.</InfoTip>);

  test('is a real button with an accessible name', () => {
    assert.match(html, /<button[^>]*type="button"/);
    assert.match(html, /<button[^>]*aria-label="[^"]+"/);
  });

  test('describes itself with the tooltip text', () => {
    assert.match(html, /role="tooltip"[^>]*>Money taken, minus refunds\.</);
    assertDescribedByResolves(html);
  });

  test('starts closed', () => {
    assert.match(html, /aria-expanded="false"/);
  });
});

describe('Field description', () => {
  test('with a label: the control is described by the tip, and the icon is not a button', () => {
    const html = renderToStaticMarkup(
      <Field label="Slug" description="The part of the address after the domain.">
        <input />
      </Field>,
    );
    assertDescribedByResolves(html);
    assert.match(html, /role="tooltip"[^>]*>The part of the address after the domain\.</);
    assert.doesNotMatch(html, /<button/, 'the field icon must stay out of the tab order');
  });

  test('without a label: the description id still exists', () => {
    const html = renderToStaticMarkup(
      <Field description="Leave empty to use the default.">
        <input />
      </Field>,
    );
    assertDescribedByResolves(html);
    assert.match(html, /Leave empty to use the default\./);
  });
});

describe('Checkbox info', () => {
  test('describes the checkbox with the tip', () => {
    const html = renderToStaticMarkup(<Checkbox label="Active" info="Only active codes are accepted at checkout." />);
    assertDescribedByResolves(html);
    assert.match(html, /<input[^>]*aria-describedby=/);
    assert.match(html, /role="tooltip"[^>]*>Only active codes are accepted at checkout\.</);
  });

  test('keeps the tip out of the label, so it is not read as part of the name', () => {
    const html = renderToStaticMarkup(<Checkbox label="Active" info="Only active codes are accepted at checkout." />);
    const label = html.match(/<label[\s\S]*?<\/label>/)?.[0] ?? '';
    assert.match(label, /Active/);
    assert.doesNotMatch(label, /role="tooltip"|Only active codes/);
  });

  test('renders no tip without info, and keeps a visible hint visible', () => {
    const html = renderToStaticMarkup(<Checkbox label="Active" hint="Cannot be undone." />);
    assert.doesNotMatch(html, /role="tooltip"/);
    assert.match(html, /Cannot be undone\./);
  });
});

describe('Th info', () => {
  test('adds a tip button beside the header text', () => {
    const html = renderToStaticMarkup(
      <table>
        <thead>
          <tr>
            <Th info="Visits that were sent on by this rule.">Hits</Th>
          </tr>
        </thead>
      </table>,
    );
    assert.match(html, /<th[^>]*>[\s\S]*Hits[\s\S]*<button/);
    assertDescribedByResolves(html);
  });

  test('is unchanged without info', () => {
    const html = renderToStaticMarkup(
      <table>
        <thead>
          <tr>
            <Th>Hits</Th>
          </tr>
        </thead>
      </table>,
    );
    assert.doesNotMatch(html, /<button|role="tooltip"/);
  });
});

describe('Section info', () => {
  test('puts the tip beside the title, not inside the collapse button', () => {
    const html = renderToStaticMarkup(
      <Section title="Shipping methods" info="Delivery options the customer chooses between.">
        <p>body</p>
      </Section>,
    );
    assertDescribedByResolves(html);
    // A button inside a button is invalid and swallows the click.
    assert.doesNotMatch(html, /<button[^>]*>(?:(?!<\/button>)[\s\S])*<button/);
  });
});
