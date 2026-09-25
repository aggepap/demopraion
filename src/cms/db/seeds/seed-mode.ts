/**
 * Whether a content seeder may overwrite what is already in the database.
 *
 * A seeder rebuilds a document's entire `data` blob from source files. That is
 * exactly right on a clean database and exactly wrong on a live one: every field
 * is authored in the admin too, so a re-run reverted whatever an editor had
 * changed, with no prompt and no diff. Seeders also pass no `expectedVersion`,
 * so the concurrency check that stops two editors overwriting each other is
 * skipped as well.
 *
 * A seed command reads as a setup step, and "idempotent" is true of the files,
 * not of the database. So the overwrite has to be asked for by name.
 */
export type SeedMode = 'create-only' | 'force';

export type SeedAction = 'create' | 'update' | 'skip';

export interface SeedCounts {
  created: number;
  updated: number;
  skipped: number;
}

const COUNT_KEY: Record<SeedAction, keyof SeedCounts> = {
  create: 'created',
  update: 'updated',
  skip: 'skipped',
};

/** Record one action against the run's tally. */
export function tally(counts: SeedCounts, action: SeedAction): void {
  counts[COUNT_KEY[action]] += 1;
}

/** What to do with one (type, slug, locale), given whether it is already stored. */
export function seedAction(exists: boolean, mode: SeedMode): SeedAction {
  if (!exists) return 'create';
  return mode === 'force' ? 'update' : 'skip';
}

/**
 * The mode a seeder run was invoked in. Matched as an exact argv token rather
 * than with a substring test: this flag is the difference between a command that
 * only adds and one that overwrites live editorial, and `--no-force` reading as
 * force is a bad way to find that out.
 */
export function parseSeedMode(argv: readonly string[]): SeedMode {
  return argv.includes('--force') ? 'force' : 'create-only';
}

/**
 * The line a seeder CLI prints when it finishes.
 *
 * A skip is silent by nature — the operator asked for a seed and got fewer
 * writes than they expected — so whenever anything was skipped the line also
 * says which flag would have written it.
 */
export function formatSeedSummary(label: string, counts: SeedCounts, mode: SeedMode): string {
  const { created, updated, skipped } = counts;
  const base = `✓ ${label} seeded (created ${created}, updated ${updated}, skipped ${skipped})`;
  if (mode === 'force' || skipped === 0) return base;
  return `${base}\n  ${skipped} already in the database and left untouched. Re-run with --force to overwrite them.`;
}
