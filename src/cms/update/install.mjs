/**
 * Install a CMS update into a site checkout.
 *
 * Dry run unless `apply`. Applying refuses a target that is not a clean git
 * checkout (unless `force`), so every update is one reviewable commit that
 * `git checkout . && git clean -fd` undoes. What it touches:
 *
 *   - core files: written; core files the update dropped: deleted;
 *   - storefront scaffolds: added only where the site has none;
 *   - package.json: missing dependencies and core scripts added, nothing changed;
 *   - src/cms/version.json (it is core) and .cms-origin.json: the new version.
 *
 * Never the front end, never `site.brand.ts` / `globals.css`, never the database
 * beyond the migrations the update brings — and no migration touches settings.
 * Then `npm install` (only if dependencies were added) and `npm run db:migrate`.
 */
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

import { readUpdate } from './manifest.mjs';
import { classifyPath, planInstall } from './plan.mjs';

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  '.next',
  '.turbo',
  'dist',
  'coverage',
  '.history',
]);

/** Repo-relative paths of the site's files that an update could have an opinion on. */
function siteFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) {
        const path = relative(root, abs).split(sep).join('/');
        const kind = classifyPath(path);
        if (kind === 'site' || kind === 'base-only') continue;
        out.push({ path, sha256: createHash('sha256').update(readFileSync(abs)).digest('hex') });
      }
    }
  };
  walk(root);
  return out;
}

const readText = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : undefined);
const readJson = (path) => {
  const text = readText(path);
  return text === undefined ? undefined : JSON.parse(text);
};

/** The version the site runs: the core's own record, else the last install's. */
function siteVersion(root) {
  return (
    readJson(join(root, 'src/cms/version.json'))?.version ??
    readJson(join(root, '.cms-origin.json'))?.cmsVersion ??
    null
  );
}

