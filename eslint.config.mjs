// ESLint flat config — Next 16 + eslint-config-next 16 default format.
// `next lint` was removed in Next 16; run `npm run lint` (which calls `eslint .`).
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const config = [
  // The Agent Studio bundle under `qa/` is a separate, self-contained tool with
  // its own toolchain and tsconfig. Linting it here reported ~1000 problems
  // about code this project does not own or ship, which buries the handful that
  // belong to the site. Mirrors the `qa` entry in tsconfig.json's `exclude`.
  {
    /*
     * Generated build output, which ESLint has no business reporting on.
     *
     * `tsconfig.json` already excludes `.next-qa/` and `.next-build/` (the other
     * two instances' build dirs), but ESLint did not — so whether a QA build
     * happened to exist swung a lint run between ~5.7k and ~21.4k problems over
     * an identical source tree. A gate whose result depends on which build
     * directories are lying around is not a gate, and the handful of real
     * findings under `src/` were buried either way.
     */
    ignores: ['qa/**', '.next/**', '.next-qa/**', '.next-build/**', '.claude/**'],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      'react/no-unescaped-entities': 'off',
      '@next/next/no-page-custom-font': 'off',
    },
  },
  // ── CMS core/site boundary ──────────────────────────────────────────────
  // The reusable CMS core (`src/cms/**`) must never import site-specific code.
  // Site code depends on the core, not the reverse — this is what keeps the
  // core extractable into a standalone package (BACKEND_V2_PLAN.md, principle 1).
  // Allowed inside src/cms: framework (next, react, drizzle, zod, …) and other
  // `@/cms/*` modules. Forbidden: `@/components`, `@/content`, `@/app`, and the
  // site's own `@/lib/*` (the CMS has its own utilities).
  {
    files: ['src/cms/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/components',
                '@/components/*',
                '@/content',
                '@/content/*',
                '@/app',
                '@/app/*',
                '@/lib',
                '@/lib/*',
                '@/types',
                '@/types/*',
                '@/admin',
                '@/admin/*',
              ],
              message:
                'src/cms is the reusable CMS core and must not import site code. ' +
                'Depend on framework packages or other @/cms/* modules only.',
            },
          ],
        },
      ],
    },
  },
];

export default config;
