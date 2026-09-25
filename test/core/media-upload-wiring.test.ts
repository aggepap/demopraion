import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

/**
 * The WebP box has to be the *default*, not an option a screen remembers to ask
 * for.
 *
 * There is one upload endpoint and one function that writes the bytes, and that
 * is the only reason "every image upload place in the CMS" can be a true
 * statement. These checks pin that shape: if someone later adds a second byte
 * writer, or a screen that posts somewhere else, the conversion silently stops
 * being universal and this test says so.
 */

const ROOT = process.cwd();
const SCAN = ['src/cms', 'src/app/api/cms', 'src/app/admin'];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const files = SCAN.flatMap((dir) => walk(join(ROOT, dir))).map((f) => ({
  path: relative(ROOT, f),
  text: readFileSync(f, 'utf8'),
}));

const filesContaining = (needle: string) => files.filter((f) => f.text.includes(needle)).map((f) => f.path);

test('only the media service writes uploaded bytes to storage', () => {
  assert.deepEqual(filesContaining('getStorage().save('), ['src/cms/core/media/service.ts']);
});

test('only the media service inserts a media row', () => {
  assert.deepEqual(filesContaining('schema.mediaFiles).values'), ['src/cms/core/media/service.ts']);
});

test('the media service normalises before it stores', () => {
  const service = files.find((f) => f.path === 'src/cms/core/media/service.ts')!;
  assert.match(service.text, /from '\.\/normalize'/);
  assert.match(service.text, /prepareUpload\(/);
  const prepareAt = service.text.indexOf('prepareUpload(');
  const saveAt = service.text.indexOf('getStorage().save(');
  assert.ok(prepareAt > -1 && saveAt > prepareAt, 'bytes are prepared before they are saved');
});

test('the media service stores the AVIF beside the WebP and deletes both', () => {
  const service = files.find((f) => f.path === 'src/cms/core/media/service.ts')!;
  assert.match(service.text, /getStorage\(\)\.save\(avifKey\(uuid\), file\.avif\)/);
  assert.match(service.text, /getStorage\(\)\.delete\(avifKey\(row\.uuid\)\)/);
});

test('the public file route negotiates on Accept and says so with Vary', () => {
  const route = files.find((f) => f.path === 'src/app/api/cms/media/file/[uuid]/route.ts')!;
  assert.match(route.text, /readForAccept\(/);
  assert.match(route.text, /headers\.get\('accept'\)/);
  assert.match(route.text, /Vary/);
});

test('the admin posts uploads to the one upload endpoint', () => {
  assert.deepEqual(filesContaining("'/api/cms/media/upload'").concat(filesContaining('`/api/cms/media/upload`')), [
    'src/cms/admin/api-client.ts',
  ]);
  // Every picker and grid goes through that client, so none of them builds its own request.
  assert.deepEqual(filesContaining('new FormData()').filter((p) => p.startsWith('src/cms/admin/')), [
    'src/cms/admin/api-client.ts',
  ]);
});

test('the service looks for an existing file by hash before it stores anything', () => {
  const service = files.find((f) => f.path === 'src/cms/core/media/service.ts')!;
  const lookupAt = service.text.indexOf('findMediaByHash(');
  const saveAt = service.text.indexOf('getStorage().save(');
  assert.ok(lookupAt > -1, 'uploadMedia looks the hash up');
  assert.ok(lookupAt < saveAt, 'the lookup comes before the write, or it saves a second copy first');
});

test('a duplicate upload is a 200 that creates nothing, not a 201', () => {
  const route = files.find((f) => f.path === 'src/app/api/cms/media/upload/route.ts')!;
  assert.match(route.text, /row\.duplicate \? 200 : 201/);
  // Nothing was written, so nothing is audited: an audit entry for a duplicate
  // would name a file this upload did not create.
  const auditAt = route.text.indexOf('logAudit(');
  const guardAt = route.text.indexOf('if (!row.duplicate)');
  assert.ok(guardAt > -1 && guardAt < auditAt, 'the audit entry is skipped for a duplicate');
});

test('both upload screens report duplicates through the shared notice', () => {
  for (const screen of ['src/cms/admin/MediaLibrary.tsx', 'src/cms/admin/fields/MediaPicker.tsx']) {
    const text = files.find((f) => f.path === screen)!.text;
    assert.match(text, /duplicateNotice/, screen);
    assert.match(text, /\.duplicate/, screen);
  }
});

test('the upload route answers 415 when the bytes cannot be processed', () => {
  const route = files.find((f) => f.path === 'src/app/api/cms/media/upload/route.ts')!;
  assert.match(route.text, /MediaProcessingError/);
  assert.match(route.text, /415/);
});
