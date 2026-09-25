# 05 · Authentication, users, roles & security

This guide covers how admin users sign in and stay signed in, and how the CMS decides what they may do. It covers the admin login (password, captcha, per-IP and per-account throttles), the stateless JWT session with idle and absolute expiry, the second factor (TOTP, emailed codes, recovery codes, the break-glass bypass), admin users and roles, the permission model and how `createRoute` enforces it, machine-to-machine API tokens (the Product Manager bridge), encryption of stored credentials, the audit log, and the cross-cutting protections every endpoint relies on: same-origin checks, security headers, rate limiting, client-IP extraction and the safe `?next=` redirect. Storefront customer accounts appear here only where they share code with admin auth. Everything else about them is in [08-commerce.md](08-commerce.md).

Related guides: [01-architecture.md](01-architecture.md) · [02-database.md](02-database.md) · [03-content-model.md](03-content-model.md) · [04-admin-ui.md](04-admin-ui.md) · [06-media-seo-structured-data.md](06-media-seo-structured-data.md) · [07-forms-email-marketing.md](07-forms-email-marketing.md) · [08-commerce.md](08-commerce.md) · [09-booking.md](09-booking.md) · [10-settings-cron-operations.md](10-settings-cron-operations.md)

---

## 1. File map

### Auth module: `src/cms/modules/auth/`

| File | What it holds |
|---|---|
| `index.ts` | Public surface. Re-exports permissions, session, password, login, MFA challenge, MFA service, current-user and guards. |
| `permissions.ts` | `PERMISSIONS` map, `PermissionKey`, `hasPerm`, `hasAnyPerm`, `ALL_PERMISSIONS`. |
| `permission-labels.ts` | Human labels and descriptions (`permissionLabel`, `permissionDescription`, `AREA_LABELS`, `VERB_LABELS`, `FULL_ACCESS = '*'`, `ACCESS_PERMISSION = 'cms.access'`). Safe on the client. |
| `password.ts` | `hashPassword` / `verifyPassword` (bcryptjs, cost 12). Not `server-only`, because the CLIs use it. |
| `password-policy.ts` | `MIN_PASSWORD_LENGTH = 10`, `PASSWORD_RULES`, `passwordProblems`, `passwordMessage`, `passwordStrength`. No dependencies, so it is shared by the server and the client. |
| `session.ts` | Admin session JWT: `signSession`, `verifySession(State)`, `setSessionCookie`, `clearSessionCookie`, `readSessionCookie`, `readSessionState`. Cookie `cms_session`. |
| `session-idle.ts` | Pure idle and absolute-expiry logic: `sessionIdleSeconds`, `decideSessionRefresh`, `sessionRefreshAfterSeconds`, `idleState`, `IDLE_WARNING_SECONDS`. |
| `login.ts` | `loginWithPassword`, `issueSession`, `claimsForUser`, internal `verifyCredentials` (includes the dummy-hash timing defence). |
| `mfa-challenge.ts` | The half-authenticated `cms_mfa` JWT: `signMfaChallenge`, `verifyMfaChallenge`, cookie helpers, `MFA_CHALLENGE_TTL_SECONDS = 600`. |
| `mfa.ts` | Second-factor I/O: `getMfaStatus`, `startTotpEnrollment`, `issueEmailCode`, `confirmEnrollment`, `verifySecondFactor`, `replaceRecoveryCodes`, `clearMfa`. |
| `mfa-email.ts` | `sendMfaCodeEmail` (sent through Microsoft Graph, localised in el/en, `MFA_EMAIL_CODE_TTL_MINUTES = 10`). |
| `current-user.ts` | `getCurrentUser` (reads the JWT only) and `loadUserPermissions` (reads the database fresh). |
| `guards.ts` | Page guards `requireAuth` and `requirePerm`. API guards `requireApiAuth` and `requireApiPerm`. |

### Core: `src/cms/core/`

| Path | What it holds |
|---|---|
| `api/handler.ts` | `createRoute`, the single route factory. Runs the same-origin check, captcha, rate limit, guard, validation and error mapping. |
| `api/same-origin.ts` | `isSameOrigin`, the CSRF check. |
| `api/params.ts` | `idParam` (positive safe integer, otherwise 400). |
| `errors.ts` | `ApiError` and the code-to-status map (`unauthorized` 401, `forbidden` 403, `rate_limited` 429, `captcha_failed` 400, `mfa_invalid` 401, …). |
| `rate-limit.ts` | `getClientIp`, `clientIpLabel`, `checkRateLimit` (an in-memory fixed-window bucket per scope). |
| `audit.ts` | `logAudit`, `recentAuthFailures`, `recentLoginFailures`, `extractRequestMeta`, `listAuditLogs`. |
| `audit-groups.ts`, `audit-labels.ts` | Filter groups for the audit screen (`AUDIT_ACTION_GROUPS`, `auditGroupFilter`) and human labels. |
| `users/schema.ts` | Zod schemas `createUserBody` (email trimmed and lowercased via `normalizeEmail`), `updateRoleIds`, `strongPassword`, `strongPasswordOrBlank`, and the form helper `newUserProblems`. |
| `users/service.ts` | `listUsers`, `listRoles`, `findUser`, `accountPermissions`, `createUser` (normalises the email again), `updateUser`, `deleteUser`, `enabledSuperadminIds`. |
| `roles/service.ts` | `ASSIGNABLE_PERMISSIONS`, `listRolesDetailed`, `createRole`, `updateRole`, `deleteRole`, `roleNameTaken`, internal `assertNotLastWildcard`. |
| `roles/can-grant.ts` | `assertCanGrant`: you cannot grant what you do not hold. |
| `roles/grants.ts` | `assertCanAssignRoles`, `assignableRoleIds`. Re-exports `assertCanGrant`. |
| `tokens/` | API tokens. `credential.ts` (parses PM credentials), `crypto.ts` (AES-256-GCM `encryptSecret`/`decryptSecret`, `timingSafeEquals`), `signature.ts` (PM-HMAC-SHA256), `replay.ts` (nonce cache), `service.ts` (storage), `guard.ts` (`requireSignatureOrSession`). |
| `secrets/policy.ts` | Client-safe declared-key model: `SecretKeyDef`, `isValidSecretKey`, `secretHint`, `summariseSecrets`. |
| `secrets/service.ts` | `setSecret`, `getSecret`, `deleteSecret`, `listSecretSummaries`, and the `secretsRoutes({ defs })` factory. |
| `security/totp.ts` | RFC 6238 TOTP built on `node:crypto`: `generateTotpSecret`, `totpCode`, `verifyTotp`, `otpauthUri`, base32. |
| `security/recovery-codes.ts` | `generateRecoveryCodes`, `normalizeRecoveryCode`, `padForHash`, `RECOVERY_CODE_COUNT = 10`. |
| `security/mfa-bypass.ts` | `readBypassCode`, `bypassCodeConfigured`, `interpretBypassAttempt`. |
| `security/captcha.ts` | reCAPTCHA v2: `CAPTCHA_HEADER = 'x-captcha-token'`, `captchaEnabled`, `verifyCaptchaToken`, `interpretCaptchaVerification`. |
| `routes/auth.ts` | `loginRoute`, `logoutRoute`, `meRoute`. |
| `routes/auth-mfa.ts` | All `/auth/2fa/*` routes, plus `mfaRequiredBySetting` and `beginMfaChallenge`. |
| `routes/mfa-guard.ts` | `requireMfaChallenge(req, purpose)`. |
| `routes/users.ts`, `routes/roles.ts`, `routes/api-tokens.ts`, `routes/audit.ts` | Route factories for those resources. |
| `paths.ts` | `getAdminPath()` (`ADMIN_PATH`, slug-validated), `isAdminPath`, `isAdminApiPath`. |
| `admin-deep-link.ts` | `ADMIN_PATH_HEADER = 'x-admin-pathname'`, `requestedAdminPath`. |

### App and other files

