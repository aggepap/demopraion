import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, test } from 'node:test';

import sharp from 'sharp';

import {
  MediaProcessingError,
  UPLOAD_MAX_HEIGHT,
  UPLOAD_MAX_WIDTH,
  prepareUpload,
} from '@/cms/core/media/normalize';

/**
 * What happens to the bytes an administrator uploads, before anything stores
 * them.
 *
 * Every upload place in the admin — the media library, the picker behind every
 * `f.image()` field, the brand logo and favicon, product galleries, variation
 * images, the SEO social image — posts to the one upload route, which hands the
 * bytes to `uploadMedia`. `prepareUpload` is the whole policy that runs there:
 * decode, fit inside 1600x1200 without enlarging, re-encode as WebP. It is a
 * pure function of the bytes so it can be tested without a database.
 */

const BOX = { width: UPLOAD_MAX_WIDTH, height: UPLOAD_MAX_HEIGHT };

async function png(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#c33' } })
    .png()
    .toBuffer();
}

async function jpeg(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#39c' } })
    .jpeg()
    .toBuffer();
}

/** Something with detail in it, the way a photograph has: a smooth gradient
 *  with a deterministic ripple, so every run encodes the same bytes. */
async function photo(width: number, height: number): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      raw[i] = (x * 255) / width;
      raw[i + 1] = (y * 255) / height;
      raw[i + 2] = 128 + 100 * Math.sin(x / 7) * Math.cos(y / 5);
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

/** A two-frame GIF, the shape an editor uploads when they upload an animation. */
async function animatedGif(width: number, height: number): Promise<Buffer> {
  const frame = (background: string) =>
    sharp({ create: { width, height, channels: 3, background } })
      .png()
      .toBuffer();
  return sharp([await frame('#f00'), await frame('#0f0')], { join: { animated: true } })
    .gif()
    .toBuffer();
}

function upload(buffer: Buffer, originalName: string, mime: string) {
  return { buffer, originalName, mime: mime as Parameters<typeof prepareUpload>[0]['mime'] };
}

async function meta(buffer: Buffer) {
  return sharp(buffer, { animated: true }).metadata();
}

describe('prepareUpload — the 1600x1200 WebP box', () => {
  test('caps a landscape image at 1600 wide and keeps its ratio', async () => {
    const out = await prepareUpload(upload(await jpeg(3000, 2000), 'wide.jpg', 'image/jpeg'));
    assert.equal(out.width, 1600);
    assert.equal(out.height, 1067);
    assert.equal((await meta(out.buffer)).width, 1600);
  });

  test('caps a portrait image at 1200 tall and keeps its ratio', async () => {
    const out = await prepareUpload(upload(await png(1000, 2000), 'tall.png', 'image/png'));
    assert.equal(out.width, 600);
    assert.equal(out.height, 1200);
  });

  test('a square image fits the shorter side of the box', async () => {
    const out = await prepareUpload(upload(await png(2000, 2000), 'square.png', 'image/png'));
    assert.deepEqual([out.width, out.height], [1200, 1200]);
  });

  test('never enlarges an image that already fits, but still converts it', async () => {
    const out = await prepareUpload(upload(await png(800, 600), 'small.png', 'image/png'));
    assert.deepEqual([out.width, out.height], [800, 600]);
    assert.equal(out.mime, 'image/webp');
  });

  test('an image exactly the size of the box is untouched in size', async () => {
    const out = await prepareUpload(upload(await png(BOX.width, BOX.height), 'exact.png', 'image/png'));
    assert.deepEqual([out.width, out.height], [BOX.width, BOX.height]);
  });

  test('no result is ever wider than 1600 or taller than 1200', async () => {
    for (const [w, h] of [
      [4000, 100],
      [100, 4000],
      [5000, 5000],
      [1601, 1201],
      [3000, 1000],
    ]) {
      const out = await prepareUpload(upload(await png(w, h), 'x.png', 'image/png'));
      assert.ok(out.width! <= BOX.width, `${w}x${h} -> width ${out.width}`);
      assert.ok(out.height! <= BOX.height, `${w}x${h} -> height ${out.height}`);
      // The ratio survives to within a rounded pixel.
      assert.ok(Math.abs(out.width! / out.height! - w / h) < 0.02, `${w}x${h} ratio`);
    }
  });
});

