/**
 * A minimal ZIP reader and writer, for CMS update packages.
 *
 * Node has no zip support built in, and the installer has to run on a site
 * before `npm install` — possibly the very install that brings a zip library in.
 * So it is written here against the format directly: deflate (or store), UTF-8
 * names, one disk, no encryption, no ZIP64. That is everything `packUpdate`
 * produces, and anything else is refused rather than guessed at.
 *
 * Every entry name is checked on the way in and on the way out: an archive that
 * names `../` or an absolute path is refused whole ("zip slip"), before a single
 * byte reaches the disk.
 */
import { deflateRawSync, inflateRawSync } from 'node:zlib';

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const UTF8_FLAG = 0x0800;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A relative, forward-slash path that stays inside the folder it is unpacked in. */
export function assertSafePath(path) {
  const ok =
    typeof path === 'string' &&
    path.length > 0 &&
    path.length <= 1024 &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    !path.includes(':') &&
    !path.includes('\0') &&
    path.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
  if (!ok) throw new Error(`Unsafe path in update archive: ${JSON.stringify(path)}`);
}

/**
 * @param {{ path: string, data: Buffer }[]} entries
 * @param {{ unsafe?: boolean }} [options] `unsafe` skips the name check — tests only.
 * @returns {Buffer}
 */
export function writeZip(entries, options = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const { path, data } of entries) {
    if (!options.unsafe) assertSafePath(path);
    const name = Buffer.from(path, 'utf8');
    const deflated = deflateRawSync(data);
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt32LE(0x00210000, 10); // 1980-01-01 00:00 — builds are reproducible
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt32LE(0x00210000, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);

    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }

  const centralDir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDir, end]);
}

/**
 * @param {Buffer} zip
 * @returns {{ path: string, data: Buffer }[]}
 */
export function readZip(zip) {
  const fail = (why) => {
    throw new Error(`Not a valid update archive: ${why}.`);
  };
  if (!Buffer.isBuffer(zip) || zip.length < 22) fail('too short');

  let endAt = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (zip.readUInt32LE(i) === END) {
      endAt = i;
      break;
    }
  }
  if (endAt < 0) fail('no end-of-archive record');

  const count = zip.readUInt16LE(endAt + 10);
  let at = zip.readUInt32LE(endAt + 16);
  const out = [];

  for (let i = 0; i < count; i++) {
    if (at + 46 > zip.length || zip.readUInt32LE(at) !== CENTRAL) fail('broken central directory');
    const flags = zip.readUInt16LE(at + 8);
    const method = zip.readUInt16LE(at + 10);
    const crc = zip.readUInt32LE(at + 16);
    const size = zip.readUInt32LE(at + 20);
    const usize = zip.readUInt32LE(at + 24);
    const nameLen = zip.readUInt16LE(at + 28);
    const extraLen = zip.readUInt16LE(at + 30);
    const commentLen = zip.readUInt16LE(at + 32);
    const localAt = zip.readUInt32LE(at + 42);
    const path = zip.toString('utf8', at + 46, at + 46 + nameLen);
    at += 46 + nameLen + extraLen + commentLen;

    if (flags & 0x1) fail(`${path} is encrypted`);
    assertSafePath(path);
    if (localAt + 30 > zip.length || zip.readUInt32LE(localAt) !== LOCAL)
      fail(`${path} has no local header`);
    const start = localAt + 30 + zip.readUInt16LE(localAt + 26) + zip.readUInt16LE(localAt + 28);
    if (start + size > zip.length) fail(`${path} is truncated`);
    const body = zip.subarray(start, start + size);

    let data;
    try {
      if (method === 0) data = Buffer.from(body);
      else if (method === 8) data = inflateRawSync(body);
      else fail(`${path} uses an unsupported compression method`);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Not a valid')) throw err;
      fail(`${path} does not decompress`);
    }
    if (data.length !== usize || crc32(data) !== crc)
      fail(`${path} is corrupted (checksum mismatch)`);
    out.push({ path, data });
  }
  return out;
}
