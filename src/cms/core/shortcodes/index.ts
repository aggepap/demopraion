/**
 * The shortcode system: one grammar, one registry, one validation.
 *
 * Modules declare their shortcodes in `modules/<m>/shortcodes.ts`; the site's
 * glue file maps each name to a component. Nothing renders that the registry
 * has not approved, with attributes it has not validated.
 */
export {
  parseShortcode,
  serializeShortcode,
  shortcodeFromParagraph,
  unescapeShortcode,
  type ParsedShortcode,
} from './parse';
export {
  attrsToZod,
  componentNameFor,
  defineShortcode,
  resolveShortcode,
  shortcodeComponentNames,
  type AttrSpec,
  type ShortcodeDef,
  type ShortcodeRegistry,
  type ShortcodeResolution,
} from './registry';
export { SHORTCODES, shortcodeList } from './all';
