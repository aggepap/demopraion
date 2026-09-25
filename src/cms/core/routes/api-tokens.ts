import 'server-only';

import { z } from 'zod';

import { PERMISSIONS, requireApiPerm } from '../../modules/auth';
import { createRoute } from '../api/handler';
import { idParam } from '../api/params';
import { created, noContent, ok } from '../api/respond';
import { logAudit } from '../audit';
import { badRequest, notFound } from '../errors';
import { siteOrigin } from '../paths';
import { CredentialParseError, parseCredential, sameSite } from '../tokens/credential';
import { assertTokenEncryptionKey } from '../tokens/crypto';
import { API_TOKEN_SCOPES, importApiToken, listApiTokens, revokeApiToken } from '../tokens/service';

/**
 * Managing the credentials Product Manager issues.
 *
 * **There is no create route, and no route that returns a secret** — not even
 * once. PM mints the credential and reveals it once on its own side; praion
 * imports it. Because praion never has a secret to display, there is no
 * "shown once" state to get right and no code path from which one could leak.
 *
 * Gated on `cms.tokens.manage` rather than `cms.users.manage`: accepting a
 * credential that can rewrite every published page is a different privilege from
 * managing editors, and collapsing the two would hide that from whoever assigns
 * roles.
 */

/** `pm:*` is offered as a scope, but least privilege is the recommended default. */
const scopeSchema = z.enum([...API_TOKEN_SCOPES, 'pm:*']);

const importSchema = z.object({
  /** The setup string from PM, or a bare `pmk_…` credential. */
  credential: z.string().min(1).max(4096),
  name: z.string().trim().min(1).max(191),
  scopes: z.array(scopeSchema).min(1).max(8),
  /** ISO date. Optional, but a finite expiry is the recommended default. */
  expiresAt: z.string().datetime().nullish(),
});

export function apiTokenListRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.tokensManage),
    handler: async () => ok(await listApiTokens()),
  });
}

/**
 * `POST /api/cms/api-tokens` — accept a credential minted by Product Manager.
 *
 * Four refusals, each preventing a failure that would otherwise surface much
 * later and much less legibly:
 *
 * 1. **Plain HTTP in production.** The paste is the one moment the secret exists
 *    in the clear; storing a credential that cannot then be used safely is worse
 *    than refusing it.
 * 2. **A missing encryption key**, checked before parsing, so the operator is
 *    told to fix the environment rather than seeing a save appear to work.
 * 3. **A wrong-site paste**, caught by comparing PM's `site_url` against our own
 *    origin. Otherwise it fails later as an unexplained signature mismatch.
 * 4. **A duplicate key id**, refused rather than overwritten — see
 *    `importApiToken`.
 */
export function apiTokenImportRoute() {
  return createRoute({
    rateLimit: { scope: 'api-token-import', max: 10, windowMs: 60_000 },
    guard: () => requireApiPerm(PERMISSIONS.tokensManage),
    input: importSchema,
    handler: async ({ input, auth }) => {
      const origin = siteOrigin();
      if (process.env.NODE_ENV === 'production' && !origin.startsWith('https://')) {
        throw badRequest(
          'This site is not served over HTTPS, so an API credential cannot be used safely. ' +
            'Configure NEXT_PUBLIC_SITE_URL with an https:// address before connecting Product Manager.',
        );
      }

      // Before parsing: a credential we cannot encrypt must not appear to save.
      try {
        assertTokenEncryptionKey();
      } catch (err) {
        throw badRequest((err as Error).message);
      }

      let parsed;
      try {
        parsed = parseCredential(input.credential);
      } catch (err) {
        if (err instanceof CredentialParseError) throw badRequest(err.message);
        throw err;
      }

      if (parsed.siteUrl && origin && !sameSite(parsed.siteUrl, origin)) {
        throw badRequest(
          `That setup string was issued for ${parsed.siteUrl}, but this site is ${origin}. ` +
            'Check which connection you copied it from.',
        );
      }

      const token = await importApiToken(
        {
          name: input.name,
          keyId: parsed.keyId,
          secret: parsed.secret,
          scopes: input.scopes,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        },
        auth.userId,
      );

      // `after` carries the key id and scopes and never the secret — an audit
      // row is exactly the kind of place a credential must not end up.
      await logAudit({
        userId: auth.userId,
        action: 'api_token.import',
        subjectType: 'cms_api_token',
        subjectId: token.id,
        after: { keyId: token.keyId, name: token.name, scopes: token.scopes },
      });

      return created(token);
    },
  });
}

/** `DELETE /api/cms/api-tokens/:id` — revocation takes effect on the next request. */
export function apiTokenRevokeRoute() {
  return createRoute({
    guard: () => requireApiPerm(PERMISSIONS.tokensManage),
    handler: async ({ params, auth }) => {
      const id = idParam(params.id, 'token id');

      const revoked = await revokeApiToken(id);
      if (!revoked) throw notFound('No such API token.');

      await logAudit({
        userId: auth.userId,
        action: 'api_token.revoke',
        subjectType: 'cms_api_token',
        subjectId: id,
      });

      return noContent();
    },
  });
}