| Path | Role |
|---|---|
| `src/proxy.ts` | The Next 16 proxy (formerly middleware). For `/admin*` it only stamps `x-admin-pathname` and returns. **It does not authenticate.** |
| `src/app/admin/(shell)/layout.tsx` | The real gate for admin pages. Calls `requirePerm(PERMISSIONS.access, requested)` and mounts `IdleLogout`. |
| `src/app/admin/login/page.tsx` | Renders `LoginForm` with the admin path, the captcha site key and `graphMailConfigured()`. |
| `src/app/admin/403/page.tsx` | Target of `requirePerm` refusals. |
| `src/app/admin/(shell)/{users,roles,audit,account}/page.tsx` | Management screens. `api-tokens/page.tsx` redirects to Settings → Praion tab. |
| `src/app/api/cms/auth/**`, `users/**`, `roles/**`, `api-tokens/**`, `audit/route.ts` | Thin files that export factories from `@/cms/core/routes`. |
| `src/cms/admin/LoginForm.tsx`, `MfaEnrollPanel.tsx`, `MfaBypassDialog.tsx`, `mfa-bypass-hotkey.ts`, `login-error.ts`, `safe-next.ts` | Sign-in UI. |
| `src/cms/admin/IdleLogout.tsx` | Client idle watcher and keepalive. |
| `src/cms/admin/UsersManager.tsx`, `RolesManager.tsx`, `ApiTokensManager.tsx`, `AccountSecurity.tsx` | Management UIs. |
| `next.config.ts` | Security headers and CSP (site and admin variants). |
| `src/cms/db/adapters/mysql/schema/{auth,mfa,audit,api-tokens,integrations}.ts` | Tables. |
| `src/cms/db/seeds/roles.ts`, `seeds/cli/{create-admin,seed-roles,reset-mfa}.ts`, `seeds/admin-args.ts` | Seeds and recovery CLIs. |
| `src/cms/modules/customers/token.ts` | Customer JWT. Shares `ADMIN_SESSION_SECRET` through HKDF (see §4.12). |

---

## 2. Data model

All tables are MySQL Drizzle definitions under `src/cms/db/adapters/mysql/schema/`. See [02-database.md](02-database.md) for migrations.

### `admin_users` (`auth.ts` → `adminUsers`)

| Column | Type | Notes |
|---|---|---|
| `id` | int PK AI | |
| `email` | varchar(255) unique | Login looks it up as `trim().toLowerCase()`. |
| `name` | varchar(191) | |
| `password_hash` | varchar(255) | bcrypt cost 12. |
| `locale` | varchar(8), default `el` | The language of MFA code emails and of the admin chrome. |
| `last_login_at` | timestamp null | Stamped only by `issueSession`, so it records completed sign-ins only, never a sign-in stopped at the code prompt. |
| `disabled_at` | timestamp null | A disabled user is refused at login and by every API guard. |
| `mfa_method` | varchar(16) null | `'totp'`, `'email'` or null. |
| `totp_secret_encrypted` | varbinary(255) null | AES-GCM from `tokens/crypto.ts`. A value here while `mfa_method` is null means an enrollment is pending. |
| `mfa_enrolled_at` | timestamp null | |
| `totp_last_step` | int null | Replay guard. The last TOTP time-step that was accepted. |
| `created_at`, `updated_at` | timestamp | |

### `admin_roles` / `admin_user_roles`

| Table | Columns | Notes |
|---|---|---|
| `admin_roles` | `id`, `name` varchar(64) unique, `permissions` json `string[]`, `created_at` | A permission list may contain `*` or prefix wildcards such as `cms.seo.*`. The API only accepts keys from `ASSIGNABLE_PERMISSIONS`. |
| `admin_user_roles` | `user_id` → `admin_users.id` cascade, `role_id` → `admin_roles.id` cascade, PK (`user_id`,`role_id`) | The schema allows many roles per user, but the API allows exactly one on create and at most one on update (`ONE_ROLE_ONLY`). |

### `admin_mfa_codes` / `admin_recovery_codes` (`mfa.ts`)

| Table | Columns | Notes |
|---|---|---|
| `admin_mfa_codes` | `id`, `user_id` (cascade), `code_hash` (bcrypt of `padForHash(code)`), `purpose` (`login` \| `enroll`), `expires_at`, `attempts` (default 0), `consumed_at`, `created_at`. Index (`user_id`,`purpose`). | Codes are sent by email. A code dies after 5 wrong attempts (`EMAIL_CODE_MAX_ATTEMPTS`). An account can be sent at most 5 per 15 minutes (`EMAIL_CODE_MAX_PER_WINDOW`). |
| `admin_recovery_codes` | `id`, `user_id` (cascade), `code_hash`, `used_at`, `created_at` | 10 per enrollment. Only the bcrypt hash is stored, so the codes cannot be shown again. |

### `audit_logs` (`audit.ts`)

| Column | Notes |
|---|---|
| `user_id` | FK → `admin_users`, `ON DELETE SET NULL`. |
| `actor_label` varchar(191) | For non-human actors, e.g. `api-token:<name>`. The list query uses `coalesce(admin_users.name, actor_label)`. |
| `action` varchar(64) | Dotted key, e.g. `auth.login.fail`. |
| `subject_type`, `subject_id` varchar(64) | Auth events use `subject_type = 'email'` and `subject_id = <lowercased email>`. The lockout counters depend on this. |
| `before`, `after` | json |
| `ip` varchar(64), `ua` varchar(255) | `ua` is truncated to 255 characters in `logAudit`. |
| indexes | `idx_audit_subject` (`subject_type`,`subject_id`), `idx_audit_user`, `idx_audit_created`. |

### `cms_api_tokens` (`api-tokens.ts`)

`id`, `name`, `key_id` varchar(16) **unique**, `secret_encrypted` varbinary(255), `scopes` json, `created_by` (FK, set null), `last_used_at`, `last_used_ip`, `expires_at`, `revoked_at`, `created_at`. Index `idx_cms_api_tokens_active` (`revoked_at`,`expires_at`). Revoking a token sets `revoked_at`. Rows are never deleted.

### `integration_secrets` (`integrations.ts`)

`key` varchar(128) PK (dotted, e.g. `google.places.apiKey`), `ciphertext` varbinary(4096), `hint` varchar(8) (last 4 characters, or `''` when the value is shorter than 12 characters), `updated_by`, `updated_at`.

---

## 3. How it works

### 3.1 Admin gating: proxy, layout and guards

There are three layers, and **only the last two authenticate**:

1. **`src/proxy.ts`**. For `/admin` and `/admin/*`, it overwrites the `x-admin-pathname` request header with `pathname + search` and returns `NextResponse.next()`. Admin requests skip SEO redirects and i18n. The proxy exists only so that a deep link survives the login bounce. A server layout is not given the pathname, so the proxy passes it along in this header. The proxy never inspects the session cookie.
2. **The shell layout** `src/app/admin/(shell)/layout.tsx` reads that header and runs it through `safeNextPath`. It then calls `requirePerm(PERMISSIONS.access, requested)`:
   - With no valid session, it redirects to `/{adminPath}/login?next=<path>` (`requireAuth`).
   - When `loadUserPermissions` says the user is disabled or lacks `cms.access`, it redirects to `/{adminPath}/403`.
   - Sidebar entries are filtered with `hasPerm(user.permissions, …)`. The filtering is cosmetic. Each page also calls `requirePerm(<its key>)`, and each API route also checks.
3. **API routes** use `requireApiAuth` / `requireApiPerm` as their `createRoute` guard. Both require `cms.access` as well (`adminApiAccessDenied`, 403 `{ missing: 'cms.access' }`), so a role without it is refused by the API exactly as by the screens. The one exception is `POST /auth/logout`, which uses `requireApiAuth({ allowWithoutAccess: true })` so such a session can still end. Signed API tokens (the PM bridge) do not go through these guards: they carry `pm:*` scopes, not `cms.*` permissions, and are unaffected. The bridge's *session* path calls `requireApiPerm`, so it requires `cms.access` too.

`/admin/login` and `/admin/403` sit outside the `(shell)` group, so they need no session.

### 3.2 Login flow

`POST /api/cms/auth/login` (`loginRoute`, `src/cms/core/routes/auth.ts`) runs these steps:

```
createRoute pipeline
  1. isSameOrigin (POST)                          → 403 "Cross-origin request rejected."
  2. captcha: per-IP gate 'cms-login-captcha' 60/10min, then verifyCaptchaToken(x-captcha-token)
                                                   → 429 / 400 captcha_failed
  3. rateLimit 'cms-login' 10/10min per x-real-ip  → 429
  4. body { email, password } (zod)                → 422
handler
  5. recentLoginFailures(email, 15min) >= 10       → audit auth.login.locked, 429
  6. loginWithPassword(email, password, { requireMfa: security.require2fa === 'on' })
       verifyCredentials: always one bcrypt compare (DUMMY_HASH for unknown email)
       fail  → audit auth.login.fail {reason}; 401 "Invalid email or password."
       mfa   → set cms_mfa (purpose 'verify'); audit auth.2fa.challenged; 200 { mfa: { required, method } }
       enroll→ set cms_mfa (purpose 'enroll'); audit auth.2fa.enroll_required; 200 { mfa: { required, enroll: true } }
       ok    → issueSession (last_login_at + cms_session); clear cms_mfa; audit auth.login.success; 200 { user }
```

