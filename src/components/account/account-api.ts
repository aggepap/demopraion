/**
 * The one place the account screens talk to the account API.
 *
 * Every response goes through the same reader, so a failure always arrives as
 * an `Error` with the server's own message rather than as a silently ignored
 * `ok: false` body — the shape `createRoute` returns on every error.
 */

export interface ApiFailure {
  ok: false;
  error: string;
  message?: string;
}

async function read<T>(res: Response, fallback: string): Promise<T> {
  const data = (await res.json().catch(() => null)) as { ok: true; data: T } | ApiFailure | null;
  if (!res.ok || !data || data.ok !== true) {
    throw new Error((data && 'message' in data && data.message) || fallback);
  }
  return data.data;
}

export async function accountPost<T>(
  path: string,
  body: unknown,
  fallback: string,
  method: 'POST' | 'PATCH' | 'DELETE' = 'POST'
): Promise<T> {
  const res = await fetch(`/api/cms/customer/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return read<T>(res, fallback);
}

export async function accountGet<T>(path: string, fallback: string): Promise<T> {
  return read<T>(await fetch(`/api/cms/customer/${path}`), fallback);
}
