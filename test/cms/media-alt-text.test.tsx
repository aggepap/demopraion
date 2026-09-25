import '../setup/react-global';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { NextRequest } from 'next/server';
import { renderToStaticMarkup } from 'react-dom/server';

import { altTextStatus, MediaAltText } from '@/cms/admin/MediaAltText';
import { MediaLibrary } from '@/cms/admin/MediaLibrary';
import { MediaPickerTile } from '@/cms/admin/fields/MediaPicker';
import { mediaUpdateRoute } from '@/cms/core/routes/media';
import { PERMISSIONS } from '@/cms/modules/auth/permissions';

/**
 * Alt text on the Media screen.
 *
 * The API could store a file's alt text all along (`PATCH /api/cms/media/:uuid`)
 * but no screen offered it, so the only writer was the Praion.ai bridge and an
 * editor could see alt text on the site with no way to correct it.
 */
const UUID = '0b6f3c1e-2d4a-4f5b-8c6d-7e8f9a0b1c2d';

const item = (altText: string | null) => ({
  uuid: UUID,
  originalName: 'harbour.webp',
  mime: 'image/webp',
  size: 2048,
  width: 800,
  height: 600,
  url: `/api/cms/media/file/${UUID}`,
  createdAt: '2026-09-01T10:00:00.000Z',
  altText,
});

describe('MediaAltText', () => {
  test('an editor gets a labelled alt-text box and a save button', () => {
    const html = renderToStaticMarkup(<MediaAltText uuid={UUID} altText="Boats in the harbour" canWrite />);
    assert.match(html, /<label[^>]*for="alt-[^"]+"[^>]*>Alt text<\/label>/);
    assert.match(html, /<textarea[^>]*id="alt-[^"]+"[^>]*>Boats in the harbour<\/textarea>/);
    assert.doesNotMatch(html, /<textarea[^>]*readonly/i);
    assert.match(html, /<button[^>]*>Save alt text<\/button>/);
  });

  test('a reader sees the alt text but cannot change it', () => {
    const html = renderToStaticMarkup(<MediaAltText uuid={UUID} altText="Boats in the harbour" canWrite={false} />);
    assert.match(html, /Boats in the harbour/);
    assert.doesNotMatch(html, /<textarea/);
    assert.doesNotMatch(html, /Save alt text/);
  });

  test('a reader is told when there is none', () => {
    const html = renderToStaticMarkup(<MediaAltText uuid={UUID} altText={null} canWrite={false} />);
    assert.match(html, /No alt text/);
  });
});

describe('altTextStatus', () => {
  test('says whether the box matches what is stored', () => {
    assert.equal(altTextStatus({ draft: 'a', saved: 'a', saving: false, error: null, justSaved: false }), null);
    assert.equal(altTextStatus({ draft: 'a ', saved: 'a', saving: false, error: null, justSaved: false }), null);
    assert.equal(altTextStatus({ draft: 'b', saved: 'a', saving: false, error: null, justSaved: false }), 'Unsaved');
    assert.equal(altTextStatus({ draft: 'b', saved: 'a', saving: true, error: null, justSaved: false }), 'Saving…');
    assert.equal(altTextStatus({ draft: 'a', saved: 'a', saving: false, error: null, justSaved: true }), 'Saved');
    assert.equal(
      altTextStatus({ draft: 'b', saved: 'a', saving: false, error: 'Nope', justSaved: false }),
      'Not saved: Nope',
    );
  });
});

describe('MediaLibrary permissions', () => {
  test('an editor sees alt text editors, upload and delete', () => {
    const html = renderToStaticMarkup(<MediaLibrary initial={[item('Boats')]} initialTotal={1} canWrite />);
    assert.match(html, /Upload files/);
    assert.match(html, /Save alt text/);
    assert.match(html, /delete/);
  });

  test('a reader sees the alt text, and no control that would be refused', () => {
    const html = renderToStaticMarkup(<MediaLibrary initial={[item('Boats')]} initialTotal={1} canWrite={false} />);
    assert.match(html, /Boats/);
    assert.doesNotMatch(html, /Upload files/);
    assert.doesNotMatch(html, /Save alt text/);
    assert.doesNotMatch(html, />\s*delete/);
  });
});

describe('MediaPickerTile', () => {
  test('shows the alt text under the file name', () => {
    const html = renderToStaticMarkup(<MediaPickerTile item={item('Boats in the harbour')} onSelect={() => {}} />);
    assert.match(html, /Boats in the harbour/);
  });

  test('says when a file has none', () => {
    const html = renderToStaticMarkup(<MediaPickerTile item={item(null)} onSelect={() => {}} />);
    assert.match(html, /No alt text/);
  });
});

describe('PATCH /api/cms/media/:uuid', () => {
  function harness(permissions: string[], exists = true) {
    const writes: { uuid: string; altText: string | null }[] = [];
    const audits: unknown[] = [];
    const route = mediaUpdateRoute({
      requirePerm: async (key) =>
        permissions.includes(key)
          ? { userId: 7, permissions }
          : Response.json({ ok: false, error: 'forbidden', missing: key }, { status: 403 }),
      setAltText: async (uuid, altText) => {
        writes.push({ uuid, altText });
        return exists;
      },
      audit: async (entry) => {
        audits.push(entry);
      },
    });
    return { route, writes, audits };
  }

  const patch = (body: unknown, uuid = UUID) =>
    [
      new NextRequest(`http://localhost/api/cms/media/${uuid}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ uuid }) },
    ] as const;

  test('without media write permission it is a 403 and nothing is written', async () => {
    const { route, writes } = harness([PERMISSIONS.mediaRead]);
    const res = await route(...patch({ altText: 'x' }));
    assert.equal(res.status, 403);
    assert.equal(writes.length, 0);
  });

  test('with it, the trimmed text is stored, audited and echoed back', async () => {
    const { route, writes, audits } = harness([PERMISSIONS.mediaRead, PERMISSIONS.mediaWrite]);
    const res = await route(...patch({ altText: '  Boats  ' }));
    assert.equal(res.status, 200);
    assert.deepEqual(writes, [{ uuid: UUID, altText: 'Boats' }]);
    assert.equal(audits.length, 1);
    const body = (await res.json()) as { data: { altText: string | null } };
    assert.equal(body.data.altText, 'Boats');
  });

  test('an empty box clears the alt text', async () => {
    const { route, writes } = harness([PERMISSIONS.mediaWrite]);
    const res = await route(...patch({ altText: '   ' }));
    assert.equal(res.status, 200);
    assert.deepEqual(writes, [{ uuid: UUID, altText: null }]);
  });

  test('longer than 512 characters is refused as invalid', async () => {
    const { route, writes } = harness([PERMISSIONS.mediaWrite]);
    const res = await route(...patch({ altText: 'a'.repeat(513) }));
    assert.equal(res.status, 422);
    assert.equal(writes.length, 0);
  });

  test('an unknown file is a 404, and a malformed id a 400', async () => {
    const missing = harness([PERMISSIONS.mediaWrite], false);
    assert.equal((await missing.route(...patch({ altText: 'x' }))).status, 404);
    assert.equal(missing.audits.length, 0);
    const bad = harness([PERMISSIONS.mediaWrite]);
    assert.equal((await bad.route(...patch({ altText: 'x' }, 'not-a-uuid'))).status, 400);
  });
});
