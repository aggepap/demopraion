import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import sharp from 'sharp';

import { fetchRemoteImage, toWebp } from '@/cms/core/media/image';
import { checkRemoteImageUrl } from '@/cms/core/media/remote-url';

/**
 * Fetching a third-party image (a Google reviewer's avatar) and storing it
 * locally, so the visitor's browser never talks to Google before consent.
 *
 * The URL comes from an external API response, so it is treated as untrusted:
 * HTTPS only, to hosts the caller names, with no redirects and a size cap.
 */

const allow = ['*.googleusercontent.com', 'maps.gstatic.com'];

describe('checkRemoteImageUrl', () => {
  test('accepts an https URL on an allowed host or subdomain', () => {
    for (const url of [
      'https://lh3.googleusercontent.com/a/photo=s96',
      'https://maps.gstatic.com/x.png',
    ]) {
      assert.equal(checkRemoteImageUrl(url, allow).ok, true, url);
    }
  });

  test('refuses everything else', () => {
    for (const url of [
      'http://lh3.googleusercontent.com/a', // not https
      'https://googleusercontent.com.evil.test/a', // suffix trick
      'https://evilgoogleusercontent.com/a', // no dot boundary
      'https://googleusercontent.com/a', // wildcard needs a subdomain
      'https://127.0.0.1/a',
      'https://[::1]/a',
      'https://localhost/a',
      'https://lh3.googleusercontent.com:8443/a', // non-default port
      'https://user:pw@lh3.googleusercontent.com/a', // credentials
      'file:///etc/passwd',
      'not a url',
      '',
    ]) {
      assert.equal(checkRemoteImageUrl(url, allow).ok, false, url);
    }
  });

  test('an empty allowlist allows nothing', () => {
    assert.equal(checkRemoteImageUrl('https://maps.gstatic.com/x.png', []).ok, false);
  });
});

async function png(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#c33' } })
    .png()
    .toBuffer();
}

function fakeFetch(response: Response, seen: { init?: RequestInit; calls: number }) {
  return async (_url: string | URL | Request, init?: RequestInit) => {
    seen.calls += 1;
    seen.init = init;
    return response;
  };
}

describe('toWebp', () => {
  test('re-encodes as WebP and caps the width', async () => {
    const out = await toWebp(await png(400, 200), { maxWidth: 96 });
    const meta = await sharp(out).metadata();
    assert.equal(meta.format, 'webp');
    assert.equal(meta.width, 96);
    assert.equal(meta.height, 48);
  });

  test('never enlarges a smaller image', async () => {
    const out = await toWebp(await png(40, 40), { maxWidth: 96 });
    assert.equal((await sharp(out).metadata()).width, 40);
  });

  test('refuses bytes that are not an image', async () => {
    await assert.rejects(toWebp(Buffer.from('<svg onload=alert(1)>'), { maxWidth: 96 }));
  });
});

describe('fetchRemoteImage', () => {
  const opts = { allowHosts: allow, maxBytes: 1024 * 1024, timeoutMs: 1000 };

  test('returns the body of an allowed image and does not follow redirects', async () => {
    const body = await png(10, 10);
    const seen: { init?: RequestInit; calls: number } = { calls: 0 };
    const res = new Response(new Uint8Array(body), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    });
    const out = await fetchRemoteImage('https://lh3.googleusercontent.com/a', {
      ...opts,
      fetchImpl: fakeFetch(res, seen),
    });
    assert.equal(Buffer.compare(out, body), 0);
    assert.equal(seen.init?.redirect, 'manual');
  });

  test('refuses a disallowed URL without making a request', async () => {
    const seen = { calls: 0 };
    await assert.rejects(
      fetchRemoteImage('https://evil.test/a.png', {
        ...opts,
        fetchImpl: fakeFetch(new Response(''), seen),
      }),
    );
    assert.equal(seen.calls, 0);
  });

  test('a redirect is an error, not a hop', async () => {
    const res = new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/' } });
    await assert.rejects(
      fetchRemoteImage('https://lh3.googleusercontent.com/a', {
        ...opts,
        fetchImpl: fakeFetch(res, { calls: 0 }),
      }),
    );
  });

  test('refuses a non-image content type', async () => {
    const res = new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } });
    await assert.rejects(
      fetchRemoteImage('https://lh3.googleusercontent.com/a', {
        ...opts,
        fetchImpl: fakeFetch(res, { calls: 0 }),
      }),
    );
  });

  test('refuses a body larger than the cap, even without a content-length', async () => {
    const res = new Response(new Uint8Array(2048), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    });
    await assert.rejects(
      fetchRemoteImage('https://lh3.googleusercontent.com/a', {
        ...opts,
        maxBytes: 1024,
        fetchImpl: fakeFetch(res, { calls: 0 }),
      }),
    );
  });

  test('refuses a non-2xx response', async () => {
    const res = new Response('', { status: 404, headers: { 'content-type': 'image/png' } });
    await assert.rejects(
      fetchRemoteImage('https://lh3.googleusercontent.com/a', {
        ...opts,
        fetchImpl: fakeFetch(res, { calls: 0 }),
      }),
    );
  });
});