describe('prepareUpload — what gets stored', () => {
  test('every raster format becomes image/webp', async () => {
    const cases: Array<[Buffer, string]> = [
      [await png(50, 50), 'image/png'],
      [await jpeg(50, 50), 'image/jpeg'],
      [await sharp({ create: { width: 50, height: 50, channels: 3, background: '#111' } }).webp().toBuffer(), 'image/webp'],
      [await sharp({ create: { width: 50, height: 50, channels: 3, background: '#222' } }).avif().toBuffer(), 'image/avif'],
      [await animatedGif(50, 50), 'image/gif'],
    ];
    for (const [buffer, mime] of cases) {
      const out = await prepareUpload(upload(buffer, `f.${mime.split('/')[1]}`, mime));
      assert.equal(out.mime, 'image/webp', mime);
      assert.equal((await meta(out.buffer)).format, 'webp', mime);
    }
  });

  test('size and hash describe the converted bytes, not the original', async () => {
    const original = await png(3000, 2000);
    const out = await prepareUpload(upload(original, 'big.png', 'image/png'));
    assert.notEqual(Buffer.compare(out.buffer, original), 0);
    assert.equal(out.size, out.buffer.length);
    assert.equal(out.hash, createHash('sha256').update(out.buffer).digest('hex'));
  });

  test('the same original always produces the same bytes and the same hash', async () => {
    // Duplicate detection is a hash lookup, so it is only as good as this: the
    // same file uploaded twice has to normalise to byte-identical output, or the
    // second copy is stored as a new file and nothing is ever detected.
    const original = await jpeg(2400, 1600);
    const first = await prepareUpload(upload(original, 'holiday.jpg', 'image/jpeg'));
    const second = await prepareUpload(upload(original, 'holiday-copy.jpg', 'image/jpeg'));
    assert.equal(Buffer.compare(first.buffer, second.buffer), 0);
    assert.equal(first.hash, second.hash);
  });

  test('the name plays no part in the hash', async () => {
    const original = await png(300, 200);
    const a = await prepareUpload(upload(original, 'a.png', 'image/png'));
    const b = await prepareUpload(upload(original, 'completely-different.png', 'image/png'));
    assert.equal(a.hash, b.hash);
    assert.notEqual(a.originalName, b.originalName);
  });

  test('different pictures get different hashes', async () => {
    const a = await prepareUpload(upload(await png(300, 200), 'a.png', 'image/png'));
    const b = await prepareUpload(upload(await jpeg(300, 200), 'b.jpg', 'image/jpeg'));
    const c = await prepareUpload(upload(await png(300, 201), 'c.png', 'image/png'));
    assert.equal(new Set([a.hash, b.hash, c.hash]).size, 3);
  });

  test('the stored name takes the .webp extension', async () => {
    const cases: Array<[string, string]> = [
      ['photo.png', 'photo.webp'],
      ['PHOTO.JPG', 'PHOTO.webp'],
      ['my.photo.final.jpeg', 'my.photo.final.webp'],
      ['no-extension', 'no-extension.webp'],
      ['Καλοκαίρι.png', 'Καλοκαίρι.webp'],
      ['.hidden', '.hidden.webp'],
    ];
    for (const [given, expected] of cases) {
      const out = await prepareUpload(upload(await png(10, 10), given, 'image/png'));
      assert.equal(out.originalName, expected, given);
    }
  });

  test('a very long name is cut to 255 characters and still ends in .webp', async () => {
    const out = await prepareUpload(upload(await png(10, 10), `${'a'.repeat(300)}.png`, 'image/png'));
    assert.ok([...out.originalName].length <= 255, `length ${[...out.originalName].length}`);
    assert.ok(out.originalName.endsWith('.webp'), out.originalName);
  });

  test('a long name of astral characters is not cut through a surrogate pair', async () => {
    const out = await prepareUpload(upload(await png(10, 10), `${'😀'.repeat(300)}.png`, 'image/png'));
    assert.ok([...out.originalName].length <= 255);
    assert.equal(out.originalName.includes('�'), false);
    assert.ok(out.originalName.endsWith('.webp'));
  });

  test('an animated GIF keeps its frames', async () => {
    const out = await prepareUpload(upload(await animatedGif(3000, 2000), 'loop.gif', 'image/gif'));
    const m = await meta(out.buffer);
    assert.equal(m.format, 'webp');
    assert.equal(m.pages, 2);
    // Reported dimensions are one frame's, not the frames stacked.
    assert.deepEqual([out.width, out.height], [1600, 1067]);
  });

  test('EXIF orientation is applied and the EXIF block is dropped', async () => {
    const rotated = await sharp({ create: { width: 400, height: 200, channels: 3, background: '#123' } })
      .withMetadata({ orientation: 6, exif: { IFD0: { Copyright: 'praion', Artist: 'someone' } } })
      .jpeg()
      .toBuffer();
    const out = await prepareUpload(upload(rotated, 'turned.jpg', 'image/jpeg'));
    // Orientation 6 means "rotate 90°": the stored pixels are already turned.
    assert.deepEqual([out.width, out.height], [200, 400]);
    const m = await sharp(out.buffer).metadata();
    assert.equal(m.exif, undefined);
  });
});