Points to note:

- **No enumeration.** Unknown email, disabled account, wrong password and `no_roles` all return the same 401 message. The account lockout returns the same wording as the per-IP limit. The dummy bcrypt comparison makes the response time the same whether or not the account exists.
- **Per-account lockout** is counted from the audit log. `recentAuthFailures` counts `auth.login.fail` rows for `subject_type='email', subject_id=<email>` inside the window, **after the most recent `auth.login.success`**. It adds no new table. A person who knows the password gets in, and that success resets the count. If the audit query itself fails, the count falls back to 0 (fail open) so that a logging fault cannot lock everyone out.
- The `mfa`/`enroll` branches do **not** write `auth.login.success`. A correct password that has not finished the sign-in must not clear the failure count.
- `mfaRequiredBySetting()` reads the setting `security.require2fa` (`SECURITY_REQUIRE_2FA_KEY` in `core/settings/schema.ts`). It is on when the value is `'on'`.

### 3.3 Session model

`src/cms/modules/auth/session.ts` and `session-idle.ts`:

- The session is a **stateless HS256 JWT** (jose). The cookie is `cms_session` with `httpOnly`, `sameSite=lax`, `secure` in production and `path=/`. Issuer `cms`, audience `cms-admin`, key `ADMIN_SESSION_SECRET` (at least 32 characters, otherwise it throws).
- Claims: `userId`, `email`, `name`, `locale`, `permissions` (a snapshot used only for page chrome), and `abs`.
- There are **two deadlines**:
  - `exp` is the **idle** deadline, `ADMIN_SESSION_IDLE_MINUTES` (default 60, minimum 60 seconds, and any non-positive or invalid value falls back to the default).
  - `abs` is the **absolute** cap, `ADMIN_SESSION_TTL_HOURS` (default 8) from sign-in. It is never extended. `exp` is always less than or equal to `abs`.
  - A token without `abs` (issued before this feature existed) gets `iat + TTL`.
- **Sliding.** Only `requireApiAuth` can renew, because `cookies().set()` throws in server components. `decideSessionRefresh(timing, now, idle)` returns one of:
  - `expired`: now ≥ abs, or age ≥ idle.
  - `ok`: age < `sessionRefreshAfterSeconds(idle)`, which is `min(60s, idle/4)`.
  - `refresh`: re-sign with **fresh DB permissions** and the **original** `abs`, with new `exp = min(now + idle, abs)`.
- **Permissions are always read fresh for authorization.** `loadUserPermissions(userId)` loads the user (returning null if missing or disabled) and takes the union of `admin_roles.permissions` over `admin_user_roles`. Both `requireApiAuth` and `requirePerm` call it, so revoking a role or disabling a user takes effect on the next request. `getCurrentUser()` (JWT only) is for display.
- `GET /api/cms/auth/me` goes through `requireApiAuth`, so it also slides the session. It returns `sessionExpiresAt` (epoch seconds) for the idle watcher.

### 3.4 Idle logout (client)

`src/cms/admin/IdleLogout.tsx` is mounted by the shell with `idleSeconds={sessionIdleSeconds()}`, resolved on the server so that client and server use the same number.

- It listens for `pointerdown`, `keydown`, `wheel`, `touchstart` and `visibilitychange`. The last activity time is shared across tabs through `localStorage['cms:last-activity']`, and every storage access is wrapped in try/catch.
- On activity it sends a keepalive `GET /api/cms/auth/me`, throttled to the server's refresh cadence. It learns the server's expiry from the `sessionExpiresAt` in the response.
- Every 5 seconds it checks two things. If the server expiry minus 10 seconds (`SIGN_OUT_GRACE_MS`) has passed, it signs out while the cookie is still valid, so that `POST /auth/logout {reason:'idle'}` is authenticated and audited as `auth.logout.idle`. Otherwise it uses `idleState()` and shows a warning `IDLE_WARNING_SECONDS` (60) before expiry.
- Sign-out does a full navigation to `/{adminPath}/login?timeout=1`, and `LoginForm` then shows an "inactive" notice.

This component is for the user's experience. The server rejects a stale cookie whatever the client does.

### 3.5 Second factor

#### Challenge token

Between the password step and the session, the browser holds only `cms_mfa`. It is a JWT with a **different audience** (`cms-admin-mfa`), signed with the same secret, lives 10 minutes, and carries `{ userId, email, purpose: 'verify' | 'enroll' }`. `verifySession` rejects it at the signature and audience check, and `verifyMfaChallenge` rejects a session token the same way. The routes guard with `requireMfaChallenge(req, purpose)` (`routes/mfa-guard.ts`), which reads the cookie from the `NextRequest` and requires the exact purpose. The challenge carries no permissions. `claimsForUser(userId)` re-reads them when the session is finally issued.

#### TOTP (`core/security/totp.ts`)

- The code is our own RFC 6238 implementation: SHA1, 6 digits, 30-second step, window ±1 (`TOTP_WINDOW`), and a 160-bit secret. Codes are compared with `timingSafeEquals`. A zero-length key fails closed.
- `startTotpEnrollment` stores the encrypted secret as pending (`mfa_method` stays null). It returns `{ secret, otpauthUri, qrSvgDataUri }`. The QR code is a `data:image/svg+xml;base64` URI rendered through `<img>`, never injected as markup.
- `confirmEnrollment('totp', code)` verifies the code, sets `mfa_method='totp'` and `mfa_enrolled_at`, and **seeds `totp_last_step`** so that the enrollment code cannot also be used to sign in.
- **Replay guard.** `verifySecondFactor` only accepts a step greater than `lastStep`. The accepted step is then persisted with a conditional `UPDATE … WHERE totp_last_step IS NULL OR totp_last_step < :step`, and success requires `adapter.affectedRows > 0`. When two requests race, the database lets exactly one of them win.
- A secret that cannot be decrypted (for example after the key was rotated) is logged and fails closed.

#### Emailed codes

- `issueEmailCode(userId, purpose)` generates 6 digits with `randomInt` per digit and inserts a bcrypt hash of `padForHash(code)` first. It then **awaits** `sendMfaCodeEmail`, and a send failure propagates to the caller. It returns `'throttled'` after 5 codes in 15 minutes for that account and purpose.
- `consumeEmailCode` checks up to 5 live codes, newest first. A wrong guess increments `attempts`, and a code at 5 attempts is burned. Single use is enforced by `UPDATE … WHERE consumed_at IS NULL` together with the affected-rows check.
- A code issued for `enroll` cannot complete a `login`, and the reverse is also true (`MfaCodePurpose`).
- Enrolling with email is refused when `graphMailConfigured()` is false.

#### Recovery codes (`core/security/recovery-codes.ts`)

- There are 10 codes of the form `XXXX-XXXX`. The alphabet is `ACDEFGHJKMNPQRSTUVWXYZ2345679`, which drops look-alike characters, and characters are drawn with rejection sampling so there is no modulo bias.
- Codes are stored as `bcrypt(padForHash(normalizeRecoveryCode(code)))`. Normalisation uppercases and strips everything outside A–Z0–9. `padForHash` pads to 10 characters with `.`, a character outside both alphabets, because `hashPassword` refuses input shorter than `MIN_PASSWORD_LENGTH`.
- `replaceRecoveryCodes` deletes every existing code for the account and inserts a new set.
- `verifySecondFactor` always tries recovery codes after the enrolled method, whichever method is enrolled.

#### Break-glass bypass (`core/security/mfa-bypass.ts`, `POST /auth/2fa/bypass`)

- `ADMIN_MFA_BYPASS_CODE` is a static, shared code that stands in for any account's second factor. It must be **exactly 6 digits**. If it is unset, blank or malformed, `readBypassCode()` returns `null` and the feature is off. A malformed value produces one warning, and the value itself is never logged.
- The route is reachable only with a `verify` challenge, which means a correct password on an account that already has a factor. It is deliberately not offered on the forced-enrollment path.
- Throttles: per IP `cms-2fa-bypass` 5/hour, and per account `auth.2fa.bypass.fail` counted since the last `auth.2fa.bypass.success`, 5/hour. The failure audit row records the reason (`disabled` or `mismatch`), never the submitted code. The client always receives the same `mfa_invalid`.
- The bypass is separated from `verifySecondFactor` in code: neither path imports the other's secret. The UI hotkey is **Ctrl+Shift+Alt+P** (`isMfaBypassHotkey`, matched on `event.code === 'KeyP'` so it works on any keyboard layout). It is bound only on the `mfa` step and opens `MfaBypassDialog`. The hotkey only hides the dialog. The actual protection is the separate route and its throttles.
- A success writes `auth.2fa.bypass.success` and then `auth.login.success`.

