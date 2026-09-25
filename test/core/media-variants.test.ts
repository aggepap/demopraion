import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { acceptsAvif, avifKey, readForAccept } from '@/cms/core/media/variants';

/**
 * One media URL, two encodings.
 *
 * Every still image is stored twice — WebP under its uuid, AVIF beside it — and
 * `/api/cms/media/file/<uuid>` picks between them from the request's `Accept`
 * header. The URL never changes, so everything that already links to a file (a
 * page, a product feed, an OG tag, a crawler) keeps working and simply gets the
 * WebP when it does not ask for AVIF.
 */

const CHROME = 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8';
const OLD_SAFARI = 'image/webp,image/png,image/svg+xml,image/*;q=0.8,video/*;q=0.8,*/*;q=0.5';

function fakeStorage(files: Record<string, string>) {
  const reads: string[] = [];
  return {
    reads,
    async read(key: string): Promise<Buffer> {
      reads.push(key);
      const text = files[key];
      if (text === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return Buffer.from(text);
    },
  };
}

const UUID = '0b6f1c2e-6f7a-4e0c-9f51-1d2a3b4c5d6e';

describe('acceptsAvif', () => {
  test('a browser that lists image/avif accepts it', () => {
    assert.equal(acceptsAvif(CHROME), true);
  });

  test('a browser that does not list it does not', () => {
    assert.equal(acceptsAvif(OLD_SAFARI), false);
  });

  test('no header, an empty header and a bare wildcard do not', () => {
    // `*/*` is what a crawler or a product-feed fetcher sends: it means
    // "anything", not "I can decode AVIF", and those clients are exactly the
    // ones that cannot.
    for (const accept of [null, '', '*/*', 'image/*']) assert.equal(acceptsAvif(accept), false, String(accept));
  });

  test('q=0 is a refusal', () => {
    assert.equal(acceptsAvif('image/avif;q=0,image/webp'), false);
    assert.equal(acceptsAvif('image/avif; q=0.0, image/webp'), false);
  });

  test('a positive q, spacing and case are all accepted', () => {
    assert.equal(acceptsAvif('image/webp, Image/AVIF ; q=0.9'), true);
  });

  test('a type that merely contains the word is not AVIF', () => {
    assert.equal(acceptsAvif('image/avif-sequence,image/webp'), false);
  });
});

describe('readForAccept', () => {
  test('serves the AVIF to a browser that accepts it, when there is one', async () => {
    const storage = fakeStorage({ [UUID]: 'webp-bytes', [avifKey(UUID)]: 'avif-bytes' });
    const out = await readForAccept(storage, UUID, 'image/webp', CHROME);
    assert.equal(out.body.toString(), 'avif-bytes');
    assert.equal(out.contentType, 'image/avif');
    assert.equal(out.negotiated, true);
  });

  test('serves the WebP to a browser that does not accept AVIF, without looking for one', async () => {
    const storage = fakeStorage({ [UUID]: 'webp-bytes', [avifKey(UUID)]: 'avif-bytes' });
    const out = await readForAccept(storage, UUID, 'image/webp', OLD_SAFARI);
    assert.equal(out.body.toString(), 'webp-bytes');
    assert.equal(out.contentType, 'image/webp');
    assert.equal(out.negotiated, true);
    assert.deepEqual(storage.reads, [UUID]);
  });

  test('falls back to the WebP when no AVIF was stored (older uploads, animations)', async () => {
    const storage = fakeStorage({ [UUID]: 'webp-bytes' });
    const out = await readForAccept(storage, UUID, 'image/webp', CHROME);
    assert.equal(out.body.toString(), 'webp-bytes');
    assert.equal(out.contentType, 'image/webp');
    assert.equal(out.negotiated, true);
  });

  test('a file that is not a WebP is served as stored and never negotiated', async () => {
    for (const mime of ['application/pdf', 'image/png', 'image/jpeg']) {
      const storage = fakeStorage({ [UUID]: 'stored', [avifKey(UUID)]: 'avif-bytes' });
      const out = await readForAccept(storage, UUID, mime, CHROME);
      assert.equal(out.body.toString(), 'stored', mime);
      assert.equal(out.contentType, mime, mime);
      assert.equal(out.negotiated, false, mime);
      assert.deepEqual(storage.reads, [UUID], mime);
    }
  });

  test('a missing main file still fails, even when an AVIF would not be asked for', async () => {
    await assert.rejects(readForAccept(fakeStorage({}), UUID, 'image/webp', OLD_SAFARI));
  });

  test('the AVIF is keyed beside the uuid, inside the same directory', () => {
    assert.equal(avifKey(UUID), `${UUID}.avif`);
  });
});
