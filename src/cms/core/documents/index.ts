export {
  createDocument,
  updateDocument,
  deleteDocument,
  getDocumentById,
  getDocumentGroup,
  listDocuments,
  listDocumentGroups,
  listVersions,
  restoreVersion,
  deriveDocumentTitle,
  documentVersionNumber,
  translationGroupSlugs,
  versionRestoreState,
} from './service';
export type {
  DocumentWriteInput,
  DocumentWriteOptions,
  DocumentPatch,
  DocumentSummary,
  DocumentVariant,
  DocumentGroupSummary,
  DocumentVersionSummary,
  ListDocumentsOptions,
  ListDocumentsResult,
  ListDocumentGroupsOptions,
  ListDocumentGroupsResult,
} from './service';
export { extractRelationLinks, syncDocumentRelations } from './relations';
export { previewTargetFor, type PreviewCandidate, type PreviewTarget } from './preview-target';
export { normalizeDocumentSlug } from './slug-input';
