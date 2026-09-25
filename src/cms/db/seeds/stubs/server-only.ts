/**
 * No-op stand-in for the `server-only` / `client-only` marker packages.
 *
 * Next.js resolves those markers through its bundler; a plain `tsx` process
 * can't, so importing any server module (which starts with `import 'server-only'`)
 * would crash the seed CLIs. `tsconfig.seed.json` maps both marker specifiers to
 * this empty module, so the seeders can pull in the document service + site
 * config outside Next. It intentionally does nothing.
 */
export {};
