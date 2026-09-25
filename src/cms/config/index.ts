/**
 * Public entry point for the config API. Site `cms.config.ts` files and the
 * core both import from here.
 */
export {
  f,
  walkFields,
  fieldAt,
  groupPartOrder,
  isRelationKind,
  showIfConditions,
  isFieldVisible,
  visibleFields,
  MONTH_DAY_PATTERN,
} from './fields';
export type {
  Field,
  FieldKind,
  FieldLabel,
  ShowIfCondition,
  TextField,
  TextareaField,
  RichTextField,
  CodeField,
  NumberField,
  BooleanField,
  SelectField,
  SelectOption,
  DateField,
  MonthDayField,
  ImageField,
  RelationField,
  RepeaterField,
  GroupField,
  MdxPropType,
  MdxPropSpec,
  MdxChildrenSpec,
  MdxRepeatSpec,
  MdxComponentSpec,
} from './fields';

export { defineCollection, isReservedSlug, listingPathOf, resolveCollection } from './collection';
export type {
  CollectionDefinition,
  ResolvedCollection,
  CollectionRouting,
  UnpublishRedirectDefinition,
} from './collection';

export { taxonomyCollection } from './taxonomy';
export type { TaxonomyCollectionOptions } from './taxonomy';

export { collectionAliasKey, defineConfig } from './config';
export type {
  CmsConfig,
  CmsConfigInput,
  ModuleFlags,
  FieldResolver,
  PmConfig,
  PmArchiveDefinition,
} from './config';

export {
  isPmArchiveType,
  isPmDocumentPageType,
  PM_ARCHIVE_PAGE_TYPES,
  PM_DOCUMENT_PAGE_TYPES,
  PM_EDITABLE_FIELD_KEYS,
  PM_PAGE_TYPES,
  PM_WRITABLE_KEYS,
} from './pm-types';
export type {
  PmArchiveType,
  PmDocumentPageType,
  PmPageType,
  PmWritableKey,
} from './pm-types';

export { buildDataSchema } from './zod';
