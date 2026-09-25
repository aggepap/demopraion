import '../setup/react-global';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { RICH_TEXT_TOOLS, RichTextToolbar } from '@/cms/admin/fields/RichTextEditor';
import { EditLockBanner } from '@/cms/admin/locks/EditLockBanner';
import { MediaAltText } from '@/cms/admin/MediaAltText';
import { VersionHistory } from '@/cms/admin/VersionHistory';

/**
 * The "i" explanations on the content screens, pinned as markup.
 *
 * No DOM here (see `drawer.test.tsx`): what is checked is that each explanation
 * is present and reachable — named buttons, descriptions that resolve to an
 * element — not how the bubble opens, which `info-tip.test.tsx` and the QA
 * spec cover for the shared kit.
 */
const idsIn = (html: string, attr: string) =>
  [...html.matchAll(new RegExp(`${attr}="([^"]+)"`, 'g'))].flatMap((m) => m[1].split(' '));

function assertDescribedByResolves(html: string) {
  const described = idsIn(html, 'aria-describedby');
  assert.ok(described.length > 0, 'nothing is described');
  const ids = new Set(idsIn(html, 'id'));
  for (const id of described) assert.ok(ids.has(id), `aria-describedby points at missing id "${id}"`);
}

describe('rich-text toolbar', () => {
  const html = renderToStaticMarkup(
    <RichTextToolbar isActive={(id) => id === 'bold'} onTool={() => {}} onInsertBlock={() => {}} />,
  );

  test('every button is named and says what it does on hover', () => {
    // "B", "i", "❝" and "H2" are not names a screen reader can say usefully.
    for (const name of ['Bold', 'Italic', 'Heading 2', 'Heading 3', 'Bulleted list', 'Numbered list', 'Quote', 'Link', 'Insert block']) {
      assert.match(html, new RegExp(`<button[^>]*aria-label="${name}"[^>]*title="[^"]+"`), `${name} has no name + title`);
    }
    const buttons = html.match(/<button/g) ?? [];
    const named = html.match(/<button[^>]*aria-label="[^"]+"[^>]*title="[^"]+"/g) ?? [];
    assert.equal(named.length, buttons.length, 'a toolbar button has no aria-label or title');
    assert.equal(buttons.length, RICH_TEXT_TOOLS.length + 1);
  });

  test('formatting buttons say whether they are on', () => {
    assert.match(html, /aria-label="Bold"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*aria-label="Bold"/);
    assert.match(html, /aria-label="Italic"[^>]*aria-pressed="false"|aria-pressed="false"[^>]*aria-label="Italic"/);
  });
});

describe('media alt text', () => {
  const html = renderToStaticMarkup(<MediaAltText uuid="u1" altText={null} canWrite />);

  test('the box is labelled and its explanation sits behind an "i"', () => {
    assert.match(html, /<label[^>]*for="([^"]+)"[^>]*>Alt text/);
    const labelFor = /<label[^>]*for="([^"]+)"/.exec(html)?.[1];
    assert.match(html, new RegExp(`<textarea[^>]*id="${labelFor}"`));
    assert.match(html, /role="tooltip"[^>]*>[^<]*screen reader/i);
    assertDescribedByResolves(html);
  });
});

describe('version history', () => {
  const html = renderToStaticMarkup(<VersionHistory collection="page" documentId={1} />);

  test('explains what restoring does', () => {
    assert.match(html, /<button[^>]*aria-label="About version history"/);
    assert.match(html, /role="tooltip"[^>]*>[^<]*Restore/);
  });
});

describe('edit lock banner', () => {
  const lock = {
    phase: 'theirs' as const,
    readOnly: true,
    holder: { userId: 2, userName: 'Maria', sessionId: 's', since: new Date().toISOString() },
    takeOver: () => {},
  };

  test('explains the copy button, while the lock-out warning stays visible', () => {
    const html = renderToStaticMarkup(<EditLockBanner lock={lock} onCopyUnsaved={() => {}} />);
    assert.match(html, /role="tooltip"[^>]*>[^<]*clipboard/);
    assert.match(html, /Taking over will lock them\s+out instead\./);
  });
});
