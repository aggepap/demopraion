/**
 * The update package: a zip holding `manifest.json`, the files to install under
 * `files/`, and the contract ("glue") files under `glue/` — the latter only so a
 * site can be told which of its own copies differ, never to be written.
 *
 * The manifest is the only list the installer acts on, and it is not trusted:
 * every path is re-classified by the installer's own rules, every file checked
 * against its SHA-256, and anything the manifest does not account for refuses
 * the whole package. A zip that names a stylesheet, a page or the brand file
 * cannot be installed, whatever it claims.
 */
import { createHash } from 'node:crypto';

import { PAYLOAD_KINDS, classifyPath, envKeys } from './plan.mjs';
import { isVersion } from './version.mjs';
import { readZip, writeZip } from './zip.mjs';

export const MANIFEST_FORMAT = 1;
const MANIFEST = 'manifest.json';

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/**
 * npm runs these by itself — the install hooks during `npm install`, which the
 * installer triggers, and any `pre<name>`/`post<name>` around another script — so
 * a script by one of these names would execute before anyone reviewed it.
 */
const LIFECYCLE = /^(pre|post)|^(install|uninstall|prepare|publish|pack|shrinkwrap|dependencies)$/;

/** A script an update may add: a plain name, running core code. */
const isCoreScript = (name, command) =>
  /^[a-z][a-z0-9:-]*$/.test(name) && !LIFECYCLE.test(name) && command.includes('src/cms/');

/** Scripts that run core code: a site needs them to use what the core ships. */
function coreScripts(scripts = {}) {
  return Object.fromEntries(
    Object.entries(scripts).filter(([name, command]) => isCoreScript(name, command))
  );
}

/**
 * Build an update zip from a CMS checkout's files.
 *
 * `files` may be the whole tree: only core, core tests and storefront scaffolds
 * are packed as files, glue as a reference, and everything else is left out.
 *
 * @param {{ version: string, commit: string, branch: string, builtAt: string,
 *   files: { path: string, data: Buffer }[], basePackage: any, baseEnv: string,
 *   baseModules: string[] }} input
 * @returns {Buffer}
 */
export function packUpdate({
  version,
  commit,
  branch,
  builtAt,
  files,
  basePackage,
  baseEnv,
  baseModules,
}) {
  if (!isVersion(version)) throw new Error(`Not a version: ${JSON.stringify(version)}`);

  const entries = [];
  const listed = [];
  const glue = [];
  for (const { path, data } of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const kind = classifyPath(path);
    if (PAYLOAD_KINDS.has(kind)) {
      listed.push({ path, kind, sha256: sha256(data) });
      entries.push({ path: `files/${path}`, data });
    } else if (kind === 'glue') {
      glue.push({ path, sha256: sha256(data) });
      entries.push({ path: `glue/${path}`, data });
    }
  }

  const manifest = {
    format: MANIFEST_FORMAT,
    version,
    commit,
    branch,
    builtAt,
    files: listed,
    glue,
    package: {
      dependencies: basePackage.dependencies ?? {},
      devDependencies: basePackage.devDependencies ?? {},
      scripts: coreScripts(basePackage.scripts),
    },
    env: envKeys(baseEnv),
    modules: baseModules,
  };
  return writeZip([
    { path: MANIFEST, data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) },
    ...entries,
  ]);
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStringMap = (v) => isObject(v) && Object.values(v).every((x) => typeof x === 'string');

/**
 * Open and verify an update zip.
 *
 * @param {Buffer} zip
 * @returns {{ manifest: any, files: Map<string, Buffer>, glue: Map<string, Buffer> }}
 */
export function readUpdate(zip) {
  const entries = new Map(readZip(zip).map((e) => [e.path, e.data]));
  const raw = entries.get(MANIFEST);
  if (!raw) throw new Error('Not a CMS update: the archive has no manifest.json.');

  let manifest;
  try {
    manifest = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new Error('Not a CMS update: manifest.json is not valid JSON.');
  }
  const bad = (why) => {
    throw new Error(`The update's manifest is invalid: ${why}.`);
  };

  if (!isObject(manifest)) bad('not an object');
  if (manifest.format !== MANIFEST_FORMAT) {
    bad(
      `format ${JSON.stringify(manifest.format)} is not one this installer reads (${MANIFEST_FORMAT}) — update the installer first`
    );
  }
  if (!isVersion(manifest.version)) bad('no valid version');
  if (typeof manifest.commit !== 'string') bad('no commit');
  if (!Array.isArray(manifest.files) || !Array.isArray(manifest.glue)) bad('no file list');
  if (!isObject(manifest.package)) bad('no package section');
  for (const section of ['dependencies', 'devDependencies', 'scripts']) {
    if (!isStringMap(manifest.package[section]))
      bad(`package.${section} is not a name → string map`);
  }
  for (const [name, command] of Object.entries(manifest.package.scripts)) {
    if (!isCoreScript(name, command)) {
      bad(
        `script "${name}" is not one an update may add (a core command, and never an npm lifecycle hook)`
      );
    }
  }
  if (!Array.isArray(manifest.env) || !manifest.env.every((k) => typeof k === 'string'))
    bad('env is not a list');
  if (
    !Array.isArray(manifest.modules) ||
    !manifest.modules.every((m) => /^[a-zA-Z][a-zA-Z0-9]*$/.test(m))
  ) {
    bad('modules is not a list of names');
  }

  const accounted = new Set([MANIFEST]);
  const take = (prefix, file, allowed) => {
    if (!isObject(file) || typeof file.path !== 'string' || typeof file.sha256 !== 'string')
      bad('a file entry is malformed');
    const kind = classifyPath(file.path);
    // Re-classified here, by these rules: a manifest cannot talk its way past them.
    if (!allowed(kind)) bad(`${file.path} is a ${kind} file, which an update may not carry`);
    const key = `${prefix}${file.path}`;
    const data = entries.get(key);
    if (!data) bad(`${file.path} is listed but missing from the archive`);
    if (sha256(data) !== file.sha256)
      bad(`${file.path} does not match its checksum — the archive was altered or damaged`);
    if (accounted.has(key)) bad(`${file.path} is listed twice`);
    accounted.add(key);
    return [file.path, data];
  };

  const files = new Map(
    manifest.files.map((f) =>
      take('files/', f, (kind) => PAYLOAD_KINDS.has(kind) && kind === f.kind)
    )
  );
  const glue = new Map(manifest.glue.map((f) => take('glue/', f, (kind) => kind === 'glue')));

  for (const key of entries.keys()) {
    if (!accounted.has(key)) bad(`${key} is in the archive but not in the manifest`);
  }
  return { manifest, files, glue };
}