function isCleanGit(root) {
  try {
    return (
      execFileSync('git', ['-C', root, 'status', '--porcelain'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() === ''
    );
  } catch {
    return false;
  }
}

/** Run a command in the site, streaming its output; rejects on a non-zero exit. */
export function defaultRun(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited with ${code}`))
    );
  });
}

/** Remove now-empty folders left by deleted core files, stopping at the site root. */
function pruneEmpty(root, dir) {
  while (dir !== root && dir.startsWith(root) && existsSync(dir) && readdirSync(dir).length === 0) {
    rmdirSync(dir);
    dir = dirname(dir);
  }
}

function report(plan, manifest, version, log) {
  const count = (kind) => plan.write.filter((w) => w.kind === kind).length;
  log(
    `CMS update ${manifest.version} (commit ${manifest.commit.slice(0, 8)}, built ${manifest.builtAt ?? '?'})`
  );
  log(`This site runs ${version ?? 'an unversioned core'}.`);
  if (plan.status !== 'ok') {
    log(`\n${plan.reason}`);
    return;
  }
  log(`\nCore            ${count('core')} file(s) to write, ${plan.delete.length} to delete`);
  log(`Core tests      ${count('core-tests')} file(s)`);
  log(`New storefront  ${count('scaffold')} file(s) the site has not got yet`);
  log(`Unchanged       ${plan.unchanged} file(s)`);

  const list = (title, items) => {
    if (!items.length) return;
    log(`\n${title}`);
    for (const item of items.slice(0, 15)) log(`  ${item}`);
    if (items.length > 15) log(`  … and ${items.length - 15} more`);
  };
  list('Core files the update removed (deleted here too):', plan.delete);
  list(
    'Your own storefront versions — LEFT ALONE. The CMS moved on; port anything you want:',
    plan.review.filter((r) => r.reason === 'yours-already').map((r) => r.path)
  );
  list(
    'Contract files — never written. Compare with `unzip -p <update.zip> glue/<path> | diff -u <path> -`:',
    plan.review
      .filter((r) => r.kind === 'glue')
      .map((r) => `${r.path}${r.reason === 'glue-missing' ? '  (missing here)' : ''}`)
  );
  const { add, differs } = plan.package;
  list('package.json — added:', [
    ...Object.entries(add.dependencies).map(([n, v]) => `dependency ${n}@${v}`),
    ...Object.entries(add.devDependencies).map(([n, v]) => `devDependency ${n}@${v}`),
    ...Object.entries(add.scripts).map(([n]) => `script "${n}"`),
  ]);
  list(
    'package.json — versions that differ (kept as the site has them; raise by hand if the core needs it):',
    differs.map((d) => `${d.name}  site ${d.site}, update ${d.update}`)
  );
  list('Environment variables the core now uses (.env.local):', plan.followUps.missingEnv);
  list(
    'Module flags to add to src/site.config.ts (all default to off):',
    plan.followUps.missingModules
  );
  if (plan.followUps.brandNotWired) {
    log("\nBranding lives in the database, but this site's layout does not render it yet.");
    log(
      '  Run `npm run db:brand-import`, then wire BrandStyle/BrandProvider — see the CMS docs, "Branding".'
    );
  }
}

/**
 * @param {{ zip: Buffer, target: string, apply?: boolean, force?: boolean,
 *   skipInstall?: boolean, skipMigrate?: boolean, reinstall?: boolean,
 *   allowDowngrade?: boolean,
 *   run?: (cmd: string, args: string[], cwd: string) => Promise<void>,
 *   log?: (line: string) => void }} options
 * @returns {Promise<{ applied: boolean, plan: ReturnType<typeof planInstall> }>}
 */
export async function runInstall({
  zip,
  target,
  apply = false,
  force = false,
  skipInstall = false,
  skipMigrate = false,
  reinstall = false,
  allowDowngrade = false,
  run = defaultRun,
  log = console.log,
}) {
  const pkgPath = join(target, 'package.json');
  const sitePackage = readJson(pkgPath);
  if (!sitePackage)
    throw new Error(`${target} does not look like a site checkout (no package.json).`);

  const { manifest, files } = readUpdate(zip);
  const version = siteVersion(target);
  const plan = planInstall({
    manifest,
    siteFiles: siteFiles(target),
    sitePackage,
    siteVersion: version,
    siteEnv: readText(join(target, '.env.example')) ?? '',
    siteConfigText: readText(join(target, 'src/site.config.ts')) ?? '',
    siteLayoutText: readText(join(target, 'src/app/[locale]/layout.tsx')),
    reinstall,
    allowDowngrade,
  });

  report(plan, manifest, version, log);
  if (plan.status !== 'ok') return { applied: false, plan };
  if (!apply) {
    log('\nDry run — nothing was written. Add --apply to install.');
    return { applied: false, plan };
  }
  if (!force && !isCleanGit(target)) {
    throw new Error(
      `${target} is not a clean git checkout. Commit or stash first, so this update is one diff you can review ` +
        'and undo — or pass --force if you know what you are doing.'
    );
  }

  for (const { path } of plan.write) {
    const to = join(target, path);
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, files.get(path));
  }
  for (const path of plan.delete) {
    const at = join(target, path);
    rmSync(at, { force: true });
    pruneEmpty(target, dirname(at));
  }

  const { add } = plan.package;
  const addedDeps =
    Object.keys(add.dependencies).length + Object.keys(add.devDependencies).length > 0;
  if (addedDeps || Object.keys(add.scripts).length > 0) {
    const pkg = {
      ...sitePackage,
      scripts: { ...sitePackage.scripts, ...add.scripts },
      dependencies: { ...sitePackage.dependencies, ...add.dependencies },
      ...(Object.keys(add.devDependencies).length || sitePackage.devDependencies
        ? { devDependencies: { ...sitePackage.devDependencies, ...add.devDependencies } }
        : {}),
    };
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  }

  const originPath = join(target, '.cms-origin.json');
  writeFileSync(
    originPath,
    `${JSON.stringify(
      {
        ...readJson(originPath),
        cmsVersion: manifest.version,
        baseCommit: manifest.commit,
        syncedAt: new Date().toISOString(),
      },
      null,
      2
    )}\n`
  );
  log(
    `\nInstalled ${manifest.version}: wrote ${plan.write.length} file(s), deleted ${plan.delete.length}.`
  );

  if (addedDeps && !skipInstall) await run('npm', ['install'], target);
  if (!skipMigrate) await run('npm', ['run', 'db:migrate'], target);

  log('\nNext, in this site:');
  log('  npm run lint && npm run type-check && npm test');
  log('  NEXT_PUBLIC_SITE_URL=https://… npm run build');
  log('Then commit: the whole update is one diff.');
  return { applied: true, plan };
}
