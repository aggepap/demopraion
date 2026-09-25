/**
 * What an update does to each file of a live site.
 *
 * A site is its own front end with a copy of the CMS core underneath. Updating
 * the core must replace the core wholesale and touch nothing else: not a
 * stylesheet, not a page, not a logo. That safety is entirely this
 * classification, so it lives in one pure module with tests — shared by the
 * `update.zip` installer and by the checkout-to-checkout `core-sync` script.
 *
 * Five classes:
 *
 *   core        replaced wholesale, and files the update dropped are deleted
 *   core-tests  added and updated, never deleted (a site writes its own there)
 *   scaffold    copied ONLY when missing — the site's styled copy is sacred
 *   glue        never written; reported, because porting it is a judgement
 *   site        untouched, always
 *
 * Anything unrecognised is `site`. That default is deliberate: skipping a new
 * kind of core file is a missing feature, which is recoverable; overwriting a
 * site's own file is not.
 *
 * Dependency-free (plain `node`), because it runs before `npm install`.
 */
import { compareVersions } from './version.mjs';

/** Base-only: how the CMS is developed. Never travels to a site. */
const BASE_ONLY = [
  'START_HERE.md',
  '.claude/**',
  'qa/**',
  'test/studio/**',
  'test/tools/**',
  'seo-audit-tool/**',
  'scripts/dev-qa.mjs',
  'scripts/cms-release.mjs',
  'docs/**',
  'releases/**',
  '.cms-origin.json',
];

/** The core proper. A site must never edit these; they are replaced entire. */
const CORE = ['src/cms/**', 'src/app/api/cms/**', 'src/app/admin/**'];

/** The core's own tests. Added and updated, never deleted. */
const CORE_TESTS = ['test/cms/**', 'test/core/**', 'test/commerce/**', 'test/booking/**'];

/**
 * Storefront pieces a core feature brings with it.
 *
 * They are site-owned the moment a site designs them, so they are copied only
 * when absent. A site that has styled its own wishlist keeps it, and is told
 * the base's version moved on.
 */
const SCAFFOLD = [
  'src/components/account/**',
  'src/components/popups/**',
  'src/components/checkout/**',
  'src/components/shortcodes/**',
  'src/components/shop/wishlist/**',
  'src/components/shop/filters/**',
  'src/components/cms/Shortcode.tsx',
  'src/shortcodes/**',
  'src/app/[locale]/account/**',
  'src/app/[locale]/wishlist/**',
];

/**
 * The contract between core and site: site-owned files the core relies on.
 *
 * Never written. `site.config.ts` holds a site's collections, `.env.example`
 * its deployment, `package.json` its scripts — the base's copy of each would
 * replace a site's own decisions. The report says what changed; a person ports
 * it. (`package.json` is the one exception, and only additively: see
 * `planPackage`.)
 */
const GLUE = [
  'src/site.config.ts',
  'src/lib/cms/**',
  'src/lib/i18n/locale-settings.ts',
  'src/lib/storage-keys.ts',
  'src/components/shop/showcase-data.ts',
  'src/app/[locale]/layout.tsx',
  'src/components/layout/Header.tsx',
  'src/mdx-components.tsx',
  '.env.example',
  'package.json',
];

