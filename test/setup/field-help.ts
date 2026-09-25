import { walkFields, type CollectionDefinition, type Field } from '@/cms/config';

/**
 * Fields an owner fills in that have no `description` — the text the admin
 * shows behind the "i" beside the label. `hidden` fields never reach the form
 * and are skipped; so is anything listed in `exempt` (keep it short, with a
 * reason next to each entry at the call site).
 */
export function missingDescriptions(collection: CollectionDefinition, exempt: ReadonlySet<string> = new Set()): string[] {
  const missing: string[] = [];
  walkFields(collection.fields as Field[], (field, path) => {
    const id = `${collection.key}.${path.join('.')}`;
    if (field.hidden || exempt.has(id)) return;
    const text = typeof field.description === 'string' ? field.description.trim() : '';
    if (!text) missing.push(id);
  });
  return missing;
}
