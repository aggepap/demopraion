/**
 * The Product Manager bridge.
 *
 * A token-authenticated REST namespace at `/api/cms/pm/v1` that lets the PM SaaS
 * read this site's content and push back SEO/AEO enrichment. See
 * `docs/PM_BRIDGE_SPEC.md` for the design and `docs/PM_CONTENT_TYPES.md` for the
 * data contract the other side codes against.
 *
 * Gated by `modules.pm`, which is off by default: the bridge grants an external
 * system write access to every published page, and that is not something a site
 * should acquire by cloning a repo.
 */
export { noRouteResponse, pmEnabled, pmModuleGate, NO_ROUTE_BODY } from './gate';
export { decodeRef, encodeRef, encodeRemoteId, PmRefError, type PmRef } from './identity';
export {
  pmPageGetRoute,
  pmPagesListRoute,
  pmImageAltsRoute,
  pmPageWriteRoute,
  pmPayloadRoute,
  pmPingRoute,
  pmProductGetRoute,
  pmProductsListRoute,
  pmProductWriteRoute,
} from './routes';
export { applyArchiveValues, applyPageValues, type PmWriteResult } from './write';
export { applyImageAlts, type AltEntry, type AltScope } from './alts';
export { safeJsonLd } from './jsonld';
export { PmStructuredData } from './PmStructuredData';
export { deletePayload, payloadHash, storePayload, PayloadError } from './payload';
export { contentTypeManifest, type PmContentType } from './catalogue';
export { buildItem, editableKeysFor, galleryPaths, type PmItem } from './dto';
export {
  clampPage,
  clampPerPage,
  exposedCollections,
  parseModifiedAfter,
  PER_PAGE_MAX,
  pmMeta,
} from './catalogue';
export {
  absoluteUrl,
  flattenTitle,
  formatRobots,
  getAtPath,
  isGroupTitle,
  isSafePath,
  mediaUuidFromUrl,
  parseRobots,
  permalinkFor,
  setAtPath,
  toPmStatus,
  toSameOriginPath,
} from './mapping';
