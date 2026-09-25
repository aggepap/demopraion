/**
 * CMS versions: plain `major.minor.patch`, compared numerically.
 *
 * The version a site runs is `src/cms/version.json`, which travels with the core,
 * so installing an update also records it.
 */

const SEMVER = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;

/** @returns {[number, number, number]} */
export function parseVersion(version) {
  const m = typeof version === 'string' ? SEMVER.exec(version) : null;
  if (!m) throw new Error(`Not a version (expected major.minor.patch): ${JSON.stringify(version)}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export const isVersion = (version) => typeof version === 'string' && SEMVER.test(version);

/** -1, 0 or 1. */
export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  }
  return 0;
}

/** @param {'major' | 'minor' | 'patch'} level */
export function bumpVersion(version, level) {
  const [major, minor, patch] = parseVersion(version);
  if (level === 'major') return `${major + 1}.0.0`;
  if (level === 'minor') return `${major}.${minor + 1}.0`;
  if (level === 'patch') return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Bump level must be major, minor or patch, not ${JSON.stringify(level)}.`);
}
