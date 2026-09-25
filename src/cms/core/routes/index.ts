/**
 * Ready-made route handlers/factories. Site route files under
 * `src/app/api/cms/**` import these and (where needed) pass the site config —
 * keeping the core free of any site import.
 */
export {
  collectionListRoute,
  collectionCreateRoute,
  collectionGetRoute,
  collectionUpdateRoute,
  collectionDeleteRoute,
  collectionVersionsRoute,
  collectionRestoreRoute,
} from './collections';
export { loginRoute, logoutRoute, meRoute } from './auth';
export {
  mfaVerifyRoute,
  mfaBypassRoute,
  mfaSendCodeRoute,
  mfaEnrollStartRoute,
  mfaEnrollConfirmRoute,
  mfaStatusRoute,
  mfaDisableRoute,
  mfaRecoveryCodesRoute,
  mfaRequiredBySetting,
} from './auth-mfa';
export { settingsGetRoute, settingsUpdateRoute } from './settings';
export { submissionsListRoute, submissionGetRoute, submissionUpdateRoute } from './forms';
export {
  redirectsListRoute,
  redirectCreateRoute,
  redirectUpdateRoute,
  redirectDeleteRoute,
  notFoundListRoute,
  notFoundUpdateRoute,
  notFoundDeleteRoute,
  metaListRoute,
  metaUpsertRoute,
  metaDeleteRoute,
} from './seo';
export { usersListRoute, userCreateRoute, userUpdateRoute, userDeleteRoute } from './users';
export { rolesListRoute, roleCreateRoute, roleUpdateRoute, roleDeleteRoute } from './roles';
export { auditListRoute } from './audit';
export { importTemplateRoute, importParseRoute } from './import';
export { apiTokenListRoute, apiTokenImportRoute, apiTokenRevokeRoute } from './api-tokens';
export { mediaListRoute, mediaDeleteRoute, mediaUpdateRoute } from './media';
export {
  cookieCatalogRoute,
  cookieScanRoute,
  cookieCategoryCreateRoute,
  cookieCategoryUpdateRoute,
  cookieCategoryDeleteRoute,
  cookieServiceCreateRoute,
  cookieServiceUpdateRoute,
  cookieServiceDeleteRoute,
} from './cookies';
export { scriptListRoute, scriptCreateRoute, scriptUpdateRoute, scriptDeleteRoute } from './scripts';
