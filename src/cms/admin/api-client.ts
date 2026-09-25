'use client';

/**
 * Thin browser-side client for the CMS API. Every response uses the uniform
 * `{ ok, ... }` envelope from the route factory, so one parser handles all
 * calls and surfaces a typed error the UI can display.
 */

export interface ApiError {
  error: string;
  message?: string;
  issues?: unknown;
}

export class CmsApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly issues?: unknown;
  constructor(status: number, body: ApiError) {
    super(body.message ?? body.error);
    this.name = 'CmsApiError';
    this.code = body.error;
    this.status = status;
    this.issues = body.issues;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({ ok: false, error: 'bad_response' }));
  if (!res.ok || body?.ok === false) {
    throw new CmsApiError(res.status, body as ApiError);
  }
  return body as T;
}

export interface ListResponse<T> {
  ok: true;
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
}

export interface DataResponse<T> {
  ok: true;
  data: T;
}

/** What `POST /api/cms/auth/login` resolves to. */
export type LoginOutcome =
  | { user: unknown; mfa?: undefined }
  | { user?: undefined; mfa: { required: true; method?: 'totp' | 'email'; enroll?: true } };

export const cmsApi = {
  list: <T>(collection: string, query: Record<string, string | number | undefined> = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') qs.set(k, String(v));
    const suffix = qs.toString() ? `?${qs}` : '';
    return request<ListResponse<T>>(`/api/cms/${collection}${suffix}`);
  },
  get: <T>(collection: string, id: number | string) =>
    request<DataResponse<T>>(`/api/cms/${collection}/${id}`),
  create: <T>(collection: string, body: unknown) =>
    request<DataResponse<T>>(`/api/cms/${collection}`, { method: 'POST', body: JSON.stringify(body) }),
  update: <T>(collection: string, id: number | string, body: unknown) =>
    request<DataResponse<T>>(`/api/cms/${collection}/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  remove: (collection: string, id: number | string) =>
    request<void>(`/api/cms/${collection}/${id}`, { method: 'DELETE' }),
  // Orders — manual create (POST) + full edit (PUT); status uses the generic PATCH.
  createOrder: <T>(body: unknown) =>
    request<DataResponse<T>>(`/api/cms/orders`, { method: 'POST', body: JSON.stringify(body) }),
  saveOrder: <T>(id: number | string, body: unknown) =>
    request<DataResponse<T>>(`/api/cms/orders/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  // Reservations — the drawer's money actions. Amounts are minor units.
  sendReservationPaymentLink: (id: number) =>
    request<DataResponse<{ url: string; expiresAt: string; amount: number }>>(
      `/api/cms/reservations/${id}/payment-link`,
      { method: 'POST', body: JSON.stringify({}) },
    ),
  recordReservationPayment: (id: number, amount: number) =>
    request<DataResponse<{ id: number }>>(`/api/cms/reservations/${id}/payments`, {
      method: 'POST',
      body: JSON.stringify({ amount }),
    }),
  refundReservationPayment: (id: number, paymentId: number, amount?: number) =>
    request<DataResponse<{ refunded: number; providerRef: string | null }>>(`/api/cms/reservations/${id}/refund`, {
      method: 'POST',
      body: JSON.stringify(amount === undefined ? { paymentId } : { paymentId, amount }),
    }),
  /** Send a captured payment back through its gateway (full, or `amount` minor units). */
  refundOrderPayment: <T>(orderId: number, body: { paymentId: number; amount?: number; reason?: string }) =>
    request<DataResponse<T>>(`/api/cms/orders/${orderId}/refund`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  /** Record a parcel: a typed tracking number, or (no `voucher`) a BoxNow voucher. */
  createShipment: <T>(orderId: number, body: { courier: string; voucher?: string }) =>
    request<DataResponse<T>>(`/api/cms/orders/${orderId}/shipments`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  // Gift cards — the list route answers `{ giftCards }`, not the paginated shape.
  listGiftCards: <T>() => request<DataResponse<{ giftCards: T[] }>>(`/api/cms/gift-cards`),
  giftCardHistory: <T>(id: number) =>
    request<DataResponse<{ entries: T[] }>>(`/api/cms/gift-cards/${id}`),
  // Shipping zones + methods (Settings → Ecommerce → Shipping).
  saveShippingZone: <T>(id: number | null, body: unknown) =>
    request<DataResponse<T>>(id ? `/api/cms/shipping/zones/${id}` : `/api/cms/shipping/zones`, {
      method: id ? 'PATCH' : 'POST',
      body: JSON.stringify(body),
    }),
  deleteShippingZone: <T>(id: number) =>
    request<DataResponse<T>>(`/api/cms/shipping/zones/${id}`, { method: 'DELETE' }),
  saveShippingMethod: <T>(id: number | null, body: unknown) =>
    request<DataResponse<T>>(id ? `/api/cms/shipping/methods/${id}` : `/api/cms/shipping/methods`, {
      method: id ? 'PATCH' : 'POST',
      body: JSON.stringify(body),
    }),
  deleteShippingMethod: <T>(id: number) =>
    request<DataResponse<T>>(`/api/cms/shipping/methods/${id}`, { method: 'DELETE' }),
  /** Courier credentials: store (`value`) or clear (`null`). Never returns a value. */
  saveCourierSecret: <T>(key: string, value: string | null) =>
    request<DataResponse<T>>(`/api/cms/shipping/couriers`, {
      method: 'POST',
      body: JSON.stringify({ key, value }),
    }),
  /**
   * The password step. Resolves to ONE of two shapes: `{ user }` when the
   * sign-in is complete, or `{ mfa }` when a second factor is still owed. The
   * second is a 200, not an error — "give me your code" is not a failure, and
   * routing it through the catch branch would show it as one.
   */
  login: (email: string, password: string, captchaToken?: string | null) =>
    request<DataResponse<LoginOutcome>>(`/api/cms/auth/login`, {
      method: 'POST',
      // Header, not body: the route factory verifies the captcha before it
      // parses the body, so the single-use token never enters the zod input
      // (and so never reaches a 422's `issues` or the audit row).
      headers: captchaToken ? { 'x-captcha-token': captchaToken } : {},
      body: JSON.stringify({ email, password }),
    }),
  /**
   * A body is always sent, even when there is no reason: the route validates
   * one, and `createRoute` rejects a bodyless POST as invalid JSON.
   */
  logout: (reason?: 'idle') =>
    request<unknown>(`/api/cms/auth/logout`, {
      method: 'POST',
      body: JSON.stringify(reason ? { reason } : {}),
    }),
  // ── Two-factor authentication ─────────────────────────────────────────────
  // The four challenge-cookie calls carry no identifier: who is signing in is
  // held in the httpOnly `cms_mfa` cookie the login response set. A user id in
  // the body here would be the login bypass the second factor exists to close.
  verify2fa: (code: string) =>
    request<DataResponse<{ user: unknown; recoveryCodesRemaining: number }>>(
      `/api/cms/auth/2fa/verify`,
      { method: 'POST', body: JSON.stringify({ code }) },
    ),
  /**
   * The break-glass bypass. Its own endpoint, not a flag on `verify2fa`: the
   * two secrets must not be checkable by the same handler, or the bypass code
   * would work in the ordinary 2FA field.
   */
  bypass2fa: (code: string) =>
    request<DataResponse<{ user: unknown }>>(`/api/cms/auth/2fa/bypass`, {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
  send2faCode: () =>
    request<DataResponse<{ sent: boolean }>>(`/api/cms/auth/2fa/send-code`, { method: 'POST' }),
  start2faEnroll: (method: 'totp' | 'email') =>
    request<
      DataResponse<
        | { method: 'totp'; secret: string; otpauthUri: string; qrSvgDataUri: string }
        | { method: 'email'; sent: boolean }
      >
    >(`/api/cms/auth/2fa/enroll/start`, { method: 'POST', body: JSON.stringify({ method }) }),
  confirm2faEnroll: (method: 'totp' | 'email', code: string) =>
    request<DataResponse<{ recoveryCodes: string[]; user?: unknown }>>(
      `/api/cms/auth/2fa/enroll/confirm`,
      { method: 'POST', body: JSON.stringify({ method, code }) },
    ),
  get2faStatus: () =>
    request<
      DataResponse<{
        method: 'totp' | 'email' | null;
        enrolledAt: string | null;
        recoveryCodesRemaining: number;
        required: boolean;
      }>
    >(`/api/cms/auth/2fa`),
  disable2fa: (password: string) =>
    request<DataResponse<{ ok: true }>>(`/api/cms/auth/2fa/disable`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  regenerate2faRecoveryCodes: (password: string) =>
    request<DataResponse<{ recoveryCodes: string[] }>>(`/api/cms/auth/2fa/recovery-codes`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  getSiteSettings: () =>
    request<DataResponse<Record<string, unknown>>>(`/api/cms/settings`),
  updateSiteSettings: (body: Record<string, unknown>) =>
    request<DataResponse<Record<string, unknown>>>(`/api/cms/settings`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  listSubmissions: <T>(query: Record<string, string | number | undefined> = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') qs.set(k, String(v));
    const suffix = qs.toString() ? `?${qs}` : '';
    return request<DataResponse<T>>(`/api/cms/forms${suffix}`);
  },
  getSubmission: <T>(id: number | string) =>
    request<DataResponse<T>>(`/api/cms/forms/${id}`),
  updateSubmission: <T>(id: number | string, body: unknown) =>
    request<DataResponse<T>>(`/api/cms/forms/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  // Reviews — moderation counts (list/update/delete reuse the generic helpers).
  reviewStats: () =>
    request<DataResponse<{ pending: number; approved: number; rejected: number; total: number }>>(
      `/api/cms/reviews/stats`,
    ),
  // Abandoned carts — list reuses the generic `list`; remind triggers the job.
  // Not the generic `remove('abandoned-carts', id)`: that would work, but the
  // list already has its own named reader here and a caller reading this file
  // should not have to know which of the two conventions this table follows.
  deleteAbandonedCart: (id: number) =>
    request<void>(`/api/cms/abandoned-carts/${id}`, { method: 'DELETE' }),
  remindAbandoned: () =>
    request<DataResponse<{ sent: number; skippedSuppressed: number; cappedBy: number }>>(
      `/api/cms/abandoned-carts/remind`,
      { method: 'POST' },
    ),
  // SEO — redirects
  listRedirects: <T>() => request<DataResponse<T>>(`/api/cms/seo/redirects`),
  createRedirect: <T>(body: unknown) =>
    request<DataResponse<T>>(`/api/cms/seo/redirects`, { method: 'POST', body: JSON.stringify(body) }),
  updateRedirect: (id: number, body: unknown) =>
    request<DataResponse<unknown>>(`/api/cms/seo/redirects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteRedirect: (id: number) => request<void>(`/api/cms/seo/redirects/${id}`, { method: 'DELETE' }),
  // SEO — 404 monitor
  list404: <T>() => request<DataResponse<T>>(`/api/cms/seo/notfound`),
  update404: (id: number, body: unknown) =>
    request<DataResponse<unknown>>(`/api/cms/seo/notfound/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  delete404: (id: number) => request<void>(`/api/cms/seo/notfound/${id}`, { method: 'DELETE' }),
  // SEO — per-path meta
  listMeta: <T>() => request<DataResponse<T>>(`/api/cms/seo/meta`),
  upsertMeta: (body: unknown) =>
    request<DataResponse<unknown>>(`/api/cms/seo/meta`, { method: 'POST', body: JSON.stringify(body) }),
  deleteMeta: (id: number) => request<void>(`/api/cms/seo/meta/${id}`, { method: 'DELETE' }),
  // Users
  listUsers: <T>() => request<DataResponse<T>>(`/api/cms/users`),
  createUser: <T>(body: unknown) =>
    request<DataResponse<T>>(`/api/cms/users`, { method: 'POST', body: JSON.stringify(body) }),
  updateUser: (id: number, body: unknown) =>
    request<DataResponse<unknown>>(`/api/cms/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteUser: (id: number) => request<void>(`/api/cms/users/${id}`, { method: 'DELETE' }),
  // Roles
  listRoles: <T>() => request<DataResponse<T>>(`/api/cms/roles`),
  createRole: <T>(body: unknown) =>
    request<DataResponse<T>>(`/api/cms/roles`, { method: 'POST', body: JSON.stringify(body) }),
  updateRole: (id: number, body: unknown) =>
    request<DataResponse<unknown>>(`/api/cms/roles/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteRole: (id: number) => request<void>(`/api/cms/roles/${id}`, { method: 'DELETE' }),
  // Media — alt text. The only writable field; upload and delete have their own
  // routes.
  updateMedia: (uuid: string, body: { altText: string | null }) =>
    request<DataResponse<{ uuid: string; altText: string | null }>>(`/api/cms/media/${uuid}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  // API tokens (the Product Manager bridge).
  //
  // There is no `createApiToken`: Product Manager mints the credential and we
  // import it. Nothing here ever receives a secret back, which is why the list
  // type carries only the key id.
  listApiTokens: <T>() => request<DataResponse<T>>(`/api/cms/api-tokens`),
  importApiToken: <T>(body: {
    credential: string;
    name: string;
    scopes: string[];
    expiresAt?: string | null;
  }) =>
    request<DataResponse<T>>(`/api/cms/api-tokens`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  revokeApiToken: (id: number) =>
    request<void>(`/api/cms/api-tokens/${id}`, { method: 'DELETE' }),
  // Audit
  // Paged like every other list endpoint — the declared type used to say
  // `DataResponse`, which no longer matches what the route returns.
  listAudit: <T>(query: { search?: string; subjectType?: string; page?: number; pageSize?: number } = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') qs.set(k, String(v));
    const suffix = qs.toString() ? `?${qs}` : '';
    return request<ListResponse<T>>(`/api/cms/audit${suffix}`);
  },
  // Cookies
  getCookieCatalog: <T>() => request<DataResponse<T>>(`/api/cms/cookies/categories`),
  getCookieScan: <T>() => request<DataResponse<T>>(`/api/cms/cookies/scan`),
  createCookieCategory: <T>(body: unknown) =>
    request<DataResponse<T>>(`/api/cms/cookies/categories`, { method: 'POST', body: JSON.stringify(body) }),
  updateCookieCategory: (id: number, body: unknown) =>
    request<DataResponse<unknown>>(`/api/cms/cookies/categories/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteCookieCategory: (id: number) =>
    request<void>(`/api/cms/cookies/categories/${id}`, { method: 'DELETE' }),
  createCookieService: <T>(body: unknown) =>
    request<DataResponse<T>>(`/api/cms/cookies/services`, { method: 'POST', body: JSON.stringify(body) }),
  updateCookieService: (id: number, body: unknown) =>
    request<DataResponse<unknown>>(`/api/cms/cookies/services/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteCookieService: (id: number) =>
    request<void>(`/api/cms/cookies/services/${id}`, { method: 'DELETE' }),
  // Script snippets
  listScripts: <T>() => request<DataResponse<T>>(`/api/cms/scripts`),
  createScript: (body: unknown) =>
    request<DataResponse<{ id: number }>>(`/api/cms/scripts`, { method: 'POST', body: JSON.stringify(body) }),
  updateScript: (id: number, body: unknown) =>
    request<DataResponse<unknown>>(`/api/cms/scripts/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteScript: (id: number) => request<void>(`/api/cms/scripts/${id}`, { method: 'DELETE' }),
  // Media
  listMedia: <T>(opts: { limit?: number; offset?: number; search?: string } = {}) => {
    const qs = new URLSearchParams();
    if (opts.limit != null) qs.set('limit', String(opts.limit));
    if (opts.offset != null) qs.set('offset', String(opts.offset));
    if (opts.search) qs.set('search', opts.search);
    const q = qs.toString();
    // `ListResponse`, like every other list — the media route used to be the one that
    // returned a bare array, and the one that could not say how many files there were.
    return request<ListResponse<T>>(`/api/cms/media${q ? `?${q}` : ''}`);
  },
  deleteMedia: (uuid: string) => request<void>(`/api/cms/media/${uuid}`, { method: 'DELETE' }),
  uploadMedia: async <T>(file: File): Promise<DataResponse<T>> => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`/api/cms/media/upload`, { method: 'POST', body: fd });
    const body = await res.json().catch(() => ({ ok: false, error: 'bad_response' }));
    if (!res.ok || body?.ok === false) throw new CmsApiError(res.status, body as ApiError);
    return body as DataResponse<T>;
  },
  /**
   * Parse a `.md` file into a document. Writes nothing — the result pre-fills
   * the form and a person presses Save.
   *
   * The file is read in the browser and posted as JSON rather than as multipart,
   * so the route keeps the same-origin check, the rate limit and the zod body
   * that `createRoute` gives every other endpoint. Markdown has no magic bytes
   * for `sniffMime` to read, so multipart would buy nothing.
   */
  parseImport: <T>(collection: string, filename: string, source: string) =>
    request<DataResponse<T>>(`/api/cms/${collection}/import`, {
      method: 'POST',
      body: JSON.stringify({ filename, source }),
    }),
  versions: <T>(collection: string, id: number | string) =>
    request<DataResponse<T[]>>(`/api/cms/${collection}/${id}/versions`),
  restore: (collection: string, id: number | string, versionId: number | string) =>
    request<DataResponse<unknown>>(
      `/api/cms/${collection}/${id}/versions/${versionId}/restore`,
      { method: 'POST' },
    ),
};
