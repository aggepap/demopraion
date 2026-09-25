#!/usr/bin/env node
/**
 * Update this site's CMS from an update zip.
 *
 *   npm run cms:update -- ../cms-update-1.4.0.zip            dry run: what would change
 *   npm run cms:update -- ../cms-update-1.4.0.zip --apply    install it
 *
 * Options: --target <dir> (default: here), --force (skip the clean-git check),
 * --skip-install, --skip-migrate, --reinstall (same version again),
 * --allow-downgrade.
 *
 * The zip carries its own installer, and that is the one that runs: this file
 * verifies the archive with the site's current reader, unpacks the update's
 * `src/cms/update/` to a temporary folder and hands over. So a site always
 * installs with the rules of the version it is moving TO — and a site too old to
 * have this file can run it straight from a CMS checkout with --target.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { readUpdate } from './manifest.mjs';

const INSTALLER_DIR = 'src/cms/update/';

function parseArgs(argv) {
  const flags = new Set();
  const values = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--target') values.target = argv[++i];
    else if (a.startsWith('--')) flags.add(a.slice(2));
    else positional.push(a);
  }
  return { flags, values, positional };
}

async function main() {
  const { flags, values, positional } = parseArgs(process.argv.slice(2));
  const known = new Set([
    'apply',
    'force',
    'skip-install',
    'skip-migrate',
    'reinstall',
    'allow-downgrade',
  ]);
  const unknown = [...flags].filter((f) => !known.has(f));
  if (positional.length !== 1 || unknown.length) {
    if (unknown.length)
      console.error(`Unknown option(s): ${unknown.map((f) => `--${f}`).join(', ')}`);
    console.error(
      'Usage: npm run cms:update -- <update.zip> [--apply] [--target <site>] [--force]'
    );
    console.error('       [--skip-install] [--skip-migrate] [--reinstall] [--allow-downgrade]');
    process.exit(2);
  }

  const zip = readFileSync(resolve(positional[0]));
  // Verified with this site's reader before any of the update's code is run.
  const { files } = readUpdate(zip);

  let install = await import('./install.mjs');
  const bundled = [...files.keys()].filter(
    // The installer's own modules only — flat, siblings of install.mjs.
    (p) =>
      p.startsWith(INSTALLER_DIR) &&
      p.endsWith('.mjs') &&
      !p.slice(INSTALLER_DIR.length).includes('/')
  );
  let tmp;
  if (bundled.includes(`${INSTALLER_DIR}install.mjs`)) {
    tmp = mkdtempSync(join(tmpdir(), 'cms-update-'));
    for (const path of bundled)
      writeFileSync(join(tmp, path.slice(INSTALLER_DIR.length)), files.get(path));
    install = await import(pathToFileURL(join(tmp, 'install.mjs')).href);
  }

  try {
    const { applied, plan } = await install.runInstall({
      zip,
      target: resolve(values.target ?? process.cwd()),
      apply: flags.has('apply'),
      force: flags.has('force'),
      skipInstall: flags.has('skip-install'),
      skipMigrate: flags.has('skip-migrate'),
      reinstall: flags.has('reinstall'),
      allowDowngrade: flags.has('allow-downgrade'),
    });
    if (plan.status === 'refused') process.exitCode = 1;
    else if (flags.has('apply') && !applied && plan.status !== 'up-to-date') process.exitCode = 1;
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