#### Recovery without the admin UI

`npm run db:reset-mfa -- <email>` (`src/cms/db/seeds/cli/reset-mfa.ts`) clears one account's factor from a shell. Use it when the only superadmin has lost both their authenticator and their recovery codes while `security.require2fa` is on.

### 3.6 Password hashing and policy

- `hashPassword` uses bcryptjs with cost 12 and throws when the input is shorter than 10 characters. `verifyPassword` returns false on any error or on empty input.
- Policy (`password-policy.ts`, Unicode-aware): at least 10 code points, plus a lowercase letter (`\p{Ll}`), an uppercase letter (`\p{Lu}`), a digit (`\p{Nd}`), a symbol, and **not on the common-password list**. The common-password check strips surrounding digits and symbols, and tries both the plain and the de-leeted form, so it catches variants like `Password1!` or `p@ssw0rd`. `passwordStrength` only drives the strength meter and never decides anything.
- The policy is enforced by `createUserBody.password` (`strongPassword`), by the user update `password` field (`strongPasswordOrBlank`, where blank means "keep the current password"), and by the `db:seed-admin` CLI.
- **There is no admin self-service "change my password" route and no admin "forgot password" email flow.** An admin's password is changed only by a `cms.users.manage` holder through `PATCH /api/cms/users/:id`, or from the shell with `db:seed-admin`. The customer forgot/reset routes under `/api/cms/customer/*` belong to the storefront (see 08).

### 3.7 Roles, permissions and `hasPerm`

- A permission is a string key of the form `cms.<area>.<verb>`. `*` grants everything. A trailing `*` is a prefix wildcard: `cms.seo.*`, or `pm:*` for token scopes. Because the separator stays in the prefix, `cms.seo.*` does not match `cms.seoextra`.
- A user's effective permissions are the **union** of the permission lists of their roles.
- Default roles come from `src/cms/db/seeds/roles.ts` (`DEFAULT_ROLES`):
  - `superadmin`: `['*']`.
  - `editor`: access, content r/w/publish, media r/w, SEO r/w, forms read, newsletter read, orders r/w, reviews r/w, reservations r/w, schedule r/w.

  `seedRoles` creates whichever of the two is missing. It re-syncs an existing `superadmin` to `['*']` (`sync: true`), but leaves an existing `editor` exactly as configured on the Roles screen (`planRoleSeed` → `keep`). A default permission added later therefore does not reach an existing site's `editor` automatically: someone ticks it on the Roles screen.
- **The anti-escalation rule** (`roles/can-grant.ts`, `roles/grants.ts`) is that nobody can grant what they do not hold:
  - Role create and update call `assertCanGrant(actor.permissions, requested)`.
  - Role delete calls `assertCanGrant` against the stored permissions of the role being deleted, inside the transaction.
  - Assigning a role to a user (create or update with `roleIds`) additionally requires `cms.roles.manage`, and `assertCanAssignRoles` requires that the actor holds every permission the role carries.
  - Editing or deleting an account (`PATCH`/`DELETE /users/:id`: password reset, 2FA reset, role change, disable, delete, rename) calls `assertCanManageAccount(actor.permissions, target's permissions)`. The account's effective permissions must all be held by the actor. A `*` holder can manage anyone, and an account with no role is within anyone's reach. Otherwise the answer is 403 naming the permissions the actor lacks.
- **Lockout protection.** There must always be at least one enabled user holding a role that grants `*`.
  - `updateUser` checks when disabling a user or dropping their wildcard role.
  - `deleteUser` checks on delete.
  - `updateRole` and `deleteRole` check through `assertNotLastWildcard` when removing `*` from a role or deleting it.

  Every one of these checks reads inside a transaction with `SELECT … FOR UPDATE`, so two concurrent requests cannot both pass. They answer 409 `conflict`. Separately, the route refuses to let you disable or delete **your own** account.
- `deleteRole` refuses (409) while any account still holds the role, rather than letting the FK cascade silently remove it from those accounts.

### 3.8 How `createRoute` enforces a permission

`src/cms/core/api/handler.ts` runs this pipeline, in order:

1. **Same-origin** check for non-GET/HEAD methods, unless the route sets `sameOrigin: false`.
2. **Captcha** (optional): a separate per-IP limiter first, then `verifyCaptchaToken(header x-captcha-token)`.
3. **`rateLimit`** (optional): `checkRateLimit(scope, getClientIp(req), cfg)`. It runs after the captcha, so a failed captcha does not use up this budget.
4. **`guard(req)`**. If it returns a `Response`, that response is sent and nothing further runs. Otherwise the returned value becomes `ctx.auth`.
5. `query` zod validation, then `input` zod validation of the JSON body. These run *after* the guard, so an anonymous caller never learns the body schema from a 422.
6. The handler runs. A plain return value is wrapped with `NextResponse.json`.
7. Errors are mapped: `ApiError` → `{ ok:false, error, message, issues? }` with its status. An FK error becomes 422 `invalid_input`, a duplicate key becomes 409 (the constraint is logged), and anything else becomes a 500 `server_error`.

A permission is enforced by the guard:

```ts
export const thingUpdateRoute = createRoute({
  guard: () => requireApiPerm(PERMISSIONS.contentWrite), // 401 no/expired session, 403 { missing }
  input: z.object({ title: z.string().max(200) }),
  handler: async ({ auth, input, params, ip, req }) => {
    // auth: CurrentUser with FRESH permissions
    // conditional, body-dependent checks go here, e.g. requirePublishRights
  },
});
```

Some checks depend on the body, and those have to happen inside the handler. Examples are `requireRoleAssignment` in `routes/users.ts` and `requirePublishRights` in `routes/collections.ts`, which requires `cms.content.publish` for any status or date change that takes content live or takes it down.

### 3.9 API tokens (Product Manager bridge)

- **The CMS never generates a token.** Product Manager mints the credential and shows it once, and the CMS imports it. Accordingly, `tokens/service.ts` has no create-with-generation function and no function that returns a secret, and no route can reveal one.
- **Format** (`tokens/credential.ts`):
  - A bare credential `pmk_<keyId>_<secret>`, where `keyId` is 12 lowercase hex characters (`KEY_ID_PATTERN`) and `secret` is 32–128 base64url characters.
  - Or a **setup string**: unpadded base64url of `{"key_id","secret","site_url"}`. When `site_url` is present, it must match our origin (`sameSite`).
