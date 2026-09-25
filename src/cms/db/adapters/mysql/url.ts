/**
 * Build a MySQL/MariaDB connection URL from environment variables.
 * Ported unchanged from v1 `src/admin/db/url.ts`.
 *
 * Precedence:
 *   1. `DATABASE_URL` — used as-is if set.
 *   2. `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` — composed,
 *      with user/password URL-encoded so Plesk credentials containing special
 *      characters don't corrupt the URL.
 *
 * Shared by the runtime client and `drizzle.config.ts` so behaviour is identical.
 */
export interface DbUrlResult {
  url: string | null;
  source: 'DATABASE_URL' | 'DB_*' | 'missing';
}

export function composeDbUrl(env: NodeJS.ProcessEnv = process.env): DbUrlResult {
  if (env.DATABASE_URL && env.DATABASE_URL.trim().length > 0) {
    return { url: env.DATABASE_URL.trim(), source: 'DATABASE_URL' };
  }

  const host = env.DB_HOST?.trim();
  const user = env.DB_USER?.trim();
  const password = env.DB_PASSWORD ?? '';
  const name = env.DB_NAME?.trim();
  const port = (env.DB_PORT ?? '3306').trim();

  if (!host || !user || !name) {
    return { url: null, source: 'missing' };
  }

  const encodedUser = encodeURIComponent(user);
  const encodedPass = password.length > 0 ? `:${encodeURIComponent(password)}` : '';
  const url = `mysql://${encodedUser}${encodedPass}@${host}:${port}/${name}`;

  return { url, source: 'DB_*' };
}