describe('prepareUpload — the AVIF companion', () => {
  test('a still image also gets an AVIF of the same size', async () => {
    const out = await prepareUpload(upload(await photo(3000, 2000), 'wide.png', 'image/png'));
    assert.ok(out.avif, 'an AVIF was produced');
    const m = await sharp(out.avif).metadata();
    assert.equal(m.format, 'heif');
    assert.equal(m.compression, 'av1');
    assert.deepEqual([m.width, m.height], [out.width, out.height]);
  });

  test('the row still describes the WebP: mime, size and hash ignore the AVIF', async () => {
    const out = await prepareUpload(upload(await photo(800, 600), 'p.png', 'image/png'));
    assert.ok(out.avif);
    assert.equal(out.mime, 'image/webp');
    assert.equal(out.size, out.buffer.length);
    assert.equal(out.hash, createHash('sha256').update(out.buffer).digest('hex'));
  });

  test('the AVIF is turned the right way up and carries no EXIF, like the WebP', async () => {
    // Detailed rather than flat: a flat colour compresses so well as WebP that
    // the AVIF is (rightly) discarded as the bigger of the two.
    const rotated = await sharp(await photo(400, 200))
      .withMetadata({ orientation: 6, exif: { IFD0: { Artist: 'someone' } } })
      .jpeg()
      .toBuffer();
    const out = await prepareUpload(upload(rotated, 'turned.jpg', 'image/jpeg'));
    assert.ok(out.avif);
    const m = await sharp(out.avif).metadata();
    assert.deepEqual([m.width, m.height], [200, 400]);
    assert.equal(m.exif, undefined);
  });

  test('an animation gets no AVIF, because it would lose its frames', async () => {
    const out = await prepareUpload(upload(await animatedGif(300, 200), 'loop.gif', 'image/gif'));
    assert.equal(out.avif, null);
  });

  test('an AVIF bigger than the WebP is not kept', async () => {
    // At 1x1 the AVIF container alone outweighs the whole WebP; serving it
    // would make the page heavier for exactly the browsers meant to gain.
    const out = await prepareUpload(upload(await png(1, 1), 'dot.png', 'image/png'));
    assert.equal(out.avif, null);
  });

  test('a PDF gets no AVIF', async () => {
    const pdf = Buffer.from('%PDF-1.4\n%%EOF\n', 'latin1');
    const out = await prepareUpload(upload(pdf, 'terms.pdf', 'application/pdf'));
    assert.equal(out.avif, null);
  });
});

describe('prepareUpload — what it refuses and what it leaves alone', () => {
  test('a PDF is stored exactly as uploaded', async () => {
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n', 'latin1');
    const out = await prepareUpload(upload(pdf, 'terms.pdf', 'application/pdf'));
    assert.equal(Buffer.compare(out.buffer, pdf), 0);
    assert.equal(out.mime, 'application/pdf');
    assert.equal(out.originalName, 'terms.pdf');
    assert.equal(out.width, null);
    assert.equal(out.height, null);
    assert.equal(out.size, pdf.length);
  });

  test('a long PDF name is cut to 255 characters and keeps its extension', async () => {
    const pdf = Buffer.from('%PDF-1.4\n%%EOF\n', 'latin1');
    const out = await prepareUpload(upload(pdf, `${'p'.repeat(300)}.pdf`, 'application/pdf'));
    assert.ok([...out.originalName].length <= 255, `length ${[...out.originalName].length}`);
  });

  test('an animation with more frames than the pixel budget is refused', async () => {
    // Each frame is modest and the file is tiny; it is the 60 of them together
    // that would cost gigabytes to decode. A single-page probe would wave this
    // through, so the guard has to count the frames.
    const frames: Buffer[] = [];
    for (let i = 0; i < 24; i += 1) {
      frames.push(
        await sharp({
          create: { width: 2000, height: 900, channels: 3, background: { r: (i * 9) % 255, g: (i * 7) % 255, b: (i * 11) % 255 } },
        })
          .png()
          .toBuffer(),
      );
    }
    const bomb = await sharp(frames, { join: { animated: true } }).gif().toBuffer();
    assert.ok(bomb.length < 10 * 1024 * 1024, 'fixture must pass the route size cap');
    await assert.rejects(
      prepareUpload(upload(bomb, 'many-frames.gif', 'image/gif')),
      (err: unknown) => err instanceof MediaProcessingError,
    );
  });

  test('bytes that claim to be an image but cannot be decoded are refused', async () => {
    const liar = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('not actually a png'),
    ]);
    await assert.rejects(
      prepareUpload(upload(liar, 'liar.png', 'image/png')),
      (err: unknown) => err instanceof MediaProcessingError,
    );
  });

  test('a decompression bomb is refused rather than decoded', async () => {
    // 42 megapixels of one colour: about 1.2 MB on the wire, far under the
    // route's 10 MB cap, and gigabytes once decoded.
    const bomb = await sharp({ create: { width: 7000, height: 6000, channels: 3, background: '#fff' } })
      .png({ compressionLevel: 1 })
      .toBuffer();
    assert.ok(bomb.length < 10 * 1024 * 1024, 'fixture must pass the route size cap');
    await assert.rejects(
      prepareUpload(upload(bomb, 'bomb.png', 'image/png')),
      (err: unknown) => err instanceof MediaProcessingError,
    );
  });

  test('an empty buffer is refused', async () => {
    await assert.rejects(
      prepareUpload(upload(Buffer.alloc(0), 'empty.png', 'image/png')),
      (err: unknown) => err instanceof MediaProcessingError,
    );
  });
});