- **Storage**: `secret_encrypted = encryptSecret(secret)`. Secrets are **encrypted, not hashed**, because HMAC verification needs the plaintext.
- **Scopes**: `API_TOKEN_SCOPES = ['pm:read','pm:write','pm:payload','pm:media']`, plus `pm:*`. They are checked with `hasPerm(token.scopes, opts.scope)`.
- **Request signing** (`tokens/signature.ts`, frozen format, shared byte-for-byte with PM's `PraionRequestSigner`):

  ```
  PM-HMAC-SHA256
  <METHOD>
  <host[:non-default-port], lowercased>
  <path + ?query, verbatim>
  <unix timestamp>
  <nonce: 32 lowercase hex>
  <sha256 hex of raw body>
  ```

  The signature is `hex(HMAC-SHA256(secret-as-string, canonical))`, sent in `X-PM-Signature` (an optional `sha256=` prefix is accepted). The other headers are `X-PM-Key-Id`, `X-PM-Timestamp` and `X-PM-Nonce`. The allowed clock skew is ±300 seconds (`CLOCK_SKEW_SECONDS`).
- **Guard** `requireSignatureOrSession({ scope, perm })` (`tokens/guard.ts`):
  - It refuses plain HTTP in production. `localhost`, `.test` and `.local` are exempt, and `x-forwarded-proto: https` is honoured.
  - It reads the raw body once itself. Bridge routes therefore set **no `input` schema** and validate `auth.body` in the handler.
  - With `X-PM-Key-Id`, the checks run in this order: headers present, key id and nonce shape, timestamp window, `findActiveToken` (unknown, revoked and expired all return null, and revocation is checked on every request), signature match (constant time), `claimNonce` (single use), scope (403), per-token rate limit `pm-token` 300/min, then `touchApiToken` (at most one update per minute).
  - Every authentication failure returns an identical 401 body, and the log line says which check failed.
  - Without `X-PM-Key-Id`, it falls back to a **session** with `requireApiPerm(opts.perm)`, and applies **its own `isSameOrigin` check**. Bridge routes set `sameOrigin: false` on the factory, so this is the only CSRF check on that path.
  - For a token principal, `userId` is null and `actorLabel` is `api-token:<name>`. Pass `actorLabel` to `logAudit`.
- The bridge routes themselves are in `src/cms/modules/pm/routes.ts` (see 06).

### 3.10 Stored-credential encryption

`src/cms/core/tokens/crypto.ts`:

- The algorithm is **AES-256-GCM**. The key is `sha256(CMS_TOKEN_ENCRYPTION_KEY)`, and the env var must be at least 32 characters. The stored value is base64 of `iv(12) ‖ tag(16) ‖ ciphertext`.
- `decryptSecret` **throws** when the value is truncated or has been tampered with.
- The key is read lazily. `assertTokenEncryptionKey()` is the explicit check, which the token import route runs before it parses anything.
- The same key protects **three** kinds of data:
  - `cms_api_tokens.secret_encrypted`
  - `admin_users.totp_secret_encrypted`
  - `integration_secrets.ciphertext`

  **Rotating `CMS_TOKEN_ENCRYPTION_KEY` breaks all three.** Tokens must be re-imported, integration secrets re-entered, and every TOTP user must sign in with a recovery code and re-enroll (or be reset).
- `timingSafeEquals(given, expected)` is the codebase's one constant-time string comparator. Use it for any secret comparison.

Integration secrets (`core/secrets/`):

- A module declares `SecretKeyDef[]`. Only declared keys can be written.
- `secretsRoutes({ defs })` returns GET, which lists `SecretSummary` entries (`set`, `masked: '••••' + hint`, `updatedAt`) and requires `cms.settings.read`. It also returns POST `{ key, value | null }`, which requires `cms.settings.write`, is rate-limited to 20 per minute (`cms-secrets`), and writes the audit actions `secret.set` / `secret.clear` with only the key name.
- **Neither route ever returns a value.** `getSecret(key)` is for server-side use only.
- The write uses `onDuplicateKeyUpdate`, which is specific to MySQL.
- Current users:
  - `courierCredentialsRoute` → `src/app/api/cms/shipping/couriers/route.ts` (see 08).
  - The Google reviews integration (`modules/reviews-external`) calls `setSecret` and `getSecret` directly (see 07).

### 3.11 Audit log

- `logAudit(entry)` inserts a row and **swallows every error**, logging it to the console. A missing audit row never breaks the action that caused it. Do not rely on it for anything that must happen.
- `extractRequestMeta(req)` returns `{ ip, ua }`, with the IP taken from `clientIpLabel`. `createRoute` already gives handlers `ctx.ip`.
- `listAuditLogs({ search, subjectType, group, page, pageSize ≤ 200 })` filters in SQL: a LIKE on action, actor name or subject_id, an exact `subject_type`, and a group given as `AUDIT_ACTION_GROUPS` prefixes with exclusions for earlier groups. It returns items including `ip`, `ua`, `before` and `after`, plus `total` and `subjectTypes`.
- Auth-related action keys in the code:

| Action | Written by |
|---|---|
| `auth.login.success` / `.fail` / `.locked` | login and every path that completes a sign-in |
| `auth.logout` / `auth.logout.idle` | logout |
| `auth.2fa.challenged`, `auth.2fa.enroll_required`, `auth.2fa.success`, `auth.2fa.fail`, `auth.2fa.locked`, `auth.2fa.recovery_used`, `auth.2fa.enrolled`, `auth.2fa.disabled`, `auth.2fa.recovery_regenerated`, `auth.2fa.admin_reset` | `routes/auth-mfa.ts`, `routes/users.ts` |
| `auth.2fa.bypass.success` / `.fail` / `.locked` | bypass route |
| `user.create`, `user.update`, `user.delete` (with `before` holding email, name and roles), `user.password.reset` | `routes/users.ts` |
| `role.create`, `role.update`, `role.delete` | `routes/roles.ts` |
| `api_token.import`, `api_token.revoke` | `routes/api-tokens.ts` |
| `secret.set`, `secret.clear` | `core/secrets/service.ts` |

### 3.12 Customer (storefront) accounts: what is shared

- **Shared with admin auth**:
  - `hashPassword` / `verifyPassword` (`modules/customers/service.ts`).
  - `passwordMessage` (customer routes and checkout).
  - `createRoute`, the rate limiter and `isSameOrigin`.
  - `ADMIN_SESSION_SECRET` as key material.
- **Separate from admin auth**:
  - The cookie `cms_customer`, with audience `cms-customer`.
  - A **different HMAC key**, derived by `hkdfSync('sha256', ADMIN_SESSION_SECRET, 'cms-customer-session', 'customer', 32)`. As a result, a customer token fails signature verification as an admin session.
  - A 30-day TTL and a `tokenVersion` claim checked against the database.
- The admin side of customers is `cms.commerce.customers.read/write`. Nobody in the admin can see or set a customer's password.

Details are in [08-commerce.md](08-commerce.md).

### 3.13 Cross-cutting protections

**CSRF / same-origin** (`api/same-origin.ts`):

- The `Origin` header must equal `new URL(NEXT_PUBLIC_SITE_URL).origin`.
- **No `Origin` header passes.** Such a request is not from a browser, and the guard's cookie requirement still applies.
- A missing `NEXT_PUBLIC_SITE_URL` **fails closed in production** and passes with a warning in development.
- In dev, `NEXT_PUBLIC_SITE_URL` must name the port you are actually using (`dev` on 3002, `dev:qa` on 3003). Otherwise every admin write returns 403.
- The session cookie is `SameSite=Lax`, which is the first line of defence. There is no CSRF token.

**Client IP** (`rate-limit.ts`):

- `getClientIp` trusts **only `x-real-ip`**, because `x-forwarded-for` and `cf-connecting-ip` can be spoofed. It returns null when the header is absent.
- `checkRateLimit` with a null IP **refuses every request in production** and uses a shared `'unknown'` bucket in development, warning once.
- nginx must set `proxy_set_header X-Real-IP $remote_addr;` on every location.
- `clientIpLabel` is only for logging and audit. In non-production it falls back to the first `x-forwarded-for` hop, and otherwise it returns `'unknown'`.
- This is the only limiter. The public `/api/contact` and `/api/cookies/consent` routes use it too (same limits: 5/min and 20/min per IP); the older `src/lib/rate-limit.ts`, which bucketed every header-less request together even in production, has been removed.

**Rate limiting**: an in-memory `Map` per process with a fixed window. It is **not shared across PM2 cluster workers**. The API token nonce cache (`tokens/replay.ts`) has the same limitation. Scopes currently used for auth:

| Scope | Limit | Route |
|---|---|---|
| `cms-login-captcha` | 60 / 10 min | login captcha gate |
| `cms-login` | 10 / 10 min | login |
| `cms-2fa-verify` | 10 / 10 min | `/auth/2fa/verify` |
| `cms-2fa-send` | 5 / 10 min | `/auth/2fa/send-code` |
| `cms-2fa-bypass` | 5 / 60 min | `/auth/2fa/bypass` |
| `cms-2fa-enroll` | 20 / 10 min | `/auth/2fa/enroll/start` |
| `cms-2fa-enroll-confirm` | 10 / 10 min | `/auth/2fa/enroll/confirm` |
| `cms-2fa-disable`, `cms-2fa-recovery` | 10 / 10 min | disable, recovery-codes |
| `api-token-import` | 10 / min | `POST /api/cms/api-tokens` |
| `cms-secrets` | 20 / min | secrets POST |
| `pm-token` (key = token id) | 300 / min | signed bridge requests |

**Safe `?next=`** (`src/cms/admin/safe-next.ts`): `safeNextPath(raw, adminPath)` accepts only the admin root, or the root followed by `/`, `?` or `#`. It rejects `\`, `://` and `//`-prefixed values, and it rejects `/adminEVIL`. Anything else falls back to the admin root. Both `LoginForm` (for the URL param) and the shell layout (for the proxy header) use it.

**Security headers** (`next.config.ts`):

- Site-wide:
  - `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`.
  - COOP `same-origin`, COEP `credentialless`, CORP `same-site`.
  - `Permissions-Policy`, and `poweredByHeader: false`.
  - A production-only CSP (`PRODUCTION_CSP`) with `frame-ancestors 'none'`, `script-src 'self' 'unsafe-inline'` + GTM.
- For `/{ADMIN_SEGMENT}` and its subpaths:
  - `ADMIN_CSP` adds the reCAPTCHA hosts and `frame-src https://www.google.com`.
  - COEP is `unsafe-none`, because reCAPTCHA iframes break under COEP.
- There is no CSP in development.
- HSTS is left to nginx.
- The admin root layout sets `robots: noindex, nofollow`.

**Captcha** (`security/captcha.ts`):

- Enforcement requires **both** `RECAPTCHA_SITE_KEY` and `RECAPTCHA_SECRET_KEY`. If either is missing, verification is skipped with a single warning.
- When configured, the check **fails closed**: a network error or timeout (5 seconds) fails the captcha.
- It checks `success === true` strictly.

---

## 4. HTTP API

All routes are under `src/app/api/cms/`, run on the Node runtime with `force-dynamic`, and are built with `createRoute`. Unless a row says otherwise, POST, PATCH and DELETE are same-origin checked.

| Method | Path | Auth / permission | Purpose |
|---|---|---|---|
| POST | `/api/cms/auth/login` | none. Captcha, rate limit, account lockout. | Password step. Returns `{user}`, `{mfa:{required,method}}` or `{mfa:{required,enroll:true}}`. |
| POST | `/api/cms/auth/logout` | session | Clears `cms_session`. Body `{reason?: 'idle'}`. |
| GET | `/api/cms/auth/me` | session | Current user with fresh permissions and `sessionExpiresAt`. Also slides the session (keepalive). |
| GET | `/api/cms/auth/2fa` | session | Own MFA status plus `required`. |
| POST | `/api/cms/auth/2fa/verify` | `cms_mfa` purpose `verify`. Rate limit and account lockout. | Submit a TOTP, email or recovery code. Issues the session. |
| POST | `/api/cms/auth/2fa/send-code` | `cms_mfa` `verify`, rate limit | Mail a login code (email-method accounts only). |
| POST | `/api/cms/auth/2fa/bypass` | `cms_mfa` `verify`, 5/h per IP and per account | Break-glass code. Issues the session. |
| POST | `/api/cms/auth/2fa/enroll/start` | session **or** `cms_mfa` `enroll` | `{method:'totp'}` returns the secret, URI and QR. `{method:'email'}` mails a code. 409 if already enrolled. |
| POST | `/api/cms/auth/2fa/enroll/confirm` | session **or** `cms_mfa` `enroll` | Verify the code and enable the factor. Returns recovery codes once. When it came from a challenge, it also issues the session. |
| POST | `/api/cms/auth/2fa/disable` | session + password re-auth | Refused (403) while `security.require2fa` is on. |
| POST | `/api/cms/auth/2fa/recovery-codes` | session + password re-auth | Replace all recovery codes. They are shown once. |
| GET | `/api/cms/users` | `cms.users.manage` | Users, roles and `assignableRoleIds`. |
| POST | `/api/cms/users` | `cms.users.manage` + `cms.roles.manage` (roleIds is required) + may-assign check | Create a user with exactly one role. |
| PATCH | `/api/cms/users/:id` | `cms.users.manage` + `assertCanManageAccount` (the target's permissions must all be held by the actor). `roleIds` also needs `cms.roles.manage` and the may-assign check. | Name, locale, disabled, password, roleIds (0–1), `resetMfa`. |
| DELETE | `/api/cms/users/:id` | `cms.users.manage` + `assertCanManageAccount` | Hard delete. Not allowed on yourself or on the last superadmin. |
| GET | `/api/cms/roles` | `cms.roles.manage` | Roles with `userCount`, plus `assignable` keys. |
| POST | `/api/cms/roles` | `cms.roles.manage` + `assertCanGrant` | Create a role. |
| PATCH | `/api/cms/roles/:id` | `cms.roles.manage` + `assertCanGrant` | Rename and/or replace permissions. |
| DELETE | `/api/cms/roles/:id` | `cms.roles.manage` + `assertCanGrant(stored)` | Refused while the role is held, or when it is the last `*` role with a holder. |
| GET | `/api/cms/api-tokens` | `cms.tokens.manage` | Token summaries. Never includes secrets. |
| POST | `/api/cms/api-tokens` | `cms.tokens.manage`, 10/min | Import a PM credential `{credential, name, scopes[], expiresAt?}`. Requires https in production and the encryption key. |
| DELETE | `/api/cms/api-tokens/:id` | `cms.tokens.manage` | Revoke (sets `revoked_at`). Returns 204. |
| GET | `/api/cms/audit` | `cms.audit.read` | Paged audit log. Query `search`, `subjectType`, `group`, `page`, `pageSize ≤ 200`. |
| GET/POST | `/api/cms/shipping/couriers` (example `secretsRoutes`) | `cms.settings.read` / `cms.settings.write` | Declared integration secrets. They are write-only. |
| * | `/api/cms/pm/**` | `requireSignatureOrSession({scope, perm})`, `sameOrigin: false` | PM bridge (see 06). |

Error envelope: `{ ok: false, error: <code>, message, issues? }`. A permission failure from `requireApiPerm` is `{ ok:false, error:'forbidden', missing:'<key>' }` with status 403. An unauthenticated request is `{ ok:false, error:'unauthorized' }` with status 401.

---

## 5. Permissions reference

Defined in `src/cms/modules/auth/permissions.ts` (`PERMISSIONS`). The descriptions are condensed from `permission-labels.ts`.

| Constant | Key | Grants |
|---|---|---|
| — | `*` | Everything, including keys added later. |
| `access` | `cms.access` | Using the admin at all: enforced by `(shell)/layout.tsx` for screens and by `requireApiAuth` / `requireApiPerm` for the API (logout excepted). |
| `contentRead` | `cms.content.read` | Content lists and editors, draft preview. |
| `contentWrite` | `cms.content.write` | Create and edit content, bulk import. |
| `contentPublish` | `cms.content.publish` | Publish, unpublish, schedule, and take live content down (`requirePublishRights`). |
| `mediaRead` / `mediaWrite` | `cms.media.read` / `.write` | Browse the media library / upload, edit and delete. |
| `seoRead` / `seoWrite` | `cms.seo.read` / `.write` | Redirects, 404 monitor, meta overrides. |
| `formsRead` / `formsWrite` | `cms.forms.read` / `.write` | Read submissions (personal data) / change status and notes. |
| `settingsRead` / `settingsWrite` | `cms.settings.read` / `.write` | Settings, cookies, shipping, stored credentials. |
| `usersManage` | `cms.users.manage` | Admin accounts: create, edit, disable, delete, reset password and 2FA — only on accounts whose permissions the actor holds. |
| `rolesManage` | `cms.roles.manage` | Role CRUD and assigning roles, within the actor's own grants. |
| `tokensManage` | `cms.tokens.manage` | Import and revoke PM API tokens (Settings → Praion tab, when the `pm` module is on). |
| `auditRead` | `cms.audit.read` | The audit log. |
| `scriptsManage` | `cms.scripts.manage` | Script snippets, which run JavaScript in every visitor's browser. |
| `ordersRead` / `ordersWrite` | `cms.commerce.orders.read` / `.write` | Orders, gift cards, abandoned carts. |
| `customersRead` / `customersWrite` | `cms.commerce.customers.read` / `.write` | Shop customer accounts (disable, re-send confirmation). |
| `reviewsRead` / `reviewsWrite` | `cms.commerce.reviews.read` / `.write` | Review moderation. |
| `newsletterRead` / `newsletterWrite` | `cms.newsletter.read` / `.write` | Subscribers / unsubscribe and erase. |
| `reservationsRead` / `reservationsWrite` | `cms.booking.reservations.read` / `.write` | Reservations, payment links, refunds. |
| `scheduleRead` / `scheduleWrite` | `cms.booking.schedule.read` / `.write` | The availability calendar. |

API token scopes are a separate namespace, checked with the same `hasPerm`: `pm:read`, `pm:write`, `pm:payload`, `pm:media`, `pm:*`.

---

## 6. Admin UI

| Screen | Component | Server gate | Notes |
|---|---|---|---|
| `/admin/login` | `LoginForm` (+ `MfaEnrollPanel`, `MfaBypassDialog`, `Captcha`) | none | Three steps: `password`, then `mfa` or `enroll`. The step is chosen from the server's response. The token goes in the `x-captcha-token` header and is reset after each failure. `?timeout=1` shows the idle notice. After success it runs `router.push(safeNextPath(next))`. Error text comes from `login-error.ts`. |
| `/admin/account` ("Your account") | `AccountSecurity` | `requireAuth` only | Available to every signed-in user and deliberately has no permission check. Enroll, disable (password re-ask) and regenerate recovery codes (password re-ask). |
| `/admin/users` | `UsersManager` | `requirePerm(usersManage)` | Create requires one role. The role dropdown is limited by `assignableRoleIds`. Edit covers name, locale, disabled, password reset, role, and "reset 2FA" (shown when `mfaEnabled`). Delete. |
| `/admin/roles` | `RolesManager` | `requirePerm(rolesManage)` | Permission checkboxes grouped by `AREA_LABELS`, with "i" help from `permissionDescription`. Keys the actor does not hold are disabled (`grantable = user.permissions`, passed by the page and returned by `GET /api/cms/roles`; `mergeRolesData` keeps it across refreshes). |
| `/admin/settings?tab=<PRAION_TAB>` | `ApiTokensManager` | settings page and `moduleFlags.pm && hasPerm(tokensManage)` | Paste the setup string, name it, choose scopes and optional expiry. The list shows key id, scopes, last used time and IP. Revoke. `/admin/api-tokens` redirects here. |
| `/admin/audit` | server page | `requirePerm(auditRead)` | Search, subject type, group filter (`AUDIT_ACTION_GROUPS`), paging. Each row can expand to show UA and the `before`/`after` JSON. |
| shell | `IdleLogout` | — | Idle warning and keepalive, described in §3.4. |

The sidebar (`(shell)/layout.tsx`) shows Users, Roles and Audit only to holders of the matching permission. "Your account" is always shown.

---

## 7. Configuration

| Env var | Default | Effect |
|---|---|---|
| `ADMIN_SESSION_SECRET` | — (required, ≥ 32 characters) | HS256 key for `cms_session` and `cms_mfa`, and the HKDF input for the customer token key. Rotating it signs everyone out, admins and customers alike. |
| `ADMIN_SESSION_TTL_HOURS` | `8` | Absolute session cap. |
| `ADMIN_SESSION_IDLE_MINUTES` | `60` | Idle window (minimum 1 minute). Invalid values fall back to the default. |
| `CMS_TOKEN_ENCRYPTION_KEY` | — (≥ 32 characters) | AES-GCM key for API tokens, TOTP secrets and integration secrets. It is required for TOTP enrollment too, not only for PM. |
| `ADMIN_PATH` | `admin` | Admin URL segment, `[A-Za-z0-9_-]+`. Anything else falls back to `admin`. See the gotcha about the literal `/admin` in §10. |
| `RECAPTCHA_SITE_KEY`, `RECAPTCHA_SECRET_KEY` | unset | The login captcha is enforced only when both are set. `.env.example` ships Google's public test keys. |
| `ADMIN_MFA_BYPASS_CODE` | unset | Exactly 6 digits enables the break-glass bypass **in every environment, production included** (the `.env.example` comment says so). Whether production should allow it at all is an open security decision; the code does not restrict it. |
| `NEXT_PUBLIC_SITE_URL` | — | Origin for `isSameOrigin` (fails closed in production when missing). Also used for the API-token https check and `site_url` match (`siteOrigin()`). |
| Microsoft Graph vars (`AZURE_*`) | — | Needed for emailed MFA codes (`graphMailConfigured()`). See 07. |

Setting:

- `security.require2fa` (`'on'` / off) forces every admin to enroll at their next sign-in and blocks self-service disable. It lives in the settings registry (see 10).

Operational commands:

```bash
npm run db:seed-roles                              # create missing default roles; re-sync superadmin to *; an existing editor is left as configured
npm run db:seed-admin -- <email> <password> [name] [--locale el]   # create a superadmin, or make an existing account one (replaces its role; policy-checked)
npm run db:reset-mfa -- <email>                    # clear one account's 2FA from a shell
```

Reverse proxy: set `proxy_set_header X-Real-IP $remote_addr;` on every location. If you do not, production refuses every rate-limited request, including the login.

---

## 8. Extending

### Add a permission

1. Add the key to `PERMISSIONS` in `src/cms/modules/auth/permissions.ts`, following `cms.<area>.<verb>`. `ALL_PERMISSIONS` and `ASSIGNABLE_PERMISSIONS` pick it up automatically.
2. Add an `AREA_LABELS` entry if the area is new, and a `PERMISSION_DESCRIPTIONS` sentence, in `permission-labels.ts`. `test/cms/permission-help.test.ts` checks the descriptions.
3. Enforce it in the API guard (`requireApiPerm`), the page (`requirePerm`) and, if needed, the sidebar filter.
4. Decide whether the seeded `editor` role should hold it (`db/seeds/roles.ts`). Only new sites (or a site with no `editor` role) get it from the seed; an existing `editor` is never rewritten, so existing sites add it on the Roles screen.
5. Update the user guide's roles section (`docs/user-guides/`) and `docs/CMS-FEATURES-FOR-PROPOSALS.md`.

### Add a protected endpoint

Build it with `createRoute` and export it from `src/cms/core/routes/index.ts` (or from the module's `routes.ts`). Then add a thin file under `src/app/api/cms/<path>/route.ts`:

```ts
// src/cms/core/routes/widgets.ts
export function widgetDeleteRoute() {
  return createRoute({
    rateLimit: { scope: 'cms-widgets-delete', max: 30, windowMs: 60_000 },
    guard: () => requireApiPerm(PERMISSIONS.contentWrite),
    handler: async ({ params, auth, ip, req }) => {
      const id = idParam(params.id, 'widget id');
      const before = await findWidget(id);
      if (!before) throw notFound('No such widget.');
      await deleteWidget(id);
      await logAudit({ userId: auth.userId, action: 'widget.delete', subjectType: 'widget',
                       subjectId: id, before: { name: before.name }, ip, ua: req.headers.get('user-agent') });
      return noContent();
    },
  });
}

// src/app/api/cms/widgets/[id]/route.ts
import { widgetDeleteRoute } from '@/cms/core/routes';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const DELETE = widgetDeleteRoute();
```

If you want the new action to appear under a filter, add its prefix to `AUDIT_ACTION_GROUPS`, and add a label to `audit-labels.ts`.

### Add a stored integration secret

Declare `SecretKeyDef`s (dotted keys matching `isValidSecretKey`) in the module. Expose them with `secretsRoutes({ defs: () => MY_DEFS })` under a settings path. Read them server-side with `getSecret(key)` and handle a `null` return (not configured) as well as a thrown error (decryption failure).

### Add a machine-to-machine endpoint for PM

Use `guard: requireSignatureOrSession({ scope: 'pm:<x>', perm: PERMISSIONS.<y> })` and `sameOrigin: false`, and give it **no `input` schema**. Parse `auth.body` with zod in the handler. Audit with `userId: principal.userId` and `actorLabel: principal.actorLabel`. If you add a new scope, extend `API_TOKEN_SCOPES` and the scope options in `ApiTokensManager`.

### Add a new auth throttle

For a per-account budget, reuse `recentAuthFailures(email, windowMs, { failAction, successAction })`, writing matching audit rows with `subjectType: 'email'` and the lowercased email. Do not add a new table.

---

## 9. Testing

The test runner is `node:test` via tsx. There is no DOM, so UI logic is tested through pure helpers.

```bash
npx tsx --tsconfig ./tsconfig.test.json --test test/cms/session-idle.test.ts
npm test        # whole suite (see package.json "test" globs)
```

| File | Covers |
|---|---|
| `test/cms/permissions.test.ts` | `hasPerm` wildcards and prefixes, `hasAnyPerm`, `ALL_PERMISSIONS`. |
| `test/cms/permission-help.test.ts`, `test/cms/labels.test.ts` | Permission descriptions and labels. |
| `test/cms/session.test.ts` | JWT sign and verify, audience separation, `abs` handling. |
| `test/cms/session-idle.test.ts` | `decideSessionRefresh`, `sessionIdleSeconds`, `idleState` boundaries. |
| `test/cms/mfa-challenge.test.ts` | Challenge token: audience, purpose, expiry. |
| `test/cms/totp.test.ts` | RFC 6238 vectors, window, `lastStep`, base32, `otpauthUri`. |
| `test/cms/recovery-codes.test.ts`, `recovery-codes-file.test.ts` | Generation, normalisation, `padForHash`. |
| `test/cms/mfa-email.test.ts` | Code email content and send-failure propagation. |
| `test/cms/mfa-bypass.test.ts`, `mfa-bypass-hotkey.test.ts` | Bypass code shape and comparison. The hotkey matcher. |
| `test/cms/password-policy.test.ts` | Rules, common list, strength meter. |
| `test/cms/user-create-form.test.tsx` | `createUserBody` / `newUserProblems` (role required, one role). |
| `test/cms/user-email.test.ts` | Email normalisation on create. |
| `test/cms/account-grants.test.ts` | `assertCanManageAccount`, and that the users PATCH/DELETE routes call it before writing. |
| `test/cms/api-access.test.ts` | `cms.access` on the API guards (`adminApiAccessDenied`), logout exemption. |
| `test/cms/roles-manager-refresh.test.ts` | `grantable` survives a Roles screen refresh; the list route returns it. |
| `test/cms/role-seed.test.ts` | `planRoleSeed` (editor kept, superadmin synced) and `superadminGrant` for `db:seed-admin`. |
| `test/lib/public-rate-limit.test.ts` | `/api/contact` and `/api/cookies/consent` use the core limiter. |
| `test/cms/safe-next.test.ts`, `test/cms/admin-deep-link.test.ts` | Open-redirect defence and deep-link header. |
| `test/cms/login-error.test.ts` | Error-to-message mapping. |
| `test/cms/client-ip.test.ts` | `getClientIp` / `clientIpLabel`. |
| `test/cms/captcha.test.ts`, `test/core/route-captcha.test.ts` | Captcha interpretation, and the captcha-then-rate-limit order. |
| `test/core/route-2fa.test.ts` | `requireMfaChallenge`, 2FA budget separation, bypass. |
| `test/core/api.test.ts` | The `createRoute` pipeline (same-origin, guard short-circuit, validation, error mapping). |
| `test/cms/audit-groups.test.ts` | Group prefix and exclusion logic. |
| `test/core/pm-signature.test.ts` | Golden vectors for the frozen canonical string and HMAC. |
| `test/core/pm-tokens.test.ts` | Credential parsing, crypto round-trip, replay cache, guard ordering. |
| `test/core/secrets.test.ts` | Secret key validation, hint and masking, summaries. |

There are no unit tests for the database-backed rules in `users/service.ts` and `roles/service.ts` (the last-superadmin locks, `deleteRole` refusals), or for `assertCanGrant` and `assertCanAssignRoles` directly (`assertCanManageAccount` is tested). Those rules are covered only by QA and end-to-end runs, if at all. If you change them, add tests.

---

## 10. Gotchas and invariants

- **The proxy does not authenticate.** `src/proxy.ts` only stamps a header. Every admin page under `(shell)` is protected by the layout's `requirePerm(cms.access)`, and every API route by its own guard. A page added **outside** `(shell)` gets no protection unless it calls `requireAuth` or `requirePerm` itself.
- **`cms.access` gates the API too (fixed).** `requireApiAuth` / `requireApiPerm` refuse a session without it (403 `missing: 'cms.access'`). A new session-authenticated endpoint that bypasses these guards must check it itself. Only logout opts out (`allowWithoutAccess`).
- **The JWT permission snapshot is display-only.** Never authorize with `getCurrentUser().permissions`. Use `requireApiPerm` / `requirePerm`, which read the database.
- **`logAudit` never throws.** Do not use it as a gate or as the source of truth for anything except the lockout counters, and those fail open.
- **The lockout counters depend on audit conventions.** Use `subjectType: 'email'` and the **lowercased** email, and write the matching success action whenever a sign-in completes. On MySQL, `utf8mb4_unicode_ci` hides case mismatches, but other dialects would not.
- **Admin emails are stored lowercased (fixed for new accounts).** `createUserBody` and `createUser` both apply `normalizeEmail`, matching the login lookup and the CLI. Accounts created before the fix may still hold mixed case; on MySQL the case-insensitive collation hides that, on other dialects they would need a one-off `UPDATE admin_users SET email = LOWER(TRIM(email))`.
- **Single use is enforced by the database, not by a read.** TOTP steps, email codes and recovery codes are each consumed with a conditional UPDATE and `adapter.affectedRows`. Keep that pattern for anything else that must be single-use.
- **The key is shared.** `CMS_TOKEN_ENCRYPTION_KEY` protects TOTP seeds as well as tokens and integration secrets. Rotating it disables TOTP for every enrolled user (fail closed).
- **The limiters and the nonce cache are per process.** Under PM2 cluster mode or multiple containers, IP limits are per worker and **token replay protection is not guaranteed** (`tokens/replay.ts` says so).
- **A missing `X-Real-IP` in production refuses everything** that is rate-limited, including login. A missing `NEXT_PUBLIC_SITE_URL` in production refuses every browser write.
- **`ADMIN_PATH` is only partly configurable.** `getAdminPath()` and the `next.config.ts` headers honour it. But the route folder is literally `src/app/admin`, the `src/proxy.ts` matcher and early exit are hard-coded to `/admin`, and sidebar hrefs are hard-coded to `/admin/...`. Treat any value other than `admin` as untested.
- **`db:seed-roles` re-syncs only `superadmin` (fixed).** It used to overwrite `editor` too. Now an existing `editor` is kept as configured, which also means new default permissions do not reach it automatically.
- **`cms.users.manage` reaches only accounts no more powerful than its holder (fixed).** Every PATCH/DELETE on `/users/:id` runs `assertCanManageAccount` first. It is still full takeover of every account *within* that reach (password and 2FA reset), so grant it deliberately.
- **Account-level MFA endpoints re-authenticate with the password.** Disable and recovery-code regeneration both require it. Keep that for any new self-service action that lowers security.
- **The customer and admin tokens must stay separate.** Changing the HKDF info strings in `modules/customers/token.ts` signs every customer out. Deriving the customer key from the admin key without HKDF would let tokens cross over.

### Security checklist for a new endpoint

Work through this for every new route under `src/app/api/cms/` (or a module's `routes.ts`):

1. **Use `createRoute`.** Never write a bare `export async function POST`. The factory is what supplies the same-origin check, validation ordering and the error envelope.
2. **Set a guard.**
   - Admin endpoints: `requireApiPerm(PERMISSIONS.<key>)`, with the narrowest key that fits and a `*.read` for GETs.
   - Mid-login endpoints: `requireMfaChallenge(req, purpose)`.
   - Machine endpoints: `requireSignatureOrSession`.
   - Public endpoints (storefront, forms): state explicitly why there is no guard, and add a rate limit and/or captcha.
3. **Leave `sameOrigin` at its default (true)** for anything reachable with a cookie. Set it to `false` only for signed machine routes, and make sure the guard re-applies `isSameOrigin` on its session path.
4. **Put body-dependent authorization in the handler.** Examples: publish rights, role assignment (`assertCanAssignRoles`), `assertCanGrant`, "not your own account", ownership and IDOR checks on `params.id`. Parse ids with `idParam`.
5. **Validate with zod.** Use `input` and `query` schemas with max lengths and enums, and do not pass the raw body through to the database (mass assignment).
6. **Rate-limit** anything that is unauthenticated, sends email, calls a third party, verifies a secret or is expensive. Give it its own `scope` so budgets do not drain each other. For guessing attacks against one account, add a per-account counter through `recentAuthFailures`.
7. **Answer uniformly.** Unknown and wrong must look the same (same status, same message). Log the detailed reason on the server.
8. **Never return or log secrets.** No passwords, codes, tokens or decrypted values in responses, audit `before`/`after`, or `console` output. Store credentials with `encryptSecret` (reversible, when needed) or `hashPassword` (one-way). Compare them with `timingSafeEquals` or bcrypt.
9. **Audit state changes** with `logAudit({ userId | actorLabel, action: '<area>.<verb>', subjectType, subjectId, ip, ua })`. Use a dedicated action for security-relevant edits (password reset, 2FA reset, permission change) rather than burying them in a generic `*.update`.
10. **Protect against lockout** when the endpoint can remove access. Put the invariant inside a transaction with `FOR UPDATE`, as `updateUser`, `deleteUser` and `assertNotLastWildcard` do.
11. **Consume one-time values atomically** with a conditional UPDATE and an affected-rows check.
12. **Enforce on the server too.** The page (`requirePerm`) and the sidebar filter are conveniences. The API route must enforce the same rule itself.
13. **Add tests.** At minimum, cover guard short-circuits (401/403), validation and the refusal paths. Pure logic belongs in a module with no `server-only` import so it can be tested with `node:test`.
14. **Update the docs.** Update this guide, `docs/CMS-FEATURES-FOR-PROPOSALS.md` and, if the admin UI changed, the user guides.