/**
 * Glob → RegExp over repo-relative, forward-slash paths. `*` stays in one
 * segment, `**` crosses segments; `[` and `]` (Next route folders) are literal.
 */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        re += '(?:.*/)?';
        i += 2;
      } else {
        re += '.*';
        i += 1;
      }
    } else if (c === '*') {
      re += '[^/]*';
    } else {
      re += c.replace(/[.+?^$()|[\]\\{}]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

const compile = (patterns) => patterns.map((pattern) => globToRegExp(pattern));
const RULES = [
  ['base-only', compile(BASE_ONLY)],
  ['glue', compile(GLUE)],
  ['core', compile(CORE)],
  ['core-tests', compile(CORE_TESTS)],
  ['scaffold', compile(SCAFFOLD)],
];

/** The classes an update carries as files to install. */
export const PAYLOAD_KINDS = new Set(['core', 'core-tests', 'scaffold']);

/**
 * Which class a path belongs to. Glue is tested before core so a named
 * contract file inside a core folder could never be replaced by accident.
 */
export function classifyPath(path) {
  for (const [kind, patterns] of RULES) {
    if (patterns.some((re) => re.test(path))) return kind;
  }
  return 'site';
}

/**
 * The file plan: what to write, what to delete, and what a person must look at.
 *
 * `baseFiles` and `siteFiles` are `{ path, hash }`; an unchanged file is left
 * alone so the resulting diff shows the update rather than the whole core.
 */
export function planSync({ baseFiles, siteFiles }) {
  const site = new Map(siteFiles.map((file) => [file.path, file.hash]));
  const baseSeen = new Set();

  const write = [];
  const remove = [];
  const review = [];
  let unchanged = 0;

  for (const file of baseFiles) {
    const kind = classifyPath(file.path);
    baseSeen.add(file.path);
    const siteHash = site.get(file.path);

    if (kind === 'site' || kind === 'base-only') continue;

    if (kind === 'glue') {
      if (siteHash === undefined) review.push({ path: file.path, kind, reason: 'glue-missing' });
      else if (siteHash !== file.hash)
        review.push({ path: file.path, kind, reason: 'glue-differs' });
      continue;
    }

    if (kind === 'scaffold' && siteHash !== undefined) {
      // The site's own, styled. Never overwritten; only mentioned.
      if (siteHash !== file.hash) review.push({ path: file.path, kind, reason: 'yours-already' });
      continue;
    }

    if (siteHash === file.hash) {
      unchanged += 1;
      continue;
    }
    write.push({ path: file.path, kind });
  }

  // A core file the base has dropped — a renamed module, a deleted route — has
  // to go, or the site keeps compiling against something upstream removed.
  for (const file of siteFiles) {
    if (baseSeen.has(file.path)) continue;
    if (classifyPath(file.path) !== 'core') continue;
    remove.push(file.path);
  }

  return { write, delete: remove, review, unchanged };
}

/** `KEY=` names from an env example, comments and blanks ignored. */
export function envKeys(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split('=')[0].trim())
    .filter(Boolean);
}

/** The env keys, module flags and brand wiring a site still has to see to. */
function siteFollowUps({ baseEnvKeys, siteEnv, baseModules, siteConfigText, siteLayoutText }) {
  const have = new Set(envKeys(siteEnv));
  const missingEnv = baseEnvKeys.filter((key) => !have.has(key));

  // A flag the site config has never mentioned: the feature would be off with
  // no way to switch it on from the admin.
  const missingModules = baseModules.filter(
    (name) => !new RegExp(`\\b${name}\\s*:`).test(siteConfigText)
  );

  // The brand lives in the database (Settings → Branding), but the locale layout
  // that renders it is glue an update never writes. A layout without the palette
  // style predates that, and the admin's brand would not reach the page.
  const brandNotWired =
    typeof siteLayoutText === 'string' && !siteLayoutText.includes('BrandStyle');

  return { missingEnv, missingModules, brandNotWired };
}

/**
 * What no file copy can do for you: dependencies, environment variables and the
 * module flags a new feature needs switching on (checkout-to-checkout sync).
 *
 * `siteLayoutText` is the site's `src/app/[locale]/layout.tsx`, or undefined when
 * it has none; it is only used to tell whether the brand is wired in.
 *
 * @param {{ basePackage: any, sitePackage: any, baseEnv: string, siteEnv: string,
 *   baseModules: string[], siteConfigText: string, siteLayoutText?: string }} input
 */
export function followUps({
  basePackage,
  sitePackage,
  baseEnv,
  siteEnv,
  baseModules,
  siteConfigText,
  siteLayoutText,
}) {
  const baseDeps = basePackage.dependencies ?? {};
  const siteDeps = sitePackage.dependencies ?? {};

  const missingDependencies = [];
  const changedDependencies = [];
  for (const [name, version] of Object.entries(baseDeps)) {
    const have = siteDeps[name];
    if (have === undefined) missingDependencies.push({ name, version });
    else if (have !== version) changedDependencies.push({ name, from: have, to: version });
  }

  return {
    missingDependencies,
    changedDependencies,
    ...siteFollowUps({
      baseEnvKeys: envKeys(baseEnv),
      siteEnv,
      baseModules,
      siteConfigText,
      siteLayoutText,
    }),
  };
}

/**
 * The `package.json` changes an update may make: additions only.
 *
 * A dependency or script the site has not got is added — the new core imports
 * the package, or its CLI needs the script. One the site already has is never
 * changed, even when the ranges differ: the site may have raised it on purpose,
 * and comparing ranges is a judgement. Those are reported instead.
 */
function planPackage(updatePackage, sitePackage) {
  const siteDeps = { ...(sitePackage.devDependencies ?? {}), ...(sitePackage.dependencies ?? {}) };
  const add = { dependencies: {}, devDependencies: {}, scripts: {} };
  const differs = [];

  for (const section of ['dependencies', 'devDependencies']) {
    for (const [name, range] of Object.entries(updatePackage[section] ?? {})) {
      const have = siteDeps[name];
      if (have === undefined) add[section][name] = range;
      else if (have !== range) differs.push({ name, site: have, update: range });
    }
  }
  for (const [name, command] of Object.entries(updatePackage.scripts ?? {})) {
    if (!(name in (sitePackage.scripts ?? {}))) add.scripts[name] = command;
  }
  return { add, differs };
}

/**
 * The whole install plan for one update against one site.
 *
 * `siteVersion` is the CMS version the site runs, or null when it predates
 * versioning. Older-than-installed is refused (a downgrade would re-run nothing
 * and silently drop newer core code); same-version is "up to date".
 */
export function planInstall({
  manifest,
  siteFiles,
  sitePackage,
  siteVersion,
  siteEnv,
  siteConfigText,
  siteLayoutText,
  reinstall = false,
  allowDowngrade = false,
}) {
  let status = 'ok';
  let reason;
  if (siteVersion) {
    const cmp = compareVersions(manifest.version, siteVersion);
    if (cmp < 0 && !allowDowngrade) {
      status = 'refused';
      reason = `This update is ${manifest.version}, older than the ${siteVersion} this site runs. Pass --allow-downgrade to install it anyway.`;
    } else if (cmp === 0 && !reinstall) {
      status = 'up-to-date';
      reason = `This site already runs ${siteVersion}. Pass --reinstall to install it again.`;
    }
  }

  const files = planSync({
    baseFiles: [...manifest.files, ...manifest.glue].map((f) => ({ path: f.path, hash: f.sha256 })),
    siteFiles: siteFiles.map((f) => ({ path: f.path, hash: f.sha256 })),
  });

  return {
    status,
    reason,
    ...files,
    package: planPackage(manifest.package, sitePackage),
    followUps: siteFollowUps({
      baseEnvKeys: manifest.env,
      siteEnv,
      baseModules: manifest.modules,
      siteConfigText,
      siteLayoutText,
    }),
  };
}
